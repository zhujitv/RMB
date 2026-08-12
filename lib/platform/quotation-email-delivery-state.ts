import { prisma } from "../prisma";
import { publicSendError } from "./notification-helpers";

export function persistedQuotationEmailDraft(delivery: {
  recipientEmails: unknown;
  ccEmails: unknown;
  subject: string;
  body: string;
}) {
  const emailList = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
  return {
    recipientEmails: emailList(delivery.recipientEmails),
    ccEmails: emailList(delivery.ccEmails),
    subject: delivery.subject,
    body: delivery.body,
    variables: {},
  };
}

export function findSentQuotationEmailOutbox(idempotencyKey: string) {
  return prisma.notificationOutbox.findFirst({
    where: { idempotencyKey, status: "sent" },
    select: { id: true, sentAt: true },
  });
}

export async function markQuotationEmailDeliveryFailed(
  deliveryId: string,
  idempotencyKey: string,
  error: unknown,
) {
  const outbox = await prisma.notificationOutbox.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (outbox?.status === "sent") return { sent: true, outboxId: outbox.id };
  await prisma.salesQuotationDelivery.updateMany({
    where: { id: deliveryId, status: "PENDING" },
    data: {
      status: "FAILED",
      outboxId: outbox?.id || undefined,
      failedAt: new Date(),
      lastError: publicSendError(error),
    },
  });
  return { sent: false, outboxId: outbox?.id || null };
}
