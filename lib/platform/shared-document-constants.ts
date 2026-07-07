import type { OrderDocumentType } from "../generated/prisma/client.js";
import { LOGISTICS_INVOICE_ENGLISH_LABELS, PAYMENT_TERM_LABELS, normalizedCostType } from "./shared-cost-constants";
import { PRODUCT_SUPPLIER_TYPE, PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";

type CostLike = {
  costType?: string | null;
  [key: string]: unknown;
};

type TransportItemLike = {
  containerNo?: string | null;
  [key: string]: unknown;
};

type DomesticLogisticsInfoLike = {
  transportItems?: TransportItemLike[] | null;
  [key: string]: unknown;
};

type OrderDocumentLike = {
  id?: string | null;
  documentType?: string | null;
  relatedModule?: string | null;
  supplierId?: string | null;
  costId?: string | null;
  costType?: string | null;
  cost?: CostLike | null;
  createdAt?: string | number | Date | null;
  deletedAt?: string | number | Date | null;
  order?: OrderLike | null;
  documentNo?: string | null;
  customsDeclarationNo?: string | null;
  customsDeclarationNumber?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  orderNo?: string | null;
  originalFileName?: string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  fileName?: string | null;
  standardFilename?: string | null;
};

type OrderLike = {
  id?: string | null;
  orderNo?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  documents?: OrderDocumentLike[] | null;
  domesticLogisticsInfos?: DomesticLogisticsInfoLike[] | null;
};

type DocumentContextLike = {
  relatedModule?: string | null;
  supplierId?: string | null;
  costId?: string | null;
  costType?: string | null;
  cost?: CostLike | null;
};

export const PAYMENT_TERM_TYPES = Object.keys(PAYMENT_TERM_LABELS);
export const PAYMENT_TERMS = Object.values(PAYMENT_TERM_LABELS);
export const SUPPLIER_TYPES = [PRODUCT_SUPPLIER_TYPE, "物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", "其他供应商"];
export const SUPPLIER_STATUSES = ["启用", "停用"];
export const EXCHANGE_RATE_SOURCES = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
export const EXCHANGE_RATE_TYPES = ["现汇买入价", "现汇卖出价", "中间价"];
export const ORDER_DOCUMENT_LABELS = {
  CUSTOMS_ENTRY_FORM: "报关单",
  RELEASE_NOTICE: "放行通知书",
  CUSTOMS_POWER_OF_ATTORNEY: "报关委托书",
  BILL_OF_LADING: "提单",
  COMMERCIAL_INVOICE: "商业发票",
  PACKING_LIST: "装箱单",
  SALES_CONTRACT: "销售合同",
  EXPORT_INVOICE: "出口发票",
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
};
export const ORDER_DOCUMENT_ENGLISH_LABELS = {
  CUSTOMS_ENTRY_FORM: "Customs-Declaration",
  RELEASE_NOTICE: "Customs-Release-Notice",
  CUSTOMS_POWER_OF_ATTORNEY: "Customs-Authorization",
  BILL_OF_LADING: "Bill-of-Lading",
  COMMERCIAL_INVOICE: "Commercial-Invoice",
  PACKING_LIST: "Packing-List",
  SALES_CONTRACT: "Sales-Contract",
  EXPORT_INVOICE: "Export-Invoice",
  SUPPLIER_PURCHASE_CONTRACT: "Factory-Contract",
  SUPPLIER_INVOICE: "Factory-Invoice",
};
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
export const CUSTOMS_DECLARATION_DOCUMENT_TYPE_ALIASES = new Set(["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION", "报关单"]);
export const TAX_REFUND_SUPPLIER_TYPES = PRODUCT_SUPPLIER_TYPES;
export const UPLOAD_STATUSES = ["PENDING", "UPLOADING", "SUCCESS", "FAILED"];
export const TAX_REFUND_STATUS_LABELS = {
  NOT_READY: "资料不完整",
  READY: "资料完整待提交",
  PROBLEM: "资料异常",
  SUBMITTED: "已提交退税",
  REFUND_RECEIVED: "已收到退税款",
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

export function normalizeOrderDocumentType(documentType: unknown = "") {
  const value = String(documentType || "").trim();
  return CUSTOMS_DECLARATION_DOCUMENT_TYPE_ALIASES.has(value) ? "CUSTOMS_ENTRY_FORM" : value;
}

export function isCustomsDeclarationDocumentType(documentType: unknown = "") {
  return normalizeOrderDocumentType(documentType) === "CUSTOMS_ENTRY_FORM";
}

export function sanitizeFilenamePart(value: unknown = "", fallback = "Document") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\\/\s]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/[._-]+$/g, "")
    .replace(/^[._-]+/g, "");
  return cleaned || fallback;
}

export function baseOrderDocumentNo(order: OrderLike = {}) {
  return sanitizeFilenamePart(order.blNo || order.billOfLadingNo || order.orderNo || order.id || "Order", "Order");
}

export function englishDocumentTypeLabel(documentType: string = "", context: DocumentContextLike = {}) {
  const normalizedType = normalizeOrderDocumentType(documentType);
  if (normalizedType === "SUPPLIER_INVOICE") {
    const costType = normalizedCostType(context.cost?.costType || context.costType || "");
    if (LOGISTICS_INVOICE_ENGLISH_LABELS[costType]) return LOGISTICS_INVOICE_ENGLISH_LABELS[costType];
    if (context.relatedModule === "SUPPLIER" || context.supplierId || context.costId) return "Factory-Invoice";
  }
  return (ORDER_DOCUMENT_ENGLISH_LABELS as Record<string, string>)[normalizedType] || "Other-Document";
}

