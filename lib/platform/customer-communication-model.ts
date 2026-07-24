import { Prisma } from "../generated/prisma/client.js";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  customerShortName,
  dateToInput,
  parseEmailList,
} from "./shared";

export const CUSTOMER_EMAIL_TYPES = {
  CUSTOMS_CLEARANCE_DOCS: "CUSTOMS_CLEARANCE_DOCS",
  SHIPPING_ADVICE: "SHIPPING_ADVICE",
  BILL_OF_LADING: "BILL_OF_LADING",
  TELEX_RELEASE_NOTICE: "TELEX_RELEASE_NOTICE",
  ETA_NOTICE: "ETA_NOTICE",
  PAYMENT_REMINDER: "PAYMENT_REMINDER",
  AFTER_SALES: "AFTER_SALES",
} as const;

const ACTIVE_SENT_STATUSES = new Set(["sent", "SUCCESS"]);

export const COMMUNICATION_FILE_TYPES = [
  { key: "commercialInvoice", label: "Commercial Invoice", documentType: "COMMERCIAL_INVOICE", requiredForClearance: true },
  { key: "packingList", label: "Packing List", documentType: "PACKING_LIST", requiredForClearance: true },
  { key: "customsDeclaration", label: "Customs Declaration / 报关单", documentType: "CUSTOMS_ENTRY_FORM", requiredForClearance: true },
  { key: "billOfLading", label: "Bill of Lading / 提单", documentType: "BILL_OF_LADING", requiredForClearance: false },
  { key: "shippingAdvice", label: "Shipping Advice", documentType: "", requiredForClearance: false },
  { key: "telexReleaseNotice", label: "Telex Release Notice", documentType: "", requiredForClearance: false },
  { key: "etaNotice", label: "ETA Notice", documentType: "", requiredForClearance: false },
];

export const orderSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true,
  orderNo: true,
  blNo: true,
  customerId: true,
  customerNameSnapshot: true,
  businessEntityNameSnapshot: true,
  customsDeclarationDate: true,
  deletedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      shortName: true,
      country: true,
      contactEmail: true,
      enableAutoShippingDocsNotification: true,
      shippingDocsEmails: true,
      shippingDocsCcEmails: true,
      autoSendDocumentTypes: true,
      clearanceEmailLanguage: true,
      salespersonUserId: true,
    },
  },
  businessEntity: { select: { id: true, name: true, shortName: true, isDefault: true } },
  documents: {
    where: { deletedAt: null },
    select: {
      id: true,
      documentType: true,
      uploadStatus: true,
      deletedAt: true,
      mimeType: true,
      originalFilename: true,
      originalName: true,
      fileName: true,
      uploadedAt: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: [{ documentType: "asc" }, { uploadedAt: "desc" }, { createdAt: "desc" }],
  },
  domesticLogisticsInfos: {
    where: { deletedAt: null },
    select: { id: true, financeStatus: true, submittedAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }],
    take: 1,
  },
  logisticsSuppliers: { select: { supplierId: true } },
  shippingDocumentNotifications: {
    include: { sentBy: true },
    orderBy: [{ createdAt: "desc" }],
    take: 20,
  },
});

export type CommunicationOrder = Prisma.ReceivableOrderGetPayload<{ select: typeof orderSelect }>;

function latestDocumentByType(order: CommunicationOrder, documentType: string) {
  if (!documentType) return null;
  return (order.documents || []).find((document) => (
    document.documentType === documentType
    && document.uploadStatus === "SUCCESS"
    && !document.deletedAt
    && String(document.mimeType || "").toLowerCase() === "application/pdf"
  )) || null;
}

export function clearanceMissingLabels(order: CommunicationOrder) {
  const configMap = SHIPPING_DOCUMENT_TYPE_CONFIG as Record<string, { documentType: string; label: string }>;
  return DEFAULT_SHIPPING_DOCUMENT_TYPES
    .map((typeKey) => configMap[typeKey])
    .filter(Boolean)
    .filter((config) => !latestDocumentByType(order, config.documentType))
    .map((config) => config.label);
}

