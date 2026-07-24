import {
  cleanText,
  firstMatch,
  inlineInvoiceText,
  isSuspiciousInvoiceParty,
  isSuspiciousInvoiceProduct,
  moneyValue,
  normalizeInvoiceProductName,
  normalizeOcrLines,
  parseAmount,
  stripInvoiceFieldNoise,
  companyNameCandidates,
} from "./supplier-vat-invoice-parser-utils";

export function extractInvoiceNameSequence(text: string) {
  const source = inlineInvoiceText(text);
  const pairedNames = source.match(/名称[:：]\s*(.*?公司)\s+名称[:：]\s*(.*?公司)(?=\s+(?:购\s*销|开票日期|发票号码|发票代码|$))/);
  if (pairedNames) {
    return {
      buyer: stripInvoiceFieldNoise(pairedNames[1]),
      seller: stripInvoiceFieldNoise(pairedNames[2]),
    };
  }
  const names = Array.from(source.matchAll(/名称[:：]\s*(.*?)(?=\s+名称[:：]|\s+纳税人识别号[:：]|\s+统一社会信用代码[:：]|\s+地址[、,，]?电话[:：]|\s+开户行|密码区|$)/g))
    .map((match) => stripInvoiceFieldNoise(match[1]))
    .filter((name) => name && !isSuspiciousInvoiceParty(name));
  const companyNames = Array.from(new Set(companyNameCandidates(source)))
    .filter((name) => !names.includes(name));
  const allNames = [...names, ...companyNames];
  return {
    buyer: allNames[0] || "",
    seller: allNames[1] || "",
  };
}

export function extractInvoiceTaxNoSequence(text: string) {
  const source = inlineInvoiceText(text);
  const taxNoCandidates = Array.from(source.matchAll(/[A-Z0-9]{15,20}/gi))
    .map((match) => cleanText(match[0]).toUpperCase())
    .filter((value) => /[A-Z]/i.test(value) && /\d/.test(value));
  if (taxNoCandidates.length >= 2) {
    return {
      buyerTaxNo: taxNoCandidates[0] || "",
      sellerTaxNo: taxNoCandidates[1] || "",
    };
  }
  const taxNos = Array.from(source.matchAll(/(?:纳税人识别号|统一社会信用代码)[:：]\s*([A-Z0-9]{8,30})/gi))
    .map((match) => cleanText(match[1]).toUpperCase())
    .filter(Boolean);
  return {
    buyerTaxNo: taxNos[0] || "",
    sellerTaxNo: taxNos[1] || "",
  };
}

export function sectionBetween(text: string, startPatterns: RegExp[], endPatterns: RegExp[]) {
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

export function isInvoiceItemNameFragment(line: string) {
  const text = cleanText(line);
  if (!text || text.length > 24) return false;
  if (/^[信信息方买售购销\s]+$/.test(text)) return false;
  if (/[0-9¥￥]/.test(text)) return false;
  if (/(合计|价税|销售方|购买方|纳税人|统一社会信用代码|地址|电话|开户行|账号|备注|收款人|复核|开票人|发票|日期|项目名称|规格型号|单位|数量|单价|金额|税率|税额)/.test(text)) return false;
  return /[\u4e00-\u9fa5]/.test(text);
}

export function extractPartyName(section: string, partyLabel: string) {
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

export function extractPartyTaxNo(section: string) {
  return firstMatch(section, [
    /纳税人识别号[:：]\s*([A-Z0-9]{8,30})/i,
    /统一社会信用代码[:：]\s*([A-Z0-9]{8,30})/i,
  ]);
}

export function extractInvoiceAmountWithTax(text: string) {
  const normalized = text.replace(/[ \t]+/g, " ");
  return parseAmount(normalized, [
    /价税合计[\s\S]{0,80}[¥￥]\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
    /价税合计[\s\S]{0,30}小写[\s\S]{0,20}[¥￥]?([0-9,]+(?:\.[0-9]{1,2})?)/,
    /小写[\s\S]{0,20}[¥￥]?([0-9,]+(?:\.[0-9]{1,2})?)/,
    /含税金额[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
  ]);
}

export function extractInvoiceTotals(text: string) {
  const lines = normalizeOcrLines(text);
  const totalLineIndex = lines.findIndex((line) => /合\s*计/.test(line) && !/价税合计/.test(line));
  const totalLine = lines.find((line) => /合\s*计/.test(line) && /[0-9]/.test(line) && !/价税合计/.test(line))
    || (totalLineIndex >= 0 ? [lines[totalLineIndex], lines[totalLineIndex + 1], lines[totalLineIndex + 2]].filter(Boolean).join(" ") : "");
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

export function stripInvoiceItemColumns(line: string) {
  return cleanText(line)
    .replace(/(套|个|件|只|批|吨|千克|公斤|米|平方米|立方米|PCS|SET)[0-9０-９].*$/i, "")
    .replace(/\s+[A-Za-z0-9\-_.#/]{1,30}\s+(套|个|件|只|批|吨|千克|公斤|米|平方米|立方米|PCS|SET)\b.*$/i, "")
    .replace(/\s+(套|个|件|只|批|吨|千克|公斤|米|平方米|立方米|PCS|SET)\b.*$/i, "")
    .replace(/\s+[0-9,]+(?:\.[0-9]+)?\s+[0-9,]+(?:\.[0-9]+)?\s+[0-9,]+(?:\.[0-9]{1,2})?\s+[0-9]{1,2}%.*$/i, "")
    .replace(/\s+[0-9,]+(?:\.[0-9]{1,2})?\s+[0-9]{1,2}%.*$/i, "")
    .replace(/\s+(税率|税额|金额|单价|数量|单位|规格型号).*$/g, "")
    .trim();
}

export function extractInvoiceProductName(text: string) {
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
  const sectionStarItems = starProduct?.[1] ? [normalizeInvoiceProductName(stripInvoiceItemColumns(starProduct[1]))] : [];
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
  const stitchedStarItems = lines
    .map((line, index) => {
      if (!/[*＊]/.test(line)) return "";
      const base = normalizeInvoiceProductName(stripInvoiceItemColumns(line));
      if (!base) return "";
      const suffix = [lines[index + 1], lines[index + 2], lines[index - 1], lines[index - 2]].find(isInvoiceItemNameFragment);
      return suffix && !base.includes(suffix) ? normalizeInvoiceProductName(`${base}${suffix}`) : base;
    })
    .filter(Boolean);
  const merged = [...stitchedStarItems, ...starItems, ...sectionStarItems, ...candidates]
    .map((item) => normalizeInvoiceProductName(item))
    .filter((item) => !isSuspiciousInvoiceProduct(item))
    .filter((item, index, arr) => item && arr.indexOf(item) === index)
    .filter((item, _index, arr) => !arr.some((candidate) => (
      candidate !== item
      && candidate.length > item.length
      && (candidate.startsWith(item) || (!item.startsWith("*") && candidate.includes(item)))
    )));
  return merged.slice(0, 2).join("；");
}

export function extractInvoiceTaxRate(text: string) {
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
    /(13(?:\.0+)?%|9(?:\.0+)?%|6(?:\.0+)?%|0(?:\.0+)?%|免税)/,
    /税率[:：]?\s*(13(?:\.0+)?%|9(?:\.0+)?%|6(?:\.0+)?%|0(?:\.0+)?%|免税)/,
  ]);
}
