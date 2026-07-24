import { prisma } from "../prisma";
import {
  amountCny,
  codedError,
  nonEmpty,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  aggregateLogisticsExpenseStatus,
  buildLogisticsExpenseData,
  ensureLogisticsExpenseBill,
  logisticsExpenseAccessWhere,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { logisticsCostTypeDefaultCurrency } from "./logistics-cost-types";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  asRecord,
  batchSaveLogisticsExpenseBillIdentifier,
  billingAmountFromUnit,
  legacyAppliedContainerCount,
  loadLogisticsExpenseBatchBillRow,
  loadLogisticsExpenseBillRowsForAction,
  logisticsExpenseBatchUpdateData,
  logisticsExpenseDeleteBlock,
  logisticsExpenseUpdateBlockReason,
  lockLogisticsBillForWorkflow,
  normalizeBatchBillingMethod,
  normalizeBatchBillingQuantity,
  resolveLogisticsExpenseBatchExchange,
  rowAuditStatus,
  rowBillId,
  rowBillStatus,
  rowBillSubmittedAt,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseRow,
  type PreparedCreate,
  type PreparedUpdate,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

export async function batchSaveLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const updates = Array.isArray(input.updates) ? input.updates.map(asRecord) : [];
  const creates = Array.isArray(input.creates) ? input.creates.map(asRecord) : [];
  const deletes = Array.isArray(input.deletes) ? input.deletes : [];
  if (!updates.length && !creates.length && !deletes.length) throw codedError("请提供需要保存的物流费用明细。", 400, "LOGISTICS_EXPENSE_BATCH_SAVE_EMPTY");
  const startedAt = Date.now();
  const identifier = batchSaveLogisticsExpenseBillIdentifier(input, updates, deletes);
  const billRows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!billRows.length) throw codedError("未找到当前物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const billId = rowBillId(billRows[0]);
  if (billRows.some((row) => rowBillStatus(row) === "voided")) {
    throw codedError("该物流费用账单已作废，不能保存明细。", 400, "LOGISTICS_BILL_VOIDED_SAVE_BLOCKED");
  }
  const billStatus = aggregateLogisticsExpenseStatus(billRows, "auditStatus");
  if (!["草稿", "已驳回"].includes(billStatus || "草稿")) {
    throw codedError(`账单${billStatus || "当前状态"}，不能保存明细，请先撤回为草稿。`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
  }
  const billRowById = new Map(billRows.map((row) => [row.id, row]));
  const preparedUpdates: PreparedUpdate[] = [];
  const preparedDeletes: LogisticsExpenseRow[] = [];
  for (let index = 0; index < updates.length; index += 1) {
    const before = loadLogisticsExpenseBatchBillRow(billRowById, updates[index]?.id, index, "保存");
    const data = await logisticsExpenseBatchUpdateData(updates[index] || {}, before, actor, index);
    preparedUpdates.push({ before, data });
  }
  for (let index = 0; index < deletes.length; index += 1) {
    const before = loadLogisticsExpenseBatchBillRow(billRowById, deletes[index], index, "删除");
    const block = logisticsExpenseDeleteBlock(before);
    if (block) throw codedError(`第 ${index + 1} 行${before.costType || "物流费用"}删除失败：${block.message}`, 400, block.code);
    preparedDeletes.push(before);
  }
  const baseExpense = preparedUpdates[0]?.before || preparedDeletes[0] || billRows[0];
  const order = baseExpense.order;
  const supplier = baseExpense.supplier;
  if (!order?.id || !supplier?.id) throw codedError("当前账单缺少订单或供应商信息，不能保存明细。", 400, "LOGISTICS_EXPENSE_BILL_CONTEXT_INVALID");
  const preparedCreates = await prepareLogisticsExpenseCreates(creates, baseExpense, order, supplier, actor, billId);
  const deletedIds = preparedDeletes.map((row) => row.id);
  const targetBillId = await persistLogisticsExpenseBatch(
    preparedUpdates,
    preparedCreates,
    preparedDeletes,
    billId,
    order,
    supplier,
    billStatus || rowAuditStatus(baseExpense),
    rowBillSubmittedAt(baseExpense),
    actor,
  );
  const savedBillRows = await loadLogisticsExpenseBillRowsForAction(targetBillId, actor);
  const serializedItems = savedBillRows.map(serializeLogisticsExpense);
  const serializedBill = savedBillRows.length ? serializeLogisticsExpenseBill(savedBillRows) : null;
  const affectedOrderIds = [...savedBillRows.map((row) => row.orderId), ...preparedDeletes.map((row) => row.orderId)].filter(Boolean);
  for (const orderId of [...new Set(affectedOrderIds)]) scheduleTaxRefundCompletenessRefresh(orderId);
  void runNonCriticalTask("物流费用账单明细批量保存日志写入", () => writeAudit(request, actor, "批量保存物流费用账单明细", "logistics_expenses", targetBillId, {
    bill: serializeLogisticsExpenseBill(billRows),
    deletedIds,
    deletedItems: preparedDeletes.map((row) => ({
      id: row.id,
      costType: row.costType || "",
      amount: Number(row.amount || 0),
      currency: row.currency || "CNY",
    })),
  }, {
    bill: serializedBill,
    updateCount: preparedUpdates.length,
    createCount: preparedCreates.length,
    deleteCount: deletedIds.length,
    deletedItems: preparedDeletes.map((row) => ({
      id: row.id,
      deletedById: actorId(actor) || "",
      deletedAt: new Date().toISOString(),
      costType: row.costType || "",
      amount: Number(row.amount || 0),
      currency: row.currency || "CNY",
    })),
    durationMs: Date.now() - startedAt,
  }));
  console.info("[logistics-expense.batch-save]", {
    billId: targetBillId,
    updateCount: preparedUpdates.length,
    createCount: preparedCreates.length,
    deleteCount: deletedIds.length,
    durationMs: Date.now() - startedAt,
  });
  invalidateWorkbenchTodosCache();
  return {
    billId: targetBillId,
    bill: serializedBill,
    items: serializedItems,
    details: serializedItems,
    deletedIds,
    totalAmount: serializedBill?.amount || 0,
    totalAmountCny: serializedBill?.amountCny || 0,
    updatedAt: serializedBill?.updatedAt || new Date().toISOString(),
  };
}

async function prepareLogisticsExpenseCreates(
  creates: UnknownRecord[],
  baseExpense: LogisticsExpenseRow,
  order: LogisticsExpenseRow["order"],
  supplier: LogisticsExpenseRow["supplier"],
  actor: ActorContext,
  targetBillId: string,
): Promise<PreparedCreate[]> {
  const preparedCreates: PreparedCreate[] = [];
  for (let index = 0; index < creates.length; index += 1) {
    const item = creates[index] || {};
    const costType = nonEmpty(item.expenseType || item.costType || item.feeType);
    if (!costType) throw codedError(`第 ${index + 1} 行请选择费用类型`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_COST_TYPE_REQUIRED");
    const unitAmount = Number(item.unitAmount ?? item.unit_amount ?? item.amount);
    const billingMethod = normalizeBatchBillingMethod(item);
    const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
    const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
    if (!nonEmpty(item.unitAmount ?? item.unit_amount ?? item.amount)) throw codedError(`第 ${index + 1} 行金额不能为空`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_REQUIRED");
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_INVALID");
    const blockReason = logisticsExpenseUpdateBlockReason(baseExpense);
    if (blockReason) throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_STATUS_BLOCKED");
    const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
    const currency = nonEmpty(item.currency || logisticsCostTypeDefaultCurrency(costType)).toUpperCase();
    const exchange = await resolveLogisticsExpenseBatchExchange(costType, item, baseExpense, actor, currency, index);
    const data = await buildLogisticsExpenseData(order, supplier, actor, {
      costType,
      amount,
      appliedContainerCount,
      billingMethod,
      billingQuantity,
      currency: exchange.currency,
      exchangeRate: exchange.exchangeRate,
      exchangeRateDate: exchange.exchangeRateDate,
      exchangeRateSource: exchange.exchangeRateSource,
      exchangeRateType: exchange.exchangeRateType,
      remark: item.remark,
      auditStatus: ["草稿", "已驳回"].includes(rowAuditStatus(baseExpense)) ? rowAuditStatus(baseExpense) : "草稿",
      supplierId: baseExpense.supplierId,
      billId: targetBillId,
    });
    preparedCreates.push({ data: { ...data, billId: targetBillId } });
  }
  return preparedCreates;
}

async function persistLogisticsExpenseBatch(
  preparedUpdates: PreparedUpdate[],
  preparedCreates: PreparedCreate[],
  preparedDeletes: LogisticsExpenseRow[],
  existingBillId: string,
  order: NonNullable<LogisticsExpenseRow["order"]>,
  supplier: NonNullable<LogisticsExpenseRow["supplier"]>,
  auditStatus: string,
  submittedAt: Date | string | null | undefined,
  actor: ActorContext,
) {
  return prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      order.id,
      "该订单已提交退税并归档，不能保存物流费用明细。",
    );
    await assertCommissionOrderWritableInTransaction(tx, order.id);
    const ensuredBill = await ensureLogisticsExpenseBill(order, supplier, actor, {
      auditStatus,
      submittedAt,
    }, tx);
    const targetBillId = ensuredBill.id || existingBillId;
    await lockLogisticsBillForWorkflow(tx, targetBillId);
    const currentBill = await tx.logisticsBill.findUnique({ where: { id: targetBillId } });
    if (!currentBill || !["草稿", "已驳回"].includes(currentBill.auditStatus)) {
      throw codedError("账单状态已变化，明细保存已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_BATCH_SAVE_STATE_CHANGED");
    }
    for (const item of preparedUpdates) {
      const updated = await tx.logisticsExpense.updateMany({
        where: {
          id: item.before.id,
          billId: targetBillId,
          deletedAt: null,
          updatedAt: item.before.updatedAt,
        },
        data: { ...item.data, billId: targetBillId },
      });
      if (updated.count !== 1) {
        throw codedError("费用明细状态已变化，保存已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_BATCH_ITEM_CHANGED");
      }
    }
    if (preparedCreates.length) {
      await tx.logisticsExpense.createMany({ data: preparedCreates.map((item) => item.data) });
    }
    if (preparedDeletes.length) {
      const deleted = await tx.logisticsExpense.updateMany({
        where: {
          billId: targetBillId,
          deletedAt: null,
          ...logisticsExpenseAccessWhere(actor),
          OR: preparedDeletes.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
        },
        data: { deletedAt: new Date(), updatedById: actorId(actor) },
      });
      if (deleted.count !== preparedDeletes.length) {
        throw codedError("费用明细状态已变化，删除已取消，请刷新后重试。", 409, "LOGISTICS_EXPENSE_BATCH_DELETE_CHANGED");
      }
    }
    const remainingCount = await tx.logisticsExpense.count({ where: { billId: targetBillId, deletedAt: null } });
    await tx.logisticsBill.update({
      where: { id: targetBillId },
      data: remainingCount
        ? { invoiceStatus: "待开票", paymentStatus: "待开票", updatedById: actorId(actor) || null }
        : { deletedAt: new Date(), updatedById: actorId(actor) || null },
    });
    return targetBillId;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
}
