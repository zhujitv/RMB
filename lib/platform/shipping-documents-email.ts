import { codedError } from "./shared";
import {
  assertResendResponseOk,
  resendIdempotencyHeaderValue,
  resendRequestSignal,
} from "./resend-email-security";
import { type EmailAttachment, type SendShippingDocumentsEmailInput } from "./shipping-documents-shared";

function resendMailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM;
  const endpoint = process.env.RESEND_EMAIL_ENDPOINT || "https://api.resend.com/emails";
  if (!apiKey || !from) {
    throw codedError("Resend 邮件服务未配置，未发送。", 500, "MAIL_SERVICE_NOT_CONFIGURED");
  }
  return { apiKey, from, endpoint };
}

function resendAttachmentPayload(attachments: EmailAttachment[] = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: Buffer.isBuffer(attachment.content)
      ? attachment.content.toString("base64")
      : Buffer.from(String(attachment.content || "")).toString("base64"),
  }));
}


export async function sendShippingDocumentsEmail({ recipientEmails, ccEmails, attachments, subject, body, notificationId }: SendShippingDocumentsEmailInput) {
  const { apiKey, from, endpoint } = resendMailConfig();
  const idempotencyHeader = resendIdempotencyHeaderValue(
    notificationId ? `shipping-docs-${notificationId}` : null,
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyHeader ? { "Idempotency-Key": idempotencyHeader } : {}),
    },
    body: JSON.stringify({
      from,
      to: recipientEmails,
      cc: ccEmails.length ? ccEmails : undefined,
      subject,
      text: body,
      attachments: resendAttachmentPayload(attachments),
    }),
    signal: resendRequestSignal(),
  });
  await assertResendResponseOk(response);
}
