import { assertQuotationEmailRecipientsAuthorized } from "./quotation-email-delivery-rules";
import { uniqueEmails } from "./notification-helpers";

type QuotationEmailRecipientSource = {
  versionContactEmail?: unknown;
  customerContactEmail?: unknown;
  shippingDocsEmails?: unknown;
  shippingDocsCcEmails?: unknown;
};

export function assertQuotationCustomerEmailRecipients(
  recipientEmails: string[],
  ccEmails: string[],
  source: QuotationEmailRecipientSource,
) {
  assertQuotationEmailRecipientsAuthorized(
    recipientEmails,
    ccEmails,
    uniqueEmails([
      source.versionContactEmail,
      source.customerContactEmail,
      source.shippingDocsEmails,
      source.shippingDocsCcEmails,
    ]),
  );
}
