import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  PAYMENT_TERM_TYPE_BY_LABEL,
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  logServerError,
  refreshTaxRefundCompleteness,
  writeAudit,
} from "./shared";
import { validateDuplicateOrder } from "./order-access";
import { MAX_ORDER_NO_LENGTH, resolveSalespersonCommissionRate } from "./orders-module-shared";
import type { SalesExecutionActor } from "./sales-execution-access";
import {
  assertExpectedSalesExecutionRevision,
  lockFactoryPurchaseOrders,
  lockSalesExecution,
  requireSalesExecutionActorId,
} from "./sales-execution-access";
import { loadSalesExecution } from "./sales-execution-query-service";
import { serializeSalesExecution } from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";

type AuditRequest = Parameters<typeof writeAudit>[0];
const PAYMENT_TERM_TYPES = ["COPY_BL", "OA", "AFTER_ARRIVAL", "INSTALLMENT"] as const;
const MAX_ATTEMPTS = 3;

function receivableOrderSummary(order: {
  id: string;
  orderNo: string;
  status: string;
  deletedAt?: Date | null;
  createdAt?: Date | null;
}) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    deletedAt: order.deletedAt || null,
    createdAt: order.createdAt || null,
  };
}

function mappedPaymentTermType(paymentTerm: string) {
  const mapped = PAYMENT_TERM_TYPE_BY_LABEL[paymentTerm];
  return (PAYMENT_TERM_TYPES as readonly string[]).includes(mapped)
    ? mapped as (typeof PAYMENT_TERM_TYPES)[number]
    : null;
}

function handoffRemark(executionNo: string, requestedDeliveryDate: Date, sourceRemark: string | null) {
  const dateText = requestedDeliveryDate.toISOString().slice(0, 10);
  const prefix = `由销售执行单 ${executionNo} 手动进入发货后创建；客户要求交货日期：${dateText}。`;
  const source = String(sourceRemark || "").trim();
  return source ? `${prefix}\n销售执行备注：${source}`.slice(0, 2000) : prefix;
}

function assertReadyForShipping(execution: Awaited<ReturnType<typeof loadSalesExecution>>) {
  if (execution.status !== "DISPATCHED") {
    throw codedError("只有已正式下发的销售执行单可以进入发货", 409, "SALES_EXECUTION_NOT_DISPATCHED");
  }
  const activePurchaseOrders = execution.purchaseOrders.filter((order) => order.status !== "VOIDED");
  if (!activePurchaseOrders.length) {
    throw codedError("销售执行单没有工厂采购单，不能进入发货", 409, "SHIPPING_PURCHASE_ORDER_REQUIRED");
  }
  const allocatedByItem = new Map<string, Prisma.Decimal>();
  for (const order of activePurchaseOrders) {
    for (const item of order.items) {
      allocatedByItem.set(
        item.executionItemId,
        (allocatedByItem.get(item.executionItemId) || new Prisma.Decimal(0)).add(item.allocatedQuantity),
      );
    }
  }
  const incompleteAllocation = execution.items.some((item) => (
    !(allocatedByItem.get(item.id) || new Prisma.Decimal(0)).eq(item.quantity)
  ));
  if (incompleteAllocation) {
    throw codedError("有效采购单未完整覆盖销售数量，请先完成被拒采购单的重新选厂", 409, "SHIPPING_PURCHASE_ALLOCATION_INCOMPLETE");
  }
  const unaccepted = activePurchaseOrders.filter((order) => order.status !== "ACCEPTED");
  if (unaccepted.length) {
    throw codedError("仍有有效工厂采购单待确认或等待新交期内部确认，不能进入发货", 409, "SHIPPING_PURCHASE_ORDER_NOT_ACCEPTED");
  }
  const unfinished = activePurchaseOrders.filter((order) => (
    order.productionStatus !== "COMPLETED" || !order.productionCompletedAt || !order.productionCompletedById
  ));
  if (unfinished.length) {
    throw codedError("仍有工厂采购单未完成生产，不能进入发货", 409, "SHIPPING_PRODUCTION_NOT_COMPLETED");
  }
  const undelivered = activePurchaseOrders.filter((order) => !order.actualDeliveryDate);
  if (undelivered.length) {
    throw codedError("仍有工厂采购单未登记实际交付日期，不能进入发货", 409, "SHIPPING_ACTUAL_DELIVERY_REQUIRED");
  }
}

