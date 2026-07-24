import { LOGISTICS_INVOICE_ENGLISH_LABELS, normalizedCostType } from "./shared-cost-constants";

type CostLike = { costType?: string | null; [key: string]: unknown };
type TransportItemLike = { containerNo?: string | null; [key: string]: unknown };
type DomesticLogisticsInfoLike = { transportItems?: TransportItemLike[] | null; [key: string]: unknown };
type OrderDocumentLike = {
  id?: string | null; documentType?: string | null; relatedModule?: string | null;
  supplierId?: string | null; costId?: string | null; costType?: string | null; cost?: CostLike | null;
  createdAt?: string | number | Date | null; deletedAt?: string | number | Date | null; order?: OrderLike | null;
  documentNo?: string | null; customsDeclarationNo?: string | null; customsDeclarationNumber?: string | null;
  blNo?: string | null; billOfLadingNo?: string | null; orderNo?: string | null;
  originalFileName?: string | null; originalFilename?: string | null; originalName?: string | null;
  fileName?: string | null; standardFilename?: string | null;
};
type OrderLike = {
  id?: string | null; orderNo?: string | null; blNo?: string | null; billOfLadingNo?: string | null;
  documents?: OrderDocumentLike[] | null; domesticLogisticsInfos?: DomesticLogisticsInfoLike[] | null;
};
type DocumentContextLike = {
  relatedModule?: string | null; supplierId?: string | null; costId?: string | null;
  costType?: string | null; cost?: CostLike | null;
};

export const ORDER_DOCUMENT_LABELS = {
  CUSTOMS_ENTRY_FORM: "报关单", RELEASE_NOTICE: "放行通知书", CUSTOMS_POWER_OF_ATTORNEY: "报关委托书",
  BILL_OF_LADING: "提单", COMMERCIAL_INVOICE: "商业发票", PACKING_LIST: "装箱单", SALES_CONTRACT: "销售合同",
  EXPORT_INVOICE: "出口发票", SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同", SUPPLIER_INVOICE: "工厂增值税发票",
};
export const ORDER_DOCUMENT_ENGLISH_LABELS = {
  CUSTOMS_ENTRY_FORM: "Customs-Declaration", RELEASE_NOTICE: "Customs-Release-Notice",
  CUSTOMS_POWER_OF_ATTORNEY: "Customs-Authorization", BILL_OF_LADING: "Bill-of-Lading",
  COMMERCIAL_INVOICE: "Commercial-Invoice", PACKING_LIST: "Packing-List", SALES_CONTRACT: "Sales-Contract",
  EXPORT_INVOICE: "Export-Invoice", SUPPLIER_PURCHASE_CONTRACT: "Factory-Contract", SUPPLIER_INVOICE: "Factory-Invoice",
};
export const CUSTOMS_DECLARATION_DOCUMENT_TYPE_ALIASES = new Set(["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION", "报关单"]);

export function normalizeOrderDocumentType(documentType: unknown = "") {
  const value = String(documentType || "").trim();
  return CUSTOMS_DECLARATION_DOCUMENT_TYPE_ALIASES.has(value) ? "CUSTOMS_ENTRY_FORM" : value;
}

export function isCustomsDeclarationDocumentType(documentType: unknown = "") {
  return normalizeOrderDocumentType(documentType) === "CUSTOMS_ENTRY_FORM";
}

export function sanitizeFilenamePart(value: unknown = "", fallback = "Document") {
  const cleaned = String(value || "").normalize("NFKD").replace(/[\\/\s]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "").replace(/-+/g, "-").replace(/[._-]+$/g, "").replace(/^[._-]+/g, "");
  return cleaned || fallback;
}

export function baseOrderDocumentNo(order: OrderLike = {}) {
  return sanitizeFilenamePart(order.blNo || order.billOfLadingNo || order.orderNo || order.id || "Order", "Order");
}

export function englishDocumentTypeLabel(documentType = "", context: DocumentContextLike = {}) {
  const normalizedType = normalizeOrderDocumentType(documentType);
  if (normalizedType === "SUPPLIER_INVOICE") {
    const costType = normalizedCostType(context.cost?.costType || context.costType || "");
    if (LOGISTICS_INVOICE_ENGLISH_LABELS[costType]) return LOGISTICS_INVOICE_ENGLISH_LABELS[costType];
    if (context.relatedModule === "SUPPLIER" || context.supplierId || context.costId) return "Factory-Invoice";
  }
  return (ORDER_DOCUMENT_ENGLISH_LABELS as Record<string, string>)[normalizedType] || "Other-Document";
}

export function generateStandardFilename(order: OrderLike = {}, documentType = "", index = 1, context: DocumentContextLike = {}) {
  const suffix = Number(index || 1) > 1 ? `-${Number(index)}` : "";
  return `${baseOrderDocumentNo(order)}_${sanitizeFilenamePart(englishDocumentTypeLabel(documentType, context), "Other-Document")}${suffix}.pdf`;
}

