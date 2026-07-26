import { codedError } from "./shared-base-utils";
import type { NotificationAttachment } from "./notification-definitions";
import { assertResendResponseOk, resendRequestSignal } from "./resend-email-security";

export function notificationMailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM;
  const endpoint = process.env.RESEND_EMAIL_ENDPOINT || "https://api.resend.com/emails";
  if (!apiKey || !from) {
    throw codedError("Resend 邮件服务未配置，未发送。", 500, "MAIL_SERVICE_NOT_CONFIGURED");
  }
  return { apiKey, from, endpoint };
}

export function resendAttachmentPayload(attachments: NotificationAttachment[] = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(String(attachment.content || "")).toString("base64"),
  }));
}

export async function sendResendEmail({
  recipientEmails,
  ccEmails,
  subject,
  body,
  attachments = [],
  idempotencyKey,
}: {
  recipientEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  attachments?: NotificationAttachment[];
  idempotencyKey?: string | null;
}) {
  const { apiKey, from, endpoint } = notificationMailConfig();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: recipientEmails,
      cc: ccEmails.length ? ccEmails : undefined,
      subject,
      text: body,
      attachments: attachments.length ? resendAttachmentPayload(attachments) : undefined,
    }),
    signal: resendRequestSignal(),
  });
  await assertResendResponseOk(response);
}
