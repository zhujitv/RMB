import {
  normalizePdfText,
  toHalfWidth,
  type CustomsDeclarationItemFields,
} from "./customs-declaration-parser-shared.ts";
import {
  findCurrency,
  findTradeTerm,
  normalizeCurrency,
  numericAmount,
} from "./customs-declaration-field-parser.ts";

const CUSTOMS_ITEM_UNIT_PATTERN = "(千克|公斤|克|吨|个|只|件|套|台|米|平方米|立方米|双|条|箱|PCS|PCE|PC|SET|SETS|KG|KGS|M2|M3|MT|UNIT|UNITS|PIECE|PIECES)";
const CUSTOMS_ITEM_UNIT_REGEX = new RegExp(CUSTOMS_ITEM_UNIT_PATTERN, "i");
const CUSTOMS_ITEM_HEADER_PATTERN = /^(项号|商品编号|HS编码|商品名称|商品名称及规格型号|规格型号|数量及单位|数量|单位|单价|总价|币制|原产国|最终目的国|征免|法定|成交|第一|第二)$/i;
const CUSTOMS_ITEM_LABEL_PATTERN = /(报关单号|海关编号|预录入编号|申报日期|出口日期|日期|出境关别|进境关别|备案号|境内发货人|境内收发货人|境外收发货人|生产销售单位|消费使用单位|申报单位|运输方式|运输工具名称|航次号|提运单号|提单号|贸易国别|贸易国|运抵国|目的国|监管方式|征免性质|征免|许可证号|合同协议号|成交方式|运费|保费|杂费|件数|包装种类|集装箱|集装箱号|箱号|港口|口岸|装货港|指运港|启运港|境内货源地|随附单证|标记唛码|备注|发票|代理报关委托协议|统一编号|申报地海关|入境口岸|毛重|净重)/;
const CUSTOMS_COMPANY_NAME_PATTERN = /(有限公司|有限责任公司|股份有限公司|进出口公司|贸易公司|B\.?V\.?|LTD\.?|LIMITED|INC\.?|CO\.?,?\s*LTD\.?)/i;
const CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN = /(水路运输|铁路运输|公路运输|航空运输|多式联运|运输工具|航次|提运单|提单|HAMBURG\s+EXPRESS|EXPRESS\s*\/|VESSEL|VOYAGE|MAJOR\s+FENCE\s+B\.?V\.?|洋山\s*区|洋山港区|港区|口岸)/i;
const CUSTOMS_ITEM_CONTAINER_NO_PATTERN = /\b[A-Z]{4}\d{7}\b/i;
const CUSTOMS_ITEM_DATE_PATTERN = /\b20\d{2}[-/.年]?\d{1,2}[-/.月]?\d{1,2}(?:日)?\b/;
const CUSTOMS_COUNTRY_NAMES = "中国|荷兰|美国|德国|英国|法国|意大利|日本|韩国|越南|印度|加拿大|澳大利亚|比利时|西班牙|波兰|俄罗斯|泰国|马来西亚|印尼|墨西哥|巴西|阿联酋|沙特|奥地利|瑞典|瑞士|土耳其|南非";
const CUSTOMS_ITEM_TRAILING_METADATA_PATTERNS = [
  new RegExp(`\\s+(?:${CUSTOMS_COUNTRY_NAMES})(?:\\s*(?:${CUSTOMS_COUNTRY_NAMES}))?(?:\\s|[()（）]|$).*$`, "i"),
  new RegExp(`中国\\s*(?:${CUSTOMS_COUNTRY_NAMES})(?:\\s|[()（）]|$).*$`, "i"),
  /[()（）\s]*(?:宣城|照章征税|照章|征税|全免|征免方式|征免性质|境内货源地|最终目的国|原产国).*$/i,
];

