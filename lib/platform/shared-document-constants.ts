import type { OrderDocumentType } from "../generated/prisma/client.js";
import { PAYMENT_TERM_LABELS } from "./shared-cost-constants";
import { PRODUCT_SUPPLIER_TYPE, PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";

export * from "./shared-document-filenames";

export const PAYMENT_TERM_TYPES = Object.keys(PAYMENT_TERM_LABELS);
export const PAYMENT_TERMS = Object.values(PAYMENT_TERM_LABELS);
export const SUPPLIER_TYPES = [PRODUCT_SUPPLIER_TYPE, "物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", "其他供应商"];
export const SUPPLIER_STATUSES = ["启用", "停用"];
export const EXCHANGE_RATE_SOURCES = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
export const EXCHANGE_RATE_TYPES = ["现汇买入价", "现汇卖出价", "中间价"];
export const EXPORT_DOCUMENT_TYPES: OrderDocumentType[] = ["CUSTOMS_ENTRY_FORM", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY", "BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "EXPORT_INVOICE"];
export const SALES_DOCUMENT_TYPES: OrderDocumentType[] = ["SALES_CONTRACT"];
export const SALESPERSON_TAX_REFUND_UPLOAD_DOCUMENT_TYPES: OrderDocumentType[] = ["BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "SALES_CONTRACT"];
export const DOMESTIC_LOGISTICS_DOCUMENT_TYPES: OrderDocumentType[] = ["CUSTOMS_ENTRY_FORM", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY"];
export const TAX_EXPORT_DOCUMENT_TYPES = [
  ...EXPORT_DOCUMENT_TYPES.filter((type) => !DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(type)),
  ...SALES_DOCUMENT_TYPES,
];
export const SUPPLIER_DOCUMENT_TYPES: OrderDocumentType[] = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];
export const ORDER_DOCUMENT_TYPES: OrderDocumentType[] = [...EXPORT_DOCUMENT_TYPES, ...SALES_DOCUMENT_TYPES, ...SUPPLIER_DOCUMENT_TYPES];
export const TAX_REFUND_SUPPLIER_TYPES = PRODUCT_SUPPLIER_TYPES;
export const UPLOAD_STATUSES = ["PENDING", "UPLOADING", "SUCCESS", "FAILED"];
export const TAX_REFUND_STATUS_LABELS = {
  NOT_READY: "资料不完整",
  READY: "资料完整待提交",
  PROBLEM: "资料异常",
  SUBMITTED: "已提交退税",
  REFUND_RECEIVED: "已提交退税",
};
export const TAX_REFUND_STATUSES = Object.keys(TAX_REFUND_STATUS_LABELS);
export const CUSTOMS_PARSE_STATUSES = ["SUCCESS", "PARTIAL", "FAILED", "MANUAL"];
export const CUSTOMS_PARSE_STATUS_LABELS = {
  SUCCESS: "成功",
  PARTIAL: "部分识别",
  FAILED: "失败",
  MANUAL: "人工修改",
};
export const CUSTOMS_PARSE_SOURCE_LABELS = {
  AUTO_PDF_TEXT: "PDF文本自动识别",
  MANUAL: "手工填写",
};
export const ACTIVE_TAX_REFUND_STATUSES = [
  "NOT_READY",
  "READY",
  "PROBLEM",
];
export const ARCHIVE_TAX_REFUND_STATUSES = ["SUBMITTED", "REFUND_RECEIVED", "COMPLETED", "ARCHIVED"];
export const CUSTOMS_FILE_READ_FAILED_MESSAGE = "报关单文件读取失败，请重新上传或联系管理员。";
export const SHIPPING_DOCUMENT_TYPE_KEYS = ["commercialInvoice", "packingList", "customsDeclaration"];
export const DEFAULT_SHIPPING_DOCUMENT_TYPES = [...SHIPPING_DOCUMENT_TYPE_KEYS];
export const SHIPPING_DOCUMENT_TYPE_CONFIG = {
  commercialInvoice: { documentType: "COMMERCIAL_INVOICE", label: "商业发票", emailLabel: "Commercial Invoice" },
  packingList: { documentType: "PACKING_LIST", label: "装箱单", emailLabel: "Packing List" },
  customsDeclaration: { documentType: "CUSTOMS_ENTRY_FORM", label: "报关单", emailLabel: "Customs Declaration" },
};
export const SHIPPING_NOTIFICATION_STATUS_LABELS = {
  NOT_ENABLED: "未启用",
  WAITING_DOCUMENTS: "等待资料完整",
  AUTO_SENT: "已自动发送",
  FAILED: "发送失败",
  MANUAL_SENT: "已手动发送",
  CANCELLED: "已取消",
};
export const SHIPPING_EMAIL_LANGUAGE_LABELS = {
  EN: "English",
  ZH: "中文",
  RU: "Русский",
  en: "English",
  zh: "中文",
  ru: "Русский",
};

export function defaultClearanceEmailLanguage(country: unknown = "") {
  return /俄罗斯|russia|рф/i.test(String(country || "")) ? "RU" : "EN";
}

export function normalizeClearanceEmailLanguage(value: unknown = "", country: unknown = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (["EN", "ZH", "CN", "RU"].includes(normalized)) return normalized === "CN" ? "ZH" : normalized;
  return defaultClearanceEmailLanguage(country);
}

export function normalizeUploadSource(uploadSource: unknown = "", relatedModule: unknown = "") {
  const value = String(uploadSource || "").trim().toUpperCase();
  if (["SCAN", "EMAIL", "MANUAL", "API"].includes(value)) return value;
  return relatedModule === "SUPPLIER" ? "MANUAL" : "SCAN";
}

export function normalizeShippingDocumentTypes(value: unknown) {
  const rows = Array.isArray(value) ? value : String(value || "").split(/[,\n;；，]+/);
  return rows.map((item) => String(item || "").trim()).filter((item, index, arr) => SHIPPING_DOCUMENT_TYPE_KEYS.includes(item) && arr.indexOf(item) === index);
}