async function runHandoffTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (error: unknown) {
      const code = String((error as { code?: string } | null)?.code || "");
      if (code !== "P2034" || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("进入发货事务重试次数已耗尽");
}

export async function enterSalesExecutionShipping(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  assertWrite(actor, "orders");
  const actorId = requireSalesExecutionActorId(actor);
  const input = assertJsonObject(rawInput);
  let result;
  try {
    result = await runHandoffTransaction(async (tx) => {
      await lockSalesExecution(tx, executionId);
      await lockFactoryPurchaseOrders(tx, executionId);
      const before = await loadSalesExecution(executionId, actor, tx);
      await assertCustomerScope(actor, before.customerId, tx);
      if (before.receivableOrder) {
        if (before.receivableOrder.deletedAt || !before.shippingStartedAt) {
          throw codedError("关联应收订单状态异常，请联系管理员处理", 409, "SHIPPING_HANDOFF_INCONSISTENT");
        }
        return {
          execution: serializeSalesExecution(before, true),
          receivableOrder: receivableOrderSummary(before.receivableOrder),
          created: false,
        };
      }
      assertExpectedSalesExecutionRevision(input, before.revision);
      assertReadyForShipping(before);
      const orderNo = before.customerOrderNo.trim();
      if (orderNo.length > MAX_ORDER_NO_LENGTH) {
        throw codedError(`客户订单号不能超过 ${MAX_ORDER_NO_LENGTH} 个字符`, 400, "VALIDATION_TEXT_TOO_LONG");
      }
      if (await validateDuplicateOrder(orderNo, null, tx)) {
        throw codedError(
          "客户订单号已存在于应收订单；请先确认是否已为同一业务建单，并处理订单号冲突后再进入发货。",
          409,
          "ORDER_DUPLICATE",
        );
      }
      const exchangeRate = before.currency === "CNY" ? new Prisma.Decimal(1) : before.exchangeRate;
      const totalAmountCny = before.totalAmount.mul(exchangeRate).toDecimalPlaces(2);
      const paymentTerm = String(before.paymentTerm || "").trim() || "待确认";
      const now = new Date();
      const createdOrder = await tx.receivableOrder.create({
        data: {
          orderNo,
          customerId: before.customerId,
          customerNameSnapshot: before.customerNameSnapshot,
          businessEntityId: before.businessEntityId,
          businessEntityNameSnapshot: before.businessEntityNameSnapshot,
          salespersonUserId: before.salespersonUserId,
          salespersonCommissionRate: resolveSalespersonCommissionRate(before.customer),
          country: before.customer.country || null,
          currency: before.currency,
          exchangeRate,
          exchangeRateDate: before.executionDate,
          exchangeRateSource: before.currency === "CNY" ? "系统" : "历史录入",
          exchangeRateType: before.currency === "CNY" ? "人民币" : "历史录入",
          receivableAmount: before.totalAmount,
          receivableAmountCny: totalAmountCny,
          estimatedReceivableAmount: before.totalAmount,
          estimatedReceivableAmountCny: totalAmountCny,
          actualShipmentAmount: null,
          actualShipmentAmountCny: null,
          actualShipmentDate: null,
          finalReceivableAmount: before.totalAmount,
          finalReceivableAmountCny: totalAmountCny,
          tradeTerm: before.tradeTerm || "FOB",
          paymentTerm,
          paymentTermType: mappedPaymentTermType(paymentTerm),
          expectedShipmentDate: before.requestedDeliveryDate,
          reminderDays: 7,
          status: "草稿",
          remark: handoffRemark(before.executionNo, before.requestedDeliveryDate, before.remark),
          sourceSalesExecutionId: before.id,
          createdById: actorId,
          updatedById: actorId,
        },
      });
      const nextRevision = before.revision + 1;
      const changed = await tx.salesExecution.updateMany({
        where: { id: before.id, status: "DISPATCHED", revision: before.revision, shippingStartedAt: null },
        data: {
          shippingStartedAt: now,
          shippingStartedById: actorId,
          revision: nextRevision,
          currentVersionNumber: nextRevision,
          updatedById: actorId,
        },
      });
      if (changed.count !== 1) {
        throw codedError("销售执行单状态已变化，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
      }
      await appendSalesExecutionVersion(tx, before.id, actor);
      const saved = await loadSalesExecution(before.id, actor, tx);
      const execution = serializeSalesExecution(saved, true);
      const order = receivableOrderSummary(createdOrder);
      await writeAudit(request, { id: actorId }, "销售执行单手动进入发货", "sales_executions", before.id, serializeSalesExecution(before, true), execution, tx);
      await writeAudit(request, { id: actorId }, "由销售执行单生成应收订单草稿", "receivable_orders", createdOrder.id, null, { ...order, sourceSalesExecutionId: before.id }, tx);
      return { execution, receivableOrder: order, created: true };
    });
  } catch (error: unknown) {
    const code = String((error as { code?: string } | null)?.code || "");
    if (code === "P2002") {
      throw codedError("客户订单号或销售执行来源已存在，请刷新后重试", 409, "SHIPPING_HANDOFF_CONFLICT");
    }
    if (code === "P2034") {
      throw codedError("销售执行单刚刚被其他操作更新，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    }
    throw error;
  }
  if (result.created) {
    refreshTaxRefundCompleteness(result.receivableOrder.id).catch((error) => {
      logServerError("进入发货后的退税资料完整度刷新失败", error, { orderId: result.receivableOrder.id });
    });
  }
  return result;
}
