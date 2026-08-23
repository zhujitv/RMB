import crypto from "node:crypto";
import { prisma } from "../prisma";
import { codedError, isPlainRecord, parseEmailList, validEmail } from "./shared";
import { redactSensitiveText } from "./shared-base-utils";
import { createOutboundTimeoutSignal, readResponseTextLimited } from "./outbound-request-security";
import {
  assertCrmEmailAttachmentBodyMatchesMime,
  CRM_EMAIL_ATTACHMENT_TOTAL_MAX_BYTES,
} from "./crm-email-attachments";
import {
  CRM_EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ACCOUNT_STATUS_ACTIVE,
  type AuditRequest,
  type CrmEmailAttachmentFile,
} from "./crm-email-shared";
import { getCrmEmailIntegrationSettings } from "./crm-email-settings";
import { recordInboundCustomerCrmEmailMessage } from "./crm-email-inbound";
import { crmEmailMessageInclude, serializeEmailMessageWithAttachments } from "./crm-email-serialization";
import {
  parseMailbox,
  parseResendEmailReceivedEnvelope,
  plainTextFromResendEmail,
  RESEND_WEBHOOK_MAX_BYTES,
  resendInboundMessageId,
  selectResendInboundAttachments,
  type ResendInboundAttachmentMetadata,
  verifyResendInboundWebhookPayload,
} from "./crm-email-resend-inbound-values";
import {
  claimWebhookReplay,
  completeWebhookReplayClaim,
  releaseWebhookReplayClaim,
} from "./webhook-replay-guard";

export {
  isResendInboundWebhookRequest,
  parseMailbox,
  plainTextFromResendEmail,
  resendInboundMessageId,
  selectResendInboundAttachments,
  verifyResendInboundWebhookPayload,
} from "./crm-email-resend-inbound-values";
export type { ResendInboundAttachmentMetadata } from "./crm-email-resend-inbound-values";

const RESEND_RECEIVING_ENDPOINT = "https://api.resend.com/emails/receiving";
const RESEND_JSON_MAX_BYTES = 2 * 1024 * 1024;
const RESEND_RECEIVING_TIMEOUT_MS = 15_000;

function requireResendInboundApiKey() {
  const apiKey = String(process.env.RESEND_INBOUND_API_KEY || "").trim();
  if (!apiKey) {
    throw codedError("Resend 收信 API Key 未配置，无法读取邮件正文。", 503, "RESEND_INBOUND_API_KEY_NOT_CONFIGURED");
  }
  return apiKey;
}

