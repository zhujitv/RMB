import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import type { SalesExecutionActor } from "./sales-execution-access";
import {
  assertExpectedSalesExecutionRevision,
  assertSalesExecutionDraft,
  lockSalesExecution,
  requireSalesExecutionActorId,
} from "./sales-execution-access";
import { factoryPurchaseOrderNumber } from "./sales-execution-number";
import { loadSalesExecution } from "./sales-execution-query-service";
import {
  executionRecord,
  executionText,
  nullableDecimalSubtotal,
  nullableSalesExecutionDecimal,
  requiredCustomerOrderNo,
  requiredRequestedDeliveryDate,
  salesExecutionCurrency,
  salesExecutionDate,
  salesExecutionDecimal,
  serializeSalesExecution,
} from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";
import { quotationLineAmount } from "./quotation-calculations";

type AuditRequest = Parameters<typeof writeAudit>[0];

type Allocation = {
  executionItemId: string;
  supplierId: string;
  purchaseCurrency: string;
  allocatedQuantity: Prisma.Decimal;
  purchaseUnitPrice: Prisma.Decimal | null;
  amount: Prisma.Decimal | null;
  requestedDeliveryDate: Date | null;
  paymentTerm: string | null;
  remark: string | null;
};

function allocationRows(value: unknown, executionCurrency: string) {
  if (!Array.isArray(value) || value.length < 1) {
    throw codedError(
      "请完整分配每条销售明细后再保存采购草稿",
      400,
      "PURCHASE_ALLOCATIONS_REQUIRED",
    );
  }
  if (value.length > 500) {
    throw codedError("单份执行单最多支持 500 条工厂分配", 400, "PURCHASE_ALLOCATIONS_LIMIT");
  }
  return value.map((raw, index): Allocation => {
    const row = executionRecord(raw);
    const executionItemId = executionText(row.executionItemId, `第 ${index + 1} 条销售明细`, 100, true);
    const supplierId = executionText(row.supplierId, `第 ${index + 1} 条工厂`, 100, true);
    const purchaseCurrency = salesExecutionCurrency(row.purchaseCurrency, executionCurrency);
    const allocatedQuantity = salesExecutionDecimal(row.allocatedQuantity ?? row.quantity, `第 ${index + 1} 条分配数量`, {
      positive: true,
      scale: 4,
      integerDigits: 14,
    });
    const purchaseUnitPrice = nullableSalesExecutionDecimal(
      Object.prototype.hasOwnProperty.call(row, "purchaseUnitPrice")
        ? row.purchaseUnitPrice
        : row.unitPrice,
      `第 ${index + 1} 条采购单价`,
      { scale: 6, integerDigits: 12 },
    );
    const amount = purchaseUnitPrice === null
      ? null
      : salesExecutionDecimal(
        quotationLineAmount(allocatedQuantity, purchaseUnitPrice).toString(),
        `第 ${index + 1} 条采购金额`,
        { scale: 2, integerDigits: 16 },
      );
    return {
      executionItemId,
      supplierId,
      purchaseCurrency,
      allocatedQuantity,
      purchaseUnitPrice,
      amount,
      requestedDeliveryDate: salesExecutionDate(row.requestedDeliveryDate, `第 ${index + 1} 条要求交期`, null) || null,
      paymentTerm: executionText(row.paymentTerm, `第 ${index + 1} 条付款条款`, 500) || null,
      remark: executionText(row.remark, `第 ${index + 1} 条采购备注`, 1000) || null,
    };
  });
}

export function purchaseOrderSubtotal(rows: Array<{ amount: Prisma.Decimal | null }>) {
  return nullableDecimalSubtotal(rows.map((row) => row.amount));
}

function validateExactAllocations(
  items: Array<{ id: string; quantity: Prisma.Decimal }>,
  allocations: Allocation[],
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const totals = new Map<string, Prisma.Decimal>();
  const groupItemKeys = new Set<string>();
  for (const allocation of allocations) {
    if (!itemById.has(allocation.executionItemId)) {
      throw codedError("采购分配引用了无效的销售明细", 400, "PURCHASE_EXECUTION_ITEM_INVALID");
    }
    const groupItemKey = `${allocation.supplierId}\u0000${allocation.purchaseCurrency}\u0000${allocation.executionItemId}`;
    if (groupItemKeys.has(groupItemKey)) {
      throw codedError("同一工厂、币种和销售明细不能重复分配", 400, "PURCHASE_ALLOCATION_DUPLICATE");
    }
    groupItemKeys.add(groupItemKey);
    totals.set(
      allocation.executionItemId,
      (totals.get(allocation.executionItemId) || new Prisma.Decimal(0)).add(allocation.allocatedQuantity),
    );
  }
  for (const item of items) {
    const allocated = totals.get(item.id) || new Prisma.Decimal(0);
    if (!allocated.eq(item.quantity)) {
      throw codedError(
        "每条销售明细的工厂分配数量必须与销售数量完全一致",
        409,
        "PURCHASE_ALLOCATION_NOT_EXACT",
      );
    }
  }
}

