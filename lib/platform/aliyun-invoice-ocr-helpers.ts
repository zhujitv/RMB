import {
  DETAIL_ARRAY_KEYS,
  INVOICE_FIELD_ALIASES,
  PARTY_MARKERS,
  PARTY_NAME_MARKERS,
  PARTY_TAX_MARKERS,
  type KeyValueEntry,
} from "./aliyun-invoice-ocr-fields";

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeKey(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s_\-:：,，.。()（）【】\[\]{}《》<>/\\]/g, "");
}

function normalizedMarkers(values: string[]) {
  return values.map(normalizeKey).filter(Boolean);
}

export function normalizeFieldValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(normalizeFieldValue).filter(Boolean).join("；");
  if (isPlainRecord(value)) {
    for (const key of ["value", "Value", "text", "Text", "content", "Content", "word", "Word", "name", "Name"]) {
      const text = normalizeFieldValue(value[key]);
      if (text) return text;
    }
  }
  return "";
}

export function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

export function responseField(record: unknown, key: string) {
  if (!isPlainRecord(record)) return undefined;
  if (record[key] != null) return record[key];
  const pascal = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
  if (record[pascal] != null) return record[pascal];
  const upper = key.toUpperCase();
  if (record[upper] != null) return record[upper];
  return undefined;
}

function matchesAlias(key: unknown, aliases: string[]) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  const exactAliases = new Set(aliases.map(normalizeKey).filter(Boolean));
  if (exactAliases.has(normalized)) return true;
  return aliases.some((alias) => {
    const candidate = normalizeKey(alias);
    return Boolean(candidate) && normalized.endsWith(candidate);
  });
}

export function officialDataCandidates(payload: unknown) {
  const candidates: unknown[] = [];
  const parsed = parseJsonMaybe(payload);
  if (isPlainRecord(parsed)) {
    if (isPlainRecord(parsed.data)) candidates.push(parsed.data);
    if (Array.isArray(parsed.data)) candidates.push(...parsed.data);
    if (Array.isArray(parsed.subImages)) {
      for (const image of parsed.subImages) {
        if (isPlainRecord(image) && isPlainRecord(image.data)) candidates.push(image.data);
      }
    }
    candidates.push(parsed);
  } else if (Array.isArray(parsed)) {
    candidates.push(...parsed);
  }
  return candidates;
}

export function keyValuePairsFromPayload(payload: unknown) {
  const pairs = new Map<string, unknown>();
  function addPair(key: unknown, value: unknown) {
    const normalized = normalizeKey(key);
    if (!normalized || value == null || pairs.has(normalized)) return;
    pairs.set(normalized, value);
  }
  function walk(value: unknown, depth = 0) {
    if (depth > 7 || value == null) return;
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) return walk(parsed, depth + 1);
    if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
    if (!isPlainRecord(value)) return;
    const key = value.key ?? value.Key ?? value.field ?? value.Field ?? value.fieldName ?? value.FieldName ?? value.name ?? value.Name ?? value.label ?? value.Label;
    const val = value.value ?? value.Value ?? value.fieldValue ?? value.FieldValue ?? value.text ?? value.Text ?? value.content ?? value.Content ?? value.word ?? value.Word;
    if (key != null && val != null) addPair(key, val);
    for (const nestedKey of ["prism_keyValueInfo", "keyValueInfo", "keyValueInfos", "kvInfo", "kvDetails", "keyValues"]) {
      const nested = value[nestedKey];
      if (Array.isArray(nested)) walk(nested, depth + 1);
    }
    for (const item of Object.values(value)) walk(item, depth + 1);
  }
  walk(payload);
  return pairs;
}

export function keyValueEntriesFromPayload(payload: unknown) {
  const entries: KeyValueEntry[] = [];
  function addEntry(key: unknown, value: unknown) {
    const textKey = normalizeFieldValue(key);
    const normalizedKey = normalizeKey(textKey);
    if (!textKey || !normalizedKey || value == null) return;
    entries.push({ key: textKey, normalizedKey, value });
  }
  function walk(value: unknown, depth = 0) {
    if (depth > 7 || value == null) return;
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) return walk(parsed, depth + 1);
    if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
    if (!isPlainRecord(value)) return;
    const key = value.key ?? value.Key ?? value.field ?? value.Field ?? value.fieldName ?? value.FieldName ?? value.name ?? value.Name ?? value.label ?? value.Label;
    const val = value.value ?? value.Value ?? value.fieldValue ?? value.FieldValue ?? value.text ?? value.Text ?? value.content ?? value.Content ?? value.word ?? value.Word;
    if (key != null && val != null) addEntry(key, val);
    for (const [recordKey, recordValue] of Object.entries(value)) {
      if (!["key", "Key", "field", "Field", "fieldName", "FieldName", "name", "Name", "label", "Label", "value", "Value", "fieldValue", "FieldValue", "text", "Text", "content", "Content", "word", "Word"].includes(recordKey)) {
        addEntry(recordKey, recordValue);
      }
      walk(recordValue, depth + 1);
    }
  }
  walk(payload);
  return entries;
}

