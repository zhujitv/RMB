import { codedError, isPlainRecord } from "./shared-base-utils";
import type { NotificationAttachment } from "./notification-definitions";

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
  const configuredTimeout = Number(process.env.RESEND_SEND_TIMEOUT_MS || 10000);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(30000, Math.max(1000, configuredTimeout))
    : 10000;
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
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as unknown;
    const errorData = isPlainRecord(data) ? data : {};
    const nestedError = isPlainRecord(errorData.error) ? errorData.error : {};
    const reason = errorData.message || nestedError.message || errorData.error || `HTTP ${response.status}`;
    throw codedError(`Resend 邮件发送失败：${reason}`, response.status, "RESEND_SEND_FAILED");
  }
}
