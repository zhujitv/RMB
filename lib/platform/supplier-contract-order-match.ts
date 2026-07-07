function cleanOrderText(value: unknown) {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function structuredText(fields: Record<string, unknown> | null | undefined, key: string) {
  return cleanOrderText(fields?.[key]);
}

function normalizeOrderNoText(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\r?\n/g, "")
    .replace(/\s+/g, "")
    .replace(/[，、；;]/g, "/")
    .replace(/[／\\]+/g, "/")
    .replace(/[（）()【】\[\]{}《》<>。.:："'“”‘’]/g, "");
}

function normalizeOrderNoToken(value: unknown) {
  return normalizeOrderNoText(value)
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2")
    .replace(/[^A-Z0-9_-]/g, "");
}

export function normalizeContractOrderNoSet(value: unknown) {
  const normalized = normalizeOrderNoText(value);
  if (!normalized) return [];
  return normalized
    .split(/[\/,+&]+|和|及/)
    .map((item) => normalizeOrderNoToken(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort();
}

export function contractOrderSetKey(value: unknown) {
  return normalizeContractOrderNoSet(value).join("|");
}

export function contractOrderNoMatches(ocrOrderNo: unknown, systemOrderNo: unknown) {
  const ocrSet = normalizeContractOrderNoSet(ocrOrderNo);
  const systemSet = normalizeContractOrderNoSet(systemOrderNo);
  if (!ocrSet.length || !systemSet.length) return false;
  if (ocrSet.join("|") === systemSet.join("|")) return true;
  return ocrSet.every((item) => systemSet.includes(item)) || systemSet.every((item) => ocrSet.includes(item));
}

const CONTRACT_ORDER_TOKEN_PATTERN = /(?:P[O0]\d{1,6}[-_][A-Z0-9]{1,12}|[A-Z]{2,6}\d{1,6}[-_][A-Z0-9]{1,12})(?:\s*[\/／,，、;；]\s*(?:P[O0]\d{1,6}[-_][A-Z0-9]{1,12}|[A-Z]{2,6}\d{1,6}[-_][A-Z0-9]{1,12}))*/gi;

function contractOrderCandidateScore(value: string) {
  const set = normalizeContractOrderNoSet(value);
  if (!set.length) return 0;
  const text = normalizeOrderNoText(value);
  const exactPoBonus = (text.match(/PO\d/gi) || []).length * 3;
  const zeroPoPenalty = (text.match(/P0\d/gi) || []).length * 2;
  return set.length * 100 + set.join("").length + exactPoBonus - zeroPoPenalty;
}

function extractContractOrderCandidates(text: string) {
  const candidates: string[] = [];
  const labeledPatterns = [
    /(?:订单号|合同号|采购单号|采购订单号|PO号|PO编号|Purchase\s*Order\s*No\.?)[:：]?\s*([A-Z0-9][A-Z0-9_\-\/／,，、;；\s]{2,80})/gi,
  ];
  for (const pattern of labeledPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = cleanOrderText(match[1]);
      if (value) candidates.push(value);
    }
  }
  for (const match of text.matchAll(CONTRACT_ORDER_TOKEN_PATTERN)) {
    const value = cleanOrderText(match[0]);
    if (value) candidates.push(value);
  }
  return candidates
    .map((item) => normalizeOrderNoText(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

export function selectBestContractOrderNo(text: string, structuredValue: unknown = "") {
  const candidates = [
    structuredText({ orderNo: structuredValue }, "orderNo"),
    ...extractContractOrderCandidates(text),
  ].filter(Boolean);
  return candidates
    .sort((left, right) => contractOrderCandidateScore(right) - contractOrderCandidateScore(left))[0] || "";
}
