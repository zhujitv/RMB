import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { codedError, logServerError, nonEmpty, refreshTaxRefundCompletenessBatch, runNonCriticalTask, writeAudit } from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  createOrUpdateCostFromLogisticsExpense,
  includeLogisticsExpenseRelations,
  notifyLogisticsSupplierInvoiceBills,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  asRecord,
  assertLogisticsBillRowsMatchHeader,
  assertWorkflowActor,
  errorMessage,
  groupLogisticsExpenseRowsByBillId,
  loadLogisticsExpenseBillRowsForAction,
  reloadLogisticsExpenseRowsForBillIds,
  rowBillId,
  rowBillStatus,
  type ActorContext,
  type AuditRequestLike,
  type CostLink,
  type EmailResult,
  type LogisticsExpenseRow,
  type ReviewBill,
  type ReviewResult,
} from "./logistics-expense-workflow-core";
import { isVoidedLogisticsBill } from "./logistics-bill-state-machine";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertNoSettledLogisticsCostConflict } from "./logistics-expense-cost-safety";

export async function loadLogisticsExpenseReviewBills(identifiers: string[] = [], actor: ActorContext) {
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

export function collectLogisticsExpenseReviewBill(rows: LogisticsExpenseRow[] = [], bills: ReviewBill[], results: ReviewResult[], seenBillIds: Set<string>) {
  if (!rows.length) throw codedError("未找到可审核的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const billId = rowBillId(rows[0]);
  if (seenBillIds.has(billId)) return;
  seenBillIds.add(billId);
  if (rows.some((row) => isVoidedLogisticsBill({ status: rowBillStatus(row) }))) {
    results.push(logisticsExpenseReviewResultFromRows(rows, {
      auditStatus: "已作废",
      notificationStatus: "not_sent",
      errorMessage: "物流费用账单已作废，不能审核。",
    }));
    return;
  }
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

export async function approveLogisticsExpenseBillsInTransaction(billIds: string[] = [], actor: ActorContext, reviewRemark: string | null | undefined, now = new Date()) {
  assertWorkflowActor(actor);
  const ids = [...new Set(billIds.map(nonEmpty).filter(Boolean))];
  if (!ids.length) return;
  await prisma.$transaction(async (tx) => {
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        status: { not: "voided" },
        auditStatus: "待审核",
        paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
      },
      data: {
        auditStatus: "审核通过",
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark,
        rejectReason: null,
        invoiceNotificationError: null,
        paymentStatus: "待开票",
        invoiceStatus: "待开票",
        updatedById: actorId(actor),
      },
    });
    if (billUpdate.count !== ids.length) {
      throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_STATUS_CHANGED");
    }
    const rows = await tx.logisticsExpense.findMany({
      where: {
        billId: { in: ids },
        deletedAt: null,
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ billId: "asc" }, { createdAt: "asc" }],
      take: ids.length * 500,
    });
    for (const [billId, billRows] of groupLogisticsExpenseRowsByBillId(rows)) {
      await assertLogisticsBillRowsMatchHeader(tx, billId, billRows);
    }
    await syncApprovedLogisticsExpenseCosts(tx, rows, actor);
    await syncApprovedLogisticsBillWorkflowStates(tx, rows, actor);
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
}

export async function scheduleLogisticsExpenseReviewSideEffects(request: AuditRequestLike, actor: ActorContext, approvedRows: LogisticsExpenseRow[] = [], now = new Date()) {
  if (!approvedRows.length) return { rows: [], emailResults: [] as EmailResult[] };
  const billIds = [...new Set(approvedRows.map(rowBillId).filter(Boolean))];
  const reloadedRows = await runNonCriticalTask(
    "物流费用审核后重新读取账单",
    () => reloadLogisticsExpenseRowsForBillIds(billIds, actor),
    { context: { billIds } },
  );
  let finalRows = Array.isArray(reloadedRows) && reloadedRows.length ? reloadedRows : approvedRows;
  let emailResults: EmailResult[] = [];
  const rowsByBill = [...groupLogisticsExpenseRowsByBillId(finalRows).values()];
  const rowsReadyForNotification = rowsByBill
    .filter((billRows) => !["已上传发票", "已确认", "已确认发票"].includes(aggregateLogisticsExpenseInvoiceStatus(billRows)))
    .flat();
  const alreadyInvoicedResults: EmailResult[] = rowsByBill
    .filter((billRows) => ["已上传发票", "已确认", "已确认发票"].includes(aggregateLogisticsExpenseInvoiceStatus(billRows)))
    .map((billRows) => ({
      supplierId: billRows[0]?.supplierId || "",
      supplierName: billRows[0]?.supplierNameSnapshot || billRows[0]?.supplier?.supplierName || "供应商",
      sent: false,
      skipped: true,
      error: "",
      expenseIds: billRows.map((row) => row.id).filter(Boolean),
    }));
  try {
    const sentResults = rowsReadyForNotification.length
      ? await notifyLogisticsSupplierInvoiceBills(rowsReadyForNotification, {
          idempotencyScope: `approval-${now.toISOString()}`,
        })
      : [];
    emailResults = [...alreadyInvoicedResults, ...sentResults];
  } catch (error: unknown) {
    logServerError("物流费用审核后开票通知发送失败", error, { billIds });
    emailResults = [
      ...alreadyInvoicedResults,
      logisticsExpenseNotificationFailureResult(rowsReadyForNotification, errorMessage(error, "邮件发送失败")),
    ];
  }
  try {
    const notificationRows = await applyLogisticsExpenseInvoiceNotificationResults(finalRows, emailResults, actor, now);
    if (notificationRows.length) finalRows = notificationRows;
  } catch (error: unknown) {
    const message = errorMessage(error, "开票通知状态记录失败");
    logServerError("物流费用开票通知状态记录失败", error, { billIds });
    emailResults = emailResults.length
      ? emailResults.map((result) => result.sent ? { ...result, trackingError: message } : result)
      : [logisticsExpenseNotificationFailureResult(finalRows, message)];
  }
  const finalReloadedRows = await runNonCriticalTask(
    "物流费用开票通知后重新读取账单",
    () => reloadLogisticsExpenseRowsForBillIds(billIds, actor),
    { context: { billIds } },
  );
  if (Array.isArray(finalReloadedRows) && finalReloadedRows.length) finalRows = finalReloadedRows;
  for (const [billId, billRows] of groupLogisticsExpenseRowsByBillId(finalRows)) {
    await runNonCriticalTask(
      "物流费用审核日志写入",
      () => writeAudit(request, actor, "审核通过物流费用账单", "logistics_bills", billId, approvedRows.filter((row) => rowBillId(row) === billId).map(serializeLogisticsExpense), {
        bill: serializeLogisticsExpenseBill(billRows),
        emailResults: emailResults.filter((result) => (result.expenseIds || []).some((id) => billRows.some((row) => row.id === id))),
      }),
      { context: { billId } },
    );
  }
  for (const result of emailResults.filter((item) => !item.sent && !item.skipped)) {
    await runNonCriticalTask(
      "物流费用开票通知失败日志写入",
      () => writeAudit(request, actor, "物流费用开票通知失败", "logistics_bills", result.supplierId || "supplier", null, {
        supplierName: result.supplierName,
        errorMessage: result.error,
        expenseIds: result.expenseIds,
      }),
      { context: { supplierId: result.supplierId || "" } },
    );
  }
  const orderIds = [...new Set(finalRows.map((row) => row.orderId).filter(Boolean))];
  await runNonCriticalTask(
    "物流费用审核后刷新退税完整度",
    () => refreshTaxRefundCompletenessBatch(orderIds),
    { context: { orderIds } },
  );
  await runNonCriticalTask(
    "物流费用审核后刷新待办缓存",
    () => invalidateWorkbenchTodosCache(),
    { context: { billIds } },
  );
  return { rows: finalRows, emailResults };
}

export async function approveLogisticsExpenseBillRowsInTransaction(rows: LogisticsExpenseRow[] = [], actor: ActorContext, reviewRemark: string | null | undefined, now = new Date()) {
  assertWorkflowActor(actor);
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return;
  const billId = rowBillId(rows[0]);
  await prisma.$transaction(async (tx) => {
    if (rows[0]?.billId) {
      const billUpdate = await tx.logisticsBill.updateMany({
        where: {
          id: billId,
          deletedAt: null,
          status: { not: "voided" },
          auditStatus: "待审核",
          paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
        },
        data: {
          auditStatus: "审核通过",
          reviewedById: actor.id,
          reviewedAt: now,
          reviewRemark,
          rejectReason: null,
          invoiceNotificationError: null,
          paymentStatus: "待开票",
          invoiceStatus: "待开票",
          updatedById: actorId(actor),
        },
      });
      if (billUpdate.count !== 1) {
        throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_STATUS_CHANGED");
      }
      const savedRows = await tx.logisticsExpense.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
        },
        include: includeLogisticsExpenseRelations(),
        orderBy: [{ createdAt: "asc" }],
        take: ids.length,
      });
      await assertLogisticsBillRowsMatchHeader(tx, billId, savedRows);
      await syncApprovedLogisticsExpenseCosts(tx, savedRows, actor);
      await syncApprovedLogisticsBillWorkflowStates(tx, savedRows, actor);
      return;
    }
    throw codedError("物流费用账单缺少主表状态，请先执行账单迁移。", 409, "LOGISTICS_BILL_REQUIRED");
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
}

