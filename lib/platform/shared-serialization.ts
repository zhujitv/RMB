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
  preferredOrderDocumentFileName,
  standardFilenameForDocument,
  supplierTypeDisplayName,
} from "./shared-constants";
import { USER_PUBLIC_SELECT, publicUser, serializeUser } from "./shared-users";
import { businessEntityFieldsFromOrder } from "./business-entities";
import { buildExportInvoiceRemarkFromTransportItems, formatExportInvoiceRemark, normalizeExportInvoiceRemark } from "./export-invoice-remark";
import { managedFileDownloadPath } from "./file-center";

export { USER_PUBLIC_SELECT, publicUser, serializeUser };

function dateTimeToIso(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

type OrderDocumentStatusLike = {
  documentType?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
};
type ShippingNotificationCustomerLike = {
  enableAutoShippingDocsNotification?: boolean | null;
  autoSendDocumentTypes?: unknown;
};
type ShippingNotificationRowLike = {
  id?: string | null;
  orderId?: string | null;
  customerId?: string | null;
  invoiceId?: string | null;
  sentById?: string | null;
  sentBy?: { name?: string | null } | null;
  recipientEmails?: unknown;
  ccEmails?: unknown;
  documentTypes?: unknown;
  attachmentFileIds?: unknown;
  sendStatus?: string | null;
  sendMode?: string | null;
  emailLanguage?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  errorMessage?: string | null;
  sentAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type ShippingNotificationOrderLike = {
  id?: string | null;
  customerId?: string | null;
  documents?: unknown[] | null;
  customer?: ShippingNotificationCustomerLike | null;
};
type CustomsRecognitionOrderLike = {
  customsDeclarationNo?: string | null;
  customsDeclarationDate?: Date | null;
  customsParsedAt?: Date | string | null;
  customsParseStatus?: string | null;
  customsDeclarationParseSource?: string | null;
  customsParseMessage?: string | null;
};
type OrderDocumentOrderOverride = Parameters<typeof standardFilenameForDocument>[1];
type UserLike = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
  avatarInitials?: string | null;
  defaultLanguage?: string | null;
  customPermissions?: unknown;
  supplierId?: string | null;
  supplierOperator?: { supplierName?: string | null; supplierType?: string | null } | null;
  mustChangePassword?: boolean | null;
  approvalStatus?: string | null;
  isActive?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type CustomerLike = Record<string, unknown> & {
  id?: string | null;
  name?: string | null;
  shortName?: string | null;
  country?: string | null;
  defaultCurrency?: string | null;
  salespersonUserId?: string | null;
  salesperson?: UserLike | null;
  commissionRate?: unknown;
  commissionStatus?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  enableAutoShippingDocsNotification?: boolean | null;
  shippingDocsEmails?: unknown;
  shippingDocsCcEmails?: unknown;
  autoSendDocumentTypes?: unknown;
  clearanceEmailLanguage?: string | null;
  remark?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type SupplierLike = Record<string, unknown> & {
  id?: string | null;
  supplierName?: string | null;
  supplierType?: string | null;
  country?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  invoiceTitle?: string | null;
  taxNumber?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  remark?: string | null;
  status?: string | null;
  allowDomesticLogisticsEntry?: boolean | null;
  allowLogisticsExpenseEntry?: boolean | null;
  allowLogisticsInvoiceUpload?: boolean | null;
  allowFactoryDocumentUpload?: boolean | null;
  isDefaultLogisticsSupplier?: boolean | null;
  allowedLogisticsCostTypes?: unknown;
  createdBy?: UserLike | null;
  updatedBy?: UserLike | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type PaymentOrderLike = Record<string, unknown> & {
  orderNo?: string | null;
  customer?: CustomerLike | null;
  customerNameSnapshot?: string | null;
  country?: string | null;
  salesperson?: UserLike | null;
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
};
type PaymentLike = Record<string, unknown> & {
  id?: string | null;
  orderId?: string | null;
  order?: PaymentOrderLike | null;
  paymentDate?: Date | string | null;
  currency?: string | null;
  exchangeRate?: unknown;
  exchangeRateDate?: Date | string | null;
  exchangeRateSource?: string | null;
  exchangeRateType?: string | null;
  amount?: unknown;
  amountCny?: unknown;
  paymentType?: string | null;
  status?: string | null;
  bankReference?: string | null;
  remark?: string | null;
  createdBy?: UserLike | null;
  updatedBy?: UserLike | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type CostOrderLike = PaymentOrderLike & {
  id?: string | null;
  blNo?: string | null;
  customerId?: string | null;
  currency?: string | null;
  exchangeRate?: unknown;
  status?: string | null;
};
type CostDocumentLike = Record<string, unknown> & {
  id?: string | null;
  orderId?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  factoryDocumentRequestId?: string | null;
  relatedModule?: string | null;
  order?: CostOrderLike | null;
  supplier?: SupplierLike | null;
  cost?: CostLike | null;
  costType?: string | null;
  documentType?: string | null;
  fileName?: string | null;
  fileUrl?: string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  fileSize?: unknown;
  mimeType?: string | null;
  uploadStatus?: string | null;
  uploadProgress?: unknown;
  uploadedBy?: UserLike | null;
  uploadedAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  source?: string | null;
};
type CostLike = Record<string, unknown> & {
  id?: string | null;
  orderId?: string | null;
  orderNo?: string | null;
  blNo?: string | null;
  order?: CostOrderLike | null;
  supplierId?: string | null;
  supplier?: SupplierLike | null;
  supplierNameSnapshot?: string | null;
  vendorName?: string | null;
  costType?: string | null;
  currency?: string | null;
  exchangeRate?: unknown;
  exchangeRateDate?: Date | string | null;
  exchangeRateSource?: string | null;
  exchangeRateType?: string | null;
  amount?: unknown;
  amountCny?: unknown;
  paymentStatus?: string | null;
  costConfirmed?: boolean | null;
  costConfirmedAt?: Date | string | null;
  paymentDate?: Date | string | null;
  paid?: boolean | null;
  paidAt?: Date | string | null;
  paymentVoucherUrl?: string | null;
  paymentVoucherFileName?: string | null;
  paymentVoucherMimeType?: string | null;
  paymentVoucherUploadedAt?: Date | string | null;
  invoiceStatus?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  remark?: string | null;
  documents?: CostDocumentLike[] | null;
  createdBy?: UserLike | null;
  updatedBy?: UserLike | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type DomesticLogisticsTransportItemLike = Record<string, unknown> & {
  id?: string | null;
  logisticsInfoId?: string | null;
  containerNo?: string | null;
  containerType?: string | null;
  sealNo?: string | null;
  truckPlateNo?: string | null;
  trailerPlateNo?: string | null;
  departureDate?: Date | string | null;
  departurePlace?: string | null;
  arrivalPlace?: string | null;
  cargoName?: string | null;
  remark?: string | null;
  sortOrder?: unknown;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};
type DomesticLogisticsInfoLike = Record<string, unknown> & {
  id?: string | null;
  orderId?: string | null;
  transportType?: string | null;
  truckPlateNo?: string | null;
  trailerPlateNo?: string | null;
  departurePlace?: string | null;
  destinationPlace?: string | null;
  departureDate?: Date | string | null;
  expressTrackingNo?: string | null;
  cargoDescription?: string | null;
  transportItems?: DomesticLogisticsTransportItemLike[] | null;
  remarkTextManualEdited?: boolean | null;
  remarkText?: string | null;
  exportInvoice?: unknown;
  submittedByUserId?: string | null;
  submittedBy?: UserLike | null;
  submittedAt?: Date | string | null;
  submitterRole?: string | null;
  unlockedByUserId?: string | null;
  unlockedAt?: Date | string | null;
  correctionRequested?: boolean | null;
  correctionReason?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  deletedAt?: Date | string | null;
};

function asLooseRecord<T extends Record<string, unknown>>(value: unknown): T {
  return (value && typeof value === "object" ? value : {}) as T;
}

export function serializeCustomer(customerInput: unknown = {}) {
  const customer = asLooseRecord<CustomerLike>(customerInput);
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
    clearanceEmailLanguageLabel: (SHIPPING_EMAIL_LANGUAGE_LABELS as Record<string, string>)[normalizeClearanceEmailLanguage(customer.clearanceEmailLanguage, customer.country)],
    remark: customer.remark || "",
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function customerFullName(customerInput: unknown, snapshot: unknown = "") {
  const customer = asLooseRecord<CustomerLike>(customerInput);
  return normalizeCustomerName(snapshot || customer.name || "");
}

export function customerShortName(customerInput: unknown) {
  const customer = asLooseRecord<CustomerLike>(customerInput);
  return normalizeCustomerName(customer.shortName || "");
}

export function customerBusinessName(customer: unknown, snapshot: unknown = "") {
  return customerShortName(customer) || customerFullName(customer, snapshot);
}

export function normalizedStringArray(value: unknown = []) {
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

export function normalizeLogisticsCostTypeList(value: unknown = []) {
  const rows = normalizedStringArray(value).map(normalizedCostType).filter((item) => LOGISTICS_COST_TYPES.includes(item));
  return rows.filter((item, index, arr) => arr.indexOf(item) === index);
}

export function expandLegacyFullLogisticsCostTypeList(value: unknown = []) {
  const rows = normalizeLogisticsCostTypeList(value);
  const documentFeeType = "打单费";
  const ensFeeType = "ENS";
  const legacyFullRows = LOGISTICS_COST_TYPES.filter((item) => ![documentFeeType, ensFeeType].includes(item));
  const preEnsFullRows = LOGISTICS_COST_TYPES.filter((item) => item !== ensFeeType);
  if (!rows.includes(documentFeeType) && legacyFullRows.every((item) => rows.includes(item))) {
    return LOGISTICS_COST_TYPES;
  }
  if (!rows.includes(ensFeeType) && preEnsFullRows.every((item) => rows.includes(item))) {
    return LOGISTICS_COST_TYPES;
  }
  return rows;
}

export function serializeSupplier(supplierInput: unknown = {}) {
  const supplier = asLooseRecord<SupplierLike>(supplierInput);
  return {
    id: supplier.id,
    supplierName: supplier.supplierName,
    supplierType: supplierTypeDisplayName(supplier.supplierType),
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
    allowFactoryDocumentUpload: Boolean(supplier.allowFactoryDocumentUpload),
    isDefaultLogisticsSupplier: Boolean(supplier.isDefaultLogisticsSupplier),
    allowedLogisticsCostTypes: expandLegacyFullLogisticsCostTypeList(supplier.allowedLogisticsCostTypes || []),
    createdBy: serializeUser(supplier.createdBy),
    updatedBy: serializeUser(supplier.updatedBy),
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

export function serializePayment(paymentInput: unknown) {
  const payment = asLooseRecord<PaymentLike>(paymentInput);
  return {
    id: payment.id,
    orderId: payment.orderId,
    orderNo: payment.order?.orderNo || "",
    customerName: customerBusinessName(payment.order?.customer, payment.order?.customerNameSnapshot),
    customerFullName: customerFullName(payment.order?.customer, payment.order?.customerNameSnapshot),
    customerShortName: customerShortName(payment.order?.customer),
    ...businessEntityFieldsFromOrder(payment.order),
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
    paymentType: payment.paymentType || "",
    status: payment.status,
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
    createdBy: serializeUser(payment.createdBy),
    updatedBy: serializeUser(payment.updatedBy),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export function invoiceStatusFromDocuments(documents: OrderDocumentStatusLike[] = []) {
  return documents.some((document) => (
    document.documentType === "SUPPLIER_INVOICE"
    && document.uploadStatus === "SUCCESS"
    && !document.deletedAt
  )) ? "已收到" : "未收到";
}

export function fallbackSerializedCost(costInput: unknown = {}) {
  const cost = asLooseRecord<CostLike>(costInput);
  return {
    id: cost.id,
    orderId: cost.orderId,
    costType: normalizedCostType(String(cost.costType || "")),
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
    paid: Boolean(cost.paid),
    paidAt: dateTimeToIso(cost.paidAt),
    paymentVoucherUrl: cost.paymentVoucherStorageKey && cost.id ? managedFileDownloadPath("payment-voucher", String(cost.id)) : (cost.paymentVoucherUrl || ""),
    paymentVoucherFileName: cost.paymentVoucherFileName || "",
    paymentVoucherMimeType: cost.paymentVoucherMimeType || "",
    paymentVoucherUploadedAt: dateTimeToIso(cost.paymentVoucherUploadedAt),
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

export function safeSerializeCost(costInput: unknown = {}) {
  const cost = asLooseRecord<CostLike>(costInput);
  try {
    return serializeCost(cost);
  } catch (error) {
    logServerError("成本返回数据序列化失败", error, { costId: cost?.id || "" });
    return fallbackSerializedCost(cost);
  }
}

export function serializeCost(costInput: unknown) {
  const cost = asLooseRecord<CostLike>(costInput);
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
    ...businessEntityFieldsFromOrder(cost.order),
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
    costType: normalizedCostType(String(cost.costType || "")),
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
    paid: Boolean(cost.paid),
    paidAt: dateTimeToIso(cost.paidAt),
    paymentVoucherUrl: cost.paymentVoucherStorageKey && cost.id ? managedFileDownloadPath("payment-voucher", String(cost.id)) : (cost.paymentVoucherUrl || ""),
    paymentVoucherFileName: cost.paymentVoucherFileName || "",
    paymentVoucherMimeType: cost.paymentVoucherMimeType || "",
    paymentVoucherUploadedAt: dateTimeToIso(cost.paymentVoucherUploadedAt),
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

export type CustomerDto = ReturnType<typeof serializeCustomer>;
export type SupplierDto = ReturnType<typeof serializeSupplier>;
export type PaymentDto = ReturnType<typeof serializePayment>;
export type CostDto = ReturnType<typeof safeSerializeCost>;
export type OrderDocumentDto = ReturnType<typeof serializeOrderDocument>;
export type ShippingDocumentNotificationDto = ReturnType<typeof serializeShippingDocumentNotification>;
export type CustomsRecognitionDto = ReturnType<typeof serializeCustomsRecognition>;
export type DomesticLogisticsTransportItemDto = ReturnType<typeof serializeDomesticLogisticsTransportItem>;
export type DomesticLogisticsInfoDto = ReturnType<typeof serializeDomesticLogisticsInfo>;
