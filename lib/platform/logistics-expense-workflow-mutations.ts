import { prisma } from "../prisma";
import {
  CURRENCIES,
  amountCny,
  codedError,
  dateFromInput,
  getExchangeRateQuote,
  nonEmpty,
  normalizedCostType,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  runNonCriticalTask,
  todayInputInChina,
  writeAudit,
} from "./shared";
import {
  assertCanWriteLogisticsExpense,
  assertLogisticsExpenseOrder,
  assertLogisticsExpenseSupplier,
  aggregateLogisticsExpenseStatus,
  buildLogisticsExpenseData,
  ensureLogisticsExpenseBill,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  logisticsExpenseAccessWhere,
  logisticsExpenseRequestedAuditStatus,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { LOGISTICS_COST_TYPES, logisticsCostTypeDefaultCurrency, logisticsCostTypeLocksCurrency } from "./logistics-cost-types";
import { canSubmitLogisticsBill, canWithdrawLogisticsBill } from "./logistics-bill-state-machine";
import {
  actorId,
  asRecord,
  batchSaveLogisticsExpenseBillIdentifier,
  billingAmountFromUnit,
  exchangeActor,
  legacyAppliedContainerCount,
  loadLogisticsExpenseBatchBillRow,
  loadLogisticsExpenseBillRowsForAction,
  loadLogisticsExpenseBillRowsForSubmit,
  logisticsExpenseBatchUpdateData,
  logisticsExpenseBillEditBlockReason,
  logisticsExpenseDeleteBlock,
  logisticsExpenseUpdateBlockReason,
  normalizeBatchBillingMethod,
  normalizeBatchBillingQuantity,
  refreshLogisticsBillWorkflowStatus,
  rowAuditStatus,
  rowBillId,
  rowBillSubmittedAt,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseCreateData,
  type LogisticsExpenseRow,
  type LogisticsExpenseUpdateData,
  type PreparedCreate,
  type PreparedUpdate,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { reviewLogisticsExpenseBills } from "./logistics-expense-workflow-review";

export async function saveLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const order = await assertLogisticsExpenseOrder(input, actor);
  const items = Array.isArray(input.items) && input.items.length ? input.items.map(asRecord) : [input];
  const rows: LogisticsExpenseCreateData[] = [];
  for (const item of items) {
    const supplier = await assertLogisticsExpenseSupplier(actor, order, { ...input, ...item });
    const auditStatus = logisticsExpenseRequestedAuditStatus({ ...input, ...item });
    const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, ...item });
    const bill = await ensureLogisticsExpenseBill(order, supplier, actor, {
      auditStatus,
      submittedAt: auditStatus === "待审核" ? new Date() : null,
    });
    rows.push({ ...data, billId: bill.id });
  }
  const expenses: LogisticsExpenseRow[] = [];
  for (const data of rows) {
    const expense = await prisma.logisticsExpense.create({ data, include: includeLogisticsExpenseRelations() });
    expenses.push(expense);
    await runNonCriticalTask("物流费用提交日志写入", () => writeAudit(request, actor, rowAuditStatus(expense) === "草稿" ? "保存物流费用草稿" : "提交物流费用审核", "logistics_expenses", expense.id, null, expense));
  }
  return {
    rows: expenses.map(serializeLogisticsExpense),
    totalAmountCny: expenses.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
  };
}

export async function updateLogisticsExpense(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (input.action === "withdraw") {
    return withdrawLogisticsExpenseBill(request, actor, rowBillId(before));
  }
  if (input.action === "submit") {
    return submitLogisticsExpenseBill(request, actor, rowBillId(before));
  }
  const order = await assertLogisticsExpenseOrder({ orderId: before.orderId }, actor);
  const supplier = await assertLogisticsExpenseSupplier(actor, order, { supplierId: before.supplierId });
  const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, supplierId: before.supplierId }, before);
  const saved = await prisma.logisticsExpense.update({ where: { id }, data, include: includeLogisticsExpenseRelations() });
  await runNonCriticalTask("物流费用修改日志写入", () => writeAudit(request, actor, "修改物流费用", "logistics_expenses", id, before, saved));
  return serializeLogisticsExpense(saved);
}

