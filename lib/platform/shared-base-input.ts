import { Prisma } from "../generated/prisma/client.js";
import { codedError, isPlainRecord, type AppError } from "./shared-base-errors";

export type JsonBodyRequest = {
  json(): Promise<unknown>;
};

export type ParseJsonBodyOptions = {
  allowEmpty?: boolean;
  label?: string;
};

type InstallmentInput = {
  ratio?: unknown;
  condition?: unknown;
};

export function dateFromInput(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateToInput(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function num(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function amountCny(amount: unknown, rate: unknown) {
  return Math.round(num(amount) * num(rate, 1) * 100) / 100;
}

function decimalFromInput(value: unknown, fallback: string): Prisma.Decimal {
  try {
    const decimal = Prisma.Decimal.isDecimal(value)
      ? value
      : new Prisma.Decimal(String(value ?? "").trim());
    return decimal.isFinite() ? decimal : new Prisma.Decimal(fallback);
  } catch {
    return new Prisma.Decimal(fallback);
  }
}

export function amountCnyDecimal(amount: unknown, rate: unknown): Prisma.Decimal {
  return decimalFromInput(amount, "0")
    .mul(decimalFromInput(rate, "1"))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
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

export function requireValidEmail(value: unknown, label: string) {
  const email = normalizeEmail(value);
  if (!email) throw codedError(`${label}不能为空`, 400, "VALIDATION_REQUIRED");
  if (!validEmail(email)) throw codedError(`${label}格式错误`, 400, "VALIDATION_INVALID_EMAIL");
  return email;
}

type InputSchemaKind = "text" | "positiveNumber" | "nonNegativeNumber" | "date" | "enum" | "email" | "array";

type InputSchemaField = {
  label: string;
  kind?: InputSchemaKind;
  required?: boolean | ((input: Record<string, unknown>) => boolean);
  enumValues?: readonly string[];
};

export type InputSchema = Record<string, InputSchemaField>;

function inputHasValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function inputFieldRequired(field: InputSchemaField, input: Record<string, unknown>) {
  return typeof field.required === "function" ? field.required(input) : Boolean(field.required);
}

export function assertJsonObject(value: unknown, label = "请求参数") {
  if (!isPlainRecord(value)) {
    throw codedError(`${label}格式错误`, 400, "INVALID_REQUEST_BODY");
  }
  return value;
}

function isEmptyJsonBodyError(error: unknown) {
  const message = String((error as { message?: string } | null | undefined)?.message || "");
  return /unexpected end of json input/i.test(message);
}

export async function parseJsonBody(request: JsonBodyRequest, options: ParseJsonBodyOptions = {}) {
  const label = options.label || "请求参数";
  try {
    return assertJsonObject(await request.json(), label);
  } catch (error: unknown) {
    if (options.allowEmpty && isEmptyJsonBodyError(error)) return {};
    if ((error as AppError | null | undefined)?.code === "INVALID_REQUEST_BODY") throw error;
    throw codedError(`${label}JSON格式错误`, 400, "INVALID_JSON_BODY");
  }
}

export function assertInputSchema(input: Record<string, unknown>, schema: InputSchema) {
  for (const [key, field] of Object.entries(schema)) {
    const value = input[key];
    const hasValue = inputHasValue(value);
    if (!hasValue) {
      if (inputFieldRequired(field, input)) {
        throw codedError(`${field.label}不能为空`, 400, "VALIDATION_REQUIRED");
      }
      continue;
    }
    if (field.kind === "text" && !nonEmpty(value)) {
      throw codedError(`${field.label}不能为空`, 400, "VALIDATION_REQUIRED");
    }
    if (field.kind === "positiveNumber" && !(num(value) > 0)) {
      throw codedError(`${field.label}必须大于 0`, 400, "VALIDATION_POSITIVE_NUMBER");
    }
    if (field.kind === "nonNegativeNumber" && !(num(value) >= 0)) {
      throw codedError(`${field.label}不能小于 0`, 400, "VALIDATION_NON_NEGATIVE_NUMBER");
    }
    if (field.kind === "date" && !dateFromInput(value)) {
      throw codedError(`${field.label}不是有效日期`, 400, "VALIDATION_INVALID_DATE");
    }
    if (field.kind === "enum" && field.enumValues && !field.enumValues.includes(nonEmpty(value))) {
      throw codedError(`${field.label}不在允许范围内`, 400, "VALIDATION_INVALID_ENUM");
    }
    if (field.kind === "email" && !validEmail(value)) {
      throw codedError(`${field.label}格式错误`, 400, "VALIDATION_INVALID_EMAIL");
    }
    if (field.kind === "array" && !Array.isArray(value)) {
      throw codedError(`${field.label}格式错误`, 400, "VALIDATION_INVALID_ARRAY");
    }
  }
  return input;
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

export function requirePositiveDecimal(value: unknown, label: string, decimalPlaces?: number): Prisma.Decimal {
  const decimal = decimalFromInput(value, "0");
  const normalized = decimalPlaces == null
    ? decimal
    : decimal.toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_HALF_UP);
  if (normalized.lte(0)) {
    const error: AppError = new Error(`${label}必须大于 0`);
    error.status = 400;
    throw error;
  }
  return normalized;
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

export function normalizeInstallments(input: unknown, finalAmount: unknown, exchangeRate: unknown) {
  const rows = (Array.isArray(input) ? input : []) as InstallmentInput[];
  const normalizedFinalAmount = decimalFromInput(finalAmount, "0");
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
    const amount = normalizedFinalAmount
      .mul(String(item.ratio))
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return {
      ratio: item.ratio,
      condition: item.condition,
      amount: amount.toNumber(),
      amountCny: amountCnyDecimal(amount, exchangeRate).toNumber(),
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
