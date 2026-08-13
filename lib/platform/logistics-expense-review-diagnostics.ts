import { logServerError } from "./shared-base-errors";

export type LogisticsExpenseReviewTransactionPhase =
  | "direct-bill-transaction"
  | "legacy-bill-transaction";

export type LogisticsExpenseReviewTransactionStep =
  | "transaction-setup"
  | "order-scope"
  | "archive-commission-check"
  | "bill-lock"
  | "bill-update"
  | "full-reload"
  | "header-check"
  | "settled-cost"
  | "cost-sync"
  | "cost-link"
  | "bill-workflow"
  | "outbox"
  | "transaction-commit";

type DatabaseErrorDiagnostic = {
  errorKind: "column-not-found";
  prismaCode?: string;
  sqlState?: string;
  adapterKind?: string;
  modelName?: string;
  column?: string;
  recordAlias?: string;
  recordField?: string;
};

type FailureContext = {
  phase: LogisticsExpenseReviewTransactionPhase;
  billCount: number;
  rowCount: number;
};

type TransactionTrace = {
  phase: LogisticsExpenseReviewTransactionPhase;
  step: LogisticsExpenseReviewTransactionStep;
};

const transactionTraceByError = new WeakMap<object, TransactionTrace>();

function errorRecords(error: unknown) {
  const records: Array<Record<string, unknown>> = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length && records.length < 12) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    records.push(record);
    for (const key of ["meta", "driverAdapterError", "cause", "error"]) {
      if (record[key]) queue.push(record[key]);
    }
  }
  return records;
}

function firstString(
  records: Array<Record<string, unknown>>,
  keys: string[],
  predicate: (value: string) => boolean = () => true,
) {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && predicate(value)) return value;
    }
  }
  return "";
}

function firstNumber(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return 0;
}

function safeSchemaToken(value: string) {
  const token = value.trim();
  if (!token || token.length > 160) return "";
  if (/^[A-Za-z_][A-Za-z0-9_.$-]*$/.test(token)) return token;
  if (/^"[A-Za-z_][A-Za-z0-9_$-]*"(?:\."[A-Za-z_][A-Za-z0-9_$-]*")*$/.test(token)) {
    return token.replaceAll('"', "");
  }
  return "";
}

export function logisticsExpenseReviewDatabaseErrorDiagnostic(
  error: unknown,
): DatabaseErrorDiagnostic | null {
  const records = errorRecords(error);
  const prismaCode = firstString(records, ["code"], (value) => /^P\d{4}$/i.test(value));
  const sqlState = firstString(records, ["sqlState", "sqlstate", "originalCode", "code"], (value) => value === "42703");
  const adapterKind = firstString(records, ["kind", "name"], (value) => /ColumnNotFound/i.test(value));
  const messages = records
    .flatMap((record) => [record.message, record.originalMessage])
    .filter((value): value is string => typeof value === "string");
  const recordFieldMatch = messages
    .map((message) => message.match(/record\s+["'`]?([A-Za-z_][A-Za-z0-9_.$-]*)["'`]?\s+has no field\s+["'`]?([A-Za-z_][A-Za-z0-9_.$-]*)["'`]?/i))
    .find(Boolean);
  const isColumnNotFound = prismaCode.toUpperCase() === "P2022"
    || sqlState === "42703"
    || /ColumnNotFound/i.test(adapterKind)
    || Boolean(recordFieldMatch)
    || messages.some((message) => /ColumnNotFound|\bP2022\b|\b42703\b|column\b[^\n]*does not exist|The column\b[^\n]*does not exist/i.test(message));
  if (!isColumnNotFound) return null;
  const directColumn = firstString(records, ["column", "columnName", "fieldName"]);
  const messageColumn = messages
    .map((message) => message.match(/column\s+[`'"]?([A-Za-z_][A-Za-z0-9_.$"-]*)[`'"]?\s+does not exist/i)?.[1] || "")
    .find(Boolean) || "";
  const modelName = safeSchemaToken(firstString(records, ["modelName", "model"]));
  const column = safeSchemaToken(directColumn || messageColumn);
  const recordAlias = safeSchemaToken(recordFieldMatch?.[1] || "");
  const recordField = safeSchemaToken(recordFieldMatch?.[2] || "");
  return {
    errorKind: "column-not-found",
    ...(prismaCode ? { prismaCode } : {}),
    ...(sqlState ? { sqlState } : {}),
    ...(adapterKind ? { adapterKind } : {}),
    ...(modelName ? { modelName } : {}),
    ...(column ? { column } : {}),
    ...(recordAlias ? { recordAlias } : {}),
    ...(recordField ? { recordField } : {}),
  };
}

export function attachLogisticsExpenseReviewTransactionTrace(
  error: unknown,
  trace: TransactionTrace,
) {
  if (error && typeof error === "object") transactionTraceByError.set(error, trace);
}

export function logLogisticsExpenseReviewFailure(error: unknown, context: FailureContext) {
  const diagnostic = logisticsExpenseReviewDatabaseErrorDiagnostic(error);
  const records = errorRecords(error);
  const originalStatus = firstNumber(records, ["status", "statusCode"]);
  if (!diagnostic && originalStatus >= 400 && originalStatus < 500) return;
  const originalCode = firstString(records, ["code"], (value) => /^[A-Z][A-Z0-9_]+$/.test(value));
  const trace = error && typeof error === "object" ? transactionTraceByError.get(error) : undefined;
  const reportableError = Object.assign(
    new Error(diagnostic ? "database_query_structure_error" : "review_transaction_failed"),
    {
      status: originalStatus >= 500 ? originalStatus : 500,
      code: diagnostic?.prismaCode || originalCode || "LOGISTICS_EXPENSE_REVIEW_TRANSACTION_FAILED",
      details: diagnostic || { errorKind: "transaction-failed" },
    },
  );
  logServerError("物流费用审核事务失败", reportableError, {
    phase: trace?.phase || context.phase,
    step: trace?.step || "transaction-setup",
    billCount: Math.max(0, Math.trunc(context.billCount || 0)),
    rowCount: Math.max(0, Math.trunc(context.rowCount || 0)),
    ...(diagnostic || { errorKind: "transaction-failed" }),
  });
}
