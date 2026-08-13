import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const resultsSource = readFileSync("lib/platform/logistics-expense-review-results.ts", "utf8");
const batchSource = readFileSync("lib/platform/logistics-expense-review-batch.ts", "utf8");
const approvalSource = readFileSync("lib/platform/logistics-expense-review-approval.ts", "utf8");
const costSyncSource = readFileSync("lib/platform/logistics-expense-review-cost-sync.ts", "utf8");
const diagnosticsSource = readFileSync("lib/platform/logistics-expense-review-diagnostics.ts", "utf8");
const diagnostics = createJiti(import.meta.url)("../lib/platform/logistics-expense-review-diagnostics.ts") as {
  logisticsExpenseReviewDatabaseErrorDiagnostic: (error: unknown) => Record<string, unknown> | null;
};

test("logistics review recognizes Prisma adapter column-not-found variants", () => {
  assert.match(diagnosticsSource, /\["meta", "driverAdapterError", "cause", "error"\]/);
  assert.match(diagnosticsSource, /prismaCode\.toUpperCase\(\) === "P2022"/);
  assert.match(diagnosticsSource, /sqlState === "42703"/);
  assert.match(diagnosticsSource, /ColumnNotFound/);
  const diagnostic = diagnostics.logisticsExpenseReviewDatabaseErrorDiagnostic({
    code: "P2022",
    meta: {
      driverAdapterError: {
        cause: {
          kind: "ColumnNotFound",
          originalCode: "42703",
          originalMessage: 'record "cost_rows" has no field "paid_at"',
        },
      },
    },
  });
  assert.deepEqual(diagnostic, {
    errorKind: "column-not-found",
    prismaCode: "P2022",
    sqlState: "42703",
    adapterKind: "ColumnNotFound",
    recordAlias: "cost_rows",
    recordField: "paid_at",
  });
  const unsafeDiagnostic = diagnostics.logisticsExpenseReviewDatabaseErrorDiagnostic({
    meta: {
      driverAdapterError: {
        cause: {
          kind: "ColumnNotFound",
          originalMessage: 'record "cost_rows;secret" has no field "paid_at"',
        },
      },
    },
  });
  assert.equal(unsafeDiagnostic?.recordAlias, undefined);
  assert.equal(unsafeDiagnostic?.recordField, undefined);
});

test("logistics review hides database column details from the UI", () => {
  assert.match(resultsSource, /审核失败：数据库查询结构异常，请联系管理员。/);
  assert.doesNotMatch(resultsSource, /已记录诊断信息/);
  assert.match(
    resultsSource,
    /logisticsExpenseReviewResultFromError[\s\S]*logisticsExpenseReviewSafeErrorMessage\(error\)/,
  );
});

test("direct and legacy review failures log only structured diagnostic context", () => {
  const calls = batchSource.match(/logLogisticsExpenseReviewFailure\(error, \{/g) || [];
  assert.equal(calls.length, 2);
  assert.match(batchSource, /phase: "direct-bill-transaction"/);
  assert.match(batchSource, /phase: "legacy-bill-transaction"/);
  assert.doesNotMatch(
    batchSource.match(/logLogisticsExpenseReviewFailure\(error, \{[\s\S]*?\}\);/g)?.join("\n") || "",
    /billIds?|orderIds?|expenseIds?|blNo|orderNo/,
  );
  assert.match(diagnosticsSource, /logServerError\("物流费用审核事务失败", reportableError/);
  assert.match(diagnosticsSource, /originalStatus >= 400 && originalStatus < 500\) return/);
});

test("review transactions track each database phase including commit failures", () => {
  for (const step of [
    "order-scope",
    "archive-commission-check",
    "bill-lock",
    "bill-update",
    "full-reload",
    "header-check",
    "bill-workflow",
    "outbox",
  ]) {
    assert.match(approvalSource, new RegExp(`markStep\\("${step}"\\)`));
  }
  for (const step of ["settled-cost", "cost-sync", "cost-link"]) {
    assert.match(costSyncSource, new RegExp(`options\\.onStep\\?\\.\\("${step}"\\)`));
  }
  assert.match(approvalSource, /callbackCompleted \? "transaction-commit" : step/);
  assert.match(approvalSource, /"direct-bill-transaction"/);
  assert.match(approvalSource, /"legacy-bill-transaction"/);
  assert.match(diagnosticsSource, /step: trace\?\.step \|\| "transaction-setup"/);
});
