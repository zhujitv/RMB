import styles from "../../WorkspaceShell.module.css";
import {
  SALESPERSON_TAX_REFUND_UPLOAD_TYPES,
  TAX_CUSTOMS_UPLOAD_TYPES,
  TAX_EXPORT_UPLOAD_TYPES,
  TAX_REFUND_STATUS_OPTIONS,
  type TaxDocument,
  type TaxRefundDetail,
  type TaxRefundRow,
  type UploadScope,
} from "./model";

export function taxRowStatus(row: TaxRefundRow) {
  if (row.refundStatus) return row.refundStatus;
  if (row.taxRefundStatus) return row.taxRefundStatus;
  const completeness = row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  return total > 0 && completed >= total ? "READY" : "NOT_READY";
}

export function taxRefundRowPatchFromDetail(detail: Partial<TaxRefundDetail>) {
  const patch: Partial<TaxRefundRow> = {};
  if (detail.orderNo !== undefined) patch.orderNo = detail.orderNo;
  if (detail.blNo !== undefined) patch.blNo = detail.blNo;
  if (detail.billOfLadingNo !== undefined) patch.billOfLadingNo = detail.billOfLadingNo;
  if (detail.billOfLadingNumbers !== undefined) patch.billOfLadingNumbers = detail.billOfLadingNumbers;
  if (detail.customerName !== undefined) patch.customerName = detail.customerName;
  if (detail.customerFullName !== undefined) patch.customerFullName = detail.customerFullName;
  if (detail.customerShortName !== undefined) patch.customerShortName = detail.customerShortName;
  if (detail.businessEntityId !== undefined) patch.businessEntityId = detail.businessEntityId;
  if (detail.businessEntityName !== undefined) patch.businessEntityName = detail.businessEntityName;
  if (detail.businessEntityShortName !== undefined) patch.businessEntityShortName = detail.businessEntityShortName;
  if (detail.businessEntityDisplayName !== undefined) patch.businessEntityDisplayName = detail.businessEntityDisplayName;
  if (detail.businessEntityNameSnapshot !== undefined) patch.businessEntityNameSnapshot = detail.businessEntityNameSnapshot;
  if (detail.currency !== undefined) patch.currency = detail.currency;
  if (detail.customsDeclarationNo !== undefined) patch.customsDeclarationNo = detail.customsDeclarationNo;
  if (detail.customsDeclarationDate !== undefined) patch.customsDeclarationDate = detail.customsDeclarationDate;
  if (detail.declarationDate !== undefined) patch.declarationDate = detail.declarationDate;
  if (detail.documentCompleteness !== undefined) patch.documentCompleteness = detail.documentCompleteness;
  if (detail.overallCompleteness !== undefined) patch.overallCompleteness = detail.overallCompleteness;
  if (detail.completenessUpdatedAt !== undefined) patch.completenessUpdatedAt = detail.completenessUpdatedAt;
  if (detail.completenessIssuesSummary !== undefined) patch.completenessIssuesSummary = detail.completenessIssuesSummary;
  if (detail.refundStatus !== undefined) patch.refundStatus = detail.refundStatus;
  if (detail.taxRefundStatus !== undefined) patch.taxRefundStatus = detail.taxRefundStatus;
  if (detail.taxRefundStatusLabel !== undefined) patch.taxRefundStatusLabel = detail.taxRefundStatusLabel;
  if (detail.taxArchived !== undefined) patch.taxArchived = detail.taxArchived;
  if (detail.taxRefundArchivedByName !== undefined) patch.taxRefundArchivedByName = detail.taxRefundArchivedByName;
  if (detail.taxRefundArchivedAt !== undefined) patch.taxRefundArchivedAt = detail.taxRefundArchivedAt;
  if (detail.taxRefundArchiveRemark !== undefined) patch.taxRefundArchiveRemark = detail.taxRefundArchiveRemark;
  if (detail.taxSubmittedByName !== undefined) patch.taxSubmittedByName = detail.taxSubmittedByName;
  if (detail.taxSubmittedAt !== undefined) patch.taxSubmittedAt = detail.taxSubmittedAt;
  return patch;
}

export function customsEntryDocuments(documents: TaxDocument[]) {
  return latestTaxDocument(documents.filter((document) => (
    document.documentType === "CUSTOMS_ENTRY_FORM" && document.uploadStatus === "SUCCESS"
  )));
}

export function latestTaxDocument(documents: TaxDocument[]) {
  const latest = documents.slice().sort((left, right) => (
    new Date(right.uploadedAt || 0).getTime() - new Date(left.uploadedAt || 0).getTime()
  ))[0];
  return latest ? [latest] : [];
}

export function canUploadTaxDocument(role: string, canWriteDocuments: boolean, documentType: string, readOnly?: boolean) {
  if (readOnly || !canWriteDocuments) return false;
  if (role === "业务员") return SALESPERSON_TAX_REFUND_UPLOAD_TYPES.has(documentType);
  if (documentType === "EXPORT_INVOICE") return ["管理员", "财务"].includes(role);
  if (TAX_CUSTOMS_UPLOAD_TYPES.some((type) => type.value === documentType)) {
    return ["管理员", "业务员", "物流供应商", "物流资料录入员"].includes(role);
  }
  if (TAX_EXPORT_UPLOAD_TYPES.some((type) => type.value === documentType)) return ["管理员", "业务员"].includes(role);
  return true;
}

export function canDeleteTaxDocument(canWriteDocuments: boolean, readOnly?: boolean) {
  return Boolean(canWriteDocuments && !readOnly);
}

export function canRecognizeTaxCustoms(role: string, canWriteDocuments: boolean, readOnly?: boolean) {
  return !readOnly && canWriteDocuments && ["管理员", "财务", "业务员"].includes(role);
}

export function uploadScopeKey(orderId: string, documentType: string, scope: UploadScope = {}) {
  return [orderId, documentType, scope.costId || "", scope.supplierId || ""].join(":");
}

export function zipFileNameFromResponse(response: Response, row: TaxRefundRow) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) return plainMatch[1];
  const orderNo = String(row.orderNo || "订单").replace(/[\\/:*?"<>|]/g, "_");
  return `退税资料_${orderNo}.zip`;
}

export function completenessClass(percent: number) {
  if (percent >= 100) return styles.statusSuccess;
  if (percent >= 50) return styles.statusWarning;
  return styles.statusDanger;
}

export function taxStatusLabel(status = "") {
  return TAX_REFUND_STATUS_OPTIONS.find((option) => option.value === status)?.label || status || "-";
}

export function taxRefundHasPackageContent(row: TaxRefundRow) {
  return Number(row.documentCompleteness?.completed || 0) > 0;
}

export function statusClass(status = "") {
  if (["READY", "REFUND_RECEIVED"].includes(status)) return styles.statusSuccess;
  if (status === "PROBLEM") return styles.statusDanger;
  if (status === "SUBMITTED") return "";
  return styles.statusWarning;
}
