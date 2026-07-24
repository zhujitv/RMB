import {
  codedError,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  assertCanReviewLogisticsExpense,
  notifyLogisticsSupplierInvoiceBills,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  loadLogisticsExpenseBillRowsForAction,
  reloadLogisticsExpenseRowsForBillIds,
  rowAuditStatus,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
} from "./logistics-expense-workflow-core";
import { applyLogisticsExpenseInvoiceNotificationResults } from "./logistics-expense-workflow-review-helpers";

export async function resendLogisticsExpenseInvoiceNotice(request: AuditRequestLike, actor: ActorContext, identifier: unknown) {
  assertCanReviewLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw codedError("未找到可通知开票的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const blocked = rows.find((row) => rowAuditStatus(row) !== "审核通过");
  if (blocked) throw codedError("只有审核通过的物流费用账单可以重新发送开票通知。", 400, "LOGISTICS_EXPENSE_NOTICE_STATUS_INVALID");
  const emailResults = await notifyLogisticsSupplierInvoiceBills(rows, {
    idempotencyScope: `resend-${new Date().toISOString()}`,
  });
  const trackedRows = await runNonCriticalTask(
    "物流费用开票通知重发状态记录",
    () => applyLogisticsExpenseInvoiceNotificationResults(rows, emailResults, actor, new Date()),
    { context: { billId: rowBillId(rows[0]) } },
  );
  const updatedRows = Array.isArray(trackedRows) && trackedRows.length ? trackedRows : rows;
  const reloadedRows = await runNonCriticalTask(
    "物流费用开票通知重发后重新读取账单",
    () => reloadLogisticsExpenseRowsForBillIds([rowBillId(rows[0])], actor),
    { context: { billId: rowBillId(rows[0]) } },
  );
  const finalRows = Array.isArray(reloadedRows) && reloadedRows.length ? reloadedRows : updatedRows;
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