function groupAllocations(allocations: Allocation[]) {
  const groups = new Map<string, { supplierId: string; purchaseCurrency: string; rows: Allocation[] }>();
  for (const row of allocations) {
    const key = `${row.supplierId}\u0000${row.purchaseCurrency}`;
    const group = groups.get(key) || { supplierId: row.supplierId, purchaseCurrency: row.purchaseCurrency, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function allocationsForExecutionLines(
  value: unknown,
  items: Array<{ id: string; lineNumber: number }>,
) {
  if (!Array.isArray(value)) return value;
  const itemByLine = new Map(items.map((item) => [item.lineNumber, item.id]));
  return value.map((raw, index) => {
    const row = executionRecord(raw);
    const executionItemId = itemByLine.get(Number(row.executionLineNumber));
    if (!executionItemId) {
      throw codedError(`第 ${index + 1} 条采购分配未匹配销售明细`, 400, "PURCHASE_EXECUTION_ITEM_INVALID");
    }
    return { ...row, executionItemId };
  });
}

export async function replaceFactoryPurchaseOrderRows(
  tx: Prisma.TransactionClient,
  actorId: string,
  execution: Awaited<ReturnType<typeof loadSalesExecution>>,
  value: unknown,
) {
  requiredCustomerOrderNo(execution.customerOrderNo);
  requiredRequestedDeliveryDate(execution.requestedDeliveryDate);
  const allocations = allocationRows(value, execution.currency);
  validateExactAllocations(execution.items, allocations);
  const supplierIds = [...new Set(allocations.map((row) => row.supplierId))];
  const suppliers = await tx.supplier.findMany({
    where: {
      id: { in: supplierIds },
      deletedAt: null,
      status: "启用",
      supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
    },
  });
  if (suppliers.length !== supplierIds.length) {
    throw codedError("采购分配包含无效、停用或非产品供应商", 400, "PURCHASE_SUPPLIER_INVALID");
  }
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const itemById = new Map(execution.items.map((item) => [item.id, item]));
  const groups = groupAllocations(allocations);

  await tx.factoryPurchaseOrder.deleteMany({ where: { executionId: execution.id } });
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const supplier = supplierById.get(group.supplierId);
    if (!supplier) throw codedError("采购工厂不存在", 400, "PURCHASE_SUPPLIER_INVALID");
    const sequenceNo = groupIndex + 1;
    const subtotal = purchaseOrderSubtotal(group.rows);
    const requestedDates = group.rows.map((row) => row.requestedDeliveryDate).filter(Boolean) as Date[];
    const order = await tx.factoryPurchaseOrder.create({
      data: {
        executionId: execution.id,
        sequenceNo,
        poNo: factoryPurchaseOrderNumber(execution.executionNo, sequenceNo),
        supplierId: supplier.id,
        supplierNameSnapshot: supplier.supplierName,
        purchaseCurrency: group.purchaseCurrency,
        subtotal,
        // 工厂分配的要求日可以更细，但客户原始交期始终保留在执行单上。
        // 未来供应商改期应使用独立回复字段，不覆盖这两个要求日期。
        requestedDeliveryDate: requestedDates[0] || execution.requestedDeliveryDate,
        paymentTerm: group.rows.find((row) => row.paymentTerm)?.paymentTerm || supplier.purchasePaymentTerm || null,
        prepaymentRatio: supplier.purchasePrepaymentRatio,
        prepaymentRequiredBeforeProduction:
          supplier.purchasePrepaymentRatio.gt(0) && supplier.purchasePrepaymentRequiredBeforeProduction,
        delayGraceDays: 10,
        delayPenaltyRatePerDay: new Prisma.Decimal("0.00003"),
        delayPenaltyCapRatio: null,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    await tx.factoryPurchaseOrderItem.createMany({
      data: group.rows.map((row, rowIndex) => {
        const item = itemById.get(row.executionItemId);
        if (!item) throw codedError("采购分配销售明细不存在", 400, "PURCHASE_EXECUTION_ITEM_INVALID");
        return {
          purchaseOrderId: order.id,
          executionId: execution.id,
          executionItemId: item.id,
          lineNumber: rowIndex + 1,
          productNameSnapshot: item.productNameSnapshot,
          specificationSnapshot: item.specificationSnapshot,
          unitSnapshot: item.unitSnapshot,
          allocatedQuantity: row.allocatedQuantity,
          purchaseUnitPrice: row.purchaseUnitPrice,
          amount: row.amount,
          remark: row.remark,
        };
      }),
    });
  }
}

export async function replaceFactoryPurchaseOrderDrafts(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const body = assertJsonObject(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockSalesExecution(tx, executionId);
      const before = await loadSalesExecution(executionId, actor, tx);
      await assertCustomerScope(actor, before.customerId, tx);
      assertSalesExecutionDraft(before.status);
      assertExpectedSalesExecutionRevision(body, before.revision);
      await replaceFactoryPurchaseOrderRows(tx, actorId, before, body.allocations ?? body.drafts);

      const nextRevision = before.revision + 1;
      const changed = await tx.salesExecution.updateMany({
        where: { id: before.id, status: "DRAFT", revision: before.revision },
        data: {
          revision: nextRevision,
          currentVersionNumber: nextRevision,
          updatedById: actorId,
        },
      });
      if (changed.count !== 1) {
        throw codedError("销售执行单已被其他用户更新，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
      }
      await appendSalesExecutionVersion(tx, before.id, actor);
      const saved = await loadSalesExecution(before.id, actor, tx);
      const serialized = serializeSalesExecution(saved, true);
      await writeAudit(
        request,
        { id: actorId },
        "替换工厂采购单草稿",
        "sales_executions",
        before.id,
        serializeSalesExecution(before, true),
        serialized,
        tx,
      );
      return serialized;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError("采购草稿已被其他用户更新，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    }
    throw error;
  }
}
