import { AUTO_RATE_CURRENCIES, BOC_CURRENCY_NAMES } from "./shared-constants";
import { dateFromInput, isPlainRecord, normalizeDateText, todayInputInChina } from "./shared-base-utils";
import type { ExchangeRateRowInput } from "./shared-exchange-types";
import { createOutboundTimeoutSignal, readResponseTextLimited } from "./outbound-request-security";

const EXCHANGE_SOURCE_TIMEOUT_MS = 10_000;
const EXCHANGE_SOURCE_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

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
  const response = await fetch("https://www.boc.cn/sourcedb/whpj/", {
    cache: "no-store",
    signal: createOutboundTimeoutSignal(EXCHANGE_SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const html = await readResponseTextLimited(response, EXCHANGE_SOURCE_RESPONSE_MAX_BYTES);
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
    signal: createOutboundTimeoutSignal(EXCHANGE_SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const html = await readResponseTextLimited(response, EXCHANGE_SOURCE_RESPONSE_MAX_BYTES);
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
  const response = await fetch(`https://api.frankfurter.app/${encodeURIComponent(rateDate)}?from=CNY&to=${AUTO_RATE_CURRENCIES.join(",")}`, {
    cache: "no-store",
    signal: createOutboundTimeoutSignal(EXCHANGE_SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const parsed = JSON.parse(await readResponseTextLimited(response, EXCHANGE_SOURCE_RESPONSE_MAX_BYTES)) as unknown;
  const data = isPlainRecord(parsed) ? parsed : {};
  const actualDate = normalizeDateText(data.date, rateDate);
  const rates = isPlainRecord(data.rates) ? data.rates : {};
  return Object.entries(rates).flatMap(([currency, rateFromCny]) => {
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
