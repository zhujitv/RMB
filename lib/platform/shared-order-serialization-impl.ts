import {
  dateToInput,
  parseEmailList,
} from "./shared-base-utils";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  TAX_REFUND_STATUS_LABELS,
  normalizeClearanceEmailLanguage,
  normalizeShippingDocumentTypes,
  standardFilenameForDocument,
} from "./shared-constants";
import {
  customerFullName,
  customerShortName,
  safeSerializeCost,
  serializeCustomsRecognition,
  serializeDomesticLogisticsInfo,
  serializeOrderDocument,
  serializeShippingDocumentNotification,
  serializeSupplier,
} from "./shared-serialization";
import { taxDocumentCompleteness, derivedTaxRefundStatus } from "./shared-tax";
import { serializeUser } from "./shared-users";
import { paymentTermLabel } from "./shared-utils";
import { summarizeOrder } from "./shared-order-calculations";
import { businessEntityFieldsFromOrder } from "./business-entities";
import { serializeCustomsDeclarationItem } from "./export-tax-refund-calculations";

type ShippingCustomerLike = {
  country?: string | null;
  clearanceEmailLanguage?: string | null;
  shippingDocsEmails?: unknown;
  shippingDocsCcEmails?: unknown;
  autoSendDocumentTypes?: unknown;
  shortName?: string | null;
  name?: string | null;
};
type OrderDocumentLike = {
  id?: string;
  documentType?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
  mimeType?: string | null;
  uploadedAt?: Date | string | null;
  createdAt?: Date | string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  fileName?: string | null;
};
type UserLike = {
  id?: string | null;
  name?: string | null;
};
type OrderPaymentInstallmentLike = {
  condition?: unknown;
  ratio?: unknown;
  amount?: unknown;
};
type OrderCostLike = Record<string, unknown>;
type ShippingNotificationLike = Record<string, unknown>;
type ShippingOrderLike = Record<string, unknown> & {
  id?: string | null;
  documents?: OrderDocumentLike[] | null;
  costs?: OrderCostLike[] | null;
  paymentInstallments?: unknown;
  customer?: ShippingCustomerLike | null;
  country?: string | null;
  currency?: string | null;
  exchangeRate?: unknown;
  exchangeRateDate?: Date | string | null;
  exchangeRateSource?: string | null;
  exchangeRateType?: string | null;
  estimatedReceivableAmount?: unknown;
  estimatedReceivableAmountCny?: unknown;
  actualShipmentAmount?: unknown;
  actualShipmentAmountCny?: unknown;
  actualShipmentDate?: Date | string | null;
  finalReceivableAmount?: unknown;
  finalReceivableAmountCny?: unknown;
  receivableAmount?: unknown;
  receivableAmountCny?: unknown;
  tradeTerm?: string | null;
  paymentTerm?: string | null;
  paymentTermType?: string | null;
  depositRatio?: unknown;
  expectedPaymentDate?: Date | string | null;
  expectedArrivalDate?: Date | string | null;
  expectedShipmentDate?: Date | string | null;
  blDate?: Date | string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  customsDeclarationDate?: Date | null;
  orderNo?: string | null;
  customerId?: string | null;
  customerNameSnapshot?: string;
  businessEntityId?: string | null;
  businessEntityNameSnapshot?: string | null;
  businessEntity?: {
    id?: string | null;
    name?: string | null;
    shortName?: string | null;
    isDefault?: boolean | null;
    status?: string | null;
  } | null;
  salespersonUserId?: string | null;
  salesperson?: UserLike | null;
  salespersonCommissionRate?: unknown;
  commissionStatus?: string | null;
  commissionSettledById?: string | null;
  commissionSettledBy?: UserLike | null;
  commissionSettledAt?: Date | string | null;
  commissionSettlementRemark?: string | null;
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxRefundArchivedById?: string | null;
  taxRefundArchivedBy?: UserLike | null;
  taxRefundArchiveRemark?: string | null;
  taxSubmittedById?: string | null;
  taxSubmittedBy?: UserLike | null;
  taxSubmittedAt?: Date | string | null;
  domesticLogisticsInfos?: unknown[] | null;
  logisticsSuppliers?: Array<{ supplierId?: string | null; supplier?: unknown }> | null;
  shippingDocumentNotifications?: ShippingNotificationLike[] | null;
  creditDays?: unknown;
  dueDate?: Date | string | null;
  reminderDays?: unknown;
  status?: string | null;
  remark?: string | null;
  createdBy?: unknown;
  updatedBy?: unknown;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

function serializeExportTaxRefundCalculation(row: Record<string, unknown> = {}) {
  const invoiceMatchJson = row.invoiceMatchJson && typeof row.invoiceMatchJson === "object" && !Array.isArray(row.invoiceMatchJson)
    ? row.invoiceMatchJson as Record<string, unknown>
    : {};
  return {
    id: String(row.id || ""),
    declarationItemId: String(row.declarationItemId || ""),
    declarationNo: String(row.declarationNo || ""),
    hsCode: String(row.hsCode || ""),
    productName: String(row.productName || ""),
    declarationDate: row.declarationDate || null,
    fobCurrency: String(row.fobCurrency || ""),
    fobAmount: row.fobAmount == null ? null : Number(row.fobAmount),
    exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
    declarationAmountCny: row.declarationAmountCny == null ? null : Number(row.declarationAmountCny),
    customsRmbAmount: row.declarationAmountCny == null ? null : Number(row.declarationAmountCny),
    rebateRate: row.rebateRate == null ? null : Number(row.rebateRate),
    vatRate: row.vatRate == null ? null : Number(row.vatRate),
    theoreticalRefundAmount: row.theoreticalRefundAmount == null ? null : Number(row.theoreticalRefundAmount),
    supplierInvoiceAmountWithoutTax: row.supplierInvoiceAmountWithoutTax == null ? null : Number(row.supplierInvoiceAmountWithoutTax),
    availableInputVatAmount: row.availableInputVatAmount == null ? null : Number(row.availableInputVatAmount),
    inputVatAmount: row.availableInputVatAmount == null ? null : Number(row.availableInputVatAmount),
    estimatedRefundAmount: row.estimatedRefundAmount == null ? null : Number(row.estimatedRefundAmount),
    invoiceMatchStatus: String(row.invoiceMatchStatus || ""),
    calculationStatus: String(row.calculationStatus || ""),
    abnormalReasons: Array.isArray(row.abnormalReasons) ? row.abnormalReasons : [],
    invoiceMatch: invoiceMatchJson,
  };
}
type ShippingDocumentBundleItem = {
  typeKey: string;
  label: string;
  emailLabel: string;
  documentType: string;
  document: OrderDocumentLike | null;
};
type ShippingDocumentBundle = {
  items: ShippingDocumentBundleItem[];
  documents: OrderDocumentLike[];
  missing: ShippingDocumentBundleItem[];
};

function latestSuccessfulDocumentByType(order: ShippingOrderLike = {}, documentType = "") {
  return (order.documents || [])
    .filter((document) => (
      document.documentType === documentType
      && document.uploadStatus === "SUCCESS"
      && !document.deletedAt
      && String(document.mimeType || "").toLowerCase() === "application/pdf"
    ))
    .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0).getTime() - new Date(a.uploadedAt || a.createdAt || 0).getTime())[0] || null;
}