function latestNotification(order: CommunicationOrder) {
  return (order.shippingDocumentNotifications || []).find((row) => row.sendStatus !== "CANCELLED") || null;
}

function latestSentNotification(order: CommunicationOrder) {
  return (order.shippingDocumentNotifications || []).find((row) => (
    ACTIVE_SENT_STATUSES.has(String(row.sendStatus || "")) && row.sentAt
  )) || null;
}

export function latestManualMarkNotification(order: CommunicationOrder) {
  return (order.shippingDocumentNotifications || []).find((row) => (
    ACTIVE_SENT_STATUSES.has(String(row.sendStatus || ""))
    && row.sentAt
    && (row.sendMode === "manual_mark" || row.isSystemSent === false)
  )) || null;
}

function clearanceStatus(order: CommunicationOrder) {
  const latest = latestNotification(order);
  const status = String(latest?.sendStatus || "");
  if (ACTIVE_SENT_STATUSES.has(status) && (latest?.sendMode === "manual_mark" || latest?.isSystemSent === false)) {
    return { value: "MANUAL_SENT", label: "手动已发送" };
  }
  if (ACTIVE_SENT_STATUSES.has(status)) return { value: "SENT", label: "已发送" };
  if (["failed", "FAILED"].includes(status)) return { value: "FAILED", label: "发送失败" };
  const missing = clearanceMissingLabels(order);
  if (missing.length) return { value: "MISSING", label: "附件缺失" };
  return { value: "READY", label: "待发送" };
}

function logisticsStatus(order: CommunicationOrder) {
  const info = (order.domesticLogisticsInfos || [])[0];
  if (!info) return "未录入";
  if (info.financeStatus === "APPROVED") return "已确认";
  if (info.financeStatus === "REJECTED") return "已驳回";
  return "已录入";
}

function businessEntityName(order: CommunicationOrder) {
  return order.businessEntity?.shortName || order.businessEntity?.name || order.businessEntityNameSnapshot || "";
}

function businessEntityIsDefault(order: CommunicationOrder) {
  return typeof order.businessEntity?.isDefault === "boolean" ? order.businessEntity.isDefault : true;
}

export function shippingRecipientEmails(customer: CommunicationOrder["customer"] | null | undefined) {
  const configured = parseEmailList(customer?.shippingDocsEmails || []);
  return configured.length ? configured : parseEmailList(customer?.contactEmail || "");
}

export function serializeAvailableFile(order: CommunicationOrder, item: (typeof COMMUNICATION_FILE_TYPES)[number]) {
  const document = latestDocumentByType(order, item.documentType);
  return {
    key: item.key,
    label: item.label,
    documentType: item.documentType,
    requiredForClearance: item.requiredForClearance,
    exists: Boolean(document),
    documentId: document?.id || "",
    fileName: document?.originalFilename || document?.originalName || document?.fileName || "",
    uploadedBy: document?.uploadedBy?.name || "",
    uploadedAt: document?.uploadedAt || document?.createdAt || null,
    previewUrl: document?.id ? `/api/order-documents/${encodeURIComponent(document.id)}/preview` : "",
    downloadUrl: document?.id ? `/api/order-documents/${encodeURIComponent(document.id)}/download` : "",
  };
}

export function serializeCommunicationRow(order: CommunicationOrder) {
  const latest = latestNotification(order);
  const latestSent = latestSentNotification(order);
  const latestManualMark = latestManualMarkNotification(order);
  const status = clearanceStatus(order);
  return {
    id: order.id,
    orderNo: order.orderNo,
    customerShortName: customerShortName(order.customer || {}) || order.customerNameSnapshot,
    billOfLadingNo: order.blNo || "",
    businessEntityName: businessEntityName(order),
    businessEntityIsDefault: businessEntityIsDefault(order),
    declarationDate: dateToInput(order.customsDeclarationDate),
    logisticsStatus: logisticsStatus(order),
    clearanceStatus: status.value,
    clearanceStatusLabel: status.label,
    latestSentAt: latestSent?.sentAt || latest?.sentAt || null,
    manualMarked: Boolean(latestManualMark),
    latestManualMarkId: latestManualMark?.id || "",
  };
}
