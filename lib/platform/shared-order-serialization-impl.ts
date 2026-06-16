// @ts-nocheck
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

function latestSuccessfulDocumentByType(order = {}, documentType = "") {
  return (order.documents || [])
    .filter((document) => (
      document.documentType === documentType
      && document.uploadStatus === "SUCCESS"
      && !document.deletedAt
      && String(document.mimeType || "").toLowerCase() === "application/pdf"
    ))
    .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0) - new Date(a.uploadedAt || a.createdAt || 0))[0] || null;
}

function shippingDocumentBundle(order = {}, options = {}) {
  const customer = order.customer || {};
  const documentTypes = normalizeShippingDocumentTypes(options.documentTypes || customer.autoSendDocumentTypes || DEFAULT_SHIPPING_DOCUMENT_TYPES);
  const items = documentTypes.map((typeKey) => {
    const config = SHIPPING_DOCUMENT_TYPE_CONFIG[typeKey];
    const document = latestSuccessfulDocumentByType(order, config.documentType);
    return { typeKey, ...config, document };
  });
  return {
    items,
    documents: items.map((item) => item.document).filter(Boolean),
    missing: items.filter((item) => !item.document),
  };
}

function shippingDocumentEmailTemplate(order = {}, bundle = {}, language = "EN") {
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

function shippingDocumentDraft(order = {}) {
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
    languageLabel: SHIPPING_EMAIL_LANGUAGE_LABELS[template.language],
    subject: template.subject,
    body: template.body,
    documents: bundle.items.map((item) => ({
      typeKey: item.typeKey,
      label: item.label,
      emailLabel: item.emailLabel,
      documentId: item.document?.id || "",
      fileName: item.document ? standardFilenameForDocument(item.document, order) : "",
      originalFilename: item.document?.originalFilename || item.document?.originalName || item.document?.fileName || "",
      exists: Boolean(item.document),
    })),
    missingLabels: bundle.missing.map((item) => item.label),
    attachmentCount: bundle.documents.length,
    canSendWithIncomplete: bundle.documents.length > 0 && bundle.missing.length > 0,
    incompleteMessage: bundle.missing.length ? `当前资料不完整，缺少${bundle.missing.map((item) => item.label).join("、")}。` : "",
  };
}

export function serializeOrder(order) {
  const summary = summarizeOrder(order);
  const paymentInstallments = Array.isArray(order.paymentInstallments) ? order.paymentInstallments : [];
  const paymentTermDisplay = paymentTermLabel(order.paymentTermType, order.paymentTerm);
  const documents = (order.documents || []).map((document) => serializeOrderDocument(document, order));
  const costs = (order.costs || []).map(safeSerializeCost);
  const shippingNotifications = order.shippingDocumentNotifications || [];
  const latestShippingNotification = shippingNotifications[0] || null;
  const completeness = taxDocumentCompleteness(order);
  const taxRefundStatus = derivedTaxRefundStatus(order, order.documents || []);
  const domesticLogisticsInfo = serializeDomesticLogisticsInfo((order.domesticLogisticsInfos || [])[0]);
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
    taxRefundStatusLabel: TAX_REFUND_STATUS_LABELS[taxRefundStatus] || taxRefundStatus,
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
