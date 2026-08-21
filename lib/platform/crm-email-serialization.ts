import type { Prisma } from "../generated/prisma/client.js";
import { serializeCrmEmailAttachment } from "./crm-email-attachments";

export type CrmEmailRow = Prisma.CrmEmailMessageGetPayload<{
  include: {
    account: true;
    createdBy: { select: { name: true; englishName: true } };
    updatedBy: { select: { name: true; englishName: true } };
  };
}>;

export function crmEmailMessageInclude() {
  return {
    account: true,
    createdBy: { select: { name: true, englishName: true } },
    updatedBy: { select: { name: true, englishName: true } },
  } as const;
}

export function serializeEmailMessage(row: CrmEmailRow) {
  return {
    id: row.id,
    customerId: row.customerId,
    accountId: row.accountId,
    accountEmail: row.account?.emailAddress || "",
    direction: row.direction,
    status: row.status,
    fromName: row.fromName || "",
    fromEmail: row.fromEmail,
    toEmails: Array.isArray(row.toEmails) ? row.toEmails : [],
    ccEmails: Array.isArray(row.ccEmails) ? row.ccEmails : [],
    subject: row.subject,
    bodyText: row.bodyText,
    messageId: row.messageId || "",
    threadKey: row.threadKey || "",
    relatedQuotationId: row.relatedQuotationId || "",
    relatedOrderId: row.relatedOrderId || "",
    lastError: row.lastError || "",
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByName: row.createdBy?.englishName || row.createdBy?.name || "",
    updatedByName: row.updatedBy?.englishName || row.updatedBy?.name || "",
    attachments: [] as ReturnType<typeof serializeCrmEmailAttachment>[],
  };
}

export function serializeEmailMessageWithAttachments(
  row: CrmEmailRow,
  attachments: ReturnType<typeof serializeCrmEmailAttachment>[] = [],
) {
  return { ...serializeEmailMessage(row), attachments };
}
