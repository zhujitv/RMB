import { NextResponse } from "next/server";

type AppError = Error & {
  status?: number;
  code?: string;
  expose?: boolean;
  details?: unknown;
};

type InstallmentInput = {
  ratio?: unknown;
  condition?: unknown;
};

export function codedError(message: string, status: number, code: string): AppError {
  const error: AppError = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

export function apiError(error: unknown, fallback = "请求处理失败") {
  console.error(error);
  const isProduction = process.env.NODE_ENV === "production";
  const exposeDetails = process.env.EXPOSE_ERROR_DETAILS === "true";
  const typedError = (error || {}) as AppError;
  const status = typedError.status || 500;
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

export function dateFromInput(value: unknown) {
  if (!value) return null;
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

export function dateToInput(value: Date | null | undefined) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export function num(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function amountCny(amount: unknown, rate: unknown) {
  return Math.round(num(amount) * num(rate, 1) * 100) / 100;
}

export function nonEmpty(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeEmail(value: unknown) {
  return nonEmpty(value).toLowerCase();
}

export function validEmail(value: unknown = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function parseEmailList(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[,，;\n\r]+/);
  return raw
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

export function requireValidEmailList(value: unknown, label: string) {
  const emails = parseEmailList(value);
  const invalid = emails.filter((email) => !validEmail(email));
  if (invalid.length) {
    throw codedError(`${label}格式错误：${invalid.join("，")}`, 400, "INVALID_EMAIL_FORMAT");
  }
  return emails;
}

export function optional(value: unknown) {
  const text = nonEmpty(value);
  return text || null;
}

export function requirePositive(value: unknown, label: string) {
  const number = num(value);
  if (number <= 0) {
    const error: AppError = new Error(`${label}必须大于 0`);
    error.status = 400;
    throw error;
  }
  return number;
}

export function requireText(value: unknown, label: string) {
  const text = nonEmpty(value);
  if (!text) {
    const error: AppError = new Error(`${label}不能为空`);
    error.status = 400;
    throw error;
  }
  return text;
}

export function addDays(date: Date | null | undefined, days: unknown) {
  if (!date || !Number.isFinite(Number(days))) return null;
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + Math.round(Number(days)));
  return result;
}

export function normalizeCreditDays(value: unknown, required = false) {
  if (value === "" || value == null) {
    if (!required) return null;
    const error: AppError = new Error("账期天数不能为空");
    error.status = 400;
    throw error;
  }
  const days = Math.round(num(value));
  if (days < 0) {
    const error: AppError = new Error("账期天数不能小于 0");
    error.status = 400;
    throw error;
  }
  return days;
}

export function normalizeInstallments(input: unknown, finalAmount: number, exchangeRate: unknown) {
  const rows = (Array.isArray(input) ? input : []) as InstallmentInput[];
  const cleaned = rows
    .map((item) => ({
      ratio: Math.round(num(item?.ratio) * 100) / 100,
      condition: nonEmpty(item?.condition),
    }))
    .filter((item) => item.ratio > 0 || item.condition);
  if (!cleaned.length) {
    const error: AppError = new Error("分批付款请至少录入一个付款节点");
    error.status = 400;
    throw error;
  }
  let ratioTotal = 0;
  const normalized = cleaned.map((item, index) => {
    if (!(item.ratio > 0)) {
      const error: AppError = new Error(`第 ${index + 1} 个付款节点比例必须大于 0`);
      error.status = 400;
      throw error;
    }
    if (!item.condition) {
      const error: AppError = new Error(`第 ${index + 1} 个付款节点条件不能为空`);
      error.status = 400;
      throw error;
    }
    ratioTotal += item.ratio;
    const amount = Math.round(finalAmount * (item.ratio / 100) * 100) / 100;
    return {
      ratio: item.ratio,
      condition: item.condition,
      amount,
      amountCny: amountCny(amount, exchangeRate),
    };
  });
  if (Math.abs(ratioTotal - 100) > 0.01) {
    const error: AppError = new Error("分批付款比例合计必须等于 100%");
    error.status = 400;
    throw error;
  }
  return normalized;
}

export function todayInputInChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function normalizeDateText(value: unknown, fallback = todayInputInChina()) {
  if (!value) return fallback;
  if (value instanceof Date) return dateToInput(value);
  const text = String(value).trim();
  return text ? text.slice(0, 10).replaceAll("/", "-") : fallback;
}
