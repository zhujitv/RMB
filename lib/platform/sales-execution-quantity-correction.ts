import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import {
  assertExpectedSalesExecutionRevision,
  lockFactoryPurchaseOrders,
  lockSalesExecution,
  requireSalesExecutionActorId,
  type SalesExecutionActor,
} from "./sales-execution-access";
import { loadSalesExecution } from "./sales-execution-query-service";
import { salesExecutionDecimal, serializeSalesExecution } from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";
import {
  loadQuantityCorrectionReceivable,
  syncQuantityCorrectionReceivable,
} from "./sales-execution-quantity-correction-receivable";

type AuditRequest = Parameters<typeof writeAudit>[0];
type LoadedExecution = Awaited<ReturnType<typeof loadSalesExecution>>;
type LoadedPurchaseOrder = LoadedExecution["purchaseOrders"][number];
type LoadedPurchaseOrderItem = LoadedPurchaseOrder["items"][number];

const ACTIVE_PURCHASE_ORDER_STATUSES = ["DISPATCHED", "ACCEPTED", "DELIVERY_PROPOSED"];
const MAX_ATTEMPTS = 3;

function amount(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal | null | undefined) {
  return unitPrice == null ? null : quantity.mul(unitPrice).toDecimalPlaces(2);
}

function normalizedReason(value: unknown) {
  const reason = String(value || "").trim();
  if (!reason || reason.length > 500) {
    throw codedError("请填写数量更正原因，且不能超过 500 个字符", 400, "SALES_QUANTITY_CORRECTION_REASON_INVALID");
  }
  return reason;
}

function normalizedInput(rawInput: unknown) {
  const input = assertJsonObject(rawInput);
  return {
    purchaseOrderItemId: String(input.purchaseOrderItemId || "").trim(),
    newQuantity: salesExecutionDecimal(input.newQuantity, "正确数量", {
      positive: true, scale: 4, integerDigits: 14,
    }),
    reason: normalizedReason(input.reason),
    expectedRevision: input.expectedRevision,
  };
}

function findTarget(execution: LoadedExecution, purchaseOrderItemId: string) {
  for (const order of execution.purchaseOrders) {
    const item = order.items.find((candidate) => candidate.id === purchaseOrderItemId);
    if (item) return { order, item };
  }
  throw codedError("采购明细不存在，请刷新后重试", 404, "SALES_QUANTITY_CORRECTION_ITEM_NOT_FOUND");
}

function assertCorrectionOpen(execution: LoadedExecution, order: LoadedPurchaseOrder, item: LoadedPurchaseOrderItem) {
  if (execution.sourceType !== "DIRECT") {
    throw codedError("报价转入订单需先走客户订单变更，不能直接更正已下发数量", 409, "SALES_QUANTITY_CORRECTION_SOURCE_LOCKED");
  }
  if (execution.status !== "DISPATCHED") {
    throw codedError("只有已下发的直接创建订单可以更正数量", 409, "SALES_QUANTITY_CORRECTION_STATUS_INVALID");
  }
  if (item.actualDeliveredQuantity !== null || order.actualDeliveryDate) {
    throw codedError("装柜已最终确认，不能再更正订单数量", 409, "SALES_QUANTITY_CORRECTION_SHIPPING_LOCKED");
  }
  if (!ACTIVE_PURCHASE_ORDER_STATUSES.includes(order.status)) {
    throw codedError("该工厂采购单当前状态不能更正数量", 409, "SALES_QUANTITY_CORRECTION_PO_STATUS_INVALID");
  }
  if (order.settlement) {
    throw codedError("该工厂采购单已生成结算，不能再更正订单数量", 409, "SALES_QUANTITY_CORRECTION_SETTLED");
  }
  if ((order.payments || []).some((payment) => payment.status !== "VOIDED")) {
    throw codedError("该工厂采购单已有付款记录，请先冲销后再更正数量", 409, "SALES_QUANTITY_CORRECTION_FACTORY_PAYMENT_EXISTS");
  }
  const activeAllocations = execution.containerLoads
    .filter((load) => load.status !== "VOIDED")
    .flatMap((load) => load.allocations)
    .filter((allocation) => allocation.purchaseOrderItemId === item.id);
  if (activeAllocations.length) {
    throw codedError("该采购明细已进入柜总单分配，请先作废或修正柜总单后再更正数量", 409, "SALES_QUANTITY_CORRECTION_CONTAINER_EXISTS");
  }
  const activeItemsForSalesLine = execution.purchaseOrders
    .filter((candidate) => !["REJECTED", "VOIDED"].includes(candidate.status))
    .flatMap((candidate) => candidate.items)
    .filter((candidate) => candidate.executionItemId === item.executionItemId);
  if (activeItemsForSalesLine.length !== 1) {
    throw codedError("该销售明细已拆分多家供应商，请先补专门的拆分变更流程", 409, "SALES_QUANTITY_CORRECTION_SPLIT_LINE");
  }
  return { resetShippingStartedAt: Boolean(execution.shippingStartedAt) };
}

