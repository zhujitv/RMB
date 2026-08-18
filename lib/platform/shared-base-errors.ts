import { NextResponse } from "next/server";
import crypto from "node:crypto";

export type AppError = Error & {
  status?: number;
  code?: string;
  expose?: boolean;
  details?: unknown;
};

export function codedError(message: string, status: number, code: string): AppError {
  const error: AppError = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = status < 500;
  return error;
}

export const SENSITIVE_LOG_KEY_PATTERN = /(password|passwd|pwd|token|secret|credential|authorization|cookie|database_url|databaseurl|smtp|r2_|access[_-]?key|api[_-]?key|app[_-]?code|client[_-]?id|map[_-]?key|private[_-]?key|response(body|text|payload|data)|raw(json|body|payload)|textpreview|document(text|content)?|extractedfields|parsedjson|file(name)?|original(name|filename)|email|url)$/i;
export const BUSINESS_IDENTIFIER_LOG_KEY_PATTERN = /^(?:id|actorId|userId|loginAttemptId|orderId|orderNo|blNo|billOfLadingNo|shipmentId|shipmentNo|supplierId|customerId|costId|requestId|entityId|documentId|invoiceId|invoiceNo|bankReference)$/i;

export function redactSensitiveText(value: unknown, limit = 300) {
  const text = String(value ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\bLTAI[A-Za-z0-9]{12,}\b/g, "[redacted-access-key]")
    .replace(
      /((?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key(?:[_-]?(?:id|secret))?|app[_-]?code|authorization|cookie)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,
      "$1[redacted]",
    )
    .replace(/([?&](?:token|secret|key|api[_-]?key|access[_-]?key|signature|credential)=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[redacted]@");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeLogValue(key: string, value: unknown, depth = 0): unknown {
  if (SENSITIVE_LOG_KEY_PATTERN.test(key)) return "[redacted]";
  if (BUSINESS_IDENTIFIER_LOG_KEY_PATTERN.test(key)) {
    if (value == null || value === "") return value;
    const digest = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
    return `[id:${digest}]`;
  }
  if (value == null) return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth >= 2) return `[array:${value.length}]`;
    return value.slice(0, 20).map((item, index) => sanitizeLogValue(String(index), item, depth + 1));
  }
  if (isPlainRecord(value)) {
    if (depth >= 2) return "[object]";
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeLogValue(entryKey, entryValue, depth + 1)]),
    );
  }
  return String(value);
}

function errorForLog(error: unknown) {
  const typedError = (error || {}) as AppError & { name?: string; stack?: string };
  const status = typedError.status || 500;
  const isProduction = process.env.NODE_ENV === "production";
  return {
    name: typedError.name || "Error",
    status,
    code: typedError.code || undefined,
    message: (!isProduction || status < 500 || typedError.expose)
      ? redactSensitiveText(typedError.message || "未知错误")
      : "internal_server_error",
    stack: !isProduction && typedError.stack ? redactSensitiveText(typedError.stack, 2000) : undefined,
    details: typedError.details ? sanitizeForLog(typedError.details) : undefined,
  };
}

export function sanitizeForLog(input: unknown) {
  return sanitizeLogValue("context", input);
}

export function logServerError(label: string, error: unknown, context: Record<string, unknown> = {}) {
  const typedError = (error || {}) as AppError;
  const status = typedError.status || 500;
  if (process.env.NODE_ENV === "production" && status < 500) return;
  const sanitizedContext = sanitizeLogValue("context", context);
  const payload = {
    ...(isPlainRecord(sanitizedContext) ? sanitizedContext : {}),
    error: errorForLog(error),
  };
  if (status >= 500) {
    console.error(label, payload);
  } else {
    console.warn(label, payload);
  }
}

function prismaQueryForLog(modelName: string, action: string, args: unknown) {
  return `prisma.${modelName}.${action}(${JSON.stringify(sanitizeForLog(args))})`;
}

export function requirePrismaModel<T>(delegate: T | null | undefined, modelName: string, context: Record<string, unknown> = {}): T {
  if (delegate) return delegate;
  const error = codedError(`Prisma Model ${modelName} not found`, 500, "PRISMA_MODEL_NOT_FOUND");
  error.expose = false;
  error.details = { modelName, ...context };
  logServerError("Prisma Model not found", error, {
    modelName,
    ...context,
  });
  throw error;
}

export async function guardedPrismaFindMany<T = unknown>(
  delegate: unknown,
  modelName: string,
  location: string,
  args: unknown,
): Promise<T> {
  const model = requirePrismaModel<{ findMany?: (query: unknown) => Promise<T> }>(delegate as { findMany?: (query: unknown) => Promise<T> } | undefined, modelName, {
    operation: "findMany",
    location,
    sql: prismaQueryForLog(modelName, "findMany", args),
  });
  if (typeof model.findMany !== "function") {
    const error = codedError(`Prisma Model ${modelName} findMany not found`, 500, "PRISMA_MODEL_METHOD_NOT_FOUND");
    error.expose = false;
    error.details = { modelName, operation: "findMany", location };
    logServerError("Prisma Model method not found", error, {
      modelName,
      operation: "findMany",
      location,
      sql: prismaQueryForLog(modelName, "findMany", args),
    });
    throw error;
  }
  try {
    return await model.findMany(args);
  } catch (error: unknown) {
    const typedError = error as AppError;
    typedError.details = {
      ...(isPlainRecord(typedError.details) ? typedError.details : {}),
      modelName,
      operation: "findMany",
      location,
      sql: prismaQueryForLog(modelName, "findMany", args),
    };
    logServerError("Prisma findMany failed", error, {
      modelName,
      operation: "findMany",
      location,
      sql: prismaQueryForLog(modelName, "findMany", args),
    });
    throw error;
  }
}