export function normalizeCustomsDeclarationItemForTaxRefund(
  input: Partial<CustomsDeclarationItemFields> & Record<string, unknown> = {},
  defaults: Partial<Pick<CustomsDeclarationItemFields, "currency" | "tradeTerm">> = {},
): CustomsDeclarationItemFields | null {
  const productName = cleanCustomsDeclarationProductNameForTaxRefund(input.productName);
  const quantity = numericAmount(String(input.quantity ?? ""));
  const unit = normalizeCustomsItemUnit(input.unit);
  const totalAmount = numericAmount(String(input.totalAmount ?? input.fobAmount ?? ""));
  if (!isValidTaxRefundProductName(productName) || quantity <= 0 || !unit || totalAmount <= 0) return null;
  const currency = normalizeCurrency(String(input.currency || defaults.currency || ""));
  return {
    itemNo: normalizeCustomsItemNo(input.itemNo),
    hsCode: normalizeHsCode(input.hsCode),
    productName,
    specification: cleanCustomsItemSpecification(input.specification),
    quantity,
    unit,
    unitPrice: numericAmount(String(input.unitPrice ?? "")),
    totalAmount,
    tradeTerm: normalizeTradeTerm(String(input.tradeTerm || defaults.tradeTerm || "")),
    currency,
    fobAmount: totalAmount,
    grossWeight: 0,
    netWeight: 0,
    originCountry: "",
    destinationCountry: "",
  };
}

function normalizeCustomsItemNo(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{1,3}$/.test(text) ? text : "";
}

function normalizeHsCode(value: unknown) {
  const text = String(value || "").replace(/\D/g, "");
  return /^\d{8,13}$/.test(text) ? text : "";
}