export function valueByAliasesFromRecord(record: unknown, aliases: string[]) {
  if (!isPlainRecord(record)) return "";
  for (const [key, value] of Object.entries(record)) {
    if (matchesAlias(key, aliases)) {
      const text = normalizeFieldValue(value);
      if (text) return text;
    }
  }
  return "";
}

export function valueByAliasesFromPairs(pairs: Map<string, unknown>, aliases: string[]) {
  const aliasKeys = aliases.map(normalizeKey).filter(Boolean);
  for (const alias of aliasKeys) {
    const text = normalizeFieldValue(pairs.get(alias));
    if (text) return text;
  }
  for (const [key, value] of pairs) {
    if (aliasKeys.some((alias) => key === alias || key.endsWith(alias))) {
      const text = normalizeFieldValue(value);
      if (text) return text;
    }
  }
  return "";
}

function contextualPartyValue(entries: KeyValueEntry[], party: "buyer" | "seller", kind: "name" | "taxNo") {
  const partyMarkers = normalizedMarkers(PARTY_MARKERS[party]);
  const fieldMarkers = normalizedMarkers(kind === "name" ? PARTY_NAME_MARKERS : PARTY_TAX_MARKERS);
  for (const entry of entries) {
    if (partyMarkers.some((marker) => entry.normalizedKey.includes(marker)) && fieldMarkers.some((marker) => entry.normalizedKey.includes(marker))) {
      const text = normalizeFieldValue(entry.value);
      if (text) return text;
    }
  }
  return "";
}

function genericPartyValueBySequence(entries: KeyValueEntry[], party: "buyer" | "seller", kind: "name" | "taxNo") {
  const exactKeys = normalizedMarkers(kind === "name" ? ["名称", "name"] : ["纳税人识别号", "统一社会信用代码", "税号", "taxNo", "taxNumber"]);
  const values = entries.filter((entry) => exactKeys.includes(entry.normalizedKey)).map((entry) => normalizeFieldValue(entry.value)).filter(Boolean);
  const uniqueValues = Array.from(new Set(values));
  return party === "buyer" ? uniqueValues[0] || "" : uniqueValues[1] || "";
}

export function partyValueFromStructuredEntries(entries: KeyValueEntry[], party: "buyer" | "seller", kind: "name" | "taxNo") {
  return contextualPartyValue(entries, party, kind) || genericPartyValueBySequence(entries, party, kind);
}

export function detailRowsFromPayload(payload: unknown, candidates: unknown[], pairs: Map<string, unknown>) {
  const rows: Record<string, unknown>[] = [];
  function addRows(value: unknown) {
    const parsed = parseJsonMaybe(value);
    if (Array.isArray(parsed)) return parsed.forEach((item) => { if (isPlainRecord(item)) rows.push(item); });
    if (isPlainRecord(parsed)) rows.push(parsed);
  }
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate)) continue;
    for (const key of DETAIL_ARRAY_KEYS) if (candidate[key] != null) addRows(candidate[key]);
  }
  for (const key of DETAIL_ARRAY_KEYS) {
    const value = pairs.get(normalizeKey(key));
    if (value != null) addRows(value);
  }
  if (!rows.length && isPlainRecord(payload)) {
    for (const value of Object.values(payload)) {
      const parsed = parseJsonMaybe(value);
      if (isPlainRecord(parsed) || Array.isArray(parsed)) rows.push(...detailRowsFromPayload(parsed, officialDataCandidates(parsed), keyValuePairsFromPayload(parsed)));
    }
  }
  return rows;
}

export function fieldFromDetails(rows: Record<string, unknown>[], canonicalKey: string) {
  const aliases = INVOICE_FIELD_ALIASES[canonicalKey] || [];
  const values = rows.map((row) => valueByAliasesFromRecord(row, aliases)).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
  return Array.from(new Set(values)).join("；");
}

export function genericFieldFallback(payload: unknown, aliases: string[]) {
  let found = "";
  function walk(value: unknown, depth = 0) {
    if (found || depth > 7 || value == null) return;
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) return walk(parsed, depth + 1);
    if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
    if (!isPlainRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (matchesAlias(key, aliases)) {
        const text = normalizeFieldValue(item);
        if (text) {
          found = text;
          return;
        }
      }
    }
    for (const item of Object.values(value)) walk(item, depth + 1);
  }
  walk(payload);
  return found;
}

export function collectText(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectText(parsed, output, depth + 1);
  if (typeof value === "string") {
    const text = value.trim();
    if (text && text.length <= 1000) output.push(text);
    return output;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output, depth + 1));
    return output;
  }
  if (isPlainRecord(value)) Object.values(value).forEach((item) => collectText(item, output, depth + 1));
  return output;
}
