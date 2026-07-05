import { prisma } from "../prisma";
import {
  amountCny,
  codedError,
  nonEmpty,
  optional,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  aggregateLogisticsExpenseStatus,
  buildLogisticsExpenseData,
  ensureLogisticsExpenseBill,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  logisticsExpenseAccessWhere,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { logisticsCostTypeDefaultCurrency } from "./logistics-cost-types";
import {
  actorId,
  asRecord,
  batchSaveLogisticsExpenseBillIdentifier,
  billingAmountFromUnit,
  legacyAppliedContainerCount,
  loadLogisticsExpenseBatchBillRow,
  loadLogisticsExpenseBillRowsForAction,
  logisticsExpenseBatchUpdateData,
  logisticsExpenseBillEditBlockReason,
  logisticsExpenseDeleteBlock,
  logisticsExpenseUpdateBlockReason,
  normalizeBatchBillingMethod,
  normalizeBatchBillingQuantity,
  refreshLogisticsBillWorkflowStatus,
  resolveLogisticsExpenseBatchExchange,
  rowAuditStatus,
  rowBillId,
  rowBillSubmittedAt,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseRow,
  type PreparedCreate,
  type PreparedUpdate,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export async function batchUpdateLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: unknown = {}) {
  assertCanWriteLogisticsExpense(actor);
  const inputRecord = asRecord(input);
  const items = Array.isArray(input)
    ? input.map(asRecord)
    : (Array.isArray(inputRecord.items) ? (inputRecord.items as unknown[]).map(asRecord) : (Array.isArray(inputRecord.rows) ? (inputRecord.rows as unknown[]).map(asRecord) : []));
  if (!items.length) throw codedError("请提供需要保存的物流费用明细。", 400, "LOGISTICS_EXPENSE_BATCH_EMPTY");
  const prepared: PreparedUpdate[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const id = nonEmpty(item.id);
    if (!id) throw codedError(`第 ${index + 1} 行保存失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
    const before = await loadLogisticsExpenseForAction(id, actor);
    const costType = before.costType || "物流费用";
    const unitAmount = Number(item.amount);
    const billingMethod = normalizeBatchBillingMethod(item, before);
    const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
    const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
    if (!Number.isFinite(unitAmount) || unitAmount < 0) throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
    const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
    if (billBlockReason) throw codedError(`第 ${index + 1} 行${costType}保存失败：${billBlockReason}`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
    const blockReason = logisticsExpenseUpdateBlockReason(before);
    if (blockReason) throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
    const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
    const hasContainerType = Object.prototype.hasOwnProperty.call(item, "containerType")
      || Object.prototype.hasOwnProperty.call(item, "container_type");
    prepared.push({
      index,
      before,
      data: {
        amount,
        amountCny: amountCny(amount, before.exchangeRate || 1),
        ...(hasContainerType ? { containerType: optional(item.containerType ?? item.container_type) } : {}),
        appliedContainerCount,
        billingMethod,
        billingQuantity,
        remark: optional(item.remark),
        updatedById: actorId(actor),
      },
    });
  }
  const savedRows: LogisticsExpenseRow[] = [];
  for (const item of prepared) {
    const saved = await prisma.logisticsExpense.update({
      where: { id: item.before.id },
      data: item.data,
      include: includeLogisticsExpenseRelations(),
    });
    savedRows.push(saved);
    await runNonCriticalTask("物流费用批量修改日志写入", () => writeAudit(request, actor, "批量修改物流费用明细", "logistics_expenses", item.before.id, item.before, saved));
  }
  for (const orderId of [...new Set(savedRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(orderId);
  }
  invalidateWorkbenchTodosCache();
  return savedRows.map(serializeLogisticsExpense);
}

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
  const bill = await ensureLogisticsExpenseBill(order, supplier, actor, {
    auditStatus: billStatus || rowAuditStatus(baseExpense),
    submittedAt: rowBillSubmittedAt(baseExpense),
  });
  const targetBillId = bill.id || billId;
  const preparedCreates = await prepareLogisticsExpenseCreates(creates, baseExpense, order, supplier, actor, targetBillId);
  const deletedIds = preparedDeletes.map((row) => row.id);
  await persistLogisticsExpenseBatch(preparedUpdates, preparedCreates, deletedIds, targetBillId, actor);
  const savedBillRows = await loadLogisticsExpenseBillRowsForAction(targetBillId, actor);
  if (!savedBillRows.length && targetBillId) {
    await prisma.logisticsBill.update({
      where: { id: targetBillId },
      data: { deletedAt: new Date(), updatedById: actorId(actor) || null },
    }).catch(() => null);
  } else {
    await refreshLogisticsBillWorkflowStatus(savedBillRows, actor).catch(() => null);
  }
  const serializedItems = savedBillRows.map(serializeLogisticsExpense);
  const serializedBill = savedBillRows.length ? serializeLogisticsExpenseBill(savedBillRows) : null;
  const affectedOrderIds = [...savedBillRows.map((row) => row.orderId), ...preparedDeletes.map((row) => row.orderId)].filter(Boolean);
  for (const orderId of [...new Set(affectedOrderIds)]) scheduleTaxRefundCompletenessRefresh(orderId);
  void runNonCriticalTask("物流费用账单明细批量保存日志写入", () => writeAudit(request, actor, "批量保存物流费用账单明细", "logistics_expenses", targetBillId, {
    bill: serializeLogisticsExpenseBill(billRows),
    deletedIds,
  }, {
    bill: serializedBill,
    updateCount: preparedUpdates.length,
    createCount: preparedCreates.length,
    deleteCount: deletedIds.length,
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
  deletedIds: string[],
  targetBillId: string,
  actor: ActorContext,
) {
  const transactionOperations = [
    ...preparedUpdates.map((item) => prisma.logisticsExpense.update({
      where: { id: item.before.id },
      data: { ...item.data, billId: targetBillId },
    })),
    ...(preparedCreates.length ? [prisma.logisticsExpense.createMany({
      data: preparedCreates.map((item) => item.data),
    })] : []),
    ...(deletedIds.length ? [prisma.logisticsExpense.updateMany({
      where: { id: { in: deletedIds }, deletedAt: null, ...logisticsExpenseAccessWhere(actor) },
      data: { deletedAt: new Date(), updatedById: actorId(actor) },
    })] : []),
  ];
  if (transactionOperations.length) await prisma.$transaction(transactionOperations);
}

export async function deleteLogisticsExpense(request: AuditRequestLike, actor: ActorContext, id: string) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  const billId = rowBillId(before);
  const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
  if (billBlockReason) throw codedError(billBlockReason.replace("修改", "删除"), 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
  const block = logisticsExpenseDeleteBlock(before);
  if (block) throw codedError(block.message, 400, block.code);
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actorId(actor) },
    include: includeLogisticsExpenseRelations(),
  });
  await runNonCriticalTask("物流费用删除日志写入", () => writeAudit(request, actor, "删除物流费用明细", "logistics_expenses", id, before, saved));
  scheduleTaxRefundCompletenessRefresh(saved.orderId);
  const billRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  if (!billRows.length && before.billId) {
    await prisma.logisticsBill.update({
      where: { id: billId },
      data: { deletedAt: new Date(), updatedById: actorId(actor) || null },
    }).catch(() => null);
  } else {
    await refreshLogisticsBillWorkflowStatus(billRows, actor).catch(() => null);
  }
  invalidateWorkbenchTodosCache();
  return serializeLogisticsExpense(saved);
}