async function syncApprovedLogisticsBillWorkflowStates(
  tx: Prisma.TransactionClient,
  rows: LogisticsExpenseRow[] = [],
  actor: ActorContext,
) {
  for (const [billId, billRows] of groupLogisticsExpenseRowsByBillId(rows)) {
    const invoiceStatus = aggregateLogisticsExpenseInvoiceStatus(billRows);
    const paymentStatus = ["已确认", "已确认发票"].includes(invoiceStatus) ? "待付款" : "待开票";
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: "voided" },
        auditStatus: "审核通过",
        paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
      },
      data: {
        invoiceStatus,
        paymentStatus,
        updatedById: actorId(actor) || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_WORKFLOW_STATE_CHANGED");
    }
  }
}

export async function updateLogisticsExpenseCostIds(tx: Prisma.TransactionClient | typeof prisma, costLinks: CostLink[] = []) {
  const links = costLinks.filter((item) => item.expenseId && item.costId);
  if (!links.length) return;
  const expenseIds = [...new Set(links.map((item) => item.expenseId))];
  const costIds = [...new Set(links.map((item) => item.costId))];
  if (expenseIds.length !== links.length || costIds.length !== links.length) {
    throw codedError("物流费用成本关联不唯一，已取消同步。", 409, "LOGISTICS_COST_LINK_CONFLICT");
  }
  const cases = links.map((item) => Prisma.sql`WHEN ${item.expenseId} THEN ${item.costId}`);
  const updatedCount = await tx.$executeRaw(Prisma.sql`
    UPDATE "logistics_expenses"
    SET "cost_id" = CASE "id" ${Prisma.join(cases, " ")} END
    WHERE "id" IN (${Prisma.join(expenseIds)})
      AND "deleted_at" IS NULL
  `);
  if (updatedCount !== links.length) {
    throw codedError("物流费用明细状态已变化，成本同步已取消，请刷新后重试。", 409, "LOGISTICS_COST_LINK_CHANGED");
  }
}

