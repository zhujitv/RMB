import type { OrderDocumentType } from "../generated/prisma/client.js";
import { businessEntityFieldsFromOrder } from "./business-entities";
import {
  dateToInput,
  isProductSupplierOperatorRole,
  serializeOrderDocument,
} from "./shared";
import {
  SUPPLIER_DOCUMENT_REQUEST_STATUSES,
  SUPPLIER_DOCUMENT_LABELS,
  factoryCostSlotsForSupplierRequest,
  normalizeSupplierReturnDocumentType,
  requiredDocumentTypes,
  type ActorLike,
  type SupplierDocumentRequestRow,
} from "./supplier-document-request-types";
import { supplierDocumentRequestOrderLocked } from "./supplier-document-request-state";
import { FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE } from "./factory-purchase-transition-settlement-values";
import { supplierTaxContractNumberFromJson } from "./supplier-tax-contract-number";
import {
  normalizeSupplierTaxContractDraftValues,
  supplierTaxContractSupplierName,
} from "./supplier-tax-contract-values";

function normalizedTaxContractJson(value: unknown, supplierName: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return normalizeSupplierTaxContractDraftValues(value as Record<string, unknown>, { supplierName });
}

function transitionSettlementIdFromDraft(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const draft = value as Record<string, unknown>;
  if (draft.sourceType !== FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE) return "";
  return String(draft.transitionSettlementId || "").trim();
}

export function serializeSupplierDocumentRequest(
  row: SupplierDocumentRequestRow,
  actor: ActorLike,
) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  const documents = (row.documents || [])
    .filter((document) => requiredTypes.includes(
      normalizeSupplierReturnDocumentType(document.documentType) as OrderDocumentType,
    ))
    .map((document) => serializeSupplierDocument(document));
  const factoryCostSlots = factoryCostSlotsForSupplierRequest(row);
  const orderLocked = supplierDocumentRequestOrderLocked(row.order);
  const canDelete = actor?.role === "管理员" && !orderLocked;
  const taxRefundDocumentCount = documents.filter((document) => (
    document.uploadStatus === "SUCCESS"
  )).length;
  const supplierActor = isProductSupplierOperatorRole(actor?.role);
  const invoiceMatch = row.invoiceMatchJson && typeof row.invoiceMatchJson === "object" && !Array.isArray(row.invoiceMatchJson)
    ? row.invoiceMatchJson as { matched?: unknown; issues?: unknown }
    : null;
  const contractSupplierName = row.supplier ? supplierTaxContractSupplierName(row.supplier) : "";
  const cost = row.order?.costs?.find((item) => item.id === row.costId);
  const transitionSettlementId = transitionSettlementIdFromDraft(row.contractDraft)
    || transitionSettlementIdFromDraft(row.contractApproved)
    || (cost?.sourceType === FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE ? String(cost.sourceId || "").trim() : "");
  const canRevokeTransitionSettlement = actor?.role === "管理员"
    && Boolean(transitionSettlementId)
    && !orderLocked
    && !row.invoiceConfirmedAt
    && row.invoiceMatchStatus !== "CONFIRMED";
  return {
    id: row.id,
    orderId: row.orderId,
    purchaseOrderNo: row.purchaseOrderNo || row.order?.orderNo || "",
    orderNo: row.order?.orderNo || "",
    ...businessEntityFieldsFromOrder(row.order),
    supplierId: row.supplierId,
    supplierName: isProductSupplierOperatorRole(actor?.role)
      ? ""
      : (row.supplier?.supplierName || ""),
    requiredDocumentTypes: requiredTypes,
    requiredDocumentLabels: requiredTypes.map((type) => SUPPLIER_DOCUMENT_LABELS[type] || type),
    factoryCostSlots,
    status: SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(row.status) ? row.status : "待上传",
    dueDate: dateToInput(row.dueDate),
    message: row.message || "",
    templateFileName: row.templateOriginalName || row.templateFileName || "",
    hasTemplate: Boolean(row.templateStorageKey),
    contractNo: row.contractStatus === "PENDING_REVIEW" || row.contractStatus === "REJECTED"
      ? supplierTaxContractNumberFromJson(row.contractDraft, row.contractNo || "")
      : (row.contractNo || ""),
    contractStatus: row.contractStatus || "LEGACY",
    contractRevision: row.contractRevision || 1,
    contractDraft: supplierActor ? null : normalizedTaxContractJson(row.contractDraft, contractSupplierName),
    contractApproved: supplierActor ? null : normalizedTaxContractJson(row.contractApproved, contractSupplierName),
    contractReviewRemark: supplierActor ? "" : (row.contractReviewRemark || ""),
    invoiceMatchStatus: row.invoiceMatchStatus || "NOT_UPLOADED",
    invoiceMatch: supplierActor && invoiceMatch
      ? { matched: Boolean(invoiceMatch.matched), issues: Array.isArray(invoiceMatch.issues) ? invoiceMatch.issues.map(String) : [] }
      : row.invoiceMatchJson,
    invoiceNo: row.invoiceNo || "",
    sendStatus: row.sendStatus || "pending",
    sendError: row.sendError || "",
    sentAt: row.sentAt,
    completedAt: row.completedAt,
    completedByName: isProductSupplierOperatorRole(actor?.role)
      ? ""
      : (row.completedBy?.name || ""),
    requestedByName: isProductSupplierOperatorRole(actor?.role)
      ? ""
      : (row.requestedBy?.name || ""),
    canDelete,
    canRevokeTransitionSettlement,
    transitionSettlementId: canRevokeTransitionSettlement ? transitionSettlementId : "",
    hasTaxRefundDocuments: taxRefundDocumentCount > 0,
    taxRefundDocumentCount,
    documents,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeSupplierDocument(document: unknown) {
  const row = serializeOrderDocument(document);
  return {
    id: row.id,
    orderId: row.orderId,
    costId: row.costId,
    supplierId: row.supplierId,
    factoryDocumentRequestId: row.factoryDocumentRequestId,
    relatedModule: row.relatedModule,
    documentType: row.documentType,
    documentTypeLabel: row.documentTypeLabel,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    displayFileName: row.displayFileName,
    downloadFileName: row.downloadFileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    uploadStatus: row.uploadStatus,
    uploadStatusLabel: row.uploadStatusLabel,
    source: row.source,
    uploadedByName: row.uploadedByName,
    uploadedAt: row.uploadedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