function shippingDocumentBundle(order: ShippingOrderLike = {}, options: { documentTypes?: unknown } = {}): ShippingDocumentBundle {
  const customer = order.customer || {};
  const documentTypes = normalizeShippingDocumentTypes(options.documentTypes || customer.autoSendDocumentTypes || DEFAULT_SHIPPING_DOCUMENT_TYPES);
  const configMap = SHIPPING_DOCUMENT_TYPE_CONFIG as Record<string, Omit<ShippingDocumentBundleItem, "typeKey" | "document">>;
  const items = documentTypes.filter((typeKey) => Boolean(configMap[typeKey])).map((typeKey) => {
    const config = configMap[typeKey];
    const document = latestSuccessfulDocumentByType(order, config.documentType);
    return { typeKey, ...config, document };
  });
  return {
    items,
    documents: items.map((item) => item.document).filter((document): document is OrderDocumentLike => Boolean(document)),
    missing: items.filter((item) => !item.document),
  };
}

function shippingDocumentEmailTemplate(order: ShippingOrderLike = {}, bundle: ShippingDocumentBundle = shippingDocumentBundle(order), language = "EN") {
  const normalizedLanguage = normalizeClearanceEmailLanguage(language, order.customer?.country || order.country || "");
  const billOfLadingNo = order.blNo || order.billOfLadingNo || "-";
  const customsDeclarationDate = dateToInput(order.customsDeclarationDate) || "-";
  const labels = (bundle.items || []).filter((item) => item.document).map((item) => item.emailLabel);
  if (normalizedLanguage === "RU") {
    return {
      language: "RU",
      subject: `Отгрузочные документы по заказу ${order.orderNo || "-"} / коносамент ${billOfLadingNo}`,
      body: [
        "Здравствуйте!",
        "",
        `Во вложении направляем отгрузочные документы по заказу ${order.orderNo || "-"}.`,
        "",
        "Документы во вложении:",
        ...(labels.length ? labels : ["Commercial Invoice", "Packing List", "Customs Declaration"]).map((label) => `- ${label}`),
        "",
        `Номер коносамента: ${billOfLadingNo}`,
        `Дата декларации: ${customsDeclarationDate}`,
        "",
        "Пожалуйста, проверьте документы и сообщите нам, если потребуется дополнительная информация.",
        "",
        "С уважением,",
        "Zhejiang Lainuo Building Materials Co., Ltd.",
      ].join("\n"),
    };
  }
  return {
    language: "EN",
    subject: `Shipping Documents for Order ${order.orderNo || "-"} / B/L ${billOfLadingNo}`,
    body: [
      "Dear Customer,",
      "",
      "Please find attached the shipping documents for your customs clearance:",
      "",
      ...labels.map((label) => `- ${label}`),
      "",
      "This email also serves as the shipment notification.",
      "",
      "Best regards,",
      "NEXTWOOD",
    ].join("\n"),
  };
}

