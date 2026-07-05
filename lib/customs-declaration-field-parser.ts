import {
  normalizeCustomsDate,
  toHalfWidth,
  type Candidate,
} from "./customs-declaration-parser-shared.ts";

const DECLARATION_NO_LABELS = ["报关单号", "海关编号", "预录入编号", "Customs Declaration No.", "Customs Declaration No", "Declaration No.", "Declaration No"];
const DECLARATION_DATE_LABELS = ["申报日期", "出口申报日期", "申报时间", "Declaration Date"];
export const EXPORT_DATE_LABELS = ["出口日期", "出口时间", "离境日期"];
const DOMESTIC_CONSIGNOR_LABELS = ["境内发货人", "境内收发货人", "发货人"];
const OVERSEAS_CONSIGNEE_LABELS = ["境外收货人", "境外收发货人", "收货人", "Consignee"];
const DECLARATION_UNIT_LABELS = ["申报单位", "报关单位", "代理报关企业"];
const TRANSPORT_MODE_LABELS = ["运输方式", "运输模式"];
const BILL_OF_LADING_LABELS = ["提运单号", "提单号", "运单号", "B/L No", "BL No"];
const TRADE_COUNTRY_LABELS = ["贸易国别", "贸易国", "贸易国家"];
const DESTINATION_COUNTRY_LABELS = ["目的国", "最终目的国", "运抵国"];
const SUPERVISION_MODE_LABELS = ["监管方式", "贸易方式"];
const NON_DECLARATION_DATE_LABEL_PATTERN = /(出口|录入|打印|放行|签发)日期/g;
const DECLARATION_NO_PATTERN = /[A-Z0-9]{8,32}/gi;

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactForNearbySearch(text = "") {
  return String(text || "").replace(/\s+/g, " ");
}

