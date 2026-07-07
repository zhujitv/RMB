import { dateToInput } from "./shared-base-utils";
import {
  CUSTOMS_PARSE_SOURCE_LABELS,
  CUSTOMS_PARSE_STATUS_LABELS,
  DOMESTIC_LOGISTICS_TRANSPORT_LABELS,
  ORDER_DOCUMENT_LABELS,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  SHIPPING_NOTIFICATION_STATUS_LABELS,
  normalizedCostType,
  normalizeShippingDocumentTypes,
  preferredOrderDocumentFileName,
  standardFilenameForDocument,
} from "./shared-constants";
import { serializeUser } from "./shared-users";
import { buildExportInvoiceRemarkFromTransportItems, formatExportInvoiceRemark, normalizeExportInvoiceRemark } from "./export-invoice-remark";
import {
  type CostDocumentLike,
  type CustomsRecognitionOrderLike,
  type DomesticLogisticsInfoLike,
  type DomesticLogisticsTransportItemLike,
  type OrderDocumentOrderOverride,
  type ShippingNotificationCustomerLike,
  type ShippingNotificationOrderLike,
  type ShippingNotificationRowLike,
  asLooseRecord,
} from "./shared-serialization-types";
import { customerBusinessName, customerFullName, customerShortName } from "./shared-serialization-parties";

