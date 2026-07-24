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

export function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanText(match?.[1]);
    if (value) return value;
  }
  return "";
}

export function moneyValue(value: unknown) {
  const text = String(value || "")
    .replace(/[人民币¥￥,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseAmount(text: string, patterns: RegExp[]) {
  return moneyValue(firstMatch(text, patterns));
}

export function parseDateText(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  const normalized = value
    .replace(/[年月.]/g, "-")
    .replace(/[日号]/g, "")
    .replace(/--+/g, "-")
    .trim();
  return normalized || value;
}

export function normalizeOcrLines(text: string) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean);
}

export function stripInvoiceFieldNoise(value: unknown) {
  return cleanText(value)
    .replace(/^(名称|纳税人识别号|地址、电话|开户行及账号|开户行账号)[:：]\s*/g, "")
    .replace(/\s+名称[:：].*$/g, "")
    .replace(/\s*(纳税人识别号|地址、电话|开户行及账号|开户行账号)[:：].*$/g, "")
    .replace(/\s*(密码区|货物或应税劳务|项目名称|规格型号|单位|数量|单价|金额|税率|税额).*$/g, "")
    .trim();
}

export function inlineInvoiceText(text: string) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const COMPANY_NAME_PATTERN = /[\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,70}?(?:集团股份有限公司|股份有限公司|有限责任公司|集团有限公司|有限公司|公司|工厂|厂|中心|合作社|企业|商行|经营部)/g;

export function companyNameCandidates(value: unknown) {
  const text = cleanText(value);
  if (!text) return [];
  return Array.from(text.matchAll(COMPANY_NAME_PATTERN))
    .map((match) => stripInvoiceFieldNoise(match[0]))
    .filter(Boolean)
    .filter((name) => !/(银行|支行|税务局|海关|发票|购买方|销售方|纳税人|地址|电话|开户|账号|项目|金额|税率|税额)/.test(name));
}

export function isSuspiciousInvoiceParty(value: unknown) {
  const text = cleanText(value);
  if (!text) return false;
  if (/(名称|纳税人识别号|地址|电话|开户行|账号|密码区|项目名称|货物或应税劳务|价税合计|税额|税率)[:：]/.test(text)) return true;
  if (!/(公司|集团|厂|中心|合作社|企业|商行|经营部)/.test(text)) return true;
  const candidates = Array.from(new Set(companyNameCandidates(text)));
  if (!candidates.length) return true;
  return candidates.length > 1;
}

export function isSuspiciousInvoiceProduct(value: unknown) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^[信信息方买售购销\s]+$/.test(text)) return true;
  const companyLikeCount = (text.match(/(?:公司|集团|厂|中心|合作社|企业|商行|经营部)/g) || []).length;
  if (companyLikeCount > 0) return true;
  if (/[A-Z0-9]{15,30}/i.test(text)) return true;
  return /(纳税人识别号|统一社会信用代码|地址|电话|开户行|账号|备注|收款人|复核|开票人|密码区|价税合计|发票号码|开票日期|购买方|销售方|¥|￥)/.test(text);
}

export function structuredText(fields: Record<string, unknown> | null | undefined, key: string) {
  return cleanText(fields?.[key]);
}

export function structuredAmount(fields: Record<string, unknown> | null | undefined, key: string) {
  return moneyValue(fields?.[key]);
}

export function normalizeInvoiceProductName(value: unknown) {
  return cleanText(value)
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+(规格型号|单位|数量|单价|金额|税率|税额).*$/g, "")
    .replace(/\s+[0-9,]+(?:\.[0-9]+)?(?:\s+[0-9,]+(?:\.[0-9]+)?){1,}\s*(?:13%|9%|6%|0%|免税)?.*$/g, "")
    .replace(/(套|只|批|吨|千克|公斤|米|平方米|立方米|PCS|SET)$/i, "")
    .trim();
}

export function structuredPartyFallback(fields: Record<string, unknown> | null | undefined, key: string) {
  const raw = structuredText(fields, key);
  if (!raw || companyNameCandidates(raw).length > 1) return "";
  const value = stripInvoiceFieldNoise(raw);
  return value && !isSuspiciousInvoiceParty(value) ? stripInvoiceFieldNoise(value) : "";
}

export function structuredProductFallback(fields: Record<string, unknown> | null | undefined) {
  const value = structuredText(fields, "productName");
  return value && !isSuspiciousInvoiceProduct(value) ? normalizeInvoiceProductName(value) : "";
}
