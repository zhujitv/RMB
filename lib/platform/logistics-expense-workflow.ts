import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  amountCny,
  CURRENCIES,
  dateFromInput,
  getExchangeRateQuote,
  nonEmpty,
  normalizedCostType,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  requireText,
  runNonCriticalTask,
  todayInputInChina,
  validEmail,
  writeAudit,
  codedError,
} from "./shared";
import {
  assertCanConfirmLogisticsInvoice,
  assertCanReviewLogisticsExpense,
  assertCanWriteLogisticsExpense,
  assertLogisticsExpenseOrder,
  assertLogisticsExpenseSupplier,
  buildLogisticsExpenseData,
  canUploadLogisticsExpenseInvoice,
  createLogisticsInvoiceDocument,
  createOrUpdateCostFromLogisticsExpense,
  ensureLogisticsExpenseBill,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  aggregateLogisticsExpenseStatus,
  aggregateLogisticsExpenseInvoiceStatus,
  logisticsExpenseBillId,
  logisticsExpenseAccessWhere,
  notifyLogisticsSupplierInvoice,
  notifyLogisticsSupplierInvoiceBills,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
} from "./logistics-expense-shared";
import { logisticsInvoiceGroupForCostType, logisticsInvoiceGroupForKey } from "./logistics-invoice-groups";
import {
  LOGISTICS_COST_TYPES,
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeLocksCurrency,
} from "./logistics-cost-types";

const LOGISTICS_EXPENSE_BILLING_METHODS = ["按柜", "按票", "按次", "按重量", "按金额比例", "手工输入"];
const DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD = "按柜";
const LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 10000 };

type UnknownRecord = Record<string, unknown>;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type WorkflowActor = { id?: string | null; role?: string | null; supplierId?: string | null } & UnknownRecord;
type ActorContext = WorkflowActor | null | undefined;
type FormDataLike = { get(name: string): unknown };
type LogisticsExpenseRow = Prisma.LogisticsExpenseGetPayload<{ include: ReturnType<typeof includeLogisticsExpenseRelations> }> & UnknownRecord;
type LogisticsExpenseSubmitRow = Prisma.LogisticsExpenseGetPayload<{ select: ReturnType<typeof logisticsExpenseSubmitSelect> }> & UnknownRecord;
type LogisticsExpenseStateSnapshot = {
  costId?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
};
type LogisticsExpenseCreateData = Prisma.LogisticsExpenseUncheckedCreateInput;
type LogisticsExpenseUpdateData = Prisma.LogisticsExpenseUncheckedUpdateInput;
type CostLink = { expenseId: string; costId: string };
type ReviewBill = { billId: string; rows: LogisticsExpenseRow[] };
type ReviewResult = {
  billId: string;
  orderNo: string;
  blNo: string;
  auditStatus: string;
  notificationStatus: string;
  errorMessage: string;
};
type EmailResult = {
  supplierId?: string;
  supplierName?: string;
  sent?: boolean;
  skipped?: boolean;
  error?: string;
  expenseIds?: string[];
};
type PreparedUpdate = { index?: number; before: LogisticsExpenseRow; data: LogisticsExpenseUpdateData };
type PreparedCreate = { data: LogisticsExpenseCreateData };
type DeleteBlock = { message: string; code: string } | null;
type BatchExchangeSnapshot = {
  currency: string;
  exchangeRate: number;
  exchangeRateDate: Date | null;
  exchangeRateSource: string;
  exchangeRateType: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function errorMessage(error: unknown, fallback = "") {
  if (error instanceof Error) return error.message;
  const message = asRecord(error).message;
  return typeof message === "string" && message ? message : fallback;
}

function actorId(actor: ActorContext): string {
  return nonEmpty(actor?.id);
}

function actorRole(actor: ActorContext): string {
  return nonEmpty(actor?.role);
}

function rowBillRecord(row: UnknownRecord = {}) {
  return asRecord(row.bill);
}

function rowAuditStatus(row: UnknownRecord = {}) {
  return nonEmpty(rowBillRecord(row).auditStatus || row.auditStatus || "草稿");
}

function rowBillSubmittedAt(row: UnknownRecord = {}) {
  return rowBillRecord(row).submittedAt || row.submittedAt || null;
}

function rowBillReviewedAt(row: UnknownRecord = {}) {
  return rowBillRecord(row).reviewedAt || row.reviewedAt || null;
}

function rowBillId(row: UnknownRecord = {}) {
  return nonEmpty(row.billId || rowBillRecord(row).id || logisticsExpenseBillId(row));
}

async function refreshLogisticsBillWorkflowStatus(rows: LogisticsExpenseRow[] = [], actor: ActorContext, overrides: Prisma.LogisticsBillUncheckedUpdateInput = {}) {
  if (!rows.length || !rows[0]?.billId) return;
  await prisma.logisticsBill.update({
    where: { id: rowBillId(rows[0]) },
    data: {
      invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(rows),
      paymentStatus: aggregateLogisticsExpenseStatus(rows, "paymentStatus"),
      updatedById: actorId(actor) || null,
      ...overrides,
    },
  });
}

async function reloadLogisticsExpenseRowsForBillIds(billIds: string[] = [], actor: ActorContext) {
  const rows: LogisticsExpenseRow[] = [];
  for (const billId of [...new Set(billIds.map(nonEmpty).filter(Boolean))]) {
    rows.push(...await loadLogisticsExpenseBillRowsForAction(billId, actor));
  }
  return rows;
}

function exchangeActor(actor: ActorContext): { role?: string } | null {
  const role = actorRole(actor);
  return role ? { role } : null;
}

function assertWorkflowActor(actor: ActorContext): asserts actor is WorkflowActor {
  if (!actor) throw permissionError("请先登录", 401);
}

export async function saveLogisticsExpenses(request: AuditRequestLike, actor: ActorContext, input: UnknownRecord = {}) {
  assertCanWriteLogisticsExpense(actor);
  const order = await assertLogisticsExpenseOrder(input, actor);
  const items = Array.isArray(input.items) && input.items.length ? input.items.map(asRecord) : [input];
  const rows: LogisticsExpenseCreateData[] = [];
  for (const item of items) {
    const supplier = await assertLogisticsExpenseSupplier(actor, order, { ...input, ...item });
    const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, ...item });
    const bill = await ensureLogisticsExpenseBill(order, supplier, actor, {
      auditStatus: data.auditStatus,
      submittedAt: data.submittedAt,
    });
    rows.push({ ...data, billId: bill.id });
  }
  const expenses: LogisticsExpenseRow[] = [];
  for (const data of rows) {
    const expense = await prisma.logisticsExpense.create({ data, include: includeLogisticsExpenseRelations() });
    expenses.push(expense);
    await runNonCriticalTask("物流费用提交日志写入", () => writeAudit(request, actor, data.auditStatus === "草稿" ? "保存物流费用草稿" : "提交物流费用审核", "logistics_expenses", expense.id, null, expense));
  }
  return {
    rows: expenses.map(serializeLogisticsExpense),
    totalAmountCny: expenses.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
  };
}