export function serializeOrderDocument(documentInput: unknown, orderOverride: unknown = null) {
  const document = asLooseRecord<CostDocumentLike>(documentInput);
  const orderContext = orderOverride as OrderDocumentOrderOverride;
  const originalFilename = document.originalFilename || document.originalName || document.fileName || "";
  const standardFilename = standardFilenameForDocument(document, orderContext);
  const displayFileName = preferredOrderDocumentFileName({
    ...document,
    standardFilename,
    order: orderContext || document.order,
  });
  return {
    id: document.id,
    orderId: document.orderId,
    costId: document.costId || "",
    supplierId: document.supplierId || "",
    factoryDocumentRequestId: document.factoryDocumentRequestId || "",
    relatedModule: document.relatedModule || "EXPORT",
    orderNo: document.order?.orderNo || "",
    blNo: document.order?.blNo || "",
    billOfLadingNo: document.order?.blNo || "",
    customerName: customerBusinessName(document.order?.customer, document.order?.customerNameSnapshot),
    customerFullName: customerFullName(document.order?.customer, document.order?.customerNameSnapshot),
    customerShortName: customerShortName(document.order?.customer),
    supplierName: document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "",
    supplierType: document.supplier?.supplierType || document.cost?.supplier?.supplierType || "",
    costType: normalizedCostType(document.cost?.costType || document.costType || ""),
    documentType: document.documentType,
    documentTypeLabel: (ORDER_DOCUMENT_LABELS as Record<string, string>)[String(document.documentType || "")] || document.documentType,
    fileName: standardFilename,
    displayFileName,
    downloadFileName: displayFileName,
    storedFileName: document.fileName,
    originalName: originalFilename,
    originalFilename,
    standardFilename,
    fileUrl: document.fileUrl || "",
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    source: document.source || (document.factoryDocumentRequestId ? "SUPPLIER_RETURN" : document.relatedModule || "ORDER"),
    uploadStatus: document.uploadStatus,
    uploadStatusLabel: uploadStatusLabel(document.uploadStatus),
    uploadProgress: document.uploadProgress,
    uploadedBy: serializeUser(document.uploadedBy),
    uploadedByName: document.uploadedBy?.name || "",
    uploadedAt: document.uploadedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export function shippingNotificationStatus(row: ShippingNotificationRowLike | null = null, customer: ShippingNotificationCustomerLike | null = null) {
  if (!customer?.enableAutoShippingDocsNotification && !row) return "NOT_ENABLED";
  if (!row) return "WAITING_DOCUMENTS";
  const sendStatus = String(row.sendStatus || "");
  const sendMode = String(row.sendMode || "");
  if (sendStatus === "CANCELLED") return "CANCELLED";
  if (["sent", "SUCCESS"].includes(sendStatus) && (sendMode === "manual_mark" || row.isSystemSent === false)) return "MANUAL_SENT";
  if (["sent", "SUCCESS"].includes(sendStatus) && sendMode === "manual") return "MANUAL_SENT";
  if (["sent", "SUCCESS"].includes(sendStatus)) return "AUTO_SENT";
  if (["failed", "FAILED"].includes(sendStatus)) return "FAILED";
  return "WAITING_DOCUMENTS";
}

export function serializeShippingDocumentNotification(row: ShippingNotificationRowLike | null = null, order: ShippingNotificationOrderLike = {}) {
  const documents = (order.documents || []).map((document) => serializeOrderDocument(document, order as OrderDocumentOrderOverride));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const customer = order.customer || {};
  const status = shippingNotificationStatus(row, customer);
  const attachmentFileIds = Array.isArray(row?.attachmentFileIds) ? row.attachmentFileIds : [];
  const emailLanguage = row?.emailLanguage || "";
  return {
    id: row?.id || "",
    orderId: row?.orderId || order.id || "",
    customerId: row?.customerId || order.customerId || "",
    invoiceId: row?.invoiceId || "",
    sentById: row?.sentById || "",
    sentByName: row?.sentBy?.name || "",
    recipientEmails: Array.isArray(row?.recipientEmails) ? row.recipientEmails : [],
    ccEmails: Array.isArray(row?.ccEmails) ? row.ccEmails : [],
    documentTypes: normalizeShippingDocumentTypes(row?.documentTypes || customer.autoSendDocumentTypes),
    attachmentFileIds,
    attachments: attachmentFileIds.map((id) => documentById.get(String(id))).filter(Boolean),
    sendStatus: row?.sendStatus || "pending",
    sendStatusLabel: SHIPPING_NOTIFICATION_STATUS_LABELS[status] || status,
    status,
    sendMode: row?.sendMode || "",
    deliveryMethod: row?.deliveryMethod || "",
    manualRemark: row?.manualRemark || "",
    isSystemSent: row?.isSystemSent !== false,
    emailLanguage,
    emailLanguageLabel: (SHIPPING_EMAIL_LANGUAGE_LABELS as Record<string, string>)[emailLanguage] || emailLanguage || "",
    emailSubject: row?.emailSubject || "",
    emailBody: row?.emailBody || "",
    errorMessage: row?.errorMessage || (!customer.enableAutoShippingDocsNotification ? "客户未启用清关资料自动通知。" : ""),
    sentAt: row?.sentAt || null,
    createdAt: row?.createdAt || null,
    updatedAt: row?.updatedAt || null,
  };
}

export function serializeCustomsRecognition(orderInput: unknown = {}) {
  const order = asLooseRecord<CustomsRecognitionOrderLike>(orderInput);
  const status = order.customsParseStatus || "";
  const source = order.customsDeclarationParseSource || (status === "MANUAL" ? "MANUAL" : "");
  const message = order.customsParseMessage || "";
  return {
    customsDeclarationNo: order.customsDeclarationNo || "",
    customsDeclarationDate: dateToInput(order.customsDeclarationDate),
    customsParsedAt: order.customsParsedAt || null,
    customsParseStatus: status,
    customsParseStatusLabel: customsParseStatusLabel(status),
    customsParseSource: source,
    customsParseSourceLabel: (CUSTOMS_PARSE_SOURCE_LABELS as Record<string, string>)[source] || source || "",
    customsParseMessage: message,
    customsDeclarationParseStatus: status,
    customsDeclarationParseSource: source,
    customsDeclarationParseMessage: message,
  };
}

export function serializeDomesticLogisticsTransportItem(itemInput: unknown) {
  if (!itemInput) return null;
  const item = asLooseRecord<DomesticLogisticsTransportItemLike>(itemInput);
  return {
	    id: item.id,
	    logisticsInfoId: item.logisticsInfoId,
	    containerNo: item.containerNo || "",
	    containerType: item.containerType || "",
	    sealNo: item.sealNo || "",
	    truckPlateNo: item.truckPlateNo || "",
    trailerPlateNo: item.trailerPlateNo || "",
    departureDate: dateToInput(item.departureDate),
    departurePlace: item.departurePlace || "",
    arrivalPlace: item.arrivalPlace || "",
    cargoName: item.cargoName || "",
    remark: item.remark || "",
    sortOrder: Number(item.sortOrder || 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function serializeDomesticLogisticsInfo(rowInput: unknown) {
  if (!rowInput) return null;
  const row = asLooseRecord<DomesticLogisticsInfoLike>(rowInput);
  const transportItems = (row.transportItems || [])
    .map(serializeDomesticLogisticsTransportItem)
    .filter((item): item is NonNullable<ReturnType<typeof serializeDomesticLogisticsTransportItem>> => Boolean(item));
  const exportInvoiceRecord = row.exportInvoice && typeof row.exportInvoice === "object" ? row.exportInvoice as Record<string, unknown> : {};
  const storedExportInvoice = normalizeExportInvoiceRemark(exportInvoiceRecord.remark);
  const exportInvoice = storedExportInvoice.containers.length
    ? storedExportInvoice
    : buildExportInvoiceRemarkFromTransportItems(transportItems);
  const exportInvoiceText = formatExportInvoiceRemark(exportInvoice) || row.remarkText || "";
  return {
    id: row.id,
    orderId: row.orderId,
    transportType: row.transportType,
    transportTypeLabel: (DOMESTIC_LOGISTICS_TRANSPORT_LABELS as Record<string, string>)[String(row.transportType || "")] || row.transportType || "",
    truckPlateNo: row.truckPlateNo || "",
    trailerPlateNo: row.trailerPlateNo || "",
    departurePlace: row.departurePlace || "",
    destinationPlace: row.destinationPlace || "",
    departureDate: dateToInput(row.departureDate),
    expressTrackingNo: row.expressTrackingNo || "",
    cargoDescription: row.cargoDescription || "",
    transportItems,
    remarkTextManualEdited: Boolean(row.remarkTextManualEdited),
    remarkText: row.remarkText || "",
    exportInvoice: { remark: exportInvoice },
    invoiceRemark: exportInvoiceText,
    submittedByUserId: row.submittedByUserId || "",
    submittedByName: row.submittedBy?.name || "",
    submittedAt: row.submittedAt,
    submitterRole: row.submitterRole || "",
    archiveStatus: exportInvoiceText ? "ARCHIVED" : "NOT_UPLOADED",
    archiveStatusLabel: exportInvoiceText ? "已归档" : "未上传",
    unlockedByUserId: row.unlockedByUserId || "",
    unlockedAt: row.unlockedAt,
    correctionRequested: Boolean(row.correctionRequested),
    correctionReason: row.correctionReason || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function uploadStatusLabel(status: string | null | undefined) {
  return {
    PENDING: "等待上传",
    UPLOADING: "上传中",
    SUCCESS: "上传成功",
    FAILED: "上传失败",
  }[String(status || "")] || status || "-";
}

export function customsParseStatusLabel(status: string | null | undefined) {
  return (CUSTOMS_PARSE_STATUS_LABELS as Record<string, string>)[String(status || "")] || status || "未识别";
}
