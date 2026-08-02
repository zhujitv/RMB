import type {
  NotificationRecordOptions,
  ShippingBundle,
  ShippingOrderLike,
} from "./shipping-documents-core";

export function shippingNotificationRecordData(
  order: ShippingOrderLike,
  bundle: ShippingBundle,
  recipientEmails: string[],
  ccEmails: string[],
  sendMode: string,
  sendStatus: string,
  errorMessage = "",
  options: NotificationRecordOptions = {},
) {
  const commercialInvoice = bundle.items.find((item) => item.typeKey === "commercialInvoice")?.document || null;
  return {
    orderId: order.id || "",
    customerId: order.customerId || "",
    invoiceId: commercialInvoice?.id || null,
    sentById: options.sentById || null,
    recipientEmails,
    ccEmails,
    documentTypes: options.documentTypes || bundle.documentTypes,
    attachmentFileIds: bundle.documents.flatMap((document) => (document.id ? [document.id] : [])),
    sendStatus,
    sendMode,
    emailLanguage: options.emailLanguage || null,
    emailSubject: options.emailSubject || null,
    emailBody: options.emailBody || null,
    errorMessage: errorMessage || null,
    sentAt: ["sent", "SUCCESS"].includes(sendStatus) ? new Date() : null,
  };
}
