import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { codedError, nonEmpty, optional, refreshTaxRefundCompleteness, requireText, runNonCriticalTask, writeAudit } from "./shared";
import {
  assertCanReviewLogisticsExpense,
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  canUploadLogisticsExpenseInvoice,
  createOrUpdateCostFromLogisticsExpense,
  includeLogisticsExpenseRelations,
  notifyLogisticsSupplierInvoiceBills,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { canRejectLogisticsBill, canUploadLogisticsBillInvoice } from "./logistics-bill-state-machine";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  asRecord,
  assertWorkflowActor,
  errorMessage,
  groupLogisticsExpenseRowsByBillId,
  loadLogisticsExpenseBillRowsForAction,
  normalizeLogisticsExpenseReviewIdentifiers,
  refreshLogisticsBillWorkflowStatus,
  reloadLogisticsExpenseRowsForBillIds,
  rowAuditStatus,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type CostLink,
  type EmailResult,
  type LogisticsExpenseRow,
  type ReviewBill,
  type ReviewResult,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";

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
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
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
    if (!canRejectLogisticsBill({ auditStatus: rowAuditStatus(row) })) {
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
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
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
  const { bills, results } = await loadLogisticsExpenseReviewBills(identifiers, actor);
  const reviewRemark = optional(input.reviewRemark || input.remark);
  const now = new Date();
  const directBills = bills.filter((bill) => bill.rows.some((row) => row.billId) && !bill.billId.startsWith("bill:"));
  const legacyBills = bills.filter((bill) => !directBills.some((item) => item.billId === bill.billId));
  let finalRows: LogisticsExpenseRow[] = [];
  if (directBills.length) {
    try {
      const billIds = directBills.map((bill) => bill.billId);
      await approveLogisticsExpenseBillsInTransaction(billIds, actor, reviewRemark, now);
      finalRows.push(...await reloadLogisticsExpenseRowsForBillIds(billIds, actor));
      const rowsByBillId = groupLogisticsExpenseRowsByBillId(finalRows);
      for (const bill of directBills) {
        const savedRows = rowsByBillId.get(bill.billId) || bill.rows;
        const auditStatus = aggregateLogisticsExpenseStatus(savedRows, "auditStatus");
        results.push(logisticsExpenseReviewResultFromRows(savedRows, {
          auditStatus,
          notificationStatus: auditStatus === "审核通过" ? "pending" : "not_sent",
          errorMessage: auditStatus === "审核通过" ? "" : "账单状态已变化，请刷新后重试",
        }));
      }
    } catch (error: unknown) {
      const safeMessage = logisticsExpenseReviewSafeErrorMessage(error);
      for (const bill of directBills) {
        results.push(logisticsExpenseReviewResultFromRows(bill.rows, {
          auditStatus: aggregateLogisticsExpenseStatus(bill.rows, "auditStatus"),
          notificationStatus: "not_sent",
          errorMessage: safeMessage || "数据库更新失败",
        }));
      }
    }
  }
  for (const bill of legacyBills) {
    try {
      await approveLogisticsExpenseBillRowsInTransaction(bill.rows, actor, reviewRemark, now);
      const savedRows = await loadLogisticsExpenseBillRowsForAction(bill.billId, actor);
      finalRows.push(...savedRows);
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
  const approvedBillIds = [...new Set(results.filter((result) => result.auditStatus === "审核通过").map((result) => result.billId).filter(Boolean))];
  const approvedRows = finalRows.filter((row) => approvedBillIds.includes(rowBillId(row)));
  scheduleLogisticsExpenseReviewSideEffects(request, actor, approvedRows, now);
  const serializedBills = approvedBillIds
    .map((billId) => serializeLogisticsExpenseBill(finalRows.filter((row) => rowBillId(row) === billId)))
    .filter((bill) => bill.items.length > 0);
  const successCount = results.filter((result) => result.auditStatus === "审核通过").length;
  const failedCount = results.length - successCount;
  return {
    success: successCount > 0,
    successCount,
    failedCount,
    results,
    bills: serializedBills,
    expenses: finalRows.map(serializeLogisticsExpense),
    emailResults: [],
    emailNotified: false,
    emailError: "",
    message: logisticsExpenseReviewSummaryMessage(successCount, failedCount, results, ""),
  };
}

async function loadLogisticsExpenseReviewBills(identifiers: string[] = [], actor: ActorContext) {
  const results: ReviewResult[] = [];
  const bills: ReviewBill[] = [];
  const seenBillIds = new Set<string>();
  const directIdentifiers = identifiers.filter((identifier) => !identifier.startsWith("bill:"));
  const legacyIdentifiers = identifiers.filter((identifier) => identifier.startsWith("bill:"));
  const directRows = await reloadLogisticsExpenseRowsForBillIds(directIdentifiers, actor);
  const directRowsByBillId = groupLogisticsExpenseRowsByBillId(directRows);
  const unresolved: string[] = [];
  for (const identifier of directIdentifiers) {
    const rows = directRowsByBillId.get(identifier);
    if (rows?.length) {
      collectLogisticsExpenseReviewBill(rows, bills, results, seenBillIds);
    } else {
      unresolved.push(identifier);
    }
  }
  for (const identifier of [...legacyIdentifiers, ...unresolved]) {
    try {
      collectLogisticsExpenseReviewBill(await loadLogisticsExpenseBillRowsForAction(identifier, actor), bills, results, seenBillIds);
    } catch (error: unknown) {
      results.push(logisticsExpenseReviewResultFromError(identifier, error));
    }
  }
  return { bills, results };
}

function collectLogisticsExpenseReviewBill(rows: LogisticsExpenseRow[] = [], bills: ReviewBill[], results: ReviewResult[], seenBillIds: Set<string>) {
  if (!rows.length) throw codedError("未找到可审核的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const billId = rowBillId(rows[0]);
  if (seenBillIds.has(billId)) return;
  seenBillIds.add(billId);
  const billAuditStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  if (billAuditStatus !== "待审核") {
    results.push(logisticsExpenseReviewResultFromRows(rows, {
      auditStatus: billAuditStatus,
      notificationStatus: "not_sent",
      errorMessage: `账单状态不是待审核，当前状态：${billAuditStatus || "未知"}`,
    }));
    return;
  }
  bills.push({ billId, rows });
}

async function approveLogisticsExpenseBillsInTransaction(billIds: string[] = [], actor: ActorContext, reviewRemark: string | null | undefined, now = new Date()) {
  assertWorkflowActor(actor);
  const ids = [...new Set(billIds.map(nonEmpty).filter(Boolean))];
  if (!ids.length) return;
  await prisma.$transaction([
    prisma.logisticsBill.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        auditStatus: "待审核",
      },
      data: {
        auditStatus: "审核通过",
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark,
        rejectReason: null,
        invoiceNotificationError: null,
        paymentStatus: "待付款",
        invoiceStatus: "待开票",
        updatedById: actorId(actor),
      },
    }),
  ], LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
}

function scheduleLogisticsExpenseReviewSideEffects(request: AuditRequestLike, actor: ActorContext, approvedRows: LogisticsExpenseRow[] = [], now = new Date()) {
  if (!approvedRows.length) return;
  void runNonCriticalTask("物流费用批量审核后续处理", async () => {
    const costLinks: CostLink[] = [];
    for (const row of approvedRows) {
      const cost = await createOrUpdateCostFromLogisticsExpense(prisma, row, actor);
      costLinks.push({ expenseId: row.id, costId: cost.id });
    }
    await updateLogisticsExpenseCostIds(prisma, costLinks);
    let emailResults: EmailResult[] = [];
    let finalRows = approvedRows;
    try {
      emailResults = await notifyLogisticsSupplierInvoiceBills(approvedRows);
    } catch (error: unknown) {
      emailResults = [logisticsExpenseNotificationFailureResult(approvedRows, errorMessage(error, "邮件发送失败"))];
    }
    try {
      finalRows = await applyLogisticsExpenseInvoiceNotificationResults(approvedRows, emailResults, actor, now);
    } catch (error: unknown) {
      const message = errorMessage(error, "开票通知状态记录失败");
      emailResults = emailResults.length
        ? emailResults.map((result) => result.sent ? { ...result, sent: false, error: message } : result)
        : [logisticsExpenseNotificationFailureResult(approvedRows, message)];
      finalRows = approvedRows;
    }
    const reloadedRows = await reloadLogisticsExpenseRowsForBillIds([...new Set(approvedRows.map(rowBillId).filter(Boolean))], actor);
    if (reloadedRows.length) finalRows = reloadedRows;
    for (const [billId, billRows] of groupLogisticsExpenseRowsByBillId(finalRows)) {
      await writeAudit(request, actor, "审核通过物流费用账单", "logistics_bills", billId, approvedRows.filter((row) => rowBillId(row) === billId).map(serializeLogisticsExpense), {
        bill: serializeLogisticsExpenseBill(billRows),
        emailResults,
      });
    }
    for (const result of emailResults.filter((item) => !item.sent && !item.skipped)) {
      await writeAudit(request, actor, "物流费用开票通知失败", "logistics_bills", result.supplierId || "supplier", null, {
        supplierName: result.supplierName,
        errorMessage: result.error,
        expenseIds: result.expenseIds,
      });
    }
    for (const orderId of [...new Set(finalRows.map((row) => row.orderId).filter(Boolean))]) {
      await refreshTaxRefundCompleteness(String(orderId));
    }
  });
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
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
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
  const blocked = rows.find((row) => !canUploadLogisticsBillInvoice({ auditStatus: rowAuditStatus(row) }));
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