function latestCompleted(order: LoadedPurchaseOrder) {
  const latest = [...(order.productionProgressReports || [])].sort((left, right) => right.sequenceNo - left.sequenceNo)[0];
  return new Map((latest?.items || []).map((item) => [
    item.purchaseOrderItemId,
    new Prisma.Decimal(item.completedQuantity.toString()),
  ]));
}

async function addCompletionCorrectionReport(
  tx: Prisma.TransactionClient,
  order: LoadedPurchaseOrder,
  targetItemId: string,
  newQuantity: Prisma.Decimal,
  actorId: string,
  reason: string,
) {
  if (order.status !== "ACCEPTED" || order.productionStatus !== "COMPLETED") return;
  if (!order.productionStartedAt) {
    throw codedError("历史生产记录缺少开始生产时间，不能自动补充完成数量", 409, "SALES_QUANTITY_CORRECTION_PROGRESS_INVALID");
  }
  const completed = latestCompleted(order);
  if ((completed.get(targetItemId) || new Prisma.Decimal(0)).gte(newQuantity)) return;
  const sequenceNo = (order.productionProgressReports || []).reduce((max, report) => Math.max(max, report.sequenceNo), 0) + 1;
  const now = new Date();
  await tx.factoryPurchaseOrderProductionReport.create({
    data: {
      purchaseOrderId: order.id,
      sequenceNo,
      reportedById: actorId,
      source: "INTERNAL_OFFLINE",
      channel: "OTHER",
      supplierContact: "内部数量更正",
      supplierReportedAt: now,
      reportedAt: now,
      remark: `订单数量更正：${reason}`.slice(0, 2000),
      items: {
        create: order.items.map((item) => ({
          purchaseOrderItemId: item.id,
          completedQuantity: item.id === targetItemId
            ? newQuantity
            : completed.get(item.id) || item.allocatedQuantity,
        })),
      },
    },
  });
}