export async function withdrawLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  assertCanWriteLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const billAuditStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  const billInvoiceStatus = aggregateLogisticsExpenseStatus(rows, "invoiceStatus");
  const billId = rowBillId(rows[0]);
  const canWithdraw = canWithdrawLogisticsBill({ auditStatus: billAuditStatus });
  console.info("[logistics-expense.withdraw]", {
    billId,
    identifier,
    status: billAuditStatus,
    auditStatus: billAuditStatus,
    invoiceStatus: billInvoiceStatus,
    userId: actor?.id || "",
    userRole: actor?.role || "",
    canWithdraw,
    reason: canWithdraw ? "账单主状态为待审核，允许撤回" : `账单主状态为${billAuditStatus || "未知"}，不能撤回`,
  });
  if (!canWithdraw) {
    throw codedError(`只有待审核账单可以撤回。当前账单状态：${billAuditStatus || "未知"}。`, 400, "LOGISTICS_EXPENSE_WITHDRAW_NOT_ALLOWED");
  }
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (rows[0]?.billId) {
    await prisma.logisticsBill.update({
      where: { id: billId },
      data: {
        auditStatus: "草稿",
        submittedAt: null,
        submittedById: null,
        updatedById: actorId(actor),
      },
    });
  } else {
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  }
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  void runNonCriticalTask("物流费用账单撤回日志写入", () => writeAudit(request, actor, "撤回物流费用账单", "logistics_bills", billId, rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
    updatedIds: ids,
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
  };
}

export async function submitLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  const startedAt = Date.now();
  let billId = "";
  let rowCount = 0;
  let success = false;
  assertCanWriteLogisticsExpense(actor);
  try {
    const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
    if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
    billId = rowBillId(rows[0]);
    rowCount = rows.length;
    const blocked = rows.find((row) => !canSubmitLogisticsBill({ auditStatus: rowAuditStatus(row) }));
    if (blocked) {
      throw codedError("只有草稿或已驳回费用可以提交审核。", 400, "LOGISTICS_EXPENSE_SUBMIT_NOT_ALLOWED");
    }
    const submittedAt = new Date();
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (rows[0]?.billId) {
      await prisma.logisticsBill.update({
        where: { id: billId },
        data: {
          auditStatus: "待审核",
          submittedAt,
          submittedById: actorId(actor) || null,
          rejectReason: null,
          invoiceNotificationError: null,
          updatedById: actorId(actor),
        },
      });
    } else {
      throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
    }
    const submittedAtIso = submittedAt.toISOString();
    void runNonCriticalTask("物流费用提交审核日志写入", () => writeAudit(request, actor, "提交物流费用审核", "logistics_bills", billId, rows.map((row) => ({
      id: row.id,
      auditStatus: rowAuditStatus(row),
      invoiceStatus: row.invoiceStatus,
      paymentStatus: row.paymentStatus,
      submittedAt: rowBillSubmittedAt(row),
    })), {
      billId,
      updatedIds: ids,
      auditStatus: "待审核",
      submittedAt,
      submittedById: actorId(actor),
    }));
    success = true;
    return {
      billId,
      updatedIds: ids,
      auditStatus: "待审核",
      submittedAt: submittedAtIso,
    };
  } finally {
    const durationMs = Date.now() - startedAt;
    const payload = {
      billId: billId || identifier,
      rowCount,
      userId: actor?.id || "",
      userRole: actor?.role || "",
      success,
      durationMs,
    };
    if (durationMs > 1000) {
      console.warn("submit-audit-slow-log", payload);
    } else {
      console.info("[logistics-expense.submit-audit]", payload);
    }
  }
}

