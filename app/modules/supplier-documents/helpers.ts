import { ApiRequestError } from "../../api";
import styles from "../../WorkspaceShell.module.css";
import type { SupplierDocument, SupplierFactoryCostSlot } from "./types";

export const DOCUMENT_LABELS: Record<string, string> = {
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
  PURCHASE_CONTRACT: "工厂采购合同",
  VAT_INVOICE: "工厂增值税发票",
};
export const SUPPLIER_DOCUMENT_PAGE_SIZE_OPTIONS = [10, 20, 50];

export function normalizeSupplierDocumentType(value: unknown) {
  const type = String(value || "").trim().toUpperCase();
  if (["SUPPLIER_PURCHASE_CONTRACT", "PURCHASE_CONTRACT", "FACTORY_PURCHASE_CONTRACT", "FACTORY_CONTRACT"].includes(type)) {
    return "SUPPLIER_PURCHASE_CONTRACT";
  }
  if (["SUPPLIER_INVOICE", "VAT_INVOICE", "SUPPLIER_VAT_INVOICE", "FACTORY_INVOICE", "FACTORY_VAT_INVOICE"].includes(type)) {
    return "SUPPLIER_INVOICE";
  }
  return type;
}

export function supplierDocumentTypeCandidates(document: SupplierDocument) {
  return [
    document.documentType,
    document.requestItemType,
    document.supplierDocumentType,
    document.type,
    document.category,
  ].map(normalizeSupplierDocumentType);
}

export function uniqueRequiredDocumentTypes(requiredTypes: string[]) {
  return requiredTypes
    .map(normalizeSupplierDocumentType)
    .filter(Boolean)
    .filter((type, index, list) => list.indexOf(type) === index);
}

export function apiErrorMessage(error: unknown, fallback: string) {
  const cleanMessage = (message: string) => message
    .replace(/。服务器返回非JSON响应，请查看服务端日志。?/g, "")
    .trim();
  if (error instanceof ApiRequestError) {
    return cleanMessage(error.message || fallback);
  }
  return error instanceof Error ? cleanMessage(error.message || fallback) : fallback;
}

export function latestDocumentByType(documents: SupplierDocument[], documentType: string) {
  const normalizedType = normalizeSupplierDocumentType(documentType);
  const matches = documents
    .filter((document) => supplierDocumentTypeCandidates(document).includes(normalizedType))
    .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
  return matches[0] || null;
}

export function supplierDocumentFileName(document: SupplierDocument) {
  return document.displayFileName || document.fileName || document.downloadFileName || "文件记录存在";
}

export function supplierDocumentFileWarning(document: SupplierDocument) {
  if (document.uploadStatus && document.uploadStatus !== "SUCCESS") return "文件记录存在，但文件无法访问";
  if (!document.fileName && !document.displayFileName && !document.downloadFileName) return "文件记录存在，但文件名缺失";
  return "";
}

export function factoryCostSlotSummary(slots: SupplierFactoryCostSlot[]) {
  const labels = slots
    .map((slot) => [slot.label, slot.costType, formatFactoryCostSlotAmount(slot)].filter(Boolean).join(" · "))
    .filter(Boolean);
  if (!labels.length) return "";
  return labels.length === 1 ? labels[0] : `关联工厂货款：${labels.length} 项`;
}

export function supplierUploadKey(taskId: string, documentType: string, costId = "") {
  return [taskId, documentType, costId].join(":");
}

export function formatFactoryCostSlotAmount(slot: SupplierFactoryCostSlot) {
  const amountCny = Number(slot.amountCny || 0);
  const amount = Number(slot.amount || 0);
  if (amountCny > 0) return `CNY ${amountCny.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  if (amount > 0) return `${slot.currency || "CNY"} ${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  return "";
}

export function supplierDocumentStatusClass(status: string) {
  if (status === "已完成" || status === "已上传") return styles.statusSuccess;
  if (status === "部分上传" || status === "上传中") return styles.statusWarning;
  if (status === "已关闭") return styles.statusMuted;
  return styles.statusMuted;
}

export function supplierDocumentSendStatusLabel(status = "") {
  if (status === "sent") return "已发送";
  if (status === "failed") return "发送失败";
  if (status === "pending") return "待发送";
  if (status === "pending_review") return "合同待人工审核，尚未发送";
  if (status === "manual_upload") return "管理员代上传";
  return status || "未记录";
}