export async function syncApprovedLogisticsExpenseCosts(
  tx: Prisma.TransactionClient | typeof prisma,
  rows: LogisticsExpenseRow[] = [],
  actor: ActorContext,
  options: { settledCostMode?: "reject" | "preserve-required" } = {},
) {
  if (!rows.length) throw codedError("物流费用账单缺少费用明细，不能同步成本。", 409, "LOGISTICS_COST_SYNC_ROWS_EMPTY");
  const settledCostMode = options.settledCostMode || "reject";
  if (settledCostMode === "reject") {
    await assertNoSettledLogisticsCostConflict(tx, rows);
  }
  const links: CostLink[] = [];
  for (const row of rows) {
    const cost = await createOrUpdateCostFromLogisticsExpense(tx, row, actor, { settledCostMode });
    links.push({ expenseId: row.id, costId: cost.id, invoiceDocumentId: row.invoiceDocumentId || null });
  }
  await updateLogisticsExpenseCostIds(tx, links);
  await linkLogisticsExpenseInvoiceDocumentsToCosts(tx, links);
  return links;
}

export async function linkLogisticsExpenseInvoiceDocumentsToCosts(tx: Prisma.TransactionClient | typeof prisma, costLinks: CostLink[] = []) {
  const linksByDocumentId = new Map<string, CostLink>();
  for (const link of costLinks) {
    const documentId = nonEmpty(link.invoiceDocumentId);
    if (link.expenseId && link.costId && documentId && !linksByDocumentId.has(documentId)) {
      linksByDocumentId.set(documentId, { ...link, invoiceDocumentId: documentId });
    }
  }
  for (const link of linksByDocumentId.values()) {
    await tx.orderDocument.updateMany({
      where: {
        id: link.invoiceDocumentId || "",
        deletedAt: null,
      },
      data: { costId: link.costId },
    });
    await tx.fileAsset.updateMany({
      where: {
        isDeleted: false,
        OR: [
          { orderDocumentId: link.invoiceDocumentId || "" },
          { logisticsExpenseId: link.expenseId },
        ],
      },
      data: { costId: link.costId },
    });
  }
}

