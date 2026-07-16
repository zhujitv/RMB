import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewRoute = readFileSync("app/api/logistics-costs/review/route.ts", "utf8");
const reviewWorkflow = readFileSync("lib/platform/logistics-expense-workflow-review.ts", "utf8");
const reviewActions = readFileSync("app/modules/logistics-fees/use-logistics-fees-review-actions.ts", "utf8");

test("logistics review exposes an admin-scoped exact status reconciliation read", () => {
  assert.match(reviewRoute, /export async function GET\(request: NextRequest\)/);
  assert.match(reviewRoute, /requireApiActor\(request\)/);
  assert.match(reviewRoute, /query\.getAll\("billId"\)/);
  assert.match(reviewRoute, /getLogisticsExpenseReviewStatuses\(actor, billIds\)/);
  assert.match(reviewWorkflow, /export async function getLogisticsExpenseReviewStatuses/);
  assert.match(reviewWorkflow, /assertCanReviewLogisticsExpense\(actor\)/);
  assert.match(reviewWorkflow, /reloadLogisticsExpenseRowsForBillIds\(ids, actor\)/);
  assert.match(reviewWorkflow, /missingIds\.length[\s\S]*LOGISTICS_EXPENSE_REVIEW_STATUS_NOT_FOUND/);
  assert.match(reviewWorkflow, /results: ids\.map\(\(billId\) => \(\{[\s\S]*auditStatus:/);
});

test("client reconciles only ambiguous transport failures and never retries approval", () => {
  assert.match(reviewActions, /new Set\(\[408, 502, 503, 504\]\)/);
  assert.match(reviewActions, /error\.code === "LOGISTICS_REVIEW_TIMEOUT"/);
  assert.match(reviewActions, /error instanceof TypeError/);
  assert.match(reviewActions, /catch \(requestError\)[\s\S]*if \(shouldReconcileLogisticsExpenseReview\(requestError\)\)/);
  assert.match(reviewActions, /apiJson<LogisticsExpenseMutationResult>\([\s\S]*`\/api\/logistics-costs\/review\?\$\{query\}`[\s\S]*timeoutMs: 10000/);
  assert.match(reviewActions, /物流费用已审核，开票通知已进入后台发送队列/);
  assert.match(reviewActions, /审核结果未知，请刷新确认，勿重复操作/);

  const approvalCalls = reviewActions.match(/apiJson<LogisticsExpenseMutationResult>\("\/api\/logistics-costs\/review"/g) || [];
  assert.equal(approvalCalls.length, 1, "the ambiguous-error path must not retry PATCH approval");
  const reconciliationStart = reviewActions.indexOf("async function reconcileReviewResult");
  const approvalStart = reviewActions.indexOf("async function reviewExpenseBills", reconciliationStart);
  assert.ok(reconciliationStart >= 0 && approvalStart > reconciliationStart);
  assert.doesNotMatch(reviewActions.slice(reconciliationStart, approvalStart), /method:\s*"PATCH"/);
});