function shippingDocumentDraft(order: ShippingOrderLike = {}) {
  const customer = order.customer || {};
  const bundle = shippingDocumentBundle(order, { documentTypes: DEFAULT_SHIPPING_DOCUMENT_TYPES });
  const template = shippingDocumentEmailTemplate(order, bundle, customer.clearanceEmailLanguage || "EN");
  const recipientEmails = parseEmailList(customer.shippingDocsEmails || []);
  const ccEmails = parseEmailList(customer.shippingDocsCcEmails || []);
  return {
    customerShortName: customerShortName(customer) || customerFullName(customer, order.customerNameSnapshot),
    orderNo: order.orderNo || "",
    billOfLadingNo: order.blNo || order.billOfLadingNo || "-",
    blNo: order.blNo || order.billOfLadingNo || "-",
    customsDeclarationDate: dateToInput(order.customsDeclarationDate) || "-",
    recipientEmails,
    ccEmails,
    language: template.language,
    languageLabel: (SHIPPING_EMAIL_LANGUAGE_LABELS as Record<string, string>)[template.language],
    subject: template.subject,
    body: template.body,
    documents: bundle.items.map((item) => ({
      typeKey: item.typeKey,
      label: item.label,
      emailLabel: item.emailLabel,
      documentId: item.document?.id || "",
      fileName: item.document ? standardFilenameForDocument(item.document, order as Parameters<typeof standardFilenameForDocument>[1]) : "",
      originalFilename: item.document?.originalFilename || item.document?.originalName || item.document?.fileName || "",
      exists: Boolean(item.document),
    })),
    missingLabels: bundle.missing.map((item) => item.label),
    attachmentCount: bundle.documents.length,
    canSendWithIncomplete: bundle.documents.length > 0 && bundle.missing.length > 0,
    incompleteMessage: bundle.missing.length ? `当前资料不完整，缺少${bundle.missing.map((item) => item.label).join("、")}。` : "",
  };
}

function asShippingOrder(value: unknown): ShippingOrderLike {
  return (value && typeof value === "object" ? value : {}) as ShippingOrderLike;
}