export function documentStandardTypeKey(document: OrderDocumentLike = {}) {
  return englishDocumentTypeLabel(document.documentType || "", {
    relatedModule: document.relatedModule, supplierId: document.supplierId, costId: document.costId,
    costType: document.cost?.costType || document.costType, cost: document.cost,
  });
}

export function orderDocumentsForStandardNaming(order: OrderLike = {}) {
  return (order.documents || []).filter((document) => !document.deletedAt).slice().sort((left, right) => {
    const typeCompare = String(documentStandardTypeKey(left)).localeCompare(String(documentStandardTypeKey(right)));
    return typeCompare || new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
  });
}

export function standardFilenameIndexForDocument(order: OrderLike = {}, document: OrderDocumentLike = {}) {
  const sameType = orderDocumentsForStandardNaming(order)
    .filter((item) => documentStandardTypeKey(item) === documentStandardTypeKey(document));
  const index = sameType.findIndex((item) => item.id === document.id);
  return index >= 0 ? index + 1 : sameType.length + 1;
}

export function standardFilenameForDocument(document: OrderDocumentLike = {}, orderOverride: OrderLike | null = null) {
  const order = orderOverride || document.order || {};
  return generateStandardFilename(order, document.documentType || "", standardFilenameIndexForDocument(order, document), {
    relatedModule: document.relatedModule, supplierId: document.supplierId, costId: document.costId,
    costType: document.cost?.costType || document.costType, cost: document.cost,
  });
}

function firstNonEmptyText(...values: unknown[]) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function documentReferenceNo(document: OrderDocumentLike = {}) {
  const order = document.order || {};
  const transportItems = (order.domesticLogisticsInfos || []).flatMap((info) => Array.isArray(info.transportItems) ? info.transportItems : []);
  const firstContainerNo = transportItems.map((item) => item.containerNo).find(Boolean) || "";
  return firstNonEmptyText(document.documentNo, document.customsDeclarationNo, document.customsDeclarationNumber,
    normalizeOrderDocumentType(document.documentType || "") === "CUSTOMS_ENTRY_FORM" ? firstContainerNo : "",
    order.blNo, order.billOfLadingNo, document.blNo, document.billOfLadingNo, order.orderNo, document.orderNo, document.id, "文件");
}

export function ensurePdfFileName(fileName = "document.pdf") {
  const cleaned = String(fileName || "").replace(/[\u0000-\u001f\u007f\r\n"]/g, "_").replace(/[\\/:*?<>|]+/g, "_").trim();
  const normalized = cleaned || "document.pdf";
  return /\.pdf$/i.test(normalized) ? normalized : `${normalized}.pdf`;
}

export function generatedOrderDocumentFileName(document: OrderDocumentLike = {}) {
  const documentType = normalizeOrderDocumentType(document.documentType || "");
  const label = (ORDER_DOCUMENT_LABELS as Record<string, string>)[documentType] || documentType || "单证";
  return ensurePdfFileName(`${label}-${documentReferenceNo(document)}`);
}

export function preferredOrderDocumentFileName(document: OrderDocumentLike = {}) {
  return ensurePdfFileName(firstNonEmptyText(document.originalFileName, document.originalFilename, document.originalName,
    document.fileName, document.standardFilename, generatedOrderDocumentFileName(document)));
}

export function asciiContentDispositionFileName(fileName = "document.pdf") {
  const fallback = ensurePdfFileName(fileName).normalize("NFKD").replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\r\n"\\/:*?<>|;]+/g, "_").trim();
  return ensurePdfFileName(fallback || "document.pdf");
}

export function pdfContentDispositionHeader(disposition = "inline", fileName = "document.pdf") {
  const normalizedDisposition = disposition === "attachment" ? "attachment" : "inline";
  const safeFileName = ensurePdfFileName(fileName);
  return `${normalizedDisposition}; filename="${asciiContentDispositionFileName(safeFileName)}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`;
}

export async function nextStandardFilenameForUpload(order: OrderLike = {}, documentType = "", context: DocumentContextLike = {}) {
  const existing = orderDocumentsForStandardNaming(order);
  const probe = { id: `__new__${Date.now()}`, documentType, relatedModule: context.relatedModule,
    supplierId: context.supplierId, costId: context.costId, cost: context.cost || (context.costType ? { costType: context.costType } : null), createdAt: new Date() };
  const sameTypeCount = existing.filter((item) => documentStandardTypeKey(item) === documentStandardTypeKey(probe)).length;
  return generateStandardFilename(order, documentType, sameTypeCount + 1, context);
}

export async function resolveStandardFilenameForPersistedDocument(document: OrderDocumentLike = {}) {
  if (!document) return "";
  const order = document.order || {};
  return standardFilenameForDocument(document, { ...order, documents: order.documents || (document.id ? [document] : []) });
}
