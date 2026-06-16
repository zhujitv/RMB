// @ts-nocheck
import { prisma } from "../prisma";
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

export function normalizeExchangeRateSettings(value = {}) {
  return {
    ...DEFAULT_EXCHANGE_RATE_SETTINGS,
    ...(value && typeof value === "object" ? value : {}),
    source: EXCHANGE_RATE_SOURCES.includes(value?.source) ? value.source : DEFAULT_EXCHANGE_RATE_SETTINGS.source,
    rateType: EXCHANGE_RATE_TYPES.includes(value?.rateType) ? value.rateType : DEFAULT_EXCHANGE_RATE_SETTINGS.rateType,
    autoUpdate: value?.autoUpdate !== false,
    allowManualEdit: value?.allowManualEdit !== false,
    allowAdminIncompleteTaxSubmit: value?.allowAdminIncompleteTaxSubmit === true,
    allowMultipleOrderLogisticsSuppliers: value?.allowMultipleOrderLogisticsSuppliers === true,
  };
}

export function serializeExchangeRateSetting(setting) {
  return normalizeExchangeRateSettings(setting?.value || setting || {});
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

export async function saveExchangeRateSettings(request, actor, input = {}) {
  assertWrite(actor, "settings");
  const value = normalizeExchangeRateSettings({
    source: input.source,
    rateType: input.rateType,
    autoUpdate: input.autoUpdate,
    allowManualEdit: input.allowManualEdit,
    allowAdminIncompleteTaxSubmit: input.allowAdminIncompleteTaxSubmit,
    allowMultipleOrderLogisticsSuppliers: input.allowMultipleOrderLogisticsSuppliers,
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

export function htmlText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

export function parseBocRate(value) {
  const number = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round((number / 100) * 1000000) / 1000000 : null;
}

export function exchangeSourceOrder(preferred) {
  const priority = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
  if (!preferred || !priority.includes(preferred)) return priority;
  return [preferred, ...priority.filter((source) => source !== preferred)];
}

export async function fetchBocRates(rateDate, rateType) {
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
    const rateMap = {
      "现汇买入价": buy,
      "现汇卖出价": sell,
      "中间价": middle,
    };
    const rateToCny = rateMap[rateType];
    return rateToCny ? [{ currency, rateToCny, rateDate: publishedDate, source: "中国银行", rateType }] : [];
  });
}

export function addDaysText(dateText, days) {
  const date = dateFromInput(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function fetchOfficialFallbackRates(source, rateDate, rateType) {
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

export async function fetchThirdPartyRates(rateDate, rateType) {
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

export async function fetchRatesBySource(source, rateDate, rateType) {
  if (source === "中国银行") return fetchBocRates(rateDate, rateType);
  if (source === "中国外汇交易中心" || source === "国家外汇管理局") return fetchOfficialFallbackRates(source, rateDate, rateType);
  if (source === "第三方API") return fetchThirdPartyRates(rateDate, rateType);
  return [];
}

export async function saveExchangeRateRows(rows) {
  const saved = [];
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

export function serializeExchangeRate(row, requestedDate = "") {
  if (!row) return null;
  const rateDate = dateToInput(row.rateDate);
  return {
    id: row.id,
    currency: row.currency,
    rateToCny: Number(row.rateToCny),
    rateDate,
    source: row.source,
    rateType: row.rateType,
    isFallbackDate: Boolean(requestedDate && rateDate !== requestedDate),
    message: requestedDate && rateDate !== requestedDate ? "今日汇率获取失败，已使用最近可用汇率。" : "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findCachedExchangeRate(currency, rateDate, rateType, source = "", exact = false) {
  const date = dateFromInput(rateDate);
  const where = {
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

export async function refreshExchangeRatesForDate(rateDateInput = todayInputInChina(), options = {}) {
  const settings = await getExchangeRateSettings();
  const rateDate = normalizeDateText(rateDateInput);
  const rateType = EXCHANGE_RATE_TYPES.includes(options.rateType) ? options.rateType : settings.rateType;
  const sourceOrder = exchangeSourceOrder(options.source || settings.source);
  let lastError = null;
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
    } catch (error) {
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
    error: lastError?.message || "未能获取汇率",
  };
}

export async function refreshExchangeRates(request, actor, input = {}) {
  assertWrite(actor, "exchangeRates");
  const result = await refreshExchangeRatesForDate(input.rateDate || input.date, {
    source: input.source,
    rateType: input.rateType,
  });
  await runNonCriticalTask("汇率刷新操作日志写入", () => writeAudit(request, actor, "手动刷新汇率", "exchange_rates", result.rateDate, null, result));
  return result;
}

export async function getExchangeRateQuote(input = {}, actor = null) {
  const settings = await getExchangeRateSettings();
  const currency = requireText(input.currency || "CNY", "币种").toUpperCase();
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const rateDate = normalizeDateText(input.rateDate || input.date);
  const rateType = EXCHANGE_RATE_TYPES.includes(input.rateType) ? input.rateType : settings.rateType;
  const source = EXCHANGE_RATE_SOURCES.includes(input.source) ? input.source : settings.source;
  if (currency === "CNY") {
    return {
      currency,
      rateToCny: 1,
      rateDate,
      source: "系统",
      rateType,
      isFallbackDate: false,
      message: "",
      settings,
    };
  }
  const exact = await findCachedExchangeRate(currency, rateDate, rateType, source, true)
    || await findCachedExchangeRate(currency, rateDate, rateType, "", true);
  if (exact && !input.forceRefresh) {
    return { ...serializeExchangeRate(exact, rateDate), settings };
  }
  if (settings.autoUpdate || input.forceRefresh) {
    await refreshExchangeRatesForDate(rateDate, { source, rateType });
  }
  const cached = await findCachedExchangeRate(currency, rateDate, rateType, source)
    || await findCachedExchangeRate(currency, rateDate, rateType, "");
  if (cached) {
    return { ...serializeExchangeRate(cached, rateDate), settings };
  }
  const error = new Error("未找到可用汇率，请财务手动刷新汇率后再保存。");
  error.status = 404;
  throw error;
}

export async function resolveExchangeRateSnapshot(input, actor, { currency, defaultDate, allowHistoricalSource = false } = {}) {
  const settings = await getExchangeRateSettings();
  const finalCurrency = requireText(currency || input.currency, "币种").toUpperCase();
  if (!CURRENCIES.includes(finalCurrency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const exchangeRate = requirePositive(input.exchangeRate, "汇率");
  const exchangeRateDate = normalizeDateText(input.exchangeRateDate || input.rateDate || defaultDate);
  const exchangeRateSource = optional(input.exchangeRateSource) || (finalCurrency === "CNY" ? "系统" : "手动");
  const exchangeRateType = EXCHANGE_RATE_TYPES.includes(input.exchangeRateType)
    ? input.exchangeRateType
    : (allowHistoricalSource && input.exchangeRateType === "历史录入" ? "历史录入" : settings.rateType);
  if (finalCurrency === "CNY" && Math.abs(exchangeRate - 1) > 0.000001) {
    const error = new Error("人民币汇率必须等于 1");
    error.status = 400;
    throw error;
  }
  if (finalCurrency !== "CNY" && Math.abs(exchangeRate - 1) <= 0.000001 && !(actor?.role === "管理员" && input.manualRateConfirmed === true)) {
    const error = new Error("非人民币汇率不能保存为 1，除非管理员手动确认");
    error.status = 400;
    throw error;
  }
  if (exchangeRateSource === "历史录入" && !allowHistoricalSource) {
    const error = new Error("不能为新记录伪造历史录入汇率来源");
    error.status = 403;
    throw error;
  }
  if (finalCurrency !== "CNY" && EXCHANGE_RATE_SOURCES.includes(exchangeRateSource)) {
    const cached = await findCachedExchangeRate(finalCurrency, exchangeRateDate, exchangeRateType, exchangeRateSource, true);
    const cachedRate = Number(cached?.rateToCny || 0);
    if (!cached || Math.abs(cachedRate - exchangeRate) > 0.000001) {
      const error = new Error("官方汇率必须来自系统缓存，请先刷新汇率后再保存。");
      error.status = 400;
      throw error;
    }
  }
  if (finalCurrency !== "CNY" && exchangeRateSource === "手动" && !["管理员", "财务"].includes(actor?.role)) {
    const error = new Error("当前用户只能使用系统自动汇率");
    error.status = 403;
    throw error;
  }
  if (finalCurrency !== "CNY" && !settings.allowManualEdit && exchangeRateSource === "手动" && actor?.role !== "管理员") {
    const error = new Error("系统设置不允许手动修改汇率，请使用系统自动汇率");
    error.status = 403;
    throw error;
  }
  return {
    currency: finalCurrency,
    exchangeRate,
    exchangeRateDate: dateFromInput(exchangeRateDate),
    exchangeRateSource,
    exchangeRateType,
  };
}
