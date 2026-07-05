import { dateToInput, parseEmailList } from "./shared-base-utils";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  SHIPPING_EMAIL_LANGUAGE_LABELS,
  normalizeClearanceEmailLanguage,
  normalizeShippingDocumentTypes,
  standardFilenameForDocument,
} from "./shared-constants";
import { customerFullName, customerShortName } from "./shared-serialization";
import {
  type OrderDocumentLike,
  type ShippingDocumentBundle,
  type ShippingDocumentBundleItem,
  type ShippingOrderLike,
} from "./shared-order-serialization-types";

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

export function shippingDocumentDraft(order: ShippingOrderLike = {}) {
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