function cleanCustomsItemSpecification(value: unknown) {
  return toHalfWidth(String(value || ""))
    .replace(/规格型号/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function normalizeTradeTerm(value = "") {
  const match = String(value || "").trim().toUpperCase().match(/\b(FOB|CIF|CFR|EXW)\b/);
  return match?.[1] || "";
}

function normalizeCustomsItemUnit(value: unknown) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  if (["KG", "KGS", "公斤"].includes(text)) return "千克";
  if (["PC", "PCE", "PCS", "PIECE", "PIECES"].includes(text)) return "PCS";
  if (["SET", "SETS"].includes(text)) return "套";
  if (["M2"].includes(text)) return "平方米";
  if (["M3"].includes(text)) return "立方米";
  if (["MT"].includes(text)) return "吨";
  if (/^(千克|克|吨|个|只|件|套|台|米|平方米|立方米|双|条|箱|PCS|UNIT|UNITS)$/i.test(text)) {
    return text;
  }
  return "";
}

export function cleanCustomsDeclarationProductNameForTaxRefund(value: unknown) {
  let text = toHalfWidth(String(value || ""))
    .replace(/^\s*\d{1,3}\s+/, "")
    .replace(/^\s*\d{8,13}\s+/, "")
    .replace(/商品名称及规格型号|商品名称|中文品名|品名|规格型号|HS编码|商品编号/g, " ")
    .replace(/\b(FOB|CIF|CFR|EXW|USD|CNY|RMB|EUR|JPY|HKD)\b/ig, " ")
    .replace(/[（(]\s*[）)]/g, " ")
    .replace(/[;；:：|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (isWholeCustomsMetadataRow(text)) return text.slice(0, 100);
  text = stripTrailingCustomsItemMetadata(text)
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 100);
}

function isValidTaxRefundProductName(productName = "") {
  const raw = toHalfWidth(String(productName || "")).replace(/\s+/g, " ").trim();
  const text = cleanCustomsDeclarationProductNameForTaxRefund(productName);
  return Boolean(
    text
    && /[\u4e00-\u9fa5A-Za-z]/.test(text)
    && !CUSTOMS_ITEM_HEADER_PATTERN.test(raw)
    && !CUSTOMS_ITEM_HEADER_PATTERN.test(text)
    && !CUSTOMS_ITEM_LABEL_PATTERN.test(raw)
    && !CUSTOMS_ITEM_LABEL_PATTERN.test(text)
    && !CUSTOMS_COMPANY_NAME_PATTERN.test(raw)
    && !CUSTOMS_COMPANY_NAME_PATTERN.test(text)
    && !CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN.test(raw)
    && !CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN.test(text)
    && !CUSTOMS_ITEM_CONTAINER_NO_PATTERN.test(raw)
    && !CUSTOMS_ITEM_CONTAINER_NO_PATTERN.test(text)
    && !CUSTOMS_ITEM_DATE_PATTERN.test(raw)
    && !CUSTOMS_ITEM_DATE_PATTERN.test(text),
  );
}

function isWholeCustomsMetadataRow(text = "") {
  return Boolean(
    text
    && (
      CUSTOMS_COMPANY_NAME_PATTERN.test(text)
      || CUSTOMS_ITEM_PARTY_OR_TRANSPORT_PATTERN.test(text)
      || CUSTOMS_ITEM_CONTAINER_NO_PATTERN.test(text)
      || CUSTOMS_ITEM_DATE_PATTERN.test(text)
    )
  );
}

function stripTrailingCustomsItemMetadata(value = "") {
  let text = value;
  for (const pattern of CUSTOMS_ITEM_TRAILING_METADATA_PATTERNS) {
    const match = text.match(pattern);
    const index = match?.index ?? -1;
    if (index > 1 && hasProductNameSignal(text.slice(0, index))) {
      text = text.slice(0, index).trim();
    }
  }
  return text;
}

function hasProductNameSignal(value = "") {
  const text = value.trim();
  return /[\u4e00-\u9fa5]{2,}/.test(text) || /[A-Za-z]{3,}/.test(text);
}

export function parseCustomsDeclarationItems(text = ""): CustomsDeclarationItemFields[] {
  const lines = normalizePdfText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const items: CustomsDeclarationItemFields[] = [];
  const itemPattern = new RegExp(`(?:^|\\s)(?:(\\d{1,3})\\s+)?([0-9]{8,13})\\s+(.+?)\\s+([0-9]+(?:[,，][0-9]{3})*(?:\\.[0-9]+)?|[0-9]+(?:\\.[0-9]+)?)\\s*${CUSTOMS_ITEM_UNIT_PATTERN}\\s+(?:(FOB|CIF|CFR|EXW)\\s+)?(?:(USD|CNY|RMB|EUR|JPY|HKD|美元|人民币|欧元|日元|港币)\\s+)?(?:(?:单价|UNIT\\s*PRICE)?\\s*([0-9]+(?:[,，][0-9]{3})*(?:\\.[0-9]{1,6})?|[0-9]+(?:\\.[0-9]{1,6})?)\\s+)?([0-9]+(?:[,，][0-9]{3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)(?:\\s|$)`, "i");
  for (const line of lines) {
    const match = line.match(itemPattern);
    if (!match) continue;
    const productName = String(match[3] || "")
      .replace(/\s+(FOB|CIF|CFR|EXW)\b.*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const item = normalizeCustomsDeclarationItemForTaxRefund({
      itemNo: String(match[1] || "").trim(),
      hsCode: String(match[2] || "").trim(),
      productName,
      quantity: numericAmount(match[4] || ""),
      unit: String(match[5] || "").trim(),
      unitPrice: numericAmount(match[8] || ""),
      totalAmount: numericAmount(match[9] || ""),
      tradeTerm: String(match[6] || "").trim().toUpperCase(),
      currency: normalizeCurrency(match[7] || ""),
    });
    if (item) items.push(item);
  }
  return dedupeCustomsItems([...items, ...parseMultilineCustomsDeclarationItems(lines)]);
}

function parseMultilineCustomsDeclarationItems(lines: string[] = []): CustomsDeclarationItemFields[] {
  const hsRows = lines
    .map((line, index) => ({ line, index, hsCode: findHsCodeInLine(line) }))
    .filter((row) => row.hsCode);
  const items: CustomsDeclarationItemFields[] = [];
  for (const [rowIndex, row] of hsRows.entries()) {
    const nextIndex = hsRows[rowIndex + 1]?.index ?? Math.min(lines.length, row.index + 16);
    const windowLines = lines.slice(row.index, Math.min(nextIndex, row.index + 16));
    const windowText = windowLines.join(" ");
    const productName = findProductNameInItemWindow(windowLines, row.hsCode);
    const quantityUnit = findQuantityUnitInItemWindow(windowText);
    const currency = findCurrency(windowText);
    const tradeTerm = findTradeTerm(windowText);
    const totalAmount = findTotalAmountInItemWindow(windowText, quantityUnit.quantity);
    const unitPrice = quantityUnit.quantity > 0 && totalAmount > 0 ? totalAmount / quantityUnit.quantity : 0;
    const item = normalizeCustomsDeclarationItemForTaxRefund({
      itemNo: findItemNoNearHsCode(lines, row.index),
      hsCode: row.hsCode,
      productName,
      quantity: quantityUnit.quantity,
      unit: quantityUnit.unit,
      unitPrice,
      totalAmount,
      tradeTerm,
      currency,
    });
    if (item) items.push(item);
  }
  return items;
}

function findItemNoNearHsCode(lines: string[] = [], index = 0) {
  const currentPrefix = toHalfWidth(lines[index] || "").match(/^\s*(\d{1,3})\s+[0-9]{8,13}\b/);
  if (currentPrefix) return currentPrefix[1] || "";
  const previous = toHalfWidth(lines[index - 1] || "").trim();
  return /^\d{1,3}$/.test(previous) ? previous : "";
}

function findHsCodeInLine(line = "") {
  if (CUSTOMS_ITEM_LABEL_PATTERN.test(line)) return "";
  const match = toHalfWidth(line).match(/(?:^|\D)([0-9]{8,13})(?!\d)/);
  return match?.[1] || "";
}

function findProductNameInItemWindow(lines: string[] = [], hsCode = "") {
  const candidates = lines
    .map((line) => cleanProductNameCandidate(line, hsCode))
    .filter(Boolean)
    .filter((line) => /[\u4e00-\u9fa5A-Za-z]/.test(line))
    .filter((line) => !CUSTOMS_ITEM_HEADER_PATTERN.test(line))
    .filter((line) => isValidTaxRefundProductName(line));
  return candidates[0] || "";
}

function cleanProductNameCandidate(line = "", hsCode = "") {
  let text = toHalfWidth(line)
    .replace(hsCode, " ")
    .replace(/^\s*\d{1,3}\s*/, "")
    .replace(/商品名称及规格型号|商品名称|规格型号|HS编码|商品编号/g, " ")
    .replace(new RegExp(`\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${CUSTOMS_ITEM_UNIT_PATTERN}`, "ig"), " ")
    .replace(new RegExp(`${CUSTOMS_ITEM_UNIT_PATTERN}\\s*\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?`, "ig"), " ")
    .replace(/\b(FOB|CIF|CFR|EXW|USD|CNY|RMB|EUR|JPY|HKD)\b/ig, " ")
    .replace(/[美元人民币欧元日元港币]+/g, " ")
    .replace(/\d+(?:[,，]\d{3})*(?:\.\d+)?/g, " ")
    .replace(/[;；:：|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 80) text = text.slice(0, 80).trim();
  return text;
}

function findQuantityUnitInItemWindow(text = "") {
  const normalized = toHalfWidth(text);
  const amount = "\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?";
  const quantityBeforeUnit = new RegExp(`(${amount})\\s*${CUSTOMS_ITEM_UNIT_PATTERN}`, "i");
  const quantityAfterUnit = new RegExp(`${CUSTOMS_ITEM_UNIT_PATTERN}\\s*(${amount})`, "i");
  let match = normalized.match(quantityBeforeUnit);
  if (match) return { quantity: numericAmount(match[1]), unit: match[2] || "" };
  match = normalized.match(quantityAfterUnit);
  if (match) return { quantity: numericAmount(match[2]), unit: match[1] || "" };
  return { quantity: 0, unit: "" };
}

function findTotalAmountInItemWindow(text = "", quantity = 0) {
  const normalized = toHalfWidth(text);
  const currencyAmount = normalized.match(/(?:FOB|CIF|CFR|EXW)?\s*(?:USD|CNY|RMB|EUR|JPY|HKD|美元|人民币|欧元|日元|港币)\s*(\d+(?:[,，]\d{3})*(?:\.\d+)?)/i);
  if (currencyAmount) return numericAmount(currencyAmount[1]);
  const amountCandidates = [...normalized.matchAll(/\d+(?:[,，]\d{3})*(?:\.\d+)?/g)]
    .map((match) => ({ value: numericAmount(match[0]), index: match.index || 0, raw: match[0] }))
    .filter((candidate) => candidate.value > 0)
    .filter((candidate) => candidate.raw.replace(/\D/g, "").length < 14)
    .filter((candidate) => Math.abs(candidate.value - quantity) > 0.0001)
    .filter((candidate) => !CUSTOMS_ITEM_UNIT_REGEX.test(normalized.slice(candidate.index, candidate.index + 20)));
  if (!amountCandidates.length) return 0;
  return amountCandidates.sort((left, right) => right.index - left.index)[0].value;
}

function dedupeCustomsItems(items: CustomsDeclarationItemFields[] = []) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.productName, item.quantity, item.unit, item.fobAmount || item.totalAmount || 0].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
