import { prisma } from "../prisma";
import {
  bodyPreview,
  jsonOrNull,
  uniqueEmails,
} from "./notification-helpers";
import { codedError, nonEmpty } from "./shared-base-utils";
import { asRecord } from "./logistics-invoice-outbox-model";

export async function markOutboxSkipped(outbox: Awaited<ReturnType<typeof prisma.notificationOutbox.findUniqueOrThrow>>, reason: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: outbox.attempts },
      data: { status: "skipped", lastError: reason || null, failedAt: null },
    });
    if (updated.count !== 1) {
      throw codedError("通知任务状态已变化。", 409, "LOGISTICS_INVOICE_OUTBOX_STATE_CHANGED");
    }
    await tx.notificationDeliveryLog.create({
      data: {
        outboxId: outbox.id,
        templateId: outbox.templateId,
        type: outbox.type,
        status: "skipped",
        recipientEmails: uniqueEmails([outbox.recipientEmails]),
        ccEmails: jsonOrNull(outbox.ccEmails),
        subject: outbox.subject,
        bodyPreview: bodyPreview(outbox.body),
        relatedEntityType: outbox.relatedEntityType,
        relatedEntityId: outbox.relatedEntityId,
        relatedOrderId: outbox.relatedOrderId,
        errorMessage: reason || null,
        provider: "system",
        sentAt: now,
      },
    });
  });
  return { outboxId: outbox.id, sent: false, skipped: true, queued: false, error: reason };
}

export async function persistLogisticsInvoiceDeliverySuccess(
  outbox: Awaited<ReturnType<typeof prisma.notificationOutbox.findUniqueOrThrow>>,
  rows: Array<{ id: string; billId: string | null }>,
  recipientEmails: string[],
  ccEmails: string[],
  subject: string,
  storedBody: string,
) {
  const sentAt = new Date();
  const expenseIds = rows.map((row) => row.id);
  const billIds = [...new Set(rows.map((row) => nonEmpty(row.billId)).filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    const outboxUpdate = await tx.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: outbox.attempts },
      data: {
        status: "sent",
        sentAt,
        failedAt: null,
        lastError: null,
        recipientEmails,
        ccEmails,
        subject,
        body: storedBody,
        context: jsonOrNull({ ...asRecord(outbox.context), phase: "sent", expenseIds }),
      },
    });
    if (outboxUpdate.count !== 1) {
      throw codedError("通知任务状态已变化。", 409, "LOGISTICS_INVOICE_OUTBOX_STATE_CHANGED");
    }
    await tx.notificationDeliveryLog.create({
      data: {
        outboxId: outbox.id,
        templateId: outbox.templateId,
        type: outbox.type,
        status: "sent",
        recipientEmails,
        ccEmails,
        subject,
        bodyPreview: bodyPreview(storedBody),
        relatedEntityType: outbox.relatedEntityType,
        relatedEntityId: outbox.relatedEntityId,
        relatedOrderId: outbox.relatedOrderId,
        provider: "resend",
        sentAt,
      },
    });
    if (expenseIds.length) {
      await tx.logisticsExpense.updateMany({
        where: { id: { in: expenseIds }, deletedAt: null },
        data: { invoiceNotifiedAt: sentAt, invoiceNotificationError: null },
      });
    }
    if (billIds.length) {
      await tx.logisticsBill.updateMany({
        where: { id: { in: billIds }, deletedAt: null },
        data: { invoiceNotifiedAt: sentAt, invoiceNotificationError: null },
      });
    }
  });
}

export async function persistLogisticsInvoiceDeliveryFailure(
  outbox: Awaited<ReturnType<typeof prisma.notificationOutbox.findUniqueOrThrow>>,
  rows: Array<{ id: string; billId: string | null }>,
  message: string,
) {
  const failedAt = new Date();
  const retryDelayMs = Math.min(30 * 60 * 1000, Math.max(60 * 1000, 2 ** Math.max(0, outbox.attempts - 1) * 60 * 1000));
  const scheduledAt = new Date(failedAt.getTime() + retryDelayMs);
  const expenseIds = rows.map((row) => row.id);
  const billIds = [...new Set(rows.map((row) => nonEmpty(row.billId)).filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: outbox.attempts },
      data: { status: "failed", failedAt, lastError: message, scheduledAt },
    });
    if (updated.count !== 1) {
      throw codedError("通知任务状态已变化。", 409, "LOGISTICS_INVOICE_OUTBOX_STATE_CHANGED");
    }
    await tx.notificationDeliveryLog.create({
      data: {
        outboxId: outbox.id,
        templateId: outbox.templateId,
        type: outbox.type,
        status: "failed",
        recipientEmails: uniqueEmails([outbox.recipientEmails]),
        ccEmails: jsonOrNull(outbox.ccEmails),
        subject: outbox.subject,
        bodyPreview: bodyPreview(outbox.body),
        relatedEntityType: outbox.relatedEntityType,
        relatedEntityId: outbox.relatedEntityId,
        relatedOrderId: outbox.relatedOrderId,
        errorMessage: message,
        provider: "resend",
      },
    });
    if (expenseIds.length) {
      await tx.logisticsExpense.updateMany({
        where: { id: { in: expenseIds }, deletedAt: null },
        data: { invoiceNotificationError: message },
      });
    }
    if (billIds.length) {
      await tx.logisticsBill.updateMany({
        where: { id: { in: billIds }, deletedAt: null },
        data: { invoiceNotificationError: message },
      });
    }
  });
}
