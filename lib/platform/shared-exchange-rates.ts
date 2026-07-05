import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { CURRENCIES, EXCHANGE_RATE_SOURCES, EXCHANGE_RATE_TYPES, runNonCriticalTask } from "./shared-constants";
import { codedError, dateFromInput, dateToInput, normalizeDateText, optional, requirePositive, requireText, todayInputInChina } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { exchangeSourceOrder, fetchRatesBySource } from "./shared-exchange-fetchers";
import { getExchangeRateSettings } from "./shared-exchange-settings";
import type { ActorLike, AuditRequestLike, ExchangeRateQuote, ExchangeRateRowInput, ExchangeRateSettingsInput, ExchangeRateSnapshot, ExchangeSnapshotOptions, RefreshExchangeRateOptions, SerializedExchangeRate } from "./shared-exchange-types";

function errorMessage(error: unknown, fallback = "") {
  return error instanceof Error ? error.message : fallback;
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
