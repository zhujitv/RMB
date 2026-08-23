import { codedError } from "./shared-base-utils";
import type { NotificationAttachment } from "./notification-definitions";
import {
  assertResendResponseOk,
  resendIdempotencyHeaderValue,
  resendRequestSignal,
} from "./resend-email-security";

const MAX_NOTIFICATION_ATTACHMENT_COUNT = 20;
const MAX_NOTIFICATION_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_NOTIFICATION_ATTACHMENTS_BASE64_BYTES = 36 * 1024 * 1024;
const ALLOWED_NOTIFICATION_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function safeAttachmentFileName(value: unknown) {
  const name = String(value || "attachment")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f\r\n"<>:|?*]+/g, "_")
    .trim();
  return (name || "attachment").slice(0, 180);
}

export function validateNotificationAttachments(attachments: NotificationAttachment[] = []) {
  if (attachments.length > MAX_NOTIFICATION_ATTACHMENT_COUNT) {
    throw codedError("邮件附件数量过多，无法发送。", 413, "NOTIFICATION_ATTACHMENT_COUNT_EXCEEDED");
  }
  let encodedBytes = 0;
  return attachments.map((attachment) => {
    const content = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(String(attachment.content || ""));
    if (!content.byteLength || content.byteLength > MAX_NOTIFICATION_ATTACHMENT_BYTES) {
      throw codedError("邮件单个附件必须大于 0 且不能超过 10MB。", 413, "NOTIFICATION_ATTACHMENT_SIZE_INVALID");
    }
    const contentType = String(attachment.contentType || "application/octet-stream").trim().toLowerCase();
    if (!ALLOWED_NOTIFICATION_ATTACHMENT_MIME_TYPES.has(contentType)) {
      throw codedError("邮件附件类型不允许发送。", 400, "NOTIFICATION_ATTACHMENT_TYPE_NOT_ALLOWED");
    }
    encodedBytes += 4 * Math.ceil(content.byteLength / 3);
    if (encodedBytes > MAX_NOTIFICATION_ATTACHMENTS_BASE64_BYTES) {
      throw codedError("邮件附件总大小超过安全发送上限。", 413, "NOTIFICATION_ATTACHMENT_TOTAL_TOO_LARGE");
    }
    return {
      ...attachment,
      filename: safeAttachmentFileName(attachment.filename),
      content,
      contentType,
    };
  });
}

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
  return validateNotificationAttachments(attachments).map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content.toString("base64"),
    content_type: attachment.contentType,
  }));
}

export async function sendResendEmail({
  recipientEmails,
  ccEmails,
  subject,
  body,
  html,
  attachments = [],
  idempotencyKey,
}: {
  recipientEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  html?: string;
  attachments?: NotificationAttachment[];
  idempotencyKey?: string | null;
}) {
  const { apiKey, from, endpoint } = notificationMailConfig();
  const validatedAttachments = validateNotificationAttachments(attachments);
  const idempotencyHeader = resendIdempotencyHeaderValue(idempotencyKey);
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
      html: html || undefined,
      attachments: validatedAttachments.length ? resendAttachmentPayload(validatedAttachments) : undefined,
    }),
    signal: resendRequestSignal(),
  });
  await assertResendResponseOk(response);
}
