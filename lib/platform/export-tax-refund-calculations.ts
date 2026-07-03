import { codedError } from "./shared-base-utils";

type AuditRequestLike = unknown;
type ActorLike = { id?: string | null; role?: string | null } | null | undefined;

function taxRefundOcrCalculationDisabled() {
  return codedError(
    "退税资料 OCR 和退税计算功能已停用，请使用资料完整度和人工维护流程。",
    410,
    "TAX_REFUND_OCR_CALC_DISABLED",
  );
}

export function serializeCustomsDeclarationItem(row: Record<string, unknown> = {}) {
  return {
    id: String(row.id || ""),
    documentId: String(row.documentId || ""),
    declarationNo: String(row.declarationNo || ""),
    declarationDate: row.declarationDate || null,
    exportDate: row.exportDate || null,
    hsCode: String(row.hsCode || ""),
    productName: String(row.productName || ""),
    quantity: row.quantity == null ? null : Number(row.quantity),
    unit: String(row.unit || ""),
    totalAmount: row.totalAmount == null ? null : Number(row.totalAmount),
    tradeTerm: String(row.tradeTerm || ""),
    currency: String(row.currency || ""),
    fobAmount: row.fobAmount == null ? null : Number(row.fobAmount),
    exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
    fobAmountCny: row.fobAmountCny == null ? null : Number(row.fobAmountCny),
    confirmationStatus: String(row.confirmationStatus || ""),
    source: String(row.source || ""),
    sortOrder: Number(row.sortOrder || 0),
  };
}

export function isUsableCustomsDeclarationItem(row: Record<string, unknown> = {}) {
  return Boolean(row && !row.deletedAt && String(row.productName || row.hsCode || "").trim());
}

export async function extractCustomsDeclarationItemsFromDocument(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  documentId: string,
) {
  void request;
  void actor;
  void orderId;
  void documentId;
  throw taxRefundOcrCalculationDisabled();
}

export async function syncCustomsDeclarationItemsFromOcrRawResult(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  documentId: string,
) {
  void request;
  void actor;
  void orderId;
  void documentId;
  throw taxRefundOcrCalculationDisabled();
}

export async function saveCustomsDeclarationItems(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  items: Array<Record<string, unknown>>,
) {
  void request;
  void actor;
  void orderId;
  void items;
  throw taxRefundOcrCalculationDisabled();
}

export async function recalculateExportTaxRefund(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  void request;
  void actor;
  void orderId;
  throw taxRefundOcrCalculationDisabled();
}

export async function getExportTaxRefundCalculationSummary(orderId: string) {
  void orderId;
  return {
    customsDeclarationItems: [],
    exportTaxRefundCalculations: [],
    exportTaxRefundSummary: {
      estimatedRefundAmount: 0,
      calculationStatus: "",
      abnormalReasons: [],
    },
  };
}