async function readResendJson(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${requireResendInboundApiKey()}` },
    cache: "no-store",
    redirect: "error",
    signal: createOutboundTimeoutSignal(RESEND_RECEIVING_TIMEOUT_MS),
  });
  const responseText = await readResponseTextLimited(response, RESEND_JSON_MAX_BYTES);
  if (!response.ok) {
    let reason = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(responseText) as unknown;
      if (isPlainRecord(parsed)) reason = String(parsed.message || parsed.error || reason);
    } catch {
      reason = responseText || reason;
    }
    throw codedError(`Resend 收信接口失败：${redactSensitiveText(reason, 300)}`, 502, "RESEND_RECEIVING_API_FAILED");
  }
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!isPlainRecord(parsed)) throw new Error("invalid_json_shape");
    return parsed;
  } catch {
    throw codedError("Resend 收信接口返回了无效数据。", 502, "RESEND_RECEIVING_RESPONSE_INVALID");
  }
}

function assertResendAttachmentDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname !== "inbound-cdn.resend.com") {
      throw new Error("not_allowed");
    }
    return url.toString();
  } catch {
    throw codedError("Resend 附件下载地址不安全，已拒绝下载。", 502, "RESEND_ATTACHMENT_URL_INVALID");
  }
}

async function readResponseBufferLimited(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw codedError("Resend 入站附件超过安全上限。", 413, "RESEND_ATTACHMENT_TOO_LARGE");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw codedError("Resend 入站附件超过安全上限。", 413, "RESEND_ATTACHMENT_TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadResendAttachment(item: ResendInboundAttachmentMetadata): Promise<CrmEmailAttachmentFile> {
  const response = await fetch(assertResendAttachmentDownloadUrl(item.downloadUrl), {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal: createOutboundTimeoutSignal(RESEND_RECEIVING_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw codedError(`Resend 附件下载失败：HTTP ${response.status}`, 502, "RESEND_ATTACHMENT_DOWNLOAD_FAILED");
  }
  const body = await readResponseBufferLimited(response, CRM_EMAIL_ATTACHMENT_MAX_BYTES);
  if (!body.byteLength) throw codedError(`Resend 附件为空：${item.fileName}`, 502, "RESEND_ATTACHMENT_EMPTY");
  assertCrmEmailAttachmentBodyMatchesMime(item.fileName, item.mimeType, body);
  return {
    originalFileName: item.fileName,
    fileName: item.fileName,
    mimeType: item.mimeType,
    fileSize: body.byteLength,
    body,
    contentSha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

async function fetchResendEmail(emailId: string) {
  const encodedId = encodeURIComponent(emailId);
  const [email, listed] = await Promise.all([
    readResendJson(`${RESEND_RECEIVING_ENDPOINT}/${encodedId}?html_format=cid`),
    readResendJson(`${RESEND_RECEIVING_ENDPOINT}/${encodedId}/attachments`),
  ]);
  const { accepted, skipped } = selectResendInboundAttachments(Array.isArray(listed.data) ? listed.data : []);
  const downloaded = await Promise.allSettled(accepted.map(downloadResendAttachment));
  const files: CrmEmailAttachmentFile[] = [];
  let totalBytes = 0;
  for (let index = 0; index < downloaded.length; index += 1) {
    const result = downloaded[index];
    if (result.status === "rejected") {
      skipped.push(`${accepted[index]?.fileName || "附件"}（下载或安全校验失败）`);
      continue;
    }
    const file = result.value;
    if (totalBytes + file.fileSize > CRM_EMAIL_ATTACHMENT_TOTAL_MAX_BYTES) {
      skipped.push(`${file.fileName}（超过附件总大小上限）`);
      continue;
    }
    totalBytes += file.fileSize;
    files.push(file);
  }
  return { email, files, skipped };
}

function resendReceivedAt(value: string) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

async function processClaimedResendEmail(request: AuditRequest & Request, envelope: NonNullable<ReturnType<typeof parseResendEmailReceivedEnvelope>>) {
  const { email, files, skipped } = await fetchResendEmail(envelope.emailId);
  const headerMap = isPlainRecord(email.headers) ? email.headers : {};
  const sender = parseMailbox(headerMap.from || email.from || envelope.fromEmail);
  if (!validEmail(sender.email)) {
    throw codedError("Resend 邮件正文缺少有效发件邮箱。", 502, "RESEND_RECEIVING_FROM_INVALID");
  }
  const toEmails = [...new Set([...parseEmailList(email.to).filter(validEmail), ...envelope.toEmails])];
  const ccEmails = [...new Set([...parseEmailList(email.cc).filter(validEmail), ...envelope.ccEmails])];
  let bodyText = plainTextFromResendEmail(email.text, email.html);
  if (skipped.length) {
    const note = `\n\n[系统提示：以下附件未归档：${skipped.join("；")}。原始邮件仍保留在 Resend Receiving。]`;
    bodyText = `${bodyText.slice(0, Math.max(0, 10_000 - note.length))}${note}`;
  }
  return recordInboundCustomerCrmEmailMessage(request, {
    fromEmail: sender.email,
    fromName: sender.name,
    toEmails,
    ccEmails,
    subject: String(email.subject || envelope.subject || "（无主题）").trim().slice(0, 200) || "（无主题）",
    bodyText,
    messageId: resendInboundMessageId(envelope.emailId),
    threadKey: String(headerMap["in-reply-to"] || email.message_id || envelope.providerMessageId || resendInboundMessageId(envelope.emailId)).trim().slice(0, 500),
    receivedAt: resendReceivedAt(String(email.created_at || envelope.createdAt)),
  }, files);
}

export async function receiveResendCustomerCrmEmail(request: AuditRequest & Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > RESEND_WEBHOOK_MAX_BYTES) {
    throw codedError("Resend Webhook 请求体超过安全上限。", 413, "RESEND_WEBHOOK_TOO_LARGE");
  }
  const payload = await request.text();
  if (Buffer.byteLength(payload, "utf8") > RESEND_WEBHOOK_MAX_BYTES) {
    throw codedError("Resend Webhook 请求体超过安全上限。", 413, "RESEND_WEBHOOK_TOO_LARGE");
  }
  const envelope = parseResendEmailReceivedEnvelope(verifyResendInboundWebhookPayload(payload, request.headers));
  if (!envelope) return { message: null, deliveryMessage: "非 email.received 事件已忽略", ignored: true };

  const settings = await getCrmEmailIntegrationSettings();
  if (!settings.enabled || !settings.inboundEnabled) {
    return { message: null, deliveryMessage: "CRM 邮件入站通道未启用，事件已忽略", ignored: true };
  }
  const account = await prisma.crmEmailAccount.findFirst({
    where: {
      emailAddress: { in: envelope.toEmails, mode: "insensitive" },
      deletedAt: null,
      status: EMAIL_ACCOUNT_STATUS_ACTIVE,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!account) return { message: null, deliveryMessage: "收件地址未绑定有效 CRM 账户，事件已忽略", ignored: true };

  const matchingCustomers = await prisma.customer.findMany({
    where: { contactEmail: { equals: envelope.fromEmail, mode: "insensitive" }, deletedAt: null },
    select: { id: true },
    take: 2,
  });
  if (matchingCustomers.length !== 1) {
    return {
      message: null,
      deliveryMessage: "发件人未能唯一匹配客户，原始邮件已保留在 Resend 待人工处理",
      ignored: true,
    };
  }

  const stableMessageId = resendInboundMessageId(envelope.emailId);
  const existing = await prisma.crmEmailMessage.findUnique({ where: { messageId: stableMessageId }, include: crmEmailMessageInclude() });
  if (existing) {
    return { message: serializeEmailMessageWithAttachments(existing), deliveryMessage: "Resend 入站邮件已存在，已跳过重复写入", ignored: false };
  }

  const fingerprint = crypto.createHash("sha256").update(`resend:${envelope.emailId}`).digest("hex");
  const claim = await claimWebhookReplay("resend", fingerprint);
  if (!claim.claimed) {
    if (claim.processed) return { message: null, deliveryMessage: "Resend 入站事件已处理", ignored: true };
    throw codedError("同一封入站邮件正在处理中，请稍后重试。", 409, "RESEND_INBOUND_PROCESSING");
  }
  try {
    const result = await processClaimedResendEmail(request, envelope);
    await completeWebhookReplayClaim(claim.key, "resend");
    return { ...result, ignored: false };
  } catch (error: unknown) {
    const code = String((error as { code?: string } | null)?.code || "");
    if (["CRM_EMAIL_INBOUND_CUSTOMER_UNMATCHED", "CRM_EMAIL_INBOUND_CUSTOMER_AMBIGUOUS"].includes(code)) {
      await completeWebhookReplayClaim(claim.key, "resend");
      return { message: null, deliveryMessage: "发件人未能唯一匹配客户，原始邮件已保留在 Resend 待人工处理", ignored: true };
    }
    await releaseWebhookReplayClaim(claim.key);
    throw error;
  }
}
