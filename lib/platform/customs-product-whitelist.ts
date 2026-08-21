import { isPlainRecord, nonEmpty } from "./shared-base-utils";

export type CustomsProductWhitelistEntry = {
  id: string;
  standardName: string;
  aliases: string[];
  hsCodes: string[];
  enabled: boolean;
};

export type CustomsProductWhitelistSettings = {
  customsProductWhitelistEnabled: boolean;
  customsProductWhitelist: CustomsProductWhitelistEntry[];
};

function compactList(value: unknown, limit = 20) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,;；、]+/g);
  return source
    .map((item) => nonEmpty(item).slice(0, 80))
    .filter(Boolean)
    .filter((item, index, rows) => rows.indexOf(item) === index)
    .slice(0, limit);
}

export function normalizeCustomsProductWhitelist(value: unknown): CustomsProductWhitelistEntry[] {
  const source = Array.isArray(value) ? value : [];
  return source.flatMap((item, index) => {
    if (!isPlainRecord(item)) return [];
    const standardName = nonEmpty(item.standardName || item.name || item.productName).slice(0, 120);
    if (!standardName) return [];
    return [{
      id: nonEmpty(item.id).slice(0, 80) || `customs-product-${index + 1}`,
      standardName,
      aliases: compactList(item.aliases),
      hsCodes: compactList(item.hsCodes || item.commodityCodes, 10).filter((code) => /^\d{6,13}$/.test(code.replace(/\s/g, ""))),
      enabled: item.enabled !== false,
    }];
  }).slice(0, 200);
}

function key(value: unknown) {
  return nonEmpty(value).toUpperCase().replace(/[\s（）()【】\[\]，,。._\-\/\\|:：;；、]/g, "");
}

function levenshtein(left: string, right: string) {
  if (!left || !right) return Math.max(left.length, right.length);
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let northwest = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const old = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? northwest
        : Math.min(previous[column - 1], previous[column], northwest) + 1;
      northwest = old;
    }
  }
  return previous[right.length];
}

function similar(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength < 4) return false;
  return 1 - (levenshtein(left, right) / maxLength) >= 0.82;
}

function entryTokens(entry: CustomsProductWhitelistEntry) {
  return [entry.standardName, ...entry.aliases].map(key).filter(Boolean);
}

export function matchCustomsProductWhitelist(
  item: Record<string, unknown>,
  entries: CustomsProductWhitelistEntry[],
) {
  const text = key([item.productName, item.nameAndSpecification].filter(Boolean).join(" "));
  const hsCode = key(item.commodityCode);
  return entries.find((entry) => entry.enabled && entry.hsCodes.some((code) => key(code) === hsCode))
    || entries.find((entry) => entry.enabled && entryTokens(entry).some((token) => text.includes(token) || token.includes(text)))
    || entries.find((entry) => entry.enabled && entryTokens(entry).some((token) => similar(text, token)));
}

export function applyCustomsProductWhitelist(
  items: Array<Record<string, unknown>>,
  settings: CustomsProductWhitelistSettings,
  warnings: string[] = [],
) {
  const entries = settings.customsProductWhitelist.filter((entry) => entry.enabled);
  if (!settings.customsProductWhitelistEnabled || !entries.length) return items;
  return items.flatMap((item, index) => {
    const originalName = nonEmpty(item.productName || item.nameAndSpecification);
    const match = matchCustomsProductWhitelist(item, entries);
    if (match) {
      if (originalName && key(originalName) !== key(match.standardName)) {
        warnings.push(`报关商品第${index + 1}行“${originalName}”已按白名单标准化为“${match.standardName}”。`);
      }
      return [{
        ...item,
        productName: match.standardName,
        nameAndSpecification: match.standardName,
        customsWhitelistMatched: true,
        customsWhitelistStandardName: match.standardName,
        customsWhitelistOriginalName: originalName,
      }];
    }
    warnings.push(`报关商品第${index + 1}行“${originalName || "未识别品名"}”未命中报关品名白名单，已排除自动填入。`);
    return [];
  });
}
