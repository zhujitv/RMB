import {
  codedError,
  logServerError,
  nonEmpty,
  optional,
  refreshTaxRefundCompletenessBatch,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  assertCanReviewLogisticsExpense,
  aggregateLogisticsExpenseStatus,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  actorId,
  groupLogisticsExpenseRowsByBillId,
  loadLogisticsExpenseBillRowsForAction,
  normalizeLogisticsExpenseReviewIdentifiers,
  reloadLogisticsExpenseRowsForBillIds,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseRow,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import {
  approveLogisticsExpenseBillRowsInTransaction,
  approveLogisticsExpenseBillsInTransaction,
  loadLogisticsExpenseReviewBills,
  logisticsExpenseReviewResultFromRows,
  logisticsExpenseReviewSafeErrorMessage,
  logisticsExpenseReviewSummaryMessage,
  markLogisticsExpenseReviewNotificationResults,
  type LogisticsExpenseApprovalAuditEntry,
} from "./logistics-expense-workflow-review-helpers";
import { processLogisticsInvoiceNotificationOutbox } from "./logistics-invoice-notification-outbox";
import { logLogisticsExpenseReviewFailure } from "./logistics-expense-review-diagnostics";
import type { LogisticsExpenseReviewExecutionOptions } from "./logistics-expense-review-types";

function logisticsExpenseRowsAfterCommittedApproval(
  rows: LogisticsExpenseRow[] = [],
  actor: ActorContext,
  reviewRemark: string | null | undefined,
  reviewedAt: Date,
  costIdByExpenseId: Map<string, string> = new Map(),
) {
  return rows.map((row) => ({
    ...row,
    costId: costIdByExpenseId.get(row.id) || row.costId,
    bill: row.bill
      ? {
          ...row.bill,
          auditStatus: "审核通过",
          reviewedById: actorId(actor) || null,
          reviewedAt,
          reviewRemark,
          rejectReason: null,
          invoiceNotificationError: null,
          updatedAt: reviewedAt,
        }
      : row.bill,
  })) as LogisticsExpenseRow[];
}

export async function reviewLogisticsExpenseBills(
  request: AuditRequestLike,
  actor: ActorContext,
  input: UnknownRecord = {},
  options: LogisticsExpenseReviewExecutionOptions = {},
) {
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
  const notificationOutboxKeys: string[] = [];
  const approvalAuditEntries: LogisticsExpenseApprovalAuditEntry[] = [];
  const costIdByExpenseId = new Map<string, string>();
  if (directBills.length) {
    const billIds = directBills.map((bill) => bill.billId);
    let committed = false;
    try {
      const approval = await approveLogisticsExpenseBillsInTransaction(request, billIds, actor, reviewRemark, now);
      const outboxIntents = approval?.outboxIntents || [];
      notificationOutboxKeys.push(...outboxIntents.map((item) => item.idempotencyKey).filter(Boolean));
      for (const link of approval?.costLinks || []) costIdByExpenseId.set(link.expenseId, link.costId);
      approvalAuditEntries.push(...(approval?.auditEntries || []));
      committed = true;
    } catch (error: unknown) {
      logLogisticsExpenseReviewFailure(error, {
        phase: "direct-bill-transaction",
        billCount: directBills.length,
        rowCount: directBills.reduce((count, bill) => count + bill.rows.length, 0),
      });
      const safeMessage = logisticsExpenseReviewSafeErrorMessage(error);
      for (const bill of directBills) {
        results.push(logisticsExpenseReviewResultFromRows(bill.rows, {
          auditStatus: aggregateLogisticsExpenseStatus(bill.rows, "auditStatus"),
          notificationStatus: "not_sent",
          errorMessage: safeMessage || "数据库更新失败",
        }));
      }
    }
    if (committed) {
      const reloaded = options.deferSideEffects ? null : await runNonCriticalTask(
        "物流费用审核提交后重新读取账单",
        () => reloadLogisticsExpenseRowsForBillIds(billIds, actor),
        { context: { billIds } },
      );
      const rowsByBillId = groupLogisticsExpenseRowsByBillId(Array.isArray(reloaded) ? reloaded : []);
      for (const bill of directBills) {
        const savedRows = rowsByBillId.get(bill.billId)
          || logisticsExpenseRowsAfterCommittedApproval(bill.rows, actor, reviewRemark, now, costIdByExpenseId);
        finalRows.push(...savedRows);
        results.push(logisticsExpenseReviewResultFromRows(savedRows, {
          auditStatus: "审核通过",
          notificationStatus: "pending",
          errorMessage: "",
        }));
      }
    }
  }
  for (const bill of legacyBills) {
    let committed = false;
    try {
      const approval = await approveLogisticsExpenseBillRowsInTransaction(request, bill.rows, actor, reviewRemark, now);
      const outboxIntents = approval?.outboxIntents || [];
      notificationOutboxKeys.push(...outboxIntents.map((item) => item.idempotencyKey).filter(Boolean));
      for (const link of approval?.costLinks || []) costIdByExpenseId.set(link.expenseId, link.costId);
      approvalAuditEntries.push(...(approval?.auditEntries || []));
      committed = true;
    } catch (error: unknown) {
      logLogisticsExpenseReviewFailure(error, {
        phase: "legacy-bill-transaction",
        billCount: 1,
        rowCount: bill.rows.length,
      });
      const safeMessage = logisticsExpenseReviewSafeErrorMessage(error);
      results.push(logisticsExpenseReviewResultFromRows(bill.rows, {
        auditStatus: aggregateLogisticsExpenseStatus(bill.rows, "auditStatus"),
        notificationStatus: "not_sent",
        errorMessage: safeMessage || "数据库更新失败",
      }));
    }
    if (committed) {
      const reloaded = options.deferSideEffects ? null : await runNonCriticalTask(
        "物流费用审核提交后重新读取历史账单",
        () => loadLogisticsExpenseBillRowsForAction(bill.billId, actor),
        { context: { billId: bill.billId } },
      );
      const savedRows = Array.isArray(reloaded) && reloaded.length
        ? reloaded
        : logisticsExpenseRowsAfterCommittedApproval(bill.rows, actor, reviewRemark, now, costIdByExpenseId);
      finalRows.push(...savedRows);
      results.push(logisticsExpenseReviewResultFromRows(savedRows, {
        auditStatus: "审核通过",
        notificationStatus: "pending",
        errorMessage: "",
      }));
    }
  }
  const approvedBillIds = [...new Set(results
    .filter((result) => result.auditStatus === "审核通过" && !result.errorMessage)
    .map((result) => result.billId)
    .filter(Boolean))];
  const approvedRows = finalRows.filter((row) => approvedBillIds.includes(rowBillId(row)));
  let sideEffects = {
    rows: [] as LogisticsExpenseRow[],
    emailResults: [] as Array<{
      supplierName?: string;
      sent?: boolean;
      skipped?: boolean;
      queued?: boolean;
      error?: string;
      expenseIds?: string[];
    }>,
  };
  const notificationQueued = notificationOutboxKeys.length > 0;
  const orderIds = [...new Set(approvedRows.map((row) => row.orderId).filter(Boolean))];
  const processDurableSideEffects = async () => {
    let notificationResult: Awaited<ReturnType<typeof processLogisticsInvoiceNotificationOutbox>> | null = null;
    try {
      await Promise.all(approvalAuditEntries.map((entry) => runNonCriticalTask(
        "物流费用审核日志写入",
        () => writeAudit(request, actor, "审核通过物流费用账单", "logistics_bills", entry.billId, entry.before, entry.after),
        { context: { billId: entry.billId } },
      )));
    } catch (error: unknown) {
      logServerError("物流费用审核后台任务执行失败", error, {
        task: "audit-log",
        billIds: approvedBillIds,
      });
    }
    try {
      notificationResult = await processLogisticsInvoiceNotificationOutbox({
        idempotencyKeys: notificationOutboxKeys,
        limit: Math.min(8, Math.max(1, notificationOutboxKeys.length)),
      });
    } catch (error: unknown) {
      logServerError("物流费用审核后台任务执行失败", error, {
        task: "notification-outbox",
        billIds: approvedBillIds,
      });
    }
    try {
      await refreshTaxRefundCompletenessBatch(orderIds);
    } catch (error: unknown) {
      logServerError("物流费用审核后台任务执行失败", error, {
        task: "tax-refund-completeness",
        billIds: approvedBillIds,
      });
    }
    try {
      invalidateWorkbenchTodosCache();
    } catch (error: unknown) {
      logServerError("物流费用审核后台任务执行失败", error, {
        task: "workbench-cache",
        billIds: approvedBillIds,
      });
    }
    return notificationResult;
  };
  if (approvedRows.length && options.deferSideEffects) {
    options.deferSideEffects(async () => {
      await processDurableSideEffects();
    });
  } else if (approvedRows.length) {
    const notificationResult = await processDurableSideEffects();
    if (notificationResult) {
      sideEffects = {
        rows: approvedRows,
        emailResults: notificationResult.results.map((result) => ({
          supplierName: result.supplierName,
          sent: result.sent,
          skipped: result.skipped,
          queued: result.queued,
          error: result.error,
          expenseIds: result.expenseIds || [],
        })),
      };
    }
  }
  if (sideEffects.rows.length) {
    const syncedById = new Map(sideEffects.rows.map((row) => [row.id, row]));
    finalRows = finalRows.map((row) => syncedById.get(row.id) || row);
  }
  markLogisticsExpenseReviewNotificationResults(results, approvedRows, sideEffects.emailResults);
  if (approvedRows.length) invalidateWorkbenchTodosCache();
  const serializedBills = approvedBillIds
    .map((billId) => serializeLogisticsExpenseBill(finalRows.filter((row) => rowBillId(row) === billId)))
    .filter((bill) => bill.items.length > 0);
  const successCount = approvedBillIds.length;
  const failedCount = results.length - successCount;
  const emailErrors = sideEffects.emailResults
    .filter((result) => !result.sent && !result.skipped)
    .map((result) => `${result.supplierName || "供应商"}：${result.error || "邮件发送失败"}`);
  const emailError = emailErrors.join("；");
  const emailNotified = sideEffects.emailResults.some((result) => result.sent);
  const summaryMessage = logisticsExpenseReviewSummaryMessage(successCount, failedCount, results, emailError, emailNotified);
  return {
    success: successCount > 0,
    successCount,
    failedCount,
    results,
    bills: serializedBills,
    expenses: finalRows.map(serializeLogisticsExpense),
    emailResults: sideEffects.emailResults,
    emailNotified,
    emailError,
    notificationQueued,
    message: notificationQueued ? `${summaryMessage}；开票通知已进入后台发送队列` : summaryMessage,
  };
}