export function serializeOrder(orderInput: unknown) {
  const order = asShippingOrder(orderInput);
  const summary = summarizeOrder(order as Parameters<typeof summarizeOrder>[0]);
  const paymentInstallments = Array.isArray(order.paymentInstallments) ? order.paymentInstallments as OrderPaymentInstallmentLike[] : [];
  const paymentTermDisplay = paymentTermLabel(order.paymentTermType || undefined, order.paymentTerm || undefined);
  const documents = (order.documents || []).map((document) => serializeOrderDocument(document, order));
  const costs = (order.costs || []).map(safeSerializeCost);
  const shippingNotifications = order.shippingDocumentNotifications || [];
  const latestShippingNotification = shippingNotifications[0] || null;
  const completeness = taxDocumentCompleteness(order as Parameters<typeof taxDocumentCompleteness>[0]);
  const taxRefundStatus = derivedTaxRefundStatus(order as Parameters<typeof derivedTaxRefundStatus>[0], order.documents || []);
  const domesticLogisticsRows = Array.isArray(order.domesticLogisticsInfos) ? order.domesticLogisticsInfos : [];
  const domesticLogisticsInfo = serializeDomesticLogisticsInfo(domesticLogisticsRows[0]);
  const customsDeclarationItems = Array.isArray(order.customsDeclarationItems)
    ? order.customsDeclarationItems.map((item) => serializeCustomsDeclarationItem(item as never))
    : [];
  const exportTaxRefundCalculations = Array.isArray(order.exportTaxRefundCalculations)
    ? order.exportTaxRefundCalculations.map((row) => serializeExportTaxRefundCalculation(row as Record<string, unknown>))
    : [];
  const exportTaxRefundSummary = {
    estimatedRefundAmount: exportTaxRefundCalculations.reduce((sum, row) => sum + Number(row.estimatedRefundAmount || 0), 0),
    calculationStatus: exportTaxRefundCalculations.some((row) => row.calculationStatus === "资料异常") ? "资料异常" : exportTaxRefundCalculations.length ? "退税金额已计算" : "",
    abnormalReasons: exportTaxRefundCalculations
      .flatMap((row) => row.abnormalReasons.map((reason) => String(reason || "")))
      .filter((reason, index, arr) => reason && arr.indexOf(reason) === index),
  };
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    customerNameSnapshot: fullCustomerName,
    ...businessEntityFieldsFromOrder(order),
    salespersonId: order.salespersonUserId || "",
    salespersonUserId: order.salespersonUserId || "",
    salespersonName: order.salesperson?.name || "",
    salespersonCommissionRate: Number(order.salespersonCommissionRate || 0),
    commissionRate: Number(order.salespersonCommissionRate || 0),
    commissionStatus: summary.commissionStatus,
    commissionStatusRaw: order.commissionStatus || "未结算",
    commissionSettledById: order.commissionSettledById || "",
    commissionSettledByName: order.commissionSettledBy?.name || "",
    commissionSettledAt: order.commissionSettledAt || null,
    commissionSettlementRemark: order.commissionSettlementRemark || "",
    country: order.customer?.country || order.country || "",
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate),
    exchangeRateDate: dateToInput(order.exchangeRateDate),
    exchangeRateSource: order.exchangeRateSource || "",
    exchangeRateType: order.exchangeRateType || "",
    estimatedReceivableAmount: Number(order.estimatedReceivableAmount ?? order.receivableAmount),
    estimatedReceivableAmountCny: Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny),
    actualShipmentAmount: order.actualShipmentAmount == null ? "" : Number(order.actualShipmentAmount),
    actualShipmentAmountCny: order.actualShipmentAmountCny == null ? "" : Number(order.actualShipmentAmountCny),
    actualShipmentDate: dateToInput(order.actualShipmentDate),
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    receivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    tradeTerm: order.tradeTerm,
    paymentTerm: paymentTermDisplay,
    paymentTermRaw: order.paymentTerm || "",
    paymentTermType: order.paymentTermType || "",
    paymentTermDisplay,
    depositRatio: order.depositRatio == null ? "" : Number(order.depositRatio) * 100,
    expectedPaymentDate: dateToInput(order.expectedPaymentDate),
    expectedArrivalDate: dateToInput(order.expectedArrivalDate),
    expectedShipmentDate: dateToInput(order.expectedShipmentDate),
    blDate: dateToInput(order.blDate),
    paymentInstallments,
    paymentInstallmentText: paymentInstallments.map((item) => (
      `${item.condition || "-"}：${Number(item.ratio || 0)}% / ${Number(item.amount || 0).toFixed(2)}`
    )).join("；"),
    taxRefundStatus,
    taxRefundStatusLabel: (TAX_REFUND_STATUS_LABELS as Record<string, string>)[taxRefundStatus] || taxRefundStatus,
    taxArchived: Boolean(order.taxArchived || taxRefundStatus === "SUBMITTED" || order.taxRefundArchivedAt),
    taxRefundArchivedById: order.taxRefundArchivedById || "",
    taxRefundArchivedByName: order.taxRefundArchivedBy?.name || "",
    taxRefundArchivedAt: order.taxRefundArchivedAt || null,
    taxRefundArchiveRemark: order.taxRefundArchiveRemark || "",
    taxSubmittedById: order.taxSubmittedById || "",
    taxSubmittedByName: order.taxSubmittedBy?.name || order.taxRefundArchivedBy?.name || "",
    taxSubmittedAt: order.taxSubmittedAt || order.taxRefundArchivedAt || null,
    ...serializeCustomsRecognition(order),
    documentCompleteness: completeness,
    domesticLogisticsInfo,
    documents,
    logisticsSupplierIds: (order.logisticsSuppliers || []).map((row) => row.supplierId),
    logisticsSuppliers: (order.logisticsSuppliers || []).map((row) => serializeSupplier(row.supplier)).filter((item) => item.id),
    shippingDocumentNotifications: shippingNotifications.map((row) => serializeShippingDocumentNotification(row, order)),
    shippingDocumentNotification: serializeShippingDocumentNotification(latestShippingNotification, order),
    shippingDocumentManualDraft: shippingDocumentDraft(order),
    customsDeclarationItems,
    exportTaxRefundCalculations,
    exportTaxRefundSummary,
    costs,
    creditDays: order.creditDays ?? "",
    dueDate: dateToInput(order.dueDate),
    reminderDays: order.reminderDays,
    status: order.status,
    remark: order.remark || "",
    createdBy: serializeUser(order.createdBy),
    updatedBy: serializeUser(order.updatedBy),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary,
  };
}

export type SerializedOrderDto = ReturnType<typeof serializeOrder>;
