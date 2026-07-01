import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  AUTO_RATE_CURRENCIES,
  BOC_CURRENCY_NAMES,
  CURRENCIES,
  DEFAULT_EXCHANGE_RATE_SETTINGS,
  EXCHANGE_RATE_SETTING_KEY,
  EXCHANGE_RATE_SOURCES,
  EXCHANGE_RATE_TYPES,
  runNonCriticalTask,
} from "./shared-constants";
import {
  codedError,
  dateFromInput,
  dateToInput,
  normalizeDateText,
  optional,
  requirePositive,
  requireText,
  todayInputInChina,
} from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

type ExchangeRateSettingsInput = Record<string, unknown>;
type ExchangeRateRowInput = {
  currency: string;
  rateToCny: number;
  rateDate: string;
  source: string;
  rateType: string;
};
type RefreshExchangeRateOptions = {
  source?: unknown;
  rateType?: unknown;
};
type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ExchangeSnapshotOptions = {
  currency?: unknown;
  defaultDate?: unknown;
  allowHistoricalSource?: boolean;
};
type ExchangeRateSettings = ReturnType<typeof normalizeExchangeRateSettings>;
type SerializedExchangeRate = {
  id: string;
  currency: string;
  rateToCny: number;
  exchangeRate: number;
  rate: number;
  rateDate: string;
  source: string;
  rateType: string;
  isFallbackDate: boolean;
  message: string;
  createdAt: Date;
  updatedAt: Date;
};
type ExchangeRateQuote = SerializedExchangeRate & {
  settings: ExchangeRateSettings;
};
type ExchangeRateSnapshot = {
  currency: string;
  exchangeRate: number;
  exchangeRateDate: Date | null;
  exchangeRateSource: string;
  exchangeRateType: string;
};

function normalizeSettingsDate(value: unknown, fallback: string) {
  const text = normalizeDateText(value, fallback);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function errorMessage(error: unknown, fallback = "") {
  return error instanceof Error ? error.message : fallback;
}

export function normalizeExchangeRateSettings(value: unknown = {}) {
  const input: ExchangeRateSettingsInput = value && typeof value === "object" ? value as ExchangeRateSettingsInput : {};
  return {
    ...DEFAULT_EXCHANGE_RATE_SETTINGS,
    ...input,
    source: EXCHANGE_RATE_SOURCES.includes(String(input.source || "")) ? String(input.source) : DEFAULT_EXCHANGE_RATE_SETTINGS.source,
    rateType: EXCHANGE_RATE_TYPES.includes(String(input.rateType || "")) ? String(input.rateType) : DEFAULT_EXCHANGE_RATE_SETTINGS.rateType,
    autoUpdate: input.autoUpdate !== false,
    allowManualEdit: input.allowManualEdit !== false,
    allowAdminIncompleteTaxSubmit: input.allowAdminIncompleteTaxSubmit === true,
    allowMultipleOrderLogisticsSuppliers: input.allowMultipleOrderLogisticsSuppliers === true,
    paymentVoucherReminderStartDate: normalizeSettingsDate(
      input.paymentVoucherReminderStartDate,
      DEFAULT_EXCHANGE_RATE_SETTINGS.paymentVoucherReminderStartDate,
    ),
  };
}

export function serializeExchangeRateSetting(setting: unknown) {
  const value = setting && typeof setting === "object" && "value" in setting
    ? (setting as { value?: unknown }).value
    : setting;
  return normalizeExchangeRateSettings(value || {});
}

export async function getExchangeRateSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: EXCHANGE_RATE_SETTING_KEY } });
  if (setting) return serializeExchangeRateSetting(setting);
  const created = await prisma.systemSetting.create({
    data: {
      key: EXCHANGE_RATE_SETTING_KEY,
      value: DEFAULT_EXCHANGE_RATE_SETTINGS,
    },
  });
  return serializeExchangeRateSetting(created);
}

export async function saveExchangeRateSettings(request: AuditRequestLike, actor: ActorLike, input: ExchangeRateSettingsInput = {}) {
  assertWrite(actor, "settings");
  const value = normalizeExchangeRateSettings({
    source: input.source,
    rateType: input.rateType,
    autoUpdate: input.autoUpdate,
    allowManualEdit: input.allowManualEdit,
    allowAdminIncompleteTaxSubmit: input.allowAdminIncompleteTaxSubmit,
    allowMultipleOrderLogisticsSuppliers: input.allowMultipleOrderLogisticsSuppliers,
    paymentVoucherReminderStartDate: input.paymentVoucherReminderStartDate,
  });
  const before = await prisma.systemSetting.findUnique({ where: { key: EXCHANGE_RATE_SETTING_KEY } });
  const setting = await prisma.systemSetting.upsert({
    where: { key: EXCHANGE_RATE_SETTING_KEY },
    update: { value },
    create: { key: EXCHANGE_RATE_SETTING_KEY, value },
  });
  await runNonCriticalTask("汇率设置操作日志写入", () => writeAudit(request, actor, "更新汇率设置", "system_settings", EXCHANGE_RATE_SETTING_KEY, before, setting));
  return serializeExchangeRateSetting(setting);
}