export function findBestDeclarationNo(text = "") {
  const compact = compactForNearbySearch(text);
  const candidates: Candidate[] = [];
  DECLARATION_NO_LABELS.forEach((label, labelIndex) => {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*[:：]?\\s*([A-Z0-9\\s-]{8,48})`, "gi");
    for (const match of compact.matchAll(pattern)) {
      const raw = trimBeforeKnownLabels(match[1] || "").replace(/[\s-]+/g, "");
      const declarationNo = raw.match(/^[A-Z0-9]{8,32}/i)?.[0] || raw.match(DECLARATION_NO_PATTERN)?.[0] || "";
      if (isLikelyDeclarationNo(declarationNo)) {
        candidates.push({ value: declarationNo.toUpperCase(), score: 100 - labelIndex * 10, index: match.index || 0 });
      }
    }
  });
  if (!candidates.length) {
    for (const match of compact.matchAll(DECLARATION_NO_PATTERN)) {
      const value = (match[0] || "").toUpperCase();
      if (isLikelyDeclarationNo(value)) candidates.push({ value, score: 10, index: match.index || 0 });
    }
  }
  return chooseBest(candidates);
}

function isLikelyDeclarationNo(value = "") {
  const normalized = String(value || "").replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8,32}$/.test(normalized)) return false;
  if (/^20\d{6}$/.test(normalized)) return false;
  return true;
}

export function findBestDeclarationDate(text = "") {
  const candidates = labeledDateCandidates(text, DECLARATION_DATE_LABELS, 120);
  for (const match of text.matchAll(NON_DECLARATION_DATE_LABEL_PATTERN)) {
    const context = text.slice(match.index || 0, (match.index || 0) + 80);
    const date = normalizeCustomsDate(context);
    if (date) candidates.push({ value: date, score: -50, index: match.index || 0 });
  }
  if (!candidates.length) {
    for (const match of text.matchAll(/20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*(?:日)?|\b20\d{6}\b/g)) {
      const date = normalizeCustomsDate(match[0]);
      if (date) candidates.push({ value: date, score: 5, index: match.index || 0 });
    }
  }
  return chooseBest(candidates.filter((item) => item.score > 0));
}

export function findBestLabeledDate(text = "", labels: string[] = []) {
  return chooseBest(labeledDateCandidates(text, labels, 100));
}

export function findBestLabeledText(text = "", labels: string[] = []) {
  const candidates: Candidate[] = [];
  const compact = compactForNearbySearch(text);
  labels.forEach((label, labelIndex) => {
    const pattern = new RegExp(`${escapeRegExp(label)}[\\s:：]{0,8}([^\\n]{2,80})`, "gi");
    for (const match of compact.matchAll(pattern)) {
      const value = cleanLabeledTextValue(match[1] || "");
      if (value) candidates.push({ value, score: 100 - labelIndex * 10, index: match.index || 0 });
    }
  });
  return chooseBest(candidates);
}

function cleanLabeledTextValue(value = "") {
  const stopLabels = [
    ...DECLARATION_NO_LABELS,
    ...DECLARATION_DATE_LABELS,
    ...EXPORT_DATE_LABELS,
    ...DOMESTIC_CONSIGNOR_LABELS,
    ...OVERSEAS_CONSIGNEE_LABELS,
    "消费使用单位",
    "生产销售单位",
    "运输方式",
    "提运单号",
    "成交方式",
    "贸易方式",
    "监管方式",
    "征免性质",
    "合同协议号",
    "申报单位",
    "贸易国别",
    "目的国",
    "币制",
    "币种",
  ];
  let text = String(value || "").replace(/[：:]+$/g, "").trim();
  for (const label of stopLabels) {
    const index = text.indexOf(label);
    if (index > 0) text = text.slice(0, index).trim();
  }
  return text.replace(/\s{2,}/g, " ").slice(0, 80);
}

function labeledDateCandidates(text = "", labels: string[] = [], baseScore = 100) {
  const candidates: Candidate[] = [];
  labels.forEach((label, labelIndex) => {
    const pattern = new RegExp(`${escapeRegExp(label)}[\\s:：]{0,8}([\\s\\S]{0,80})`, "gi");
    for (const match of text.matchAll(pattern)) {
      const context = trimBeforeKnownLabels(match[1] || "");
      const date = normalizeCustomsDate(context);
      if (date) candidates.push({ value: date, score: baseScore - labelIndex * 10, index: match.index || 0 });
    }
  });
  return candidates;
}

export function findTradeTerm(text = "") {
  const compact = compactForNearbySearch(text).toUpperCase();
  const labeled = compact.match(/(?:成交方式|贸易方式|价格条款)[:：]?\s*(FOB|CIF|CFR|EXW)/i)?.[1];
  return (labeled || compact.match(/\b(FOB|CIF|CFR|EXW)\b/i)?.[1] || "").toUpperCase();
}

export function findDomesticShipper(text = "") {
  return findBestLabeledText(text, DOMESTIC_CONSIGNOR_LABELS);
}

export function findOverseasConsignee(text = "") {
  return findBestLabeledText(text, OVERSEAS_CONSIGNEE_LABELS);
}

export function findTradeMode(text = "") {
  return findBestLabeledText(text, SUPERVISION_MODE_LABELS);
}

export function findCurrency(text = "") {
  const compact = compactForNearbySearch(text);
  const value = compact.match(/(?:币制|币种|成交币制)[:：]?\s*([A-Z]{3}|美元|人民币|欧元|日元|港币)/i)?.[1] || "";
  return normalizeCurrency(value);
}

export function normalizeCurrency(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (/美元|USD/.test(text)) return "USD";
  if (/人民币|CNY|RMB/.test(text)) return "CNY";
  if (/欧元|EUR/.test(text)) return "EUR";
  if (/日元|JPY/.test(text)) return "JPY";
  if (/港币|HKD/.test(text)) return "HKD";
  return /^[A-Z]{3}$/.test(text) ? text : "";
}

export function numericAmount(value = "") {
  const parsed = Number.parseFloat(String(value || "").replace(/[,，\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function findDeclarationTotalAmount(text = "") {
  const compact = compactForNearbySearch(text);
  const labeled = compact.match(/(?:报关总金额|FOB金额|成交金额|总价)[:：]?\s*(?:USD|CNY|RMB|EUR|JPY|HKD|美元|人民币|欧元|日元|港币)?\s*(\d+(?:[,，]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
  return labeled ? numericAmount(labeled[1]) : 0;
}

function chooseBest(candidates: Candidate[] = []) {
  if (!candidates.length) return "";
  return [...candidates].sort((a, b) => b.score - a.score || a.index - b.index)[0].value || "";
}

function trimBeforeKnownLabels(value = "") {
  const labels = [...DECLARATION_NO_LABELS, ...DECLARATION_DATE_LABELS, ...negativeDateLabelsIn(value)];
  const indexes = labels
    .map((label) => String(value || "").indexOf(label))
    .filter((index) => index >= 0);
  if (!indexes.length) return value;
  return String(value || "").slice(0, Math.min(...indexes));
}

function negativeDateLabelsIn(value = "") {
  return [...String(value || "").matchAll(NON_DECLARATION_DATE_LABEL_PATTERN)].map((match) => match[0]);
}