export function logisticsExpenseReviewSafeErrorMessage(error: unknown) {
  const message = errorMessage(error);
  if (/expired transaction|Transaction API error|timeout|timed out|P2028/i.test(message)) {
    return "审核失败：系统处理超时，请稍后重试。";
  }
  return message;
}

export function logisticsExpenseReviewResultFromRows(rows: LogisticsExpenseRow[] = [], overrides: Partial<ReviewResult> = {}): ReviewResult {
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

export function logisticsExpenseReviewResultFromError(identifier: unknown, error: unknown): ReviewResult {
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

export function logisticsExpenseNotificationFailureResult(rows: LogisticsExpenseRow[] = [], message = "邮件发送失败"): EmailResult {
  const first = rows[0];
  return {
    supplierId: first?.supplierId || "",
    supplierName: first?.supplierNameSnapshot || first?.supplier?.supplierName || "供应商",
    sent: false,
    error: message,
    expenseIds: rows.map((row) => row.id).filter(Boolean),
  };
}

export function markLogisticsExpenseReviewNotificationResults(results: ReviewResult[] = [], rows: LogisticsExpenseRow[] = [], emailResults: EmailResult[] = []) {
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

export function logisticsExpenseReviewSummaryMessage(successCount = 0, failedCount = 0, results: ReviewResult[] = [], emailError = "", emailNotified = false) {
  const failures = results.filter((result) => result.auditStatus !== "审核通过" && result.errorMessage);
  if (!successCount) {
    return failures.length
      ? failures.map((result) => `${result.orderNo || result.billId || "账单"}${result.blNo ? `/${result.blNo}` : ""}：${result.errorMessage}`).join("；")
      : "审核物流费用失败";
  }
	const parts = [`已审核 ${successCount} 票物流费用，已同步成本管理`];
  if (emailNotified) parts.push("已通知供应商上传发票");
  if (emailError) parts.push(`开票通知发送失败，可稍后重发：${emailError}`);
  if (failedCount) parts.push(`有 ${failedCount} 票未审核：${failures.map((result) => `${result.orderNo || result.billId || "账单"}${result.blNo ? `/${result.blNo}` : ""}：${result.errorMessage || "审核失败"}`).join("；")}`);
  return parts.join("；");
}

export async function applyLogisticsExpenseInvoiceNotificationResults(rows: LogisticsExpenseRow[] = [], emailResults: EmailResult[] = [], actor: ActorContext, now = new Date()) {
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
    const saved = await prisma.logisticsExpense.update({
      where: { id: row.id },
      data: {
        invoiceNotifiedAt: result.sent ? now : row.invoiceNotifiedAt,
        invoiceNotificationError: result.sent || result.skipped ? null : (result.error || "邮件发送失败"),
        updatedById: actorId(actor),
      },
      include: includeLogisticsExpenseRelations(),
    });
    finalRows.push(saved);
  }
  for (const billId of [...new Set(finalRows.map(rowBillId).filter(Boolean))]) {
    const billRows = finalRows.filter((row) => rowBillId(row) === billId);
    const billExpenseIds = new Set(billRows.map((row) => row.id));
    const billEmailResults = emailResults.filter((result) => (result.expenseIds || []).some((id) => billExpenseIds.has(id)));
    const sent = billEmailResults.some((result) => result.sent);
    await prisma.logisticsBill.updateMany({
      where: { id: billId, deletedAt: null },
      data: {
        ...(sent ? { invoiceNotifiedAt: now } : {}),
        invoiceNotificationError: billEmailResults.find((result) => !result.sent && !result.skipped)?.error || null,
        updatedById: actorId(actor) || null,
      },
    });
  }
  return finalRows;
}
