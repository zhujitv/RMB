import { prisma } from "../prisma";
import {
  codedError,
  LOGISTICS_BILL_STATUS_VOIDED,
  ORDER_COST_STATUS_VOID,
  permissionError,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
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
  logisticsExpenseRequestedAuditStatus,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { canSubmitLogisticsBill, canWithdrawLogisticsBill, isVoidedLogisticsBill } from "./logistics-bill-state-machine";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  asRecord,
  loadLogisticsExpenseBillRowsForAction,
  loadLogisticsExpenseBillRowsForSubmit,
  logisticsExpenseBillEditBlockReason,
  logisticsExpenseUpdateBlockReason,
  rowAuditStatus,
  rowBillId,
  rowBillStatus,
  rowBillSubmittedAt,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseCreateData,
  type LogisticsExpenseRow,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

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
  invalidateWorkbenchTodosCache();
  return {
    rows: expenses.map(serializeLogisticsExpense),
    totalAmountCny: expenses.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
  };
}

export async function updateLogisticsExpense(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (input.action === "withdraw") return withdrawLogisticsExpenseBill(request, actor, rowBillId(before));
  if (input.action === "submit") return submitLogisticsExpenseBill(request, actor, rowBillId(before));
  const order = await assertLogisticsExpenseOrder({ orderId: before.orderId }, actor);
  const supplier = await assertLogisticsExpenseSupplier(actor, order, { supplierId: before.supplierId });
  const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
  if (billBlockReason) throw codedError(billBlockReason, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
  const blockReason = logisticsExpenseUpdateBlockReason(before);
  if (blockReason) throw codedError(blockReason, 400, "LOGISTICS_EXPENSE_STATUS_BLOCKED");
  const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, supplierId: before.supplierId }, before);
  const saved = await prisma.logisticsExpense.update({ where: { id }, data, include: includeLogisticsExpenseRelations() });
  invalidateWorkbenchTodosCache();
  await runNonCriticalTask("物流费用修改日志写入", () => writeAudit(request, actor, "修改物流费用", "logistics_expenses", id, before, saved));
  return serializeLogisticsExpense(saved);
}

export async function withdrawLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  assertCanWriteLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const billAuditStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  const billInvoiceStatus = aggregateLogisticsExpenseStatus(rows, "invoiceStatus");
  const billStatus = rowBillStatus(rows[0]);
  const billId = rowBillId(rows[0]);
  const canWithdraw = canWithdrawLogisticsBill({ auditStatus: billAuditStatus, status: billStatus });
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
  if (!rows[0]?.billId) throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  await prisma.logisticsBill.update({
    where: { id: billId },
    data: {
      auditStatus: "草稿",
      submittedAt: null,
      submittedById: null,
      updatedById: actorId(actor),
    },
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  invalidateWorkbenchTodosCache();
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
    const blocked = rows.find((row) => !canSubmitLogisticsBill({ auditStatus: rowAuditStatus(row), status: rowBillStatus(row) }));
    if (blocked) throw codedError("只有草稿或已驳回费用可以提交审核。", 400, "LOGISTICS_EXPENSE_SUBMIT_NOT_ALLOWED");
    const submittedAt = new Date();
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!rows[0]?.billId) throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
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
    invalidateWorkbenchTodosCache();
    return { billId, updatedIds: ids, auditStatus: "待审核", submittedAt: submittedAtIso };
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
    if (durationMs > 1000) console.warn("submit-audit-slow-log", payload);
    else console.info("[logistics-expense.submit-audit]", payload);
  }
}

