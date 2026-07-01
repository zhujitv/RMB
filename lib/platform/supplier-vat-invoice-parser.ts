export type VatInvoiceFields = {
  invoiceNo: string;
  invoiceDate: string;
  amountWithTax: number;
  amountWithoutTax: number;
  taxAmount: number;
  taxRate: string;
  seller: string;
  sellerTaxNo: string;
  buyer: string;
  buyerTaxNo: string;
  productName: string;
  specModel: string;
  unit: string;
  quantity: string;
  unitPrice: string;
};

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanText(match?.[1]);
    if (value) return value;
  }
  return "";
}

function moneyValue(value: unknown) {
  const text = String(value || "")
    .replace(/[人民币¥￥,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAmount(text: string, patterns: RegExp[]) {
  return moneyValue(firstMatch(text, patterns));
}

function parseDateText(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  const normalized = value
    .replace(/[年月.]/g, "-")
    .replace(/[日号]/g, "")
    .replace(/--+/g, "-")
    .trim();
  return normalized || value;
}

function normalizeOcrLines(text: string) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function stripInvoiceFieldNoise(value: unknown) {
  return cleanText(value)
    .replace(/^(名称|纳税人识别号|地址、电话|开户行及账号|开户行账号)[:：]\s*/g, "")
    .replace(/\s+名称[:：].*$/g, "")
    .replace(/\s*(纳税人识别号|地址、电话|开户行及账号|开户行账号)[:：].*$/g, "")
    .replace(/\s*(密码区|货物或应税劳务|项目名称|规格型号|单位|数量|单价|金额|税率|税额).*$/g, "")
    .trim();
}

function inlineInvoiceText(text: string) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSuspiciousInvoiceParty(value: unknown) {
  const text = cleanText(value);
  if (!text) return false;
  if (/(名称|纳税人识别号|地址|电话|开户行|账号|密码区|项目名称|货物或应税劳务|价税合计|税额|税率)[:：]/.test(text)) return true;
  const companyLikeCount = (text.match(/(?:公司|集团|厂|中心|合作社|企业|商行|经营部)/g) || []).length;
  return companyLikeCount > 1;
}

export function isSuspiciousInvoiceProduct(value: unknown) {
  const text = cleanText(value);
  if (!text) return false;
  return /(纳税人识别号|统一社会信用代码|地址|电话|开户行|账号|备注|收款人|复核|开票人|密码区|价税合计|发票号码|开票日期|购买方|销售方|¥|￥)/.test(text);
}

function structuredText(fields: Record<string, unknown> | null | undefined, key: string) {
  return cleanText(fields?.[key]);
}

function structuredAmount(fields: Record<string, unknown> | null | undefined, key: string) {
  return moneyValue(fields?.[key]);
}

function normalizeInvoiceProductName(value: unknown) {
  return cleanText(value)
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+(规格型号|单位|数量|单价|金额|税率|税额).*$/g, "")
    .replace(/\s+[0-9,]+(?:\.[0-9]+)?(?:\s+[0-9,]+(?:\.[0-9]+)?){1,}\s*(?:13%|9%|6%|0%|免税)?.*$/g, "")
    .replace(/(套|只|批|吨|千克|公斤|米|平方米|立方米|PCS|SET)$/i, "")
    .trim();
}

function structuredPartyFallback(fields: Record<string, unknown> | null | undefined, key: string) {
  const value = structuredText(fields, key);
  return value && !isSuspiciousInvoiceParty(value) ? stripInvoiceFieldNoise(value) : "";
}

function structuredProductFallback(fields: Record<string, unknown> | null | undefined) {
  const value = structuredText(fields, "productName");
  return value && !isSuspiciousInvoiceProduct(value) ? normalizeInvoiceProductName(value) : "";
}

function extractInvoiceNameSequence(text: string) {
  const source = inlineInvoiceText(text);
  const names = Array.from(source.matchAll(/名称[:：]\s*(.*?)(?=\s+名称[:：]|\s+纳税人识别号[:：]|\s+统一社会信用代码[:：]|\s+地址[、,，]?电话[:：]|\s+开户行|密码区|$)/g))
    .map((match) => stripInvoiceFieldNoise(match[1]))
    .filter((name) => name && !isSuspiciousInvoiceParty(name));
  return {
    buyer: names[0] || "",
    seller: names[1] || "",
  };
}

function extractInvoiceTaxNoSequence(text: string) {
  const source = inlineInvoiceText(text);
  const taxNos = Array.from(source.matchAll(/(?:纳税人识别号|统一社会信用代码)[:：]\s*([A-Z0-9]{8,30})/gi))
    .map((match) => cleanText(match[1]).toUpperCase())
    .filter(Boolean);
  return {
    buyerTaxNo: taxNos[0] || "",
    sellerTaxNo: taxNos[1] || "",
  };
}

function sectionBetween(text: string, startPatterns: RegExp[], endPatterns: RegExp[]) {
  const source = String(text || "");
  let start = -1;
  for (const pattern of startPatterns) {
    const match = pattern.exec(source);
    if (match && (start < 0 || match.index < start)) start = match.index;
  }
  if (start < 0) return "";
  let end = source.length;
  const tail = source.slice(start + 1);
  for (const pattern of endPatterns) {
    const match = pattern.exec(tail);
    if (match) end = Math.min(end, start + 1 + match.index);
  }
  return source.slice(start, end);
}

function extractPartyName(section: string, partyLabel: string) {
  const sectionText = section || "";
  const direct = firstMatch(sectionText, [
    /名称[:：]\s*([^\n\r]+)/,
    new RegExp(`${partyLabel}\\s*(?:名称)?[:：]?\\s*([^\\n\\r]+)`),
  ]);
  if (direct) return stripInvoiceFieldNoise(direct);
  const lines = normalizeOcrLines(sectionText);
  const labelIndex = lines.findIndex((line) => line.includes(partyLabel));
  for (let index = Math.max(0, labelIndex); index < Math.min(lines.length, labelIndex + 6); index += 1) {
    const line = lines[index] || "";
    const value = firstMatch(line, [/名称[:：]\s*(.+)$/]);
    if (value) return stripInvoiceFieldNoise(value);
    if (labelIndex >= 0 && index > labelIndex && !/(纳税人识别号|地址|电话|开户行|账号)/.test(line)) {
      const cleaned = stripInvoiceFieldNoise(line);
      if (cleaned && /[\u4e00-\u9fa5]/.test(cleaned)) return cleaned;
    }
  }
  return "";
}

function extractPartyTaxNo(section: string) {
  return firstMatch(section, [
    /纳税人识别号[:：]\s*([A-Z0-9]{8,30})/i,
    /统一社会信用代码[:：]\s*([A-Z0-9]{8,30})/i,
  ]);
}

function extractInvoiceAmountWithTax(text: string) {
  const normalized = text.replace(/[ \t]+/g, " ");
  return parseAmount(normalized, [
    /价税合计[\s\S]{0,80}[¥￥]\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
    /价税合计[\s\S]{0,30}小写[\s\S]{0,20}[¥￥]?([0-9,]+(?:\.[0-9]{1,2})?)/,
    /小写[\s\S]{0,20}[¥￥]?([0-9,]+(?:\.[0-9]{1,2})?)/,
    /含税金额[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
  ]);
}

function extractInvoiceTotals(text: string) {
  const totalLine = normalizeOcrLines(text).find((line) => /合计/.test(line) && /[0-9]/.test(line) && !/价税合计/.test(line)) || "";
  const amounts = Array.from(totalLine.matchAll(/[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/g))
    .map((match) => moneyValue(match[1]))
    .filter((value) => value > 0);
  return {
    amountWithoutTax: amounts[0] || parseAmount(text, [
      /不含税金额[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
      /金额[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s+税率/,
    ]),
    taxAmount: amounts[1] || parseAmount(text, [
      /税额[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
    ]),
  };
}

function stripInvoiceItemColumns(line: string) {
  return cleanText(line)
    .replace(/\s+[A-Za-z0-9\-_.#/]{1,30}\s+(套|个|件|只|批|吨|千克|公斤|米|平方米|立方米|PCS|SET)\b.*$/i, "")
    .replace(/\s+(套|个|件|只|批|吨|千克|公斤|米|平方米|立方米|PCS|SET)\b.*$/i, "")
    .replace(/\s+[0-9,]+(?:\.[0-9]+)?\s+[0-9,]+(?:\.[0-9]+)?\s+[0-9,]+(?:\.[0-9]{1,2})?\s+[0-9]{1,2}%.*$/i, "")
    .replace(/\s+[0-9,]+(?:\.[0-9]{1,2})?\s+[0-9]{1,2}%.*$/i, "")
    .replace(/\s+(税率|税额|金额|单价|数量|单位|规格型号).*$/g, "")
    .trim();
}

function extractInvoiceProductName(text: string) {
  const lines = normalizeOcrLines(text);
  const startIndex = lines.findIndex((line) => /(货物或应税劳务|服务名称|项目名称)/.test(line));
  const itemSection = sectionBetween(text, [
    /货物或应税劳务/,
    /项目名称/,
  ], [
    /合计/,
    /价税合计/,
    /销售方/,
  ]);
  const sectionText = normalizeInvoiceProductName(itemSection
    .replace(/(货物或应税劳务、?服务名称|项目名称|规格型号|单位|数量|单价|金额|税率|税额)/g, " "));
  const starProduct = sectionText.match(/([*＊][^*＊\s]{1,40}[*＊][\u4e00-\u9fa5A-Za-z0-9（）()·\-_/]{2,80})/);
  if (starProduct?.[1] && !isSuspiciousInvoiceProduct(starProduct[1])) return starProduct[1];
  const candidates: string[] = [];
  const scanLines = startIndex >= 0 ? lines.slice(startIndex + 1) : lines;
  for (const line of scanLines) {
    if (/(合计|价税合计|销售方|备注|收款人|复核|开票人)/.test(line)) break;
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(line)) continue;
    if (/(规格型号|单位|数量|单价|金额|税率|税额)/.test(line) && line.length < 20) continue;
    const cleaned = stripInvoiceItemColumns(line);
    if (cleaned && !/(购买方|销售方|纳税人识别号|地址|电话|开户行|密码区)/.test(cleaned)) {
      candidates.push(cleaned);
    }
    if (candidates.length >= 4) break;
  }
  const starItems = Array.from(text.matchAll(/([*＊][^*＊\n\r]{1,40}[*＊]\s*[^\n\r]+)/g))
    .map((match) => normalizeInvoiceProductName(stripInvoiceItemColumns(match[1])))
    .filter(Boolean);
  const merged = [...starItems, ...candidates]
    .map((item) => normalizeInvoiceProductName(item))
    .filter((item) => !isSuspiciousInvoiceProduct(item))
    .filter((item, index, arr) => item && arr.indexOf(item) === index);
  return merged.slice(0, 2).join("；");
}

function extractInvoiceTaxRate(text: string) {
  const itemSection = sectionBetween(text, [
    /货物或应税劳务/,
    /项目名称/,
  ], [
    /合计/,
    /价税合计/,
    /销售方/,
  ]);
  const source = itemSection || text;
  return firstMatch(source, [
    /(13(?:\.0+)?%|9(?:\.0+)?%|6(?:\.0+)?%|0(?:\.0+)?%|免税)/,
  ]) || firstMatch(text, [
    /税率[:：]?\s*(13(?:\.0+)?%|9(?:\.0+)?%|6(?:\.0+)?%|0(?:\.0+)?%|免税)/,
  ]);
}

export function parseVatInvoiceFields(text: string, structuredFields: Record<string, unknown> = {}): VatInvoiceFields {
  const buyerSection = sectionBetween(text, [
    /购买方/,
    /购\s*买\s*方/,
  ], [
    /密码区/,
    /货物或应税劳务/,
    /项目名称/,
    /销售方/,
  ]);
  const sellerSection = sectionBetween(text, [
    /销售方/,
    /销\s*售\s*方/,
  ], [
    /备注/,
    /收款人/,
    /复核/,
    /开票人/,
  ]);
  const partyNames = extractInvoiceNameSequence(text);
  const partyTaxNos = extractInvoiceTaxNoSequence(text);
  const rawSeller = partyNames.seller || extractPartyName(sellerSection, "销售方") || firstMatch(text, [
    /销售方(?:名称)?[:：]\s*([^\n\r]+)/,
    /销\s*售\s*方[:：]\s*([^\n\r]+)/,
  ]);
  const rawBuyer = partyNames.buyer || extractPartyName(buyerSection, "购买方") || firstMatch(text, [
    /购买方(?:名称)?[:：]\s*([^\n\r]+)/,
    /购\s*买\s*方[:：]\s*([^\n\r]+)/,
  ]);
  const rawProductName = extractInvoiceProductName(text) || firstMatch(text, [
    /货物或应税劳务、服务名称[:：]?\s*([^\n\r]+)/,
    /产品名称[:：]\s*([^\n\r]+)/,
    /服务名称[:：]\s*([^\n\r]+)/,
  ]);
  const invoiceNo = structuredText(structuredFields, "invoiceNo") || firstMatch(text, [
    /发票号码[:：]?\s*([A-Z0-9\-]{6,30})/i,
    /发票号[:：]?\s*([A-Z0-9\-]{6,30})/i,
    /No\.?\s*[:：]?\s*([A-Z0-9\-]{6,30})/i,
  ]);
  const invoiceDate = structuredText(structuredFields, "invoiceDate") || parseDateText(text, [
    /开票日期[:：]?\s*([0-9]{4}[年\-/.][0-9]{1,2}[月\-/.][0-9]{1,2}[日号]?)/,
    /日期[:：]?\s*([0-9]{4}[年\-/.][0-9]{1,2}[月\-/.][0-9]{1,2}[日号]?)/,
  ]);
  const amountWithTax = structuredAmount(structuredFields, "amountWithTax") || extractInvoiceAmountWithTax(text);
  const totals = extractInvoiceTotals(text);
  const taxRate = structuredText(structuredFields, "taxRate") || extractInvoiceTaxRate(text);
  const seller = stripInvoiceFieldNoise(rawSeller) || structuredPartyFallback(structuredFields, "seller");
  const buyer = stripInvoiceFieldNoise(rawBuyer) || structuredPartyFallback(structuredFields, "buyer");
  const productName = normalizeInvoiceProductName(rawProductName) || structuredProductFallback(structuredFields);
  return {
    invoiceNo,
    invoiceDate,
    amountWithTax,
    amountWithoutTax: structuredAmount(structuredFields, "amountWithoutTax") || totals.amountWithoutTax,
    taxAmount: structuredAmount(structuredFields, "taxAmount") || totals.taxAmount,
    taxRate,
    seller,
    sellerTaxNo: partyTaxNos.sellerTaxNo || structuredText(structuredFields, "sellerTaxNo") || extractPartyTaxNo(sellerSection),
    buyer,
    buyerTaxNo: partyTaxNos.buyerTaxNo || structuredText(structuredFields, "buyerTaxNo") || extractPartyTaxNo(buyerSection),
    productName,
    specModel: structuredText(structuredFields, "specModel"),
    unit: structuredText(structuredFields, "unit"),
    quantity: structuredText(structuredFields, "quantity"),
    unitPrice: structuredText(structuredFields, "unitPrice"),
  };
}
