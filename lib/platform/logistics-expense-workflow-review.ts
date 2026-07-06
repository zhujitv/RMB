import { prisma } from "../prisma";
import { codedError, nonEmpty, optional, requireText, runNonCriticalTask, writeAudit } from "./shared";
import {
  assertCanReviewLogisticsExpense,
  aggregateLogisticsExpenseStatus,
  notifyLogisticsSupplierInvoiceBills,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { canRejectLogisticsBill } from "./logistics-bill-state-machine";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  actorId,
  assertWorkflowActor,
  groupLogisticsExpenseRowsByBillId,
  loadLogisticsExpenseBillRowsForAction,
  normalizeLogisticsExpenseReviewIdentifiers,
  reloadLogisticsExpenseRowsForBillIds,
  rowAuditStatus,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type LogisticsExpenseRow,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import {
  applyLogisticsExpenseInvoiceNotificationResults,
  approveLogisticsExpenseBillRowsInTransaction,
  approveLogisticsExpenseBillsInTransaction,
  loadLogisticsExpenseReviewBills,
  logisticsExpenseReviewResultFromRows,
  logisticsExpenseReviewSafeErrorMessage,
  logisticsExpenseReviewSummaryMessage,
  scheduleLogisticsExpenseReviewSideEffects,
} from "./logistics-expense-workflow-review-helpers";

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
  invalidateWorkbenchTodosCache();
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
  invalidateWorkbenchTodosCache();
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
          notificationStatus: auditStatus === "审核通过" ? "skipped" : "not_sent",
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
        notificationStatus: "skipped",
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
	const syncedRows = await scheduleLogisticsExpenseReviewSideEffects(request, actor, approvedRows, now);
	if (syncedRows.length) {
		const syncedById = new Map(syncedRows.map((row) => [row.id, row]));
		finalRows = finalRows.map((row) => syncedById.get(row.id) || row);
	}
  if (approvedRows.length) invalidateWorkbenchTodosCache();
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

export async function resendLogisticsExpenseInvoiceNotice(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  assertCanReviewLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw codedError("未找到可通知开票的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
	const blocked = rows.find((row) => rowAuditStatus(row) !== "审核通过");
  if (blocked) throw codedError("只有审核通过的物流费用账单可以重新发送开票通知。", 400, "LOGISTICS_EXPENSE_NOTICE_STATUS_INVALID");
  const emailResults = await notifyLogisticsSupplierInvoiceBills(rows);
  const updatedRows = await applyLogisticsExpenseInvoiceNotificationResults(rows, emailResults, actor, new Date());
  const finalRows = await reloadLogisticsExpenseRowsForBillIds([rowBillId(rows[0])], actor).then((nextRows) => nextRows.length ? nextRows : updatedRows);
  invalidateWorkbenchTodosCache();
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
