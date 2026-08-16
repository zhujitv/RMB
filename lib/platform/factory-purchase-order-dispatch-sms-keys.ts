import { createHash } from "node:crypto";

export function factoryDispatchSmsRecipientKey(phone: string) {
  return createHash("sha256").update(phone).digest("hex").slice(0, 20);
}

export function factoryDispatchSmsIdempotencyKey(
  purchaseOrderId: string,
  dispatchVersionNumber: number,
  phone: string,
) {
  return `factory-po-dispatch-sms:${purchaseOrderId}:v${dispatchVersionNumber}:${factoryDispatchSmsRecipientKey(phone)}`;
}
