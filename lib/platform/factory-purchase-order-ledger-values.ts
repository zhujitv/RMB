import { Prisma } from "../generated/prisma/client.js";
import { codedError, isPlainRecord } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import { todayInChina } from "./quotation-date-values";

export type FactoryLedgerInput = Record<string, unknown>;

export function factoryLedgerInput(value: unknown, label: string): FactoryLedgerInput {
  if (!isPlainRecord(value)) {
    throw codedError(`${label}格式错误`, 400, "FACTORY_LEDGER_INPUT_INVALID");
  }
  return value;
}

export function factoryLedgerAmount(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(text)) {
    throw codedError("金额格式错误，最多保留两位小数", 400, "FACTORY_LEDGER_AMOUNT_INVALID");
  }
  const amount = new Prisma.Decimal(text);
  if (!amount.gt(0)) throw codedError("金额必须大于 0", 400, "FACTORY_LEDGER_AMOUNT_INVALID");
  return amount;
}

export function requiredFactoryLedgerDate(value: unknown, label: string, allowFuture = true) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw codedError(`${label}格式错误`, 400, "FACTORY_LEDGER_DATE_INVALID");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw codedError(`${label}格式错误`, 400, "FACTORY_LEDGER_DATE_INVALID");
  }
  if (!allowFuture && date.getTime() > todayInChina().getTime()) {
    throw codedError(`${label}不能晚于今天`, 400, "FACTORY_LEDGER_DATE_FUTURE");
  }
  return date;
}

export function factoryLedgerText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxLength) {
    throw codedError(`${label}不能超过 ${maxLength} 个字符`, 400, "FACTORY_LEDGER_TEXT_TOO_LONG");
  }
  return text;
}

export function factoryLedgerIdempotencyKey(value: unknown) {
  const key = nonEmpty(value);
  if (!key || key.length > 200) {
    throw codedError("请求标识无效", 400, "FACTORY_LEDGER_IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}

export async function runFactoryPurchaseMutation<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_ORDER_WRITE_CONFLICT");
    }
    throw error;
  }
}