function serverTimingSlowThresholdMs() {
  const configured = Number.parseInt(process.env.SERVER_TIMING_SLOW_MS || "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 1000;
}

export function logServerTiming(label: string, startedAt: number, context: Record<string, unknown> = {}) {
  const durationMs = Date.now() - startedAt;
  const slowThresholdMs = serverTimingSlowThresholdMs();
  const shouldLog = process.env.NODE_ENV !== "production"
    || process.env.SERVER_TIMING_LOGS === "true"
    || durationMs >= slowThresholdMs;
  if (!shouldLog) return durationMs;
  console.info(label, sanitizeLogValue("context", {
    ...context,
    durationMs,
    slow: durationMs >= slowThresholdMs,
  }));
  return durationMs;
}

export async function timeServerStep<T>(
  label: string,
  step: string,
  task: () => Promise<T>,
  context: Record<string, unknown> = {},
) {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    logServerTiming(label, startedAt, { ...context, step });
  }
}

export function logSecurityEvent(label: string, context: Record<string, unknown> = {}) {
  console.warn(label, sanitizeLogValue("context", context));
}

function shouldLogApiErrorStatus(status: number) {
  if (status === 401 || status === 403) return process.env.LOG_EXPECTED_AUTH_ERRORS === "true";
  return true;
}

function prismaSchemaMismatchMessage(error: unknown) {
  const typedError = (error || {}) as AppError & { name?: string };
  const message = String(typedError.message || "");
  const fieldMatch = message.match(
    /column .*`?(billing_method|billing_quantity)`?.*(does not exist|not exist)/i,
  );
  if (!fieldMatch) return "";
  const fieldName = String(fieldMatch[1] || "").includes("Quantity") || String(fieldMatch[1] || "").includes("quantity")
    ? "billingQuantity"
    : "billingMethod";
  return `保存失败：本地数据库缺少 ${fieldName} 字段，请执行迁移。`;
}

function prismaInfrastructureError(error: unknown) {
  const typedError = (error || {}) as AppError & { meta?: unknown };
  const code = String(typedError.code || "");
  const message = String(typedError.message || "");
  if (code === "P2037" || /too many (?:database )?connections|too many clients/i.test(message)) {
    return {
      status: 503,
      code: "PRISMA_DATABASE_POOL_EXHAUSTED",
      message: "数据库连接繁忙，请稍后重试。",
    };
  }
  if (
    code === "P1001"
    || /Can't reach database server|database .*connect|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection terminated|connect ECONNREFUSED/i.test(message)
  ) {
    return {
      status: 500,
      code: "PRISMA_DATABASE_CONNECTION_FAILED",
      message: "数据库暂时无法连接，请稍后重试或联系管理员。",
    };
  }
  if (
    code === "P2009"
    || /Unknown field|Unknown argument|Invalid .*select/i.test(message)
  ) {
    return {
      status: 500,
      code: "PRISMA_CLIENT_VALIDATION_FAILED",
      message: "应用数据写入结构不兼容，请联系管理员更新系统。",
    };
  }
  if (
    ["P2021", "P2022"].includes(code)
    || /column .*does not exist|The column .* does not exist|has no column/i.test(message)
  ) {
    return {
      status: 500,
      code: "PRISMA_SCHEMA_MISMATCH",
      message: "数据库结构与应用版本不一致，请联系管理员执行正式迁移。",
    };
  }
  return null;
}

export function apiError(error: unknown, fallback = "请求处理失败") {
  const typedError = (error || {}) as AppError;
  const status = typedError.status || 500;
  if (shouldLogApiErrorStatus(status)) logServerError(fallback, error);
  const infrastructureError = prismaInfrastructureError(error);
  if (infrastructureError) {
    return NextResponse.json(
      {
        error: infrastructureError.message,
        code: infrastructureError.code,
      },
      { status: infrastructureError.status },
    );
  }
  const schemaMismatchMessage = prismaSchemaMismatchMessage(error);
  if (schemaMismatchMessage) {
    return NextResponse.json(
      {
        error: schemaMismatchMessage,
        code: "PRISMA_SCHEMA_MISMATCH",
      },
      { status: 500 },
    );
  }
  const isProduction = process.env.NODE_ENV === "production";
  const exposeDetails = process.env.EXPOSE_ERROR_DETAILS === "true";
  const safeMessage = isProduction && status >= 500 && !typedError.expose ? fallback : (typedError.message || fallback);
  return NextResponse.json(
    {
      error: safeMessage,
      code: typedError.code || undefined,
      details: exposeDetails || !isProduction ? (typedError.details || undefined) : undefined,
    },
    { status },
  );
}

export function ok<T>(data: T, init?: ResponseInit) {
  return init ? NextResponse.json(data, init) : NextResponse.json(data);
}
