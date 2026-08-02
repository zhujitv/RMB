import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import type { ManualShippingEmailInput } from "./shipping-documents-core";

const MANUAL_SEND_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

type ShippingNotificationCreateData = Parameters<typeof prisma.shippingDocumentNotification.create>[0]["data"];
type FingerprintInput = {
  recipientEmails?: unknown;
  ccEmails?: unknown;
  emailSubject?: unknown;
  emailBody?: unknown;
  attachmentFileIds?: unknown;
};

function sortedStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean).sort()
    : [];
}

export function manualSendFingerprint(input: FingerprintInput) {
  return createHash("sha256").update(JSON.stringify({
    recipientEmails: sortedStringList(input.recipientEmails),
    ccEmails: sortedStringList(input.ccEmails),
    emailSubject: String(input.emailSubject || "").trim(),
    emailBody: String(input.emailBody || "").trim(),
    attachmentFileIds: sortedStringList(input.attachmentFileIds),
  })).digest("hex");
}

export function manualSendIdempotencyKey(orderId: string, input: ManualShippingEmailInput) {
  const requestId = String(input.requestId || input.idempotencyKey || "").trim() || randomUUID();
  const requestHash = createHash("sha256").update(requestId).digest("hex").slice(0, 32);
  return `shipping-docs:manual:${orderId}:${requestHash}`;
}

export async function claimManualShippingNotification(
  orderId: string,
  data: ShippingNotificationCreateData,
  fingerprint: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`shipping-docs:manual:${orderId}`}, 0))`;
    const recent = await tx.shippingDocumentNotification.findMany({
      where: {
        orderId,
        createdAt: { gte: new Date(Date.now() - MANUAL_SEND_DUPLICATE_WINDOW_MS) },
        sendStatus: { in: ["pending", "sent", "SUCCESS"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        recipientEmails: true,
        ccEmails: true,
        emailSubject: true,
        emailBody: true,
        attachmentFileIds: true,
        sendStatus: true,
      },
    });
    const duplicate = recent.find((item) => manualSendFingerprint(item) === fingerprint);
    if (duplicate) return { duplicate, row: null };
    return {
      duplicate: null,
      row: await tx.shippingDocumentNotification.create({ data }),
    };
  });
}
