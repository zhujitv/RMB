// @ts-nocheck
import { dateToInput, logServerError } from "./shared-base-utils";
import {
  CUSTOMS_PARSE_SOURCE_LABELS,
  CUSTOMS_PARSE_STATUS_LABELS,
  DOMESTIC_LOGISTICS_TRANSPORT_LABELS,
  LOGISTICS_COST_TYPES,
  ORDER_DOCUMENT_LABELS,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  SHIPPING_NOTIFICATION_STATUS_LABELS,
  normalizeClearanceEmailLanguage,
  normalizeCustomerName,
  normalizedCostType,
  normalizeShippingDocumentTypes,
  standardFilenameForDocument,
} from "./shared-constants";
import { USER_PUBLIC_SELECT, publicUser, serializeUser } from "./shared-users";

export { USER_PUBLIC_SELECT, publicUser, serializeUser };

export function serializeCustomer(customer) {
  const fullName = normalizeCustomerName(customer.name);
  const shortName = normalizeCustomerName(customer.shortName || "");
  return {
    id: customer.id,
    name: fullName,
    fullName,
    shortName,
    displayName: shortName || fullName,
    country: customer.country || "",
    defaultCurrency: customer.defaultCurrency,
    salespersonUserId: customer.salespersonUserId || "",
    salespersonName: customer.salesperson?.name || "",
    commissionRate: Number(customer.commissionRate || 0),
    commissionStatus: customer.commissionStatus || "启用",
    contactPerson: customer.contactPerson || "",
    contactEmail: customer.contactEmail || "",
    contactPhone: customer.contactPhone || "",
    enableAutoShippingDocsNotification: Boolean(customer.enableAutoShippingDocsNotification),
    shippingDocsEmails: Array.isArray(customer.shippingDocsEmails) ? customer.shippingDocsEmails : [],
    shippingDocsCcEmails: Array.isArray(customer.shippingDocsCcEmails) ? customer.shippingDocsCcEmails : [],
    autoSendDocumentTypes: normalizeShippingDocumentTypes(customer.autoSendDocumentTypes),
    clearanceEmailLanguage: normalizeClearanceEmailLanguage(customer.clearanceEmailLanguage, customer.country),
    clearanceEmailLanguageLabel: SHIPPING_EMAIL_LANGUAGE_LABELS[normalizeClearanceEmailLanguage(customer.clearanceEmailLanguage, customer.country)],
    remark: customer.remark || "",
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function customerFullName(customer, snapshot = "") {
  return normalizeCustomerName(snapshot || customer?.name || "");
}

export function customerShortName(customer) {
  return normalizeCustomerName(customer?.shortName || "");
}

export function customerBusinessName(customer, snapshot = "") {
  return customerShortName(customer) || customerFullName(customer, snapshot);
}

export function normalizedStringArray(value = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizedStringArray(parsed);
    } catch {}
    return value.split(/[,\n;；，]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeLogisticsCostTypeList(value = []) {
  const rows = normalizedStringArray(value).map(normalizedCostType).filter((item) => LOGISTICS_COST_TYPES.includes(item));
  return rows.filter((item, index, arr) => arr.indexOf(item) === index);
}

export function serializeSupplier(supplier) {
  return {
    id: supplier.id,
    supplierName: supplier.supplierName,
    supplierType: supplier.supplierType,
    country: supplier.country || "",
    contactPerson: supplier.contactPerson || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    invoiceTitle: supplier.invoiceTitle || "",
    taxNumber: supplier.taxNumber || "",
    bankName: supplier.bankName || "",
    bankAccount: supplier.bankAccount || "",
    remark: supplier.remark || "",
    status: supplier.status,
    allowDomesticLogisticsEntry: Boolean(supplier.allowDomesticLogisticsEntry),
    allowLogisticsExpenseEntry: Boolean(supplier.allowLogisticsExpenseEntry),
    allowLogisticsInvoiceUpload: Boolean(supplier.allowLogisticsInvoiceUpload),
    isDefaultLogisticsSupplier: Boolean(supplier.isDefaultLogisticsSupplier),
    allowedLogisticsCostTypes: normalizeLogisticsCostTypeList(supplier.allowedLogisticsCostTypes || []),
    createdBy: serializeUser(supplier.createdBy),
    updatedBy: serializeUser(supplier.updatedBy),
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export function serializePayment(payment) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    orderNo: payment.order?.orderNo || "",
    customerName: customerBusinessName(payment.order?.customer, payment.order?.customerNameSnapshot),
    customerFullName: customerFullName(payment.order?.customer, payment.order?.customerNameSnapshot),
    customerShortName: customerShortName(payment.order?.customer),
    country: payment.order?.customer?.country || payment.order?.country || "",
    salespersonName: payment.order?.salesperson?.name || "",
    taxArchived: Boolean(payment.order?.taxArchived || payment.order?.taxRefundStatus === "SUBMITTED"),
    taxRefundStatus: payment.order?.taxRefundStatus || "",
    paymentDate: dateToInput(payment.paymentDate),
    currency: payment.currency,
    exchangeRate: Number(payment.exchangeRate),
    exchangeRateDate: dateToInput(payment.exchangeRateDate),
    exchangeRateSource: payment.exchangeRateSource || "",
    exchangeRateType: payment.exchangeRateType || "",
    amount: Number(payment.amount),
    amountCny: Number(payment.amountCny),
    paymentType: payment.paymentType || "尾款",
    status: payment.status,
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
    createdBy: serializeUser(payment.createdBy),
    updatedBy: serializeUser(payment.updatedBy),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export function invoiceStatusFromDocuments(documents = []) {
  return documents.some((document) => (
    document.documentType === "SUPPLIER_INVOICE"
    && document.uploadStatus === "SUCCESS"
    && !document.deletedAt
  )) ? "已收到" : "未收到";
}

export function fallbackSerializedCost(cost) {
  return {
    id: cost.id,
    orderId: cost.orderId,
    costType: normalizedCostType(cost.costType),
    costTypeRaw: cost.costType,
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.vendorName || "",
    supplierNameSnapshot: cost.supplierNameSnapshot || cost.vendorName || "",
    vendorName: cost.supplierNameSnapshot || cost.vendorName || "",
    currency: cost.currency || "CNY",
    exchangeRate: Number(cost.exchangeRate || 1),
    amount: Number(cost.amount || 0),
    amountCny: Number(cost.amountCny || 0),
    paymentStatus: cost.paymentStatus || "待支付",
    costConfirmed: Boolean(cost.costConfirmed),
    paymentDate: dateToInput(cost.paymentDate),
    invoiceStatus: cost.sourceType === "LOGISTICS_EXPENSE"
      ? (cost.invoiceStatus || invoiceStatusFromDocuments(cost.documents || []))
      : invoiceStatusFromDocuments(cost.documents || []),
    sourceType: cost.sourceType || "MANUAL",
    sourceId: cost.sourceId || "",
    sourceLabel: cost.sourceType === "LOGISTICS_EXPENSE" ? "物流费用审核生成" : "人工录入",
    remark: cost.remark || "",
    documents: [],
    createdAt: cost.createdAt,
    updatedAt: cost.updatedAt,
  };
}

export function safeSerializeCost(cost) {
  try {
    return serializeCost(cost);
  } catch (error) {
    logServerError("成本返回数据序列化失败", error, { costId: cost?.id || "" });
    return fallbackSerializedCost(cost);
  }
}

export function serializeCost(cost) {
  const costDocuments = (cost.documents || []).map((document) => ({
    ...document,
    cost: document.cost || cost,
    costType: document.cost?.costType || cost.costType,
  }));
  return {
    id: cost.id,
    orderId: cost.orderId,
    orderNo: cost.order?.orderNo || "",
    blNo: cost.order?.blNo || "",
    billOfLadingNo: cost.order?.blNo || "",
    customerId: cost.order?.customerId || "",
    customerName: customerBusinessName(cost.order?.customer, cost.order?.customerNameSnapshot),
    customerFullName: customerFullName(cost.order?.customer, cost.order?.customerNameSnapshot),
    customerShortName: customerShortName(cost.order?.customer),
    country: cost.order?.customer?.country || cost.order?.country || "",
    salespersonName: cost.order?.salesperson?.name || "",
    orderCurrency: cost.order?.currency || "",
    orderExchangeRate: Number(cost.order?.exchangeRate || 0),
    orderStatus: cost.order?.status || "",
    taxArchived: Boolean(cost.order?.taxArchived || cost.order?.taxRefundStatus === "SUBMITTED"),
    taxRefundStatus: cost.order?.taxRefundStatus || "",
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierNameSnapshot: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierType: cost.supplier?.supplierType || "",
    costType: normalizedCostType(cost.costType),
    costTypeRaw: cost.costType,
    vendorName: cost.supplierNameSnapshot || cost.vendorName,
    currency: cost.currency,
    exchangeRate: Number(cost.exchangeRate),
    exchangeRateDate: dateToInput(cost.exchangeRateDate),
    exchangeRateSource: cost.exchangeRateSource || "",
    exchangeRateType: cost.exchangeRateType || "",
    amount: Number(cost.amount),
    amountCny: Number(cost.amountCny),
    paymentStatus: cost.paymentStatus,
    costConfirmed: Boolean(cost.costConfirmed),
    costConfirmedAt: cost.costConfirmedAt,
    paymentDate: dateToInput(cost.paymentDate),
    invoiceStatus: cost.sourceType === "LOGISTICS_EXPENSE"
      ? (cost.invoiceStatus || invoiceStatusFromDocuments(cost.documents || []))
      : invoiceStatusFromDocuments(cost.documents || []),
    sourceType: cost.sourceType || "MANUAL",
    sourceId: cost.sourceId || "",
    sourceLabel: cost.sourceType === "LOGISTICS_EXPENSE" ? "物流费用审核生成" : "人工录入",
    remark: cost.remark || "",
    createdBy: serializeUser(cost.createdBy),
    updatedBy: serializeUser(cost.updatedBy),
    documents: costDocuments.map((document) => serializeOrderDocument(document, {
      ...(cost.order || {}),
      id: cost.orderId || cost.order?.id,
      orderNo: cost.order?.orderNo || cost.orderNo || "",
      blNo: cost.order?.blNo || cost.blNo || "",
      documents: costDocuments,
    })),
    createdAt: cost.createdAt,
    updatedAt: cost.updatedAt,
  };
}

export function serializeOrderDocument(document, orderOverride = null) {
  const originalFilename = document.originalFilename || document.originalName || document.fileName || "";
  const standardFilename = standardFilenameForDocument(document, orderOverride);
  return {
    id: document.id,
    orderId: document.orderId,
    costId: document.costId || "",
    supplierId: document.supplierId || "",
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
    documentTypeLabel: ORDER_DOCUMENT_LABELS[document.documentType] || document.documentType,
    fileName: standardFilename,
    storedFileName: document.fileName,
    originalName: originalFilename,
    originalFilename,
    standardFilename,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
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

export function shippingNotificationStatus(row = null, customer = null) {
  if (!customer?.enableAutoShippingDocsNotification && !row) return "NOT_ENABLED";
  if (!row) return "WAITING_DOCUMENTS";
  if (["sent", "SUCCESS"].includes(row.sendStatus) && row.sendMode === "manual") return "MANUAL_SENT";
  if (["sent", "SUCCESS"].includes(row.sendStatus)) return "AUTO_SENT";
  if (["failed", "FAILED"].includes(row.sendStatus)) return "FAILED";
  return "WAITING_DOCUMENTS";
}

export function serializeShippingDocumentNotification(row = null, order = {}) {
  const documents = (order.documents || []).map((document) => serializeOrderDocument(document, order));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const customer = order.customer || {};
  const status = shippingNotificationStatus(row, customer);
  const attachmentFileIds = Array.isArray(row?.attachmentFileIds) ? row.attachmentFileIds : [];
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
    attachments: attachmentFileIds.map((id) => documentById.get(id)).filter(Boolean),
    sendStatus: row?.sendStatus || "pending",
    sendStatusLabel: SHIPPING_NOTIFICATION_STATUS_LABELS[status] || status,
    status,
    sendMode: row?.sendMode || "",
    emailLanguage: row?.emailLanguage || "",
    emailLanguageLabel: SHIPPING_EMAIL_LANGUAGE_LABELS[row?.emailLanguage] || row?.emailLanguage || "",
    emailSubject: row?.emailSubject || "",
    emailBody: row?.emailBody || "",
    errorMessage: row?.errorMessage || (!customer.enableAutoShippingDocsNotification ? "客户未启用清关资料自动通知。" : ""),
    sentAt: row?.sentAt || null,
    createdAt: row?.createdAt || null,
    updatedAt: row?.updatedAt || null,
  };
}

export function serializeCustomsRecognition(order = {}) {
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
    customsParseSourceLabel: CUSTOMS_PARSE_SOURCE_LABELS[source] || source || "",
    customsParseMessage: message,
    customsDeclarationParseStatus: status,
    customsDeclarationParseSource: source,
    customsDeclarationParseMessage: message,
  };
}

export function serializeDomesticLogisticsTransportItem(item) {
  if (!item) return null;
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

export function serializeDomesticLogisticsInfo(row) {
  if (!row) return null;
  const transportItems = (row.transportItems || []).map(serializeDomesticLogisticsTransportItem).filter(Boolean);
  return {
    id: row.id,
    orderId: row.orderId,
    transportType: row.transportType,
    transportTypeLabel: DOMESTIC_LOGISTICS_TRANSPORT_LABELS[row.transportType] || row.transportType || "",
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
    exportInvoiceRemark: row.remarkText || "",
    invoiceRemark: row.remarkText || "",
    submittedByUserId: row.submittedByUserId || "",
    submittedByName: row.submittedBy?.name || "",
    submittedAt: row.submittedAt,
    submitterRole: row.submitterRole || "",
    archiveStatus: row.remarkText ? "ARCHIVED" : "NOT_UPLOADED",
    archiveStatusLabel: row.remarkText ? "已归档" : "未上传",
    unlockedByUserId: row.unlockedByUserId || "",
    unlockedAt: row.unlockedAt,
    correctionRequested: Boolean(row.correctionRequested),
    correctionReason: row.correctionReason || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function uploadStatusLabel(status) {
  return {
    PENDING: "等待上传",
    UPLOADING: "上传中",
    SUCCESS: "上传成功",
    FAILED: "上传失败",
  }[status] || status || "-";
}

export function customsParseStatusLabel(status) {
  return CUSTOMS_PARSE_STATUS_LABELS[status] || status || "未识别";
}