export async function voidLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown, input: UnknownRecord = {}) {
  if (actor?.role !== "管理员") throw permissionError("只有管理员可以作废物流费用账单。", 403);
  const reason = String(input.reason || input.voidReason || "").trim();
  if (!reason) throw codedError("作废原因不能为空。", 400, "LOGISTICS_BILL_VOID_REASON_REQUIRED");
  const remark = String(input.remark || input.voidRemark || "").trim();
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const billId = rowBillId(rows[0]);
  if (isVoidedLogisticsBill({ status: rowBillStatus(rows[0]) })) {
    throw codedError("该物流费用账单已作废，不能重复作废。", 400, "LOGISTICS_BILL_ALREADY_VOIDED");
  }
  const now = new Date();
  const orderId = String(rows[0]?.orderId || "");
  const voided = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，不能作废物流费用账单。",
    );
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!currentRows.length) throw codedError("物流费用账单缺少费用明细，不能作废。", 409, "LOGISTICS_BILL_VOID_ROWS_EMPTY");
    if (currentRows.some((row) => isVoidedLogisticsBill({ status: rowBillStatus(row) }))) {
      throw codedError("该物流费用账单已作废，不能重复作废。", 400, "LOGISTICS_BILL_ALREADY_VOIDED");
    }
    const billPaymentStatus = aggregateLogisticsExpenseStatus(currentRows, "paymentStatus");
    if (String(billPaymentStatus || "").includes("已付款")) {
      throw codedError("已付款账单不能直接作废，请先取消付款或走红冲流程。", 400, "LOGISTICS_BILL_VOID_PAID_BLOCKED");
    }
    const linkedCosts = currentRows.map((row) => row.cost).filter(Boolean);
    const paidCost = linkedCosts.find((cost) =>
      ["已支付", "部分支付"].includes(String(cost?.paymentStatus || "")) ||
      Boolean(cost?.paid || cost?.paidAt || cost?.paymentDate),
    );
    if (paidCost) {
      throw codedError("已同步成本存在付款记录，不能直接作废，请先取消付款或走红冲流程。", 400, "LOGISTICS_BILL_VOID_COST_PAID_BLOCKED");
    }
    const costIds = [...new Set(currentRows.map((row) => row.costId || row.cost?.id || "").filter(Boolean))];
    const billAuditStatus = aggregateLogisticsExpenseStatus(currentRows, "auditStatus");
    if (billAuditStatus === "审核通过" && costIds.length !== currentRows.length) {
      throw codedError("物流费用未完整关联成本，不能作废，请先修复成本关联。", 409, "LOGISTICS_BILL_VOID_COST_LINK_INCOMPLETE");
    }
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: LOGISTICS_BILL_STATUS_VOIDED },
        paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
      },
      data: {
        status: LOGISTICS_BILL_STATUS_VOIDED,
        voidedAt: now,
        voidedById: actor.id || null,
        voidReason: reason,
        voidRemark: remark || null,
        updatedById: actor.id || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("物流费用账单状态已变化，作废已取消，请刷新后重试。", 409, "LOGISTICS_BILL_VOID_STATE_CHANGED");
    }
    if (costIds.length) {
      const costUpdate = await tx.orderCost.updateMany({
        where: {
          id: { in: costIds },
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
          paymentStatus: { notIn: ["已支付", "部分支付"] },
          paid: false,
          paidAt: null,
          paymentDate: null,
        },
        data: {
          status: ORDER_COST_STATUS_VOID,
          voidedAt: now,
          voidedById: actor.id || null,
          voidReason: `物流费用账单作废：${reason}`,
          updatedById: actor.id || null,
        },
      });
      if (costUpdate.count !== costIds.length) {
        throw codedError("关联成本状态已变化，物流费用账单作废已取消。", 409, "LOGISTICS_BILL_VOID_COST_CHANGED");
      }
    }
    return { rows: currentRows, costIds };
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  for (const affectedOrderId of [...new Set(voided.rows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(affectedOrderId);
  }
  invalidateWorkbenchTodosCache();
  await runNonCriticalTask("物流费用账单作废日志写入", () => writeAudit(request, actor, "作废物流费用账单", "logistics_bills", billId, {
    bill: serializeLogisticsExpenseBill(voided.rows),
    expenses: voided.rows.map(serializeLogisticsExpense),
  }, {
    bill: serializeLogisticsExpenseBill(savedRows),
    voidReason: reason,
    voidRemark: remark,
    originalOrderNo: voided.rows[0]?.order?.orderNo || voided.rows[0]?.orderId || "",
    originalAmountCny: voided.rows.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
    voidedCostIds: voided.costIds,
    voidedAt: now.toISOString(),
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    voidedBillId: billId,
    voidedCostIds: voided.costIds,
  };
}
