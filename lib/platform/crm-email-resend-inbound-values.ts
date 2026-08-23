import { Webhook } from "svix";
import { safeObjectFileName } from "../object-storage";
import {
  assertJsonObject,
  codedError,
  isPlainRecord,
  normalizeEmail,
  parseEmailList,
  validEmail,
} from "./shared";
import {
  CRM_EMAIL_ATTACHMENT_ALLOWED_MIMES,
  CRM_EMAIL_ATTACHMENT_MAX_COUNT,
  CRM_EMAIL_ATTACHMENT_TOTAL_MAX_BYTES,
  normalizeCrmEmailAttachmentMimeType,
} from "./crm-email-attachments";
import { CRM_EMAIL_ATTACHMENT_MAX_BYTES } from "./crm-email-shared";

export const RESEND_WEBHOOK_MAX_BYTES = 1024 * 1024;

export type ResendEmailReceivedEnvelope = {
  emailId: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  providerMessageId: string;
  createdAt: string;
};

export type ResendInboundAttachmentMetadata = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  downloadUrl: string;
};

function requireResendWebhookSecret() {
  const secret = String(process.env.RESEND_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    throw codedError("Resend Webhook 签名密钥未配置，已拒绝入站邮件。", 503, "RESEND_WEBHOOK_SECRET_NOT_CONFIGURED");
  }
  return secret;
}

export function isResendInboundWebhookRequest(request: Request) {
  return ["svix-id", "svix-timestamp", "svix-signature"].some((name) => Boolean(request.headers.get(name)));
}

export function verifyResendInboundWebhookPayload(
  payload: string,
  headers: Headers | Record<string, string>,
  webhookSecret = requireResendWebhookSecret(),
) {
  const readHeader = (name: string) => headers instanceof Headers ? headers.get(name) || "" : String(headers[name] || "");
  const verificationHeaders = {
    "svix-id": readHeader("svix-id"),
    "svix-timestamp": readHeader("svix-timestamp"),
    "svix-signature": readHeader("svix-signature"),
  };
  if (Object.values(verificationHeaders).some((value) => !value)) {
    throw codedError("Resend Webhook 缺少签名请求头。", 401, "RESEND_WEBHOOK_SIGNATURE_HEADERS_MISSING");
  }
  try {
    return new Webhook(webhookSecret).verify(payload, verificationHeaders);
  } catch {
    throw codedError("Resend Webhook 签名校验失败。", 401, "RESEND_WEBHOOK_SIGNATURE_INVALID");
  }
}

export function resendInboundMessageId(emailId: string) {
  return `resend-inbound:${emailId}`;
}

export function parseMailbox(value: unknown) {
  const text = String(value || "").trim();
  const match = text.match(/^(?:"([^"]*)"|([^<]*?))?\s*<([^<>]+)>$/);
  const email = normalizeEmail(match?.[3] || text);
  const name = String(match?.[1] || match?.[2] || "").trim().replace(/^"|"$/g, "").slice(0, 120);
  return { email, name };
}

export function parseResendEmailReceivedEnvelope(input: unknown): ResendEmailReceivedEnvelope | null {
  const event = assertJsonObject(input);
  if (String(event.type || "") !== "email.received") return null;
  const data = assertJsonObject(event.data);
  const emailId = String(data.email_id || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(emailId)) {
    throw codedError("Resend 入站事件缺少有效 email_id。", 400, "RESEND_INBOUND_EMAIL_ID_INVALID");
  }
  const fromEmail = parseMailbox(data.from).email;
  if (!validEmail(fromEmail)) {
    throw codedError("Resend 入站事件缺少有效发件邮箱。", 400, "RESEND_INBOUND_FROM_INVALID");
  }
  const toEmails = parseEmailList(data.to).filter(validEmail);
  const receivedFor = parseEmailList(data.received_for).filter(validEmail);
  const recipients = [...new Set([...toEmails, ...receivedFor])];
  if (!recipients.length) {
    throw codedError("Resend 入站事件缺少有效收件邮箱。", 400, "RESEND_INBOUND_TO_INVALID");
  }
  return {
    emailId,
    fromEmail,
    toEmails: recipients,
    ccEmails: parseEmailList(data.cc).filter(validEmail),
    subject: String(data.subject || "").trim().slice(0, 200),
    providerMessageId: String(data.message_id || "").trim().slice(0, 500),
    createdAt: String(data.created_at || event.created_at || "").trim(),
  };
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, token: string) => {
    if (token.startsWith("#")) {
      const hex = token[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try { return String.fromCodePoint(codePoint); } catch { return whole; }
      }
      return whole;
    }
    return named[token.toLowerCase()] ?? whole;
  });
}

export function plainTextFromResendEmail(textValue: unknown, htmlValue: unknown) {
  const text = String(textValue || "").replace(/\r\n?/g, "\n").trim();
  if (text) return text.slice(0, 10_000);
  const html = String(htmlValue || "");
  if (!html.trim()) return "（邮件正文为空）";
  const plain = decodeHtmlEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return (plain || "（邮件正文为空）").slice(0, 10_000);
}

function attachmentMetadata(value: unknown): ResendInboundAttachmentMetadata | null {
  if (!isPlainRecord(value)) return null;
  const id = String(value.id || "").trim();
  const rawName = String(value.filename || "").trim();
  const downloadUrl = String(value.download_url || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !rawName || !downloadUrl) return null;
  const fileName = safeObjectFileName(rawName);
  const mimeType = normalizeCrmEmailAttachmentMimeType(fileName, value.content_type);
  const fileSize = Number(value.size || 0);
  return {
    id,
    fileName,
    mimeType,
    fileSize: Number.isSafeInteger(fileSize) && fileSize >= 0 ? fileSize : 0,
    downloadUrl,
  };
}

export function selectResendInboundAttachments(values: unknown[]) {
  const accepted: ResendInboundAttachmentMetadata[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  for (const value of values) {
    const item = attachmentMetadata(value);
    if (!item) {
      skipped.push("存在一个无效附件");
      continue;
    }
    if (!CRM_EMAIL_ATTACHMENT_ALLOWED_MIMES.has(item.mimeType)) {
      skipped.push(`${item.fileName}（不支持的文件类型）`);
      continue;
    }
    if (item.fileSize > CRM_EMAIL_ATTACHMENT_MAX_BYTES) {
      skipped.push(`${item.fileName}（超过 10MB）`);
      continue;
    }
    if (accepted.length >= CRM_EMAIL_ATTACHMENT_MAX_COUNT) {
      skipped.push(`${item.fileName}（超过附件数量上限）`);
      continue;
    }
    if (item.fileSize && totalBytes + item.fileSize > CRM_EMAIL_ATTACHMENT_TOTAL_MAX_BYTES) {
      skipped.push(`${item.fileName}（超过附件总大小上限）`);
      continue;
    }
    totalBytes += item.fileSize;
    accepted.push(item);
  }
  return { accepted, skipped };
}