async function runCorrection<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (error: unknown) {
      if (String((error as { code?: string } | null)?.code || "") !== "P2034" || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("订单数量更正事务重试次数已耗尽");
}

export async function correctSalesExecutionQuantity(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  assertWrite(actor, "orders");
  const actorId = requireSalesExecutionActorId(actor);
  const input = normalizedInput(rawInput);
  return runCorrection(async (tx) => {
    await lockSalesExecution(tx, executionId);
    await lockFactoryPurchaseOrders(tx, executionId);
    const before = await loadSalesExecution(executionId, actor, tx);
    await assertCustomerScope(actor, before.customerId, tx);
    assertExpectedSalesExecutionRevision({ expectedRevision: input.expectedRevision }, before.revision);
    const { order, item } = findTarget(before, input.purchaseOrderItemId);
    const correctionOpen = assertCorrectionOpen(before, order, item);
    if (input.newQuantity.eq(item.allocatedQuantity)) {
      throw codedError("正确数量与当前数量一致，无需更正", 400, "SALES_QUANTITY_CORRECTION_UNCHANGED");
    }
    const receivable = await loadQuantityCorrectionReceivable(tx, before, actorId);
    await tx.$executeRaw`SELECT set_config('app.sales_quantity_correction', 'on', true)`;
    const salesItem = before.items.find((candidate) => candidate.id === item.executionItemId);
    if (!salesItem) throw codedError("销售明细不存在，请刷新后重试", 404, "SALES_QUANTITY_CORRECTION_SALES_ITEM_NOT_FOUND");
    const salesAmount = amount(input.newQuantity, salesItem.salesUnitPrice);
    if (!salesAmount) throw codedError("销售单价异常，不能更正数量", 409, "SALES_QUANTITY_CORRECTION_SALES_PRICE_MISSING");
    const purchaseAmount = amount(input.newQuantity, item.purchaseUnitPrice);
    const supplierAmount = amount(input.newQuantity, item.supplierPrice?.unitPrice);
    const salesItemUpdate = await tx.salesExecutionItem.updateMany({
      where: { id: salesItem.id, executionId: before.id },
      data: { quantity: input.newQuantity, salesAmount },
    });
    const purchaseItemUpdate = await tx.factoryPurchaseOrderItem.updateMany({
      where: { id: item.id, purchaseOrderId: order.id },
      data: { allocatedQuantity: input.newQuantity, amount: purchaseAmount },
    });
    if (salesItemUpdate.count !== 1 || purchaseItemUpdate.count !== 1) {
      throw codedError("订单明细已变化，请刷新后重试", 409, "SALES_QUANTITY_CORRECTION_LINE_CONFLICT");
    }
    if (supplierAmount) {
      await tx.factoryPurchaseOrderSupplierPrice.updateMany({
        where: { purchaseOrderId: order.id, purchaseOrderItemId: item.id },
        data: { amount: supplierAmount },
      });
    }
    const newSalesTotal = before.items.reduce((sum, candidate) => (
      sum.add(candidate.id === salesItem.id ? salesAmount : candidate.salesAmount)
    ), new Prisma.Decimal(0)).toDecimalPlaces(2);
    const newPoSubtotal = order.items.reduce((sum, candidate) => {
      const value = candidate.id === item.id ? purchaseAmount : candidate.amount;
      return value == null ? null : (sum as Prisma.Decimal).add(value);
    }, new Prisma.Decimal(0) as Prisma.Decimal | null)?.toDecimalPlaces(2) || null;
    const newPenaltyBase = order.penaltyBaseAmount == null ? null : order.items.reduce((sum, candidate) => {
      const value = candidate.id === item.id
        ? supplierAmount ?? purchaseAmount
        : candidate.supplierPrice?.amount ?? candidate.amount;
      return value == null ? null : (sum as Prisma.Decimal).add(value);
    }, new Prisma.Decimal(0) as Prisma.Decimal | null)?.toDecimalPlaces(2) || null;
    const purchaseOrderUpdate = await tx.factoryPurchaseOrder.updateMany({
      where: { id: order.id, executionId: before.id, revision: order.revision },
      data: { subtotal: newPoSubtotal, penaltyBaseAmount: newPenaltyBase, revision: { increment: 1 }, updatedById: actorId },
    });
    if (purchaseOrderUpdate.count !== 1) {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "SALES_QUANTITY_CORRECTION_PO_CONFLICT");
    }
    await addCompletionCorrectionReport(tx, order, item.id, input.newQuantity, actorId, input.reason);
    const nextRevision = before.revision + 1;
    const executionUpdate = await tx.salesExecution.updateMany({
      where: { id: before.id, revision: before.revision },
      data: {
        subtotal: newSalesTotal,
        totalAmount: newSalesTotal,
        revision: nextRevision,
        currentVersionNumber: nextRevision,
        ...(correctionOpen.resetShippingStartedAt ? { shippingStartedAt: null, shippingStartedById: null } : {}),
        updatedById: actorId,
      },
    });
    if (executionUpdate.count !== 1) {
      throw codedError("销售执行单已被其他用户更新，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    }
    if (receivable) {
      await syncQuantityCorrectionReceivable(tx, request, actorId, receivable, newSalesTotal, input.reason);
    }
    await appendSalesExecutionVersion(tx, before.id, actor);
    const saved = await loadSalesExecution(before.id, actor, tx);
    const after = serializeSalesExecution(saved, true);
    await writeAudit(request, { id: actorId }, "更正已下发订单数量", "sales_executions", before.id, serializeSalesExecution(before, true), {
      execution: after,
      purchaseOrderItemId: item.id,
      oldQuantity: item.allocatedQuantity.toString(),
      newQuantity: input.newQuantity.toString(),
      shippingStartedMarkerReset: correctionOpen.resetShippingStartedAt,
      reason: input.reason,
    }, tx);
    return after;
  });
}
