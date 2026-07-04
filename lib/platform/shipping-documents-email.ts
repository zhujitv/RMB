import { codedError, isPlainRecord } from "./shared";
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(notificationId ? { "Idempotency-Key": `shipping-docs-${notificationId}` } : {}),
    },
    body: JSON.stringify({
      from,
      to: recipientEmails,
      cc: ccEmails.length ? ccEmails : undefined,
      subject,
      text: body,
      attachments: resendAttachmentPayload(attachments),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as unknown;
    const errorData = isPlainRecord(data) ? data : {};
    const nestedError = isPlainRecord(errorData.error) ? errorData.error : {};
    const reason = errorData.message || nestedError.message || errorData.error || `HTTP ${response.status}`;
    throw codedError(`Resend 邮件发送失败：${reason}`, response.status, "RESEND_SEND_FAILED");
  }
}