export async function reviewLogisticsExpense(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanReviewLogisticsExpense(actor);
  const action = nonEmpty(input.action || input.reviewAction || input.auditAction);
  if (!["approve", "reject", "reopen"].includes(action)) throw codedError("请选择有效审核动作。", 400, "LOGISTICS_EXPENSE_ACTION_REQUIRED");
  if (action === "reject" && !nonEmpty(input.rejectReason || input.reason)) {
    throw codedError("驳回物流费用必须填写原因。", 400, "LOGISTICS_EXPENSE_REJECT_REASON_REQUIRED");
  }
  if (action === "approve") {
    const result = await reviewLogisticsExpenseBills(request, actor, { ...input, action, ids: [id] });
    if (result.success === false) {
      throw codedError(result.message || "审核物流费用失败。", 400, "LOGISTICS_EXPENSE_REVIEW_FAILED");
    }
    const firstExpense = result.expenses[0] || result.bills[0]?.items?.[0] || null;
    return {
      expense: firstExpense || null,
      bill: result.bills[0] || null,
      emailNotified: result.emailNotified,
      emailError: result.emailError,
      emailResults: result.emailResults,
    };
  }
  if (action === "reject") {
    const result = await rejectLogisticsExpenseBill(request, actor, id, input);
    const firstExpense = result.expenses[0] || result.bill?.items?.[0] || null;
    return {
      expense: firstExpense || null,
      bill: result.bill || null,
      expenses: result.expenses,
      emailNotified: false,
      emailError: "",
    };
  }
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  if (!rows.length) throw codedError("未找到可重新打开的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const billId = rowBillId(rows[0]);
  const reviewRemark = optional(input.reviewRemark || input.remark);
  if (rows[0]?.billId) {
    await prisma.logisticsBill.update({
      where: { id: billId },
      data: {
        auditStatus: "待审核",
        reviewedById: null,
        reviewedAt: null,
        rejectReason: null,
        reviewRemark,
        updatedById: actorId(actor),
      },
    });
  } else {
    const ids = rows.map((row) => row.id).filter(Boolean);
    await prisma.logisticsExpense.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      data: {
        auditStatus: "待审核",
        reviewedById: null,
        reviewedAt: null,
        rejectReason: null,
        reviewRemark,
        updatedById: actorId(actor),
      },
    });
  }
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  await runNonCriticalTask("物流费用审核日志写入", () => writeAudit(request, actor, "重新打开物流费用账单", "logistics_bills", billId, rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
  }));
  return {
    expense: savedRows[0] ? serializeLogisticsExpense(savedRows[0]) : null,
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    emailNotified: false,
    emailError: "",
  };
}