export async function batchUpdateLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: unknown = {}) {
  assertCanWriteLogisticsExpense(actor);
  const items = Array.isArray(input)
    ? input.map(asRecord)
    : (Array.isArray(asRecord(input).items) ? (asRecord(input).items as unknown[]).map(asRecord) : (Array.isArray(asRecord(input).rows) ? (asRecord(input).rows as unknown[]).map(asRecord) : []));
  if (!items.length) {
    throw codedError("请提供需要保存的物流费用明细。", 400, "LOGISTICS_EXPENSE_BATCH_EMPTY");
  }
  const prepared: PreparedUpdate[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const id = nonEmpty(item.id);
    if (!id) {
      throw codedError(`第 ${index + 1} 行保存失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
    }
    const before = await loadLogisticsExpenseForAction(id, actor);
    const costType = before.costType || "物流费用";
    const unitAmount = Number(item.amount);
    const billingMethod = normalizeBatchBillingMethod(item, before);
    const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
    const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
	    if (!Number.isFinite(unitAmount) || unitAmount < 0) {
	      throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
	    }
	    const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
	    if (billBlockReason) {
	      throw codedError(`第 ${index + 1} 行${costType}保存失败：${billBlockReason}`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
	    }
	    const blockReason = logisticsExpenseUpdateBlockReason(before);
	    if (blockReason) {
	      throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
	    }
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
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(orderId));
  }
  return savedRows.map(serializeLogisticsExpense);
}

export async function batchSaveLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const updates = Array.isArray(input.updates) ? input.updates.map(asRecord) : [];
  const creates = Array.isArray(input.creates) ? input.creates.map(asRecord) : [];
  const deletes = Array.isArray(input.deletes) ? input.deletes : [];
  if (!updates.length && !creates.length && !deletes.length) {
    throw codedError("请提供需要保存的物流费用明细。", 400, "LOGISTICS_EXPENSE_BATCH_SAVE_EMPTY");
  }
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
    const item = updates[index] || {};
    const before = loadLogisticsExpenseBatchBillRow(billRowById, item.id, index, "保存");
    const data = await logisticsExpenseBatchUpdateData(item, before, actor, index);
    preparedUpdates.push({ before, data });
  }
  for (let index = 0; index < deletes.length; index += 1) {
    const before = loadLogisticsExpenseBatchBillRow(billRowById, deletes[index], index, "删除");
    const block = logisticsExpenseDeleteBlock(before);
    if (block) {
      throw codedError(`第 ${index + 1} 行${before.costType || "物流费用"}删除失败：${block.message}`, 400, block.code);
    }
    preparedDeletes.push(before);
  }
  const baseExpense = preparedUpdates[0]?.before || preparedDeletes[0] || billRows[0];
  const order = baseExpense.order;
  const supplier = baseExpense.supplier;
  if (!order?.id || !supplier?.id) {
    throw codedError("当前账单缺少订单或供应商信息，不能保存明细。", 400, "LOGISTICS_EXPENSE_BILL_CONTEXT_INVALID");
  }
  const bill = await ensureLogisticsExpenseBill(order, supplier, actor, {
    auditStatus: billStatus || rowAuditStatus(baseExpense),
    submittedAt: rowBillSubmittedAt(baseExpense),
  });
  const preparedCreates: PreparedCreate[] = [];
  for (let index = 0; index < creates.length; index += 1) {
    const item = creates[index] || {};
    const costType = nonEmpty(item.expenseType || item.costType || item.feeType);
    if (!costType) {
      throw codedError(`第 ${index + 1} 行请选择费用类型`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_COST_TYPE_REQUIRED");
    }
    const unitAmount = Number(item.unitAmount ?? item.unit_amount ?? item.amount);
    const billingMethod = normalizeBatchBillingMethod(item);
    const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
    const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
	    if (!nonEmpty(item.unitAmount ?? item.unit_amount ?? item.amount)) {
	      throw codedError(`第 ${index + 1} 行金额不能为空`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_REQUIRED");
	    }
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_INVALID");
    }
	    const blockReason = logisticsExpenseUpdateBlockReason(baseExpense);
    if (blockReason) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_STATUS_BLOCKED");
    }
	    const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
	    const data = await buildLogisticsExpenseData(order, supplier, actor, {
	      costType,
	      amount,
	      appliedContainerCount,
	      billingMethod,
	      billingQuantity,
	      currency: nonEmpty(item.currency || baseExpense.currency || "CNY").toUpperCase(),
      exchangeRate: item.exchangeRate ?? item.exchange_rate ?? baseExpense.exchangeRate ?? 1,
      exchangeRateDate: baseExpense.exchangeRateDate,
      exchangeRateSource: baseExpense.exchangeRateSource,
      exchangeRateType: baseExpense.exchangeRateType,
      remark: item.remark,
      auditStatus: ["草稿", "已驳回"].includes(rowAuditStatus(baseExpense)) ? rowAuditStatus(baseExpense) : "草稿",
      supplierId: baseExpense.supplierId,
      billId: bill.id,
    });
    preparedCreates.push({ data: { ...data, billId: bill.id } });
  }
  const deletedIds = preparedDeletes.map((row) => row.id);
  const transactionOperations = [
    ...preparedUpdates.map((item) => prisma.logisticsExpense.update({
      where: { id: item.before.id },
      data: { ...item.data, billId: item.before.billId || bill.id },
    })),
    ...(preparedCreates.length ? [prisma.logisticsExpense.createMany({
      data: preparedCreates.map((item) => item.data),
    })] : []),
    ...(deletedIds.length ? [prisma.logisticsExpense.updateMany({
      where: {
        id: { in: deletedIds },
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      data: { deletedAt: new Date(), updatedById: actorId(actor) },
    })] : []),
  ];
  if (transactionOperations.length) await prisma.$transaction(transactionOperations);
  const savedBillRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  if (!savedBillRows.length && bill.id) {
    await prisma.logisticsBill.update({
      where: { id: bill.id },
      data: { deletedAt: new Date(), updatedById: actorId(actor) || null },
    }).catch(() => null);
  } else {
    await refreshLogisticsBillWorkflowStatus(savedBillRows, actor).catch(() => null);
  }
  const serializedItems = savedBillRows.map(serializeLogisticsExpense);
  const serializedBill = savedBillRows.length ? serializeLogisticsExpenseBill(savedBillRows) : null;
  const affectedOrderIds = [
    ...savedBillRows.map((row) => row.orderId),
    ...preparedDeletes.map((row) => row.orderId),
  ].filter(Boolean);
  for (const orderId of [...new Set(affectedOrderIds)]) {
    void runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(orderId));
  }
  void runNonCriticalTask("物流费用账单明细批量保存日志写入", () => writeAudit(request, actor, "批量保存物流费用账单明细", "logistics_expenses", billId, {
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
    billId,
    updateCount: preparedUpdates.length,
    createCount: preparedCreates.length,
    deleteCount: deletedIds.length,
    durationMs: Date.now() - startedAt,
  });
  return {
    billId,
    bill: serializedBill,
    items: serializedItems,
    details: serializedItems,
    deletedIds,
    totalAmount: serializedBill?.amount || 0,
    totalAmountCny: serializedBill?.amountCny || 0,
    updatedAt: serializedBill?.updatedAt || new Date().toISOString(),
  };
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
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(saved.orderId));
  const billRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  if (!billRows.length && before.billId) {
    await prisma.logisticsBill.update({
      where: { id: billId },
      data: { deletedAt: new Date(), updatedById: actorId(actor) || null },
    }).catch(() => null);
  } else {
    await refreshLogisticsBillWorkflowStatus(billRows, actor).catch(() => null);
  }
  return serializeLogisticsExpense(saved);
}
