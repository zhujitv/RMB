import { assertWrite, codedError } from "./shared";
import type { QuotationActor } from "./quotation-values";

/**
 * Legacy endpoint guard.
 *
 * A successful PI email only proves that the quotation was sent. Customer
 * acceptance must be recorded through the internal manual-confirmation flow,
 * where the operator, channel, confirmation date and note are preserved.
 */
export async function recordQuotationDecision(
  _request: unknown,
  actor: QuotationActor,
  _quotationId: string,
  _input: unknown,
): Promise<never> {
  assertWrite(actor, "quotations");
  throw codedError(
    "PI 邮件发送仅代表已发送，客户确认请在客户与报价中手动登记",
    409,
    "QUOTATION_EMAIL_DECISION_DISABLED",
  );
}