export async function rejectLogisticsExpenseBill(request: AuditRequestLike, actor: ActorContext, identifier: unknown, input: UnknownRecord = {}) {
  assertCanReviewLogisticsExpense(actor);
  assertWorkflowActor(actor);
  const rejectReason = requireText(input.rejectReason || input.reason, "驳回原因");
  const reviewRemark = optional(input.reviewRemark || input.remark);
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw codedError("未找到可驳回的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  for (const row of rows) {
    if (rowAuditStatus(row) !== "待审核") {
      throw codedError(`账单 ${row.order?.orderNo || row.orderId || ""}/${row.order?.blNo || "-"} 中存在非待审核费用，不能驳回。`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_INVALID");
    }
  }
  const now = new Date();
  const billId = rowBillId(rows[0]);
  if (rows[0]?.billId) {
    await prisma.logisticsBill.update({
      where: { id: billId },
      data: {
        auditStatus: "已驳回",
        invoiceStatus: "未通知",
        paymentStatus: "待开票",
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark,
        rejectReason,
        invoiceNotifiedAt: null,
        invoiceNotificationError: null,
        updatedById: actorId(actor),
      },
    });
  } else {
    await prisma.logisticsExpense.updateMany({
      where: { id: { in: rows.map((row) => row.id).filter(Boolean) }, deletedAt: null },
      data: {
        auditStatus: "已驳回",
        invoiceStatus: "未通知",
        paymentStatus: "待开票",
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark,
        rejectReason,
        invoiceNotifiedAt: null,
        invoiceNotificationError: null,
        updatedById: actorId(actor),
      },
    });
  }
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  await runNonCriticalTask("物流费用账单驳回日志写入", () => writeAudit(request, actor, "驳回物流费用账单", "logistics_bills", billId, rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
    rejectReason,
    rejectedById: actorId(actor),
    rejectedAt: now,
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
  };
}

export async function reviewLogisticsExpenseBills(request: AuditRequestLike, actor: ActorContext, input: UnknownRecord = {}) {
  assertCanReviewLogisticsExpense(actor);
  const action = nonEmpty(input.action || input.reviewAction || input.auditAction || "approve");
  if (action !== "approve") throw codedError("批量审核当前仅支持审核通过。", 400, "LOGISTICS_EXPENSE_BATCH_REVIEW_ACTION_INVALID");
  const identifiers = normalizeLogisticsExpenseReviewIdentifiers(input);
  if (!identifiers.length) {
    throw codedError("请选择需要审核的物流费用账单。", 400, "LOGISTICS_EXPENSE_BATCH_REVIEW_EMPTY");
  }
  const bills: ReviewBill[] = [];
  const results: ReviewResult[] = [];
  const seenBillIds = new Set();
  for (const identifier of identifiers) {
    try {
      const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
      if (!rows.length) throw codedError("未找到可审核的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
      const billId = rowBillId(rows[0]);
      if (seenBillIds.has(billId)) continue;
      seenBillIds.add(billId);
      const billAuditStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
      if (billAuditStatus !== "待审核") {
        results.push(logisticsExpenseReviewResultFromRows(rows, {
          auditStatus: billAuditStatus,
          notificationStatus: "not_sent",
          errorMessage: `账单状态不是待审核，当前状态：${billAuditStatus || "未知"}`,
        }));
        continue;
      }
      bills.push({ billId, rows });
    } catch (error: unknown) {
      results.push(logisticsExpenseReviewResultFromError(identifier, error));
    }
  }
  const reviewRemark = optional(input.reviewRemark || input.remark);
  const now = new Date();
  const approvedBills: ReviewBill[] = [];
  for (const bill of bills) {
    try {
      await approveLogisticsExpenseBillRowsInTransaction(bill.rows, actor, reviewRemark, now);
      const savedRows = await loadLogisticsExpenseBillRowsForAction(bill.billId, actor);
      approvedBills.push({ ...bill, rows: savedRows });
      results.push(logisticsExpenseReviewResultFromRows(savedRows, {
        auditStatus: "审核通过",
        notificationStatus: "pending",
        errorMessage: "",
      }));
    } catch (error: unknown) {
      const safeMessage = logisticsExpenseReviewSafeErrorMessage(error);
      results.push(logisticsExpenseReviewResultFromRows(bill.rows, {
        auditStatus: aggregateLogisticsExpenseStatus(bill.rows, "auditStatus"),
        notificationStatus: "not_sent",
        errorMessage: safeMessage || "数据库更新失败",
      }));
    }
  }
  const approvedRows = approvedBills.flatMap((bill) => bill.rows);
  let emailResults: EmailResult[] = [];
  let finalRows = approvedRows;
  if (approvedRows.length) {
    try {
      emailResults = await notifyLogisticsSupplierInvoiceBills(approvedRows);
    } catch (error: unknown) {
      emailResults = [logisticsExpenseNotificationFailureResult(approvedRows, errorMessage(error, "邮件发送失败"))];
    }
    try {
      finalRows = await applyLogisticsExpenseInvoiceNotificationResults(approvedRows, emailResults, actor, now);
    } catch (error: unknown) {
      const message = errorMessage(error, "开票通知状态记录失败");
      emailResults = emailResults.length ? emailResults.map((result) => result.sent ? { ...result, sent: false, error: message } : result) : [logisticsExpenseNotificationFailureResult(approvedRows, message)];
      finalRows = approvedRows;
    }
    const reloadedRows = await reloadLogisticsExpenseRowsForBillIds(approvedBills.map((bill) => bill.billId), actor);
    if (reloadedRows.length) finalRows = reloadedRows;
  }
  const emailErrors = emailResults
    .filter((result) => !result.sent && !result.skipped)
    .map((result) => `${result.supplierName || "供应商"}：${result.error || "邮件发送失败"}`);
  const emailError = emailErrors.join("；");
  for (const bill of approvedBills) {
    const billRows = finalRows.filter((row) => rowBillId(row) === bill.billId);
    await runNonCriticalTask("物流费用批量审核日志写入", () => writeAudit(request, actor, "审核通过物流费用账单", "logistics_expenses", bill.billId, bill.rows.map(serializeLogisticsExpense), {
      bill: serializeLogisticsExpenseBill(billRows),
      emailResults,
    }));
  }
  for (const result of emailResults.filter((item) => !item.sent && !item.skipped)) {
    await runNonCriticalTask("物流费用通知失败日志写入", () => writeAudit(request, actor, "物流费用开票通知失败", "logistics_expenses", result.supplierId || "supplier", null, {
      supplierName: result.supplierName,
      errorMessage: result.error,
      expenseIds: result.expenseIds,
    }));
  }
  for (const orderId of [...new Set(finalRows.map((row) => row.orderId).filter(Boolean))]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(String(orderId)));
  }
  markLogisticsExpenseReviewNotificationResults(results, finalRows, emailResults);
  const serializedBills = approvedBills.map((bill) => serializeLogisticsExpenseBill(finalRows.filter((row) => rowBillId(row) === bill.billId)));
  const successCount = results.filter((result) => result.auditStatus === "审核通过").length;
  const failedCount = results.length - successCount;
  return {
    success: successCount > 0,
    successCount,
    failedCount,
    results,
    bills: serializedBills,
    expenses: finalRows.map(serializeLogisticsExpense),
    emailResults,
    emailNotified: emailResults.some((result) => result.sent),
    emailError,
    message: logisticsExpenseReviewSummaryMessage(successCount, failedCount, results, emailError),
  };
}

async function approveLogisticsExpenseBillRowsInTransaction(rows: LogisticsExpenseRow[] = [], actor: ActorContext, reviewRemark: string | null | undefined, now = new Date()) {
  assertWorkflowActor(actor);
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return;
  const billId = rowBillId(rows[0]);
  await prisma.$transaction(async (tx) => {
    if (rows[0]?.billId) {
      await tx.logisticsBill.update({
        where: { id: billId },
        data: {
          auditStatus: "审核通过",
          reviewedById: actor.id,
          reviewedAt: now,
          reviewRemark,
          rejectReason: null,
          invoiceNotificationError: null,
          paymentStatus: "待付款",
          invoiceStatus: "未通知",
          updatedById: actorId(actor),
        },
      });
      return;
    }
    await tx.logisticsExpense.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: {
        auditStatus: "审核通过",
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark,
        rejectReason: null,
        invoiceNotificationError: null,
        paymentStatus: "待付款",
        updatedById: actorId(actor),
      },
    });
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  const costLinks: CostLink[] = [];
  for (const before of rows) {
    const cost = await createOrUpdateCostFromLogisticsExpense(prisma, before, actor);
    costLinks.push({ expenseId: before.id, costId: cost.id });
  }
  await updateLogisticsExpenseCostIds(prisma, costLinks);
}

async function updateLogisticsExpenseCostIds(tx: Prisma.TransactionClient | typeof prisma, costLinks: CostLink[] = []) {
  const links = costLinks.filter((item) => item.expenseId && item.costId);
  if (!links.length) return;
  const cases = links.map((item) => Prisma.sql`WHEN ${item.expenseId} THEN ${item.costId}`);
  const ids = links.map((item) => item.expenseId);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "logistics_expenses"
    SET "cost_id" = CASE "id" ${Prisma.join(cases, " ")} END
    WHERE "id" IN (${Prisma.join(ids)})
  `);
}

function logisticsExpenseReviewSafeErrorMessage(error: unknown) {
  const message = errorMessage(error);
  if (/expired transaction|Transaction API error|timeout|timed out|P2028/i.test(message)) {
    return "审核失败：系统处理超时，请稍后重试。";
  }
  return message;
}

function logisticsExpenseReviewResultFromRows(rows: LogisticsExpenseRow[] = [], overrides: Partial<ReviewResult> = {}): ReviewResult {
  const first = rows[0];
  const order = asRecord(first?.order);
  return {
    billId: rows.length && first ? rowBillId(first) : (overrides.billId || ""),
    orderNo: nonEmpty(order.orderNo || first?.orderNo || first?.orderId),
    blNo: nonEmpty(order.blNo || first?.blNo || first?.billOfLadingNo) || "-",
    auditStatus: overrides.auditStatus || aggregateLogisticsExpenseStatus(rows, "auditStatus") || "",
    notificationStatus: overrides.notificationStatus || "not_sent",
    errorMessage: overrides.errorMessage || "",
  };
}

function logisticsExpenseReviewResultFromError(identifier: unknown, error: unknown): ReviewResult {
  const message = errorMessage(error, "审核物流费用失败");
  return {
    billId: nonEmpty(identifier),
    orderNo: "",
    blNo: "",
    auditStatus: "",
    notificationStatus: "not_sent",
    errorMessage: message,
  };
}

function logisticsExpenseNotificationFailureResult(rows: LogisticsExpenseRow[] = [], message = "邮件发送失败"): EmailResult {
  const first = rows[0];
  return {
    supplierId: first?.supplierId || "",
    supplierName: first?.supplierNameSnapshot || first?.supplier?.supplierName || "供应商",
    sent: false,
    error: message,
    expenseIds: rows.map((row) => row.id).filter(Boolean),
  };
}

function markLogisticsExpenseReviewNotificationResults(results: ReviewResult[] = [], rows: LogisticsExpenseRow[] = [], emailResults: EmailResult[] = []) {
  const resultByBillId = new Map(results.map((result) => [result.billId, result]));
  for (const row of rows) {
    const billId = rowBillId(row);
    const result = resultByBillId.get(billId);
    if (!result || result.auditStatus !== "审核通过") continue;
    const rowEmailResults = emailResults.filter((item) => (item.expenseIds || []).includes(row.id));
    if (rowEmailResults.some((item) => item.skipped)) {
      result.notificationStatus = "skipped";
      result.errorMessage = "";
      continue;
    }
    const failed = rowEmailResults.find((item) => !item.sent);
    if (failed) {
      result.notificationStatus = "failed";
      result.errorMessage = failed.error ? `开票通知发送失败：${failed.error}` : "开票通知发送失败，可稍后重发";
      continue;
    }
    if (rowEmailResults.some((item) => item.sent)) {
      result.notificationStatus = "sent";
    }
  }
}

function logisticsExpenseReviewSummaryMessage(successCount = 0, failedCount = 0, results: ReviewResult[] = [], emailError = "") {
  const failures = results.filter((result) => result.auditStatus !== "审核通过" && result.errorMessage);
  if (!successCount) {
    return failures.length
      ? failures.map((result) => `${result.orderNo || result.billId || "账单"}${result.blNo ? `/${result.blNo}` : ""}：${result.errorMessage}`).join("；")
      : "审核物流费用失败";
  }
  const parts = [`已审核 ${successCount} 票物流费用`];
  if (emailError) parts.push(`开票通知发送失败，可稍后重发：${emailError}`);
  if (failedCount) parts.push(`有 ${failedCount} 票未审核：${failures.map((result) => `${result.orderNo || result.billId || "账单"}${result.blNo ? `/${result.blNo}` : ""}：${result.errorMessage || "审核失败"}`).join("；")}`);
  return parts.join("；");
}

async function applyLogisticsExpenseInvoiceNotificationResults(rows: LogisticsExpenseRow[] = [], emailResults: EmailResult[] = [], actor: ActorContext, now = new Date()) {
  const resultByExpenseId = new Map<string, EmailResult>();
  for (const result of emailResults) {
    for (const id of result.expenseIds || []) resultByExpenseId.set(id, result);
  }
  const finalRows: LogisticsExpenseRow[] = [];
  for (const row of rows) {
    const result = resultByExpenseId.get(row.id);
    if (!result) {
      finalRows.push(row);
      continue;
    }
    const isLockedInvoiceStatus = ["已上传", "已确认"].includes(row.invoiceStatus);
    const nextInvoiceStatus = isLockedInvoiceStatus
      ? row.invoiceStatus
      : (result.skipped ? row.invoiceStatus : (result.sent ? "已通知开票" : "通知失败"));
    const saved = await prisma.logisticsExpense.update({
      where: { id: row.id },
      data: {
        invoiceStatus: nextInvoiceStatus,
        invoiceNotifiedAt: result.sent ? now : row.invoiceNotifiedAt,
        invoiceNotificationError: result.sent || result.skipped ? null : (result.error || "邮件发送失败"),
        paymentStatus: "待付款",
        updatedById: actorId(actor),
      },
      include: includeLogisticsExpenseRelations(),
    });
    if (saved.costId && result.sent && !isLockedInvoiceStatus) {
      await prisma.orderCost.update({ where: { id: saved.costId }, data: { invoiceStatus: "已通知开票" } }).catch(() => null);
    }
    finalRows.push(saved);
  }
  for (const billId of [...new Set(finalRows.map(rowBillId).filter(Boolean))]) {
    const billRows = finalRows.filter((row) => rowBillId(row) === billId);
    await refreshLogisticsBillWorkflowStatus(billRows, actor, {
      invoiceNotifiedAt: emailResults.some((result) => result.sent) ? now : undefined,
      invoiceNotificationError: emailResults.find((result) => !result.sent && !result.skipped)?.error || null,
    });
  }
  return finalRows;
}

export async function resendLogisticsExpenseInvoiceNotice(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  assertCanReviewLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw codedError("未找到可通知开票的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const blocked = rows.find((row) => rowAuditStatus(row) !== "审核通过");
  if (blocked) throw codedError("只有审核通过的物流费用账单可以重新发送开票通知。", 400, "LOGISTICS_EXPENSE_NOTICE_STATUS_INVALID");
  const emailResults = await notifyLogisticsSupplierInvoiceBills(rows);
  const updatedRows = await applyLogisticsExpenseInvoiceNotificationResults(rows, emailResults, actor, new Date());
  const finalRows = await reloadLogisticsExpenseRowsForBillIds([rowBillId(rows[0])], actor).then((nextRows) => nextRows.length ? nextRows : updatedRows);
  const emailErrors = emailResults.filter((result) => !result.sent).map((result) => `${result.supplierName || "供应商"}：${result.error || "邮件发送失败"}`);
  const emailError = emailErrors.join("；");
  await runNonCriticalTask("物流费用开票通知重发日志写入", () => writeAudit(request, actor, "重新发送物流费用开票通知", "logistics_bills", rowBillId(rows[0]), rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(finalRows),
    emailResults,
  }));
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    emailResults,
    emailNotified: emailResults.some((result) => result.sent),
    emailError,
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
  const canWithdraw = billAuditStatus === "待审核";
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
    await prisma.logisticsExpense.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      data: {
        auditStatus: "草稿",
        submittedAt: null,
        updatedById: actorId(actor),
      },
    });
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
    const blocked = rows.find((row) => !["草稿", "已驳回"].includes(rowAuditStatus(row)));
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
      await prisma.logisticsExpense.updateMany({
        where: {
          id: { in: ids },
          deletedAt: null,
          ...logisticsExpenseAccessWhere(actor),
        },
        data: {
          auditStatus: "待审核",
          submittedAt,
          rejectReason: null,
          invoiceNotificationError: null,
          updatedById: actorId(actor),
        },
      });
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
    auditStatus: billStatus || baseExpense.auditStatus || "草稿",
    submittedAt: baseExpense.submittedAt,
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
    preparedCreates.push({ data });
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

function batchSaveLogisticsExpenseBillIdentifier(input: UnknownRecord = {}, updates: UnknownRecord[] = [], deletes: unknown[] = []) {
  const update = updates.find((item) => nonEmpty(item?.groupKey || item?.billId || item?.id)) || {};
  return nonEmpty(input.groupKey || input.billId || input.id || update.groupKey || update.billId || update.id || deletes[0]);
}

function loadLogisticsExpenseBatchBillRow(rowById: Map<string, LogisticsExpenseRow>, id: unknown, index: number, actionLabel = "保存") {
  const expenseId = nonEmpty(id);
  if (!expenseId) {
    throw codedError(`第 ${index + 1} 行${actionLabel}失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
  }
  const row = rowById.get(expenseId);
  if (!row) {
    throw codedError(`第 ${index + 1} 行${actionLabel}失败：该费用明细不属于当前账单。`, 400, "LOGISTICS_EXPENSE_BATCH_ITEM_OUT_OF_BILL");
  }
  return row;
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

async function loadLogisticsExpenseForBatchItem(id: unknown, actor: ActorContext, index: number) {
  const expenseId = nonEmpty(id);
  if (!expenseId) {
    throw codedError(`第 ${index + 1} 行保存失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
  }
  return loadLogisticsExpenseForAction(expenseId, actor);
}

async function logisticsExpenseBatchUpdateData(item: UnknownRecord, before: LogisticsExpenseRow, actor: ActorContext, index: number): Promise<LogisticsExpenseUpdateData> {
  const costType = normalizedCostType(nonEmpty(item.feeType || item.expenseType || item.costType || before.costType));
  if (!LOGISTICS_COST_TYPES.includes(costType)) {
    throw codedError(`第 ${index + 1} 行请选择费用类型`, 400, "LOGISTICS_EXPENSE_BATCH_COST_TYPE_INVALID");
  }
  const rawUnitAmount = item.unitAmount ?? item.unit_amount ?? item.amount;
  if (!nonEmpty(rawUnitAmount)) {
    throw codedError(`第 ${index + 1} 行金额不能为空`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_REQUIRED");
  }
  const unitAmount = Number(rawUnitAmount);
  const billingMethod = normalizeBatchBillingMethod(item, before);
  const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
  const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
	  if (!Number.isFinite(unitAmount) || unitAmount < 0) {
	    throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
	  }
  const blockReason = logisticsExpenseUpdateBlockReason(before);
  if (blockReason) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
  }
  const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
  const hasContainerType = Object.prototype.hasOwnProperty.call(item, "containerType")
    || Object.prototype.hasOwnProperty.call(item, "container_type");
  const currency = logisticsCostTypeDefaultCurrency(costType) === "USD"
    ? "USD"
    : nonEmpty(item.currency || before.currency || "CNY").toUpperCase();
  if (!CURRENCIES.includes(currency)) throw codedError(`第 ${index + 1} 行请选择有效币种。`, 400, "CURRENCY_REQUIRED");
  const exchange = await resolveLogisticsExpenseBatchExchange(costType, item, before, actor, currency, index);
  const exchangeRate = Number(exchange.exchangeRate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw codedError(`第 ${index + 1} 行汇率必须大于 0。`, 400, "EXCHANGE_RATE_REQUIRED");
  }
  return {
    costType,
    currency: exchange.currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchangeRate),
	    ...(hasContainerType ? { containerType: optional(item.containerType ?? item.container_type) } : {}),
	    appliedContainerCount,
	    billingMethod,
	    billingQuantity,
	    remark: optional(item.remark),
    updatedById: actorId(actor),
  };
}

async function resolveLogisticsExpenseBatchExchange(costType: string, item: UnknownRecord, before: LogisticsExpenseRow, actor: ActorContext, currency: string, index: number): Promise<BatchExchangeSnapshot> {
  if (logisticsCostTypeLocksCurrency(costType)) {
    const quote = await getExchangeRateQuote({
      currency: "USD",
      date: item.exchangeRateDate || item.rateDate || todayInputInChina(),
    }, exchangeActor(actor));
    const exchangeRate = Number(quote.rateToCny ?? quote.exchangeRate ?? quote.rate ?? 0);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：未找到可用美元汇率，请先刷新系统汇率。`, 400, "EXCHANGE_RATE_REQUIRED");
    }
    return {
      currency: "USD",
      exchangeRate,
      exchangeRateDate: dateFromInput(quote.rateDate || todayInputInChina()),
      exchangeRateSource: quote.source || "系统",
      exchangeRateType: quote.rateType || "",
    };
  }
  return {
    currency,
    exchangeRate: Number(item.exchangeRate ?? item.exchange_rate ?? before.exchangeRate ?? 1),
    exchangeRateDate: before.exchangeRateDate,
    exchangeRateSource: before.exchangeRateSource || "",
    exchangeRateType: before.exchangeRateType || "",
  };
}

async function loadBatchSaveBaseExpense(input: UnknownRecord, actor: ActorContext) {
  const parsed = parseLogisticsExpenseGroupKey(input.groupKey);
  const orderId = nonEmpty(input.orderId || parsed.orderId);
  if (!orderId) {
    throw codedError("新增费用明细缺少账单分组信息。", 400, "LOGISTICS_EXPENSE_BATCH_GROUP_REQUIRED");
  }
  const expense = await prisma.logisticsExpense.findFirst({
    where: {
      deletedAt: null,
      orderId,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!expense) {
    throw codedError("未找到账单分组，无法新增费用明细。", 404, "LOGISTICS_EXPENSE_BATCH_GROUP_NOT_FOUND");
  }
  return expense;
}

function parseLogisticsExpenseGroupKey(groupKey: unknown) {
  const text = nonEmpty(groupKey);
  if (!text.startsWith("bill:")) return {};
  const rest = text.slice(5);
  const separator = rest.indexOf(":");
  if (separator < 0) return { orderId: rest };
  return {
    orderId: rest.slice(0, separator),
    billKey: rest.slice(separator + 1),
  };
}

function rowMatchesLegacyBillKey(row: UnknownRecord = {}, legacyBillId: unknown) {
  const parsed = parseLogisticsExpenseGroupKey(legacyBillId);
  if (!parsed.orderId) return false;
  const order = asRecord(row.order);
  const rowOrderId = nonEmpty(row.orderId || order.id);
  const rowBillKey = nonEmpty(order.blNo || order.orderNo || "no-bl").toLowerCase();
  return rowOrderId === parsed.orderId && rowBillKey === nonEmpty(parsed.billKey || "no-bl").toLowerCase();
}

function normalizeLogisticsExpenseReviewIdentifiers(input: UnknownRecord = {}) {
  const values = [
    ...(Array.isArray(input.billIds) ? input.billIds : []),
    ...(Array.isArray(input.groupKeys) ? input.groupKeys : []),
    ...(Array.isArray(input.ids) ? input.ids : []),
    ...(Array.isArray(input.expenseIds) ? input.expenseIds : []),
    input.billId,
    input.groupKey,
    input.id,
  ];
  return values.map(nonEmpty).filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function logisticsExpenseSubmitSelect() {
  return {
    id: true,
    orderId: true,
    supplierId: true,
    auditStatus: true,
    invoiceStatus: true,
    paymentStatus: true,
    submittedAt: true,
    billId: true,
    bill: {
      select: {
        id: true,
        auditStatus: true,
        invoiceStatus: true,
        paymentStatus: true,
        submittedAt: true,
        reviewedAt: true,
      },
    },
    order: {
      select: {
        id: true,
        orderNo: true,
        blNo: true,
      },
    },
  };
}

async function loadLogisticsExpenseBillRowsForSubmit(identifier: unknown, actor: ActorContext): Promise<LogisticsExpenseSubmitRow[]> {
  const text = requireText(identifier, "物流费用账单");
  if (!text.startsWith("bill:")) {
    const billRows = await prisma.logisticsExpense.findMany({
      where: {
        billId: text,
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      select: logisticsExpenseSubmitSelect(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (billRows.length) return billRows;
  }
  if (text.startsWith("bill:")) {
    const parsed = parseLogisticsExpenseGroupKey(text);
    if (!parsed.orderId) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_ID_INVALID");
    const rows = await prisma.logisticsExpense.findMany({
      where: {
        deletedAt: null,
        orderId: parsed.orderId,
        ...logisticsExpenseAccessWhere(actor),
      },
      select: logisticsExpenseSubmitSelect(),
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.filter((row) => rowMatchesLegacyBillKey(row, text));
  }
  const before = await prisma.logisticsExpense.findFirst({
    where: {
      id: text,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    select: logisticsExpenseSubmitSelect(),
  });
  if (!before) throw permissionError("物流费用不存在或无权访问", 404);
  const billId = rowBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(before.billId ? { billId: before.billId } : { orderId: before.orderId }),
      ...logisticsExpenseAccessWhere(actor),
    },
    select: logisticsExpenseSubmitSelect(),
    orderBy: [{ createdAt: "asc" }],
  });
  return before.billId ? rows : rows.filter((row) => rowMatchesLegacyBillKey(row, billId));
}

async function loadLogisticsExpenseBillRowsForAction(identifier: unknown, actor: ActorContext): Promise<LogisticsExpenseRow[]> {
  const text = requireText(identifier, "物流费用账单");
  if (!text.startsWith("bill:")) {
    const billRows = await prisma.logisticsExpense.findMany({
      where: {
        billId: text,
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (billRows.length) return billRows;
  }
  if (text.startsWith("bill:")) {
    const parsed = parseLogisticsExpenseGroupKey(text);
    if (!parsed.orderId) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_ID_INVALID");
    const rows = await prisma.logisticsExpense.findMany({
      where: {
        deletedAt: null,
        orderId: parsed.orderId,
        ...logisticsExpenseAccessWhere(actor),
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.filter((row) => rowMatchesLegacyBillKey(row, text));
  }
  const before = await loadLogisticsExpenseForAction(text, actor);
  const billId = rowBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(before.billId ? { billId: before.billId } : { orderId: before.orderId }),
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ createdAt: "asc" }],
  });
  return before.billId ? rows : rows.filter((row) => rowMatchesLegacyBillKey(row, billId));
}

async function logisticsExpenseBillEditBlockReason(expense: LogisticsExpenseStateSnapshot & UnknownRecord, actor: ActorContext) {
  const rows = await loadLogisticsExpenseBillRowsForAction(rowBillId(expense), actor);
  const billStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  if (["草稿", "已驳回"].includes(billStatus || "草稿")) return "";
  return `账单${billStatus || "当前状态"}，不能修改明细，请先撤回为草稿。`;
}

function normalizeBatchBillingMethod(item: UnknownRecord = {}, before: LogisticsExpenseStateSnapshot & UnknownRecord | null = null) {
  const method = nonEmpty(item.billingMethod ?? item.billing_method ?? before?.billingMethod ?? DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  if (!LOGISTICS_EXPENSE_BILLING_METHODS.includes(method)) {
    throw codedError("请选择有效计费方式。", 400, "LOGISTICS_EXPENSE_BILLING_METHOD_INVALID");
  }
  return method;
}

function integerBillingMethod(method: string) {
  return ["按柜", "按票", "按次"].includes(method);
}

function normalizeBatchBillingQuantity(item: UnknownRecord = {}, billingMethod = DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD, costType = "物流费用", index = 0) {
  const raw = item.billingQuantity
    ?? item.billing_quantity
    ?? item.appliedQuantity
    ?? item.applied_quantity
    ?? item.appliedContainerCount
    ?? item.containerCount
    ?? item.applied_container_count
    ?? 1;
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：适用数量/范围必须大于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_QUANTITY_INVALID");
  }
  if (integerBillingMethod(billingMethod) && !Number.isInteger(quantity)) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：按柜、按票、按次的适用数量/范围必须为正整数。`, 400, "LOGISTICS_EXPENSE_BATCH_QUANTITY_INTEGER_REQUIRED");
  }
  return quantity;
}

function legacyAppliedContainerCount(quantity: unknown) {
  return Math.max(1, Math.ceil(Number(quantity || 1)));
}

function billingAmountFromUnit(unitAmount: number, billingQuantity: number, billingMethod: string) {
  return billingMethod === "手工输入" ? unitAmount : unitAmount * billingQuantity;
}

function logisticsExpenseUpdateBlockReason(expense: LogisticsExpenseStateSnapshot) {
  if (expense.costId) return "该费用已同步到成本，不能修改。";
  if (rowAuditStatus(expense) === "审核通过") return "已审核，不能修改。";
  if (rowAuditStatus(expense) === "待审核") return "待审核账单不能修改，请先撤回为草稿。";
  if (["已上传", "已确认"].includes(expense.invoiceStatus || "")) return "已开票，不能修改。";
  if (["已开票", "待付款", "已付款"].includes(expense.paymentStatus || "")) return "已付款流程中，不能修改。";
  if (!["草稿", "已驳回"].includes(rowAuditStatus(expense))) return "当前状态不能修改。";
  return "";
}

function logisticsExpenseDeleteBlock(expense: LogisticsExpenseStateSnapshot): DeleteBlock {
  if (expense.costId) return { message: "该费用已同步到成本，请先取消同步后再删除。", code: "LOGISTICS_EXPENSE_SYNCED_COST_DELETE_BLOCKED" };
  if (rowAuditStatus(expense) === "审核通过") return { message: "已审核通过的物流费用不能删除。", code: "LOGISTICS_EXPENSE_APPROVED_DELETE_BLOCKED" };
  if (rowAuditStatus(expense) === "待审核") return { message: "待审核账单不能删除明细，请先撤回为草稿。", code: "LOGISTICS_EXPENSE_PENDING_DELETE_BLOCKED" };
  if (["已上传", "已确认"].includes(expense.invoiceStatus || "") || ["已开票", "待付款", "已付款"].includes(expense.paymentStatus || "")) {
    return { message: "已开票或已付款的物流费用不能删除。", code: "LOGISTICS_EXPENSE_INVOICED_DELETE_BLOCKED" };
  }
  if (!["草稿", "已驳回"].includes(rowAuditStatus(expense))) {
    return { message: "当前状态的物流费用不能删除。", code: "LOGISTICS_EXPENSE_DELETE_STATUS_BLOCKED" };
  }
  return null;
}

export async function uploadLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, formData: FormDataLike) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (rowAuditStatus(before) !== "审核通过") throw codedError("只有审核通过的物流费用可以上传发票。", 400, "LOGISTICS_EXPENSE_NOT_APPROVED");
  if (!canUploadLogisticsExpenseInvoice(actor, before)) throw permissionError("无权限上传该物流费用发票", 403);
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const requestedGroup = logisticsInvoiceGroupForKey(formData.get("invoiceGroup") || formData.get("invoiceGroupKey"));
  const fallbackGroup = logisticsInvoiceGroupForCostType(before.costType);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const targetRows = rows.filter((row) => invoiceGroup.costTypes.includes(normalizedCostType(row.costType)));
  if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用，不能上传该分组发票。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  const blocked = targetRows.find((row) => rowAuditStatus(row) !== "审核通过" || !row.costId);
  if (blocked) throw codedError("该发票分组包含尚未审核生成正式成本的费用，不能上传发票。", 400, "LOGISTICS_EXPENSE_COST_MISSING");
  const file = formData.get("file");
  if (!file || typeof file !== "object" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    throw codedError("请上传发票文件。", 400, "INVOICE_FILE_REQUIRED");
  }
  const document = await createLogisticsInvoiceDocument(request, actor, before, file, {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
  });
  const uploadedAt = new Date();
  const savedRows: LogisticsExpenseRow[] = [];
  for (const row of targetRows) {
    const saved = await prisma.logisticsExpense.update({
      where: { id: row.id },
      data: {
        invoiceDocumentId: document.id,
        invoiceStatus: "已上传",
        paymentStatus: "已开票",
        invoiceNotificationError: null,
        invoiceUploadedById: actorId(actor),
        invoiceUploadedAt: uploadedAt,
        updatedById: actorId(actor),
      },
      include: includeLogisticsExpenseRelations(),
    });
    savedRows.push(saved);
    if (saved.costId) await prisma.orderCost.update({ where: { id: saved.costId }, data: { invoiceStatus: "已收到" } }).catch(() => null);
  }
  await runNonCriticalTask("物流发票上传状态日志写入", () => writeAudit(request, actor, "提交物流分组发票", "logistics_bills", rowBillId(before), targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId: document.id,
    updatedIds: savedRows.map((row) => row.id),
  }));
  for (const orderId of [...new Set(savedRows.map((row) => row.orderId).filter(Boolean))]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(String(orderId)));
  }
  const billRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  await refreshLogisticsBillWorkflowStatus(billRows, actor);
  const finalRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}

export async function deleteLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (!canUploadLogisticsExpenseInvoice(actor, before)) throw permissionError("无权限删除该物流费用发票", 403);
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const requestedGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  const fallbackGroup = logisticsInvoiceGroupForCostType(before.costType);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const targetRows = rows.filter((row) => invoiceGroup.costTypes.includes(normalizedCostType(row.costType)));
  if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  if (targetRows.some((row) => row.invoiceStatus === "已确认" || row.invoiceConfirmedAt)) {
    throw codedError("已确认发票不能删除。", 400, "LOGISTICS_INVOICE_CONFIRMED_DELETE_BLOCKED");
  }
  const documentId = optional(input.documentId) || targetRows.find((row) => row.invoiceDocumentId)?.invoiceDocumentId || "";
  if (!documentId) throw codedError("当前分组没有已上传发票。", 404, "LOGISTICS_INVOICE_DOCUMENT_NOT_FOUND");
  const targetDocumentRows = targetRows.filter((row) => row.invoiceDocumentId === documentId);
  if (!targetDocumentRows.length) throw codedError("该发票文件不属于当前账单分组。", 400, "LOGISTICS_INVOICE_DOCUMENT_SCOPE_INVALID");
  const document = await prisma.orderDocument.findUnique({ where: { id: documentId } });
  if (!document || document.deletedAt) throw codedError("发票文件不存在或已删除。", 404, "LOGISTICS_INVOICE_DOCUMENT_NOT_FOUND");
  const uploadedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.orderDocument.update({
      where: { id: documentId },
      data: { deletedAt: uploadedAt },
    });
    for (const row of targetDocumentRows) {
      await tx.logisticsExpense.update({
        where: { id: row.id },
        data: {
          invoiceDocumentId: null,
          invoiceUploadedById: null,
          invoiceUploadedAt: null,
          invoiceStatus: row.invoiceNotifiedAt ? "已通知开票" : "待开票",
          paymentStatus: "待开票",
          updatedById: actorId(actor),
        },
      });
      if (row.costId) {
        await tx.orderCost.update({ where: { id: row.costId }, data: { invoiceStatus: "未收到" } }).catch(() => null);
      }
    }
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  await runNonCriticalTask("物流发票删除状态日志写入", () => writeAudit(request, actor, "删除物流分组发票", "logistics_bills", rowBillId(before), targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId,
    updatedIds: targetDocumentRows.map((row) => row.id),
  }));
  for (const orderId of [...new Set(targetDocumentRows.map((row) => row.orderId).filter(Boolean))]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(String(orderId)));
  }
  await refreshLogisticsBillWorkflowStatus(savedRows, actor);
  const finalRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}

export async function confirmLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (before.invoiceStatus !== "已上传") throw codedError("只有已上传发票的物流费用可以确认。", 400, "LOGISTICS_INVOICE_NOT_UPLOADED");
  if (!before.invoiceDocumentId) throw codedError("发票文件不能为空。", 400, "LOGISTICS_INVOICE_FILE_REQUIRED");
  const forceConfirmReason = optional(input.forceConfirmReason || input.reason);
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: {
      invoiceStatus: "已确认",
      paymentStatus: "待付款",
      invoiceConfirmedById: actorId(actor),
      invoiceConfirmedAt: new Date(),
      forceConfirmReason,
      updatedById: actorId(actor),
    },
    include: includeLogisticsExpenseRelations(),
  });
  if (before.costId) await prisma.orderCost.update({ where: { id: before.costId }, data: { invoiceStatus: "已收到" } }).catch(() => null);
  await runNonCriticalTask("物流发票确认日志写入", () => writeAudit(request, actor, "确认物流发票", "logistics_expenses", id, before, saved));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(saved.orderId));
  const billRows = await loadLogisticsExpenseBillRowsForAction(rowBillId(saved), actor);
  await refreshLogisticsBillWorkflowStatus(billRows, actor);
  const reloadedRows = await loadLogisticsExpenseBillRowsForAction(rowBillId(saved), actor);
  return serializeLogisticsExpense(reloadedRows.find((row) => row.id === saved.id) || saved);
}

export async function updateLogisticsExpensePaymentStatus(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  const paymentStatus = nonEmpty(input.paymentStatus || input.status || "已付款");
  if (!LOGISTICS_EXPENSE_PAYMENT_STATUSES.includes(paymentStatus)) {
    throw codedError("请选择有效付款状态。", 400, "LOGISTICS_PAYMENT_STATUS_INVALID");
  }
  if (paymentStatus === "已付款" && before.invoiceStatus !== "已确认") {
    throw codedError("发票确认后才能标记已付款。", 400, "LOGISTICS_PAYMENT_REQUIRES_CONFIRMED_INVOICE");
  }
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: { paymentStatus, updatedById: actorId(actor) },
    include: includeLogisticsExpenseRelations(),
  });
  if (before.costId) {
    await prisma.orderCost.update({
      where: { id: before.costId },
      data: { paymentStatus: paymentStatus === "已付款" ? "已支付" : "待支付" },
    }).catch(() => null);
  }
  await runNonCriticalTask("物流付款状态日志写入", () => writeAudit(request, actor, "更新物流费用付款状态", "logistics_expenses", id, before, saved));
  const billRows = await loadLogisticsExpenseBillRowsForAction(rowBillId(saved), actor);
  await refreshLogisticsBillWorkflowStatus(billRows, actor);
  const reloadedRows = await loadLogisticsExpenseBillRowsForAction(rowBillId(saved), actor);
  return serializeLogisticsExpense(reloadedRows.find((row) => row.id === saved.id) || saved);
}