export function generateStandardFilename(order: OrderLike = {}, documentType = "", index = 1, context: DocumentContextLike = {}) {
  const baseNo = baseOrderDocumentNo(order);
  const englishType = sanitizeFilenamePart(englishDocumentTypeLabel(documentType, context), "Other-Document");
  const suffix = Number(index || 1) > 1 ? `-${Number(index)}` : "";
  return `${baseNo}_${englishType}${suffix}.pdf`;
}

export function documentStandardTypeKey(document: OrderDocumentLike = {}) {
  return englishDocumentTypeLabel(document.documentType || "", {
    relatedModule: document.relatedModule,
    supplierId: document.supplierId,
    costId: document.costId,
    costType: document.cost?.costType || document.costType,
    cost: document.cost,
  });
}

export function orderDocumentsForStandardNaming(order: OrderLike = {}) {
  return (order.documents || [])
    .filter((document) => !document.deletedAt)
    .slice()
    .sort((left, right) => {
      const typeCompare = String(documentStandardTypeKey(left)).localeCompare(String(documentStandardTypeKey(right)));
      if (typeCompare !== 0) return typeCompare;
      return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    });
}

export function standardFilenameIndexForDocument(order: OrderLike = {}, document: OrderDocumentLike = {}) {
  const list = orderDocumentsForStandardNaming(order);
  const sameType = list.filter((item) => documentStandardTypeKey(item) === documentStandardTypeKey(document));
  const index = sameType.findIndex((item) => item.id === document.id);
  return index >= 0 ? index + 1 : sameType.length + 1;
}

export function standardFilenameForDocument(document: OrderDocumentLike = {}, orderOverride: OrderLike | null = null) {
  const order = orderOverride || document.order || {};
  return generateStandardFilename(order, document.documentType || "", standardFilenameIndexForDocument(order, document), {
    relatedModule: document.relatedModule,
    supplierId: document.supplierId,
    costId: document.costId,
    costType: document.cost?.costType || document.costType,
    cost: document.cost,
  });
}

function firstNonEmptyText(...values: unknown[]) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function documentReferenceNo(document: OrderDocumentLike = {}) {
  const order = document.order || {};
  const transportItems = (order.domesticLogisticsInfos || [])
    .flatMap((info) => Array.isArray(info.transportItems) ? info.transportItems : []);
  const firstContainerNo = transportItems.map((item) => item.containerNo).find(Boolean) || "";
  const documentType = normalizeOrderDocumentType(document.documentType || "");
  return firstNonEmptyText(
    document.documentNo,
    document.customsDeclarationNo,
    document.customsDeclarationNumber,
    documentType === "CUSTOMS_ENTRY_FORM" ? firstContainerNo : "",
    order.blNo,
    order.billOfLadingNo,
    document.blNo,
    document.billOfLadingNo,
    order.orderNo,
    document.orderNo,
    document.id,
    "文件",
  );
}

export function ensurePdfFileName(fileName = "document.pdf") {
  const cleaned = String(fileName || "")
    .replace(/[\u0000-\u001f\u007f\r\n"]/g, "_")
    .replace(/[\\/:*?<>|]+/g, "_")
    .trim();
  const normalized = cleaned || "document.pdf";
  return /\.pdf$/i.test(normalized) ? normalized : `${normalized}.pdf`;
}

export function generatedOrderDocumentFileName(document: OrderDocumentLike = {}) {
  const documentType = normalizeOrderDocumentType(document.documentType || "");
  const label = (ORDER_DOCUMENT_LABELS as Record<string, string>)[documentType] || documentType || "单证";
  return ensurePdfFileName(`${label}-${documentReferenceNo(document)}`);
}

export function preferredOrderDocumentFileName(document: OrderDocumentLike = {}) {
  return ensurePdfFileName(firstNonEmptyText(
    document.originalFileName,
    document.originalFilename,
    document.originalName,
    document.fileName,
    document.standardFilename,
    generatedOrderDocumentFileName(document),
  ));
}

export function asciiContentDispositionFileName(fileName = "document.pdf") {
  const fallback = ensurePdfFileName(fileName)
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\r\n"\\/:*?<>|;]+/g, "_")
    .trim();
  return ensurePdfFileName(fallback || "document.pdf");
}

export function pdfContentDispositionHeader(disposition = "inline", fileName = "document.pdf") {
  const normalizedDisposition = disposition === "attachment" ? "attachment" : "inline";
  const safeFileName = ensurePdfFileName(fileName);
  const asciiFileName = asciiContentDispositionFileName(safeFileName);
  return `${normalizedDisposition}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`;
}

export async function nextStandardFilenameForUpload(order: OrderLike = {}, documentType = "", context: DocumentContextLike = {}) {
  const existing = orderDocumentsForStandardNaming(order);
  const probe = {
    id: `__new__${Date.now()}`,
    documentType,
    relatedModule: context.relatedModule,
    supplierId: context.supplierId,
    costId: context.costId,
    cost: context.cost || (context.costType ? { costType: context.costType } : null),
    createdAt: new Date(),
  };
  const sameTypeCount = existing.filter((item) => documentStandardTypeKey(item) === documentStandardTypeKey(probe)).length;
  return generateStandardFilename(order, documentType, sameTypeCount + 1, context);
}

export async function resolveStandardFilenameForPersistedDocument(document: OrderDocumentLike = {}) {
  if (!document) return "";
  const order = document.order || {};
  return standardFilenameForDocument(document, {
    ...order,
    documents: order.documents || (document.id ? [document] : []),
  });
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