export function htmlText(value: unknown = "") {
  return String(value)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

export function parseBocRate(value: unknown) {
  const number = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round((number / 100) * 1000000) / 1000000 : null;
}

export function exchangeSourceOrder(preferred: unknown) {
  const priority = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
  const preferredSource = String(preferred || "");
  if (!preferredSource || !priority.includes(preferredSource)) return priority;
  return [preferredSource, ...priority.filter((source) => source !== preferredSource)];
}

export async function fetchBocRates(rateDate: string, rateType: string): Promise<ExchangeRateRowInput[]> {
  const response = await fetch("https://www.boc.cn/sourcedb/whpj/", { cache: "no-store" });
  if (!response.ok) return [];
  const html = await response.text();
  const rows = [...html.matchAll(/<tr[^>]*data-currency=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.flatMap((match) => {
    const currency = Object.entries(BOC_CURRENCY_NAMES).find(([, name]) => name === match[1])?.[0];
    if (!currency) return [];
    const cells = [...match[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlText(cell[1]));
    const publishedDate = (cells[6] || "").slice(0, 10).replaceAll("/", "-") || rateDate;
    if (publishedDate !== rateDate && rateDate !== todayInputInChina()) return [];
    const buy = parseBocRate(cells[1]);
    const sell = parseBocRate(cells[3]);
    const middle = parseBocRate(cells[5]) || (buy && sell ? Math.round(((buy + sell) / 2) * 1000000) / 1000000 : null);
    const rateMap: Record<string, number | null> = {
      "现汇买入价": buy,
      "现汇卖出价": sell,
      "中间价": middle,
    };
    const rateToCny = rateMap[rateType];
    return rateToCny ? [{ currency, rateToCny, rateDate: publishedDate, source: "中国银行", rateType }] : [];
  });
}

export function addDaysText(dateText: unknown, days: number) {
  const date = dateFromInput(dateText);
  date!.setUTCDate(date!.getUTCDate() + days);
  return date!.toISOString().slice(0, 10);
}

export async function fetchOfficialFallbackRates(source: string, rateDate: string, rateType: string): Promise<ExchangeRateRowInput[]> {
  if (rateType !== "中间价") return [];
  const body = new URLSearchParams({
    startDate: addDaysText(rateDate, -10),
    endDate: rateDate,
    queryYN: "true",
  });
  const response = await fetch("https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const html = await response.text();
  const rows = [...html.matchAll(/<tr class=\"first\"[\s\S]*?<\/tr>/gi)]
    .map((row) => [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlText(cell[1])))
    .filter((cells) => /^\d{4}-\d{2}-\d{2}$/.test(cells[0]) && cells[0] <= rateDate)
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  const cells = rows[0];
  if (!cells) return [];
  const map = [
    ["USD", cells[1]],
    ["EUR", cells[2]],
    ["HKD", cells[4]],
    ["GBP", cells[5]],
  ];
  return map.flatMap(([currency, value]) => {
    const rateToCny = parseBocRate(value);
    return rateToCny ? [{ currency, rateToCny, rateDate: cells[0], source, rateType }] : [];
  });
}

export async function fetchThirdPartyRates(rateDate: string, rateType: string): Promise<ExchangeRateRowInput[]> {
  const response = await fetch(`https://api.frankfurter.app/${encodeURIComponent(rateDate)}?from=CNY&to=${AUTO_RATE_CURRENCIES.join(",")}`, { cache: "no-store" });
  if (!response.ok) return [];
  const data = await response.json();
  const actualDate = normalizeDateText(data.date, rateDate);
  return Object.entries(data.rates || {}).flatMap(([currency, rateFromCny]) => {
    const rate = Number(rateFromCny);
    if (!AUTO_RATE_CURRENCIES.includes(currency) || !(rate > 0)) return [];
    return [{
      currency,
      rateToCny: Math.round((1 / rate) * 1000000) / 1000000,
      rateDate: actualDate,
      source: "第三方API",
      rateType,
    }];
  });
}

export async function fetchRatesBySource(source: string, rateDate: string, rateType: string): Promise<ExchangeRateRowInput[]> {
  if (source === "中国银行") return fetchBocRates(rateDate, rateType);
  if (source === "中国外汇交易中心" || source === "国家外汇管理局") return fetchOfficialFallbackRates(source, rateDate, rateType);
  if (source === "第三方API") return fetchThirdPartyRates(rateDate, rateType);
  return [];
}

export async function saveExchangeRateRows(rows: ExchangeRateRowInput[]) {
  const saved: Prisma.ExchangeRateGetPayload<{}>[] = [];
  for (const row of rows) {
    const rateDate = dateFromInput(row.rateDate);
    if (!row.currency || !rateDate || !(Number(row.rateToCny) > 0)) continue;
    const item = await prisma.exchangeRate.upsert({
      where: {
        currency_rateDate_source_rateType: {
          currency: row.currency,
          rateDate,
          source: row.source,
          rateType: row.rateType,
        },
      },
      update: { rateToCny: row.rateToCny },
      create: {
        currency: row.currency,
        rateDate,
        source: row.source,
        rateType: row.rateType,
        rateToCny: row.rateToCny,
      },
    });
    saved.push(item);
  }
  return saved;
}

export function serializeExchangeRate(row: Prisma.ExchangeRateGetPayload<{}> | null, requestedDate = ""): SerializedExchangeRate | null {
  if (!row) return null;
  const rateDate = dateToInput(row.rateDate);
  const rateToCny = Number(row.rateToCny);
  return {
    id: row.id,
    currency: row.currency,
    rateToCny,
    exchangeRate: rateToCny,
    rate: rateToCny,
    rateDate,
    source: row.source,
    rateType: row.rateType,
    isFallbackDate: Boolean(requestedDate && rateDate !== requestedDate),
    message: requestedDate && rateDate !== requestedDate ? "今日汇率获取失败，已使用最近可用汇率。" : "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findCachedExchangeRate(currency: string, rateDate: string, rateType: string, source = "", exact = false) {
  const date = dateFromInput(rateDate);
  if (!date) return null;
  const where: Prisma.ExchangeRateWhereInput = {
    currency,
    rateType,
    ...(source ? { source } : {}),
    rateDate: exact ? date : { lte: date },
  };
  return prisma.exchangeRate.findFirst({
    where,
    orderBy: [{ rateDate: "desc" }, { updatedAt: "desc" }],
  });
}

export async function refreshExchangeRatesForDate(rateDateInput = todayInputInChina(), options: RefreshExchangeRateOptions = {}) {
  const settings = await getExchangeRateSettings();
  const rateDate = normalizeDateText(rateDateInput);
  const requestedRateType = String(options.rateType || "");
  const rateType = EXCHANGE_RATE_TYPES.includes(requestedRateType) ? requestedRateType : settings.rateType;
  const sourceOrder = exchangeSourceOrder(String(options.source || settings.source));
  let lastError: unknown = null;
  for (const source of sourceOrder) {
    try {
      const rows = await fetchRatesBySource(source, rateDate, rateType);
      if (!rows.length) continue;
      const saved = await saveExchangeRateRows(rows);
      if (saved.length) {
        return {
          ok: true,
          source: saved[0].source,
          rateType,
          rateDate,
          rates: saved.map((row) => serializeExchangeRate(row, rateDate)),
        };
      }
    } catch (error: unknown) {
      lastError = error;
    }
  }
  return {
    ok: false,
    source: "",
    rateType,
    rateDate,
    rates: [],
    message: "今日汇率获取失败，已使用最近可用汇率。",
    error: errorMessage(lastError, "未能获取汇率"),
  };
}

export async function refreshExchangeRates(request: AuditRequestLike, actor: ActorLike, input: ExchangeRateSettingsInput = {}) {
  assertWrite(actor, "exchangeRates");
  const result = await refreshExchangeRatesForDate(String(input.rateDate || input.date || todayInputInChina()), {
    source: input.source,
    rateType: input.rateType,
  });
  await runNonCriticalTask("汇率刷新操作日志写入", () => writeAudit(request, actor, "手动刷新汇率", "exchange_rates", result.rateDate, null, result));
  return result;
}

export async function getExchangeRateQuote(input: ExchangeRateSettingsInput = {}, actor: ActorLike = null): Promise<ExchangeRateQuote> {
  const settings = await getExchangeRateSettings();
  const currency = requireText(input.currency || "CNY", "币种").toUpperCase();
  if (!CURRENCIES.includes(currency)) {
    throw codedError("请选择有效币种", 400, "CURRENCY_REQUIRED");
  }
  const rateDate = normalizeDateText(input.rateDate || input.date);
  const requestedRateType = String(input.rateType || "");
  const requestedSource = String(input.source || "");
  const rateType = EXCHANGE_RATE_TYPES.includes(requestedRateType) ? requestedRateType : settings.rateType;
  const source = EXCHANGE_RATE_SOURCES.includes(requestedSource) ? requestedSource : settings.source;
  if (currency === "CNY") {
    return {
      id: "CNY",
      currency,
      rateToCny: 1,
      exchangeRate: 1,
      rate: 1,
      rateDate,
      source: "系统",
      rateType,
      isFallbackDate: false,
      message: "",
      createdAt: dateFromInput(rateDate) || new Date(),
      updatedAt: dateFromInput(rateDate) || new Date(),
      settings,
    };
  }
  const exact = await findCachedExchangeRate(currency, rateDate, rateType, source, true)
    || await findCachedExchangeRate(currency, rateDate, rateType, "", true);
  if (exact && !input.forceRefresh) {
    const serialized = serializeExchangeRate(exact, rateDate);
    if (serialized) return { ...serialized, settings };
  }
  if (settings.autoUpdate || input.forceRefresh) {
    await refreshExchangeRatesForDate(rateDate, { source, rateType });
  }
  const cached = await findCachedExchangeRate(currency, rateDate, rateType, source)
    || await findCachedExchangeRate(currency, rateDate, rateType, "");
  if (cached) {
    const serialized = serializeExchangeRate(cached, rateDate);
    if (serialized) return { ...serialized, settings };
  }
  throw codedError("未找到可用汇率，请财务手动刷新汇率后再保存。", 404, "EXCHANGE_RATE_NOT_FOUND");
}

export async function resolveExchangeRateSnapshot(input: ExchangeRateSettingsInput, actor: ActorLike, { currency, defaultDate, allowHistoricalSource = false }: ExchangeSnapshotOptions = {}): Promise<ExchangeRateSnapshot> {
  const settings = await getExchangeRateSettings();
  const finalCurrency = requireText(currency || input.currency, "币种").toUpperCase();
  if (!CURRENCIES.includes(finalCurrency)) {
    throw codedError("请选择有效币种", 400, "CURRENCY_REQUIRED");
  }
  const exchangeRate = requirePositive(input.exchangeRate, "汇率");
  const exchangeRateDate = normalizeDateText(input.exchangeRateDate || input.rateDate || defaultDate);
  const exchangeRateSource = optional(input.exchangeRateSource) || (finalCurrency === "CNY" ? "系统" : "手动");
  const requestedExchangeRateType = String(input.exchangeRateType || "");
  const exchangeRateType = EXCHANGE_RATE_TYPES.includes(requestedExchangeRateType)
    ? requestedExchangeRateType
    : (allowHistoricalSource && requestedExchangeRateType === "历史录入" ? "历史录入" : settings.rateType);
  if (finalCurrency === "CNY" && Math.abs(exchangeRate - 1) > 0.000001) {
    throw codedError("人民币汇率必须等于 1", 400, "CNY_RATE_MUST_BE_ONE");
  }
  if (finalCurrency !== "CNY" && Math.abs(exchangeRate - 1) <= 0.000001 && !(actor?.role === "管理员" && input.manualRateConfirmed === true)) {
    throw codedError("非人民币汇率不能保存为 1，除非管理员手动确认", 400, "FOREIGN_RATE_CONFIRM_REQUIRED");
  }
  if (exchangeRateSource === "历史录入" && !allowHistoricalSource) {
    throw codedError("不能为新记录伪造历史录入汇率来源", 403, "HISTORICAL_RATE_FORBIDDEN");
  }
  if (finalCurrency !== "CNY" && EXCHANGE_RATE_SOURCES.includes(exchangeRateSource)) {
    const cached = await findCachedExchangeRate(finalCurrency, exchangeRateDate, exchangeRateType, exchangeRateSource, true);
    const cachedRate = Number(cached?.rateToCny || 0);
    if (!cached || Math.abs(cachedRate - exchangeRate) > 0.000001) {
      throw codedError("官方汇率必须来自系统缓存，请先刷新汇率后再保存。", 400, "OFFICIAL_RATE_CACHE_REQUIRED");
    }
  }
  const actorRole = actor?.role || "";
  if (finalCurrency !== "CNY" && exchangeRateSource === "手动" && !["管理员", "财务"].includes(actorRole)) {
    throw codedError("当前用户只能使用系统自动汇率", 403, "MANUAL_RATE_FORBIDDEN");
  }
  if (finalCurrency !== "CNY" && !settings.allowManualEdit && exchangeRateSource === "手动" && actorRole !== "管理员") {
    throw codedError("系统设置不允许手动修改汇率，请使用系统自动汇率", 403, "MANUAL_RATE_DISABLED");
  }
  return {
    currency: finalCurrency,
    exchangeRate,
    exchangeRateDate: dateFromInput(exchangeRateDate),
    exchangeRateSource,
    exchangeRateType,
  };
}
