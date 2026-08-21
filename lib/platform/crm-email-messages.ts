import crypto from "node:crypto";
import type { FileAsset } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readObjectStorageObject } from "../object-storage";
import { assertJsonObject, codedError, isPlainRecord, requireText, runNonCriticalTask, writeAudit } from "./shared";
import { assertResendResponseOk, resendIdempotencyHeaderValue, resendRequestSignal } from "./resend-email-security";
import {
  assertCustomerCrmRead,
  assertCustomerCrmWrite,
  assertScopedCustomerForCrmEmail,
  cleanEmailSubject,
  CRM_EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ACCOUNT_STATUS_ACTIVE,
  EMAIL_MESSAGE_STATUS_QUEUED,
  EMAIL_MESSAGE_STATUS_SENT,
  emailArray,
  type AuditRequest,
  type CrmEmailActor,
  type CrmEmailAttachmentFile,
  type QueryLike,
  requireActorId,
} from "./crm-email-shared";
import { getCrmEmailIntegrationSettings } from "./crm-email-settings";
import {
  listCrmEmailAttachments,
  readCrmEmailAttachmentFiles,
  serializeCrmEmailAttachment,
  storeCrmEmailAttachments,
} from "./crm-email-attachments";
import { crmEmailMessageInclude, serializeEmailMessageWithAttachments } from "./crm-email-serialization";

async function sendCrmEmailViaResend(input: {
  fromName: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyText: string;
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
  idempotencyKey: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const endpoint = process.env.RESEND_EMAIL_ENDPOINT || "https://api.resend.com/emails";
  if (!apiKey) throw codedError("CRM 邮件外发服务未配置，邮件已保存但未真实发送。", 500, "MAIL_SERVICE_NOT_CONFIGURED");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(resendIdempotencyHeaderValue(input.idempotencyKey) ? { "Idempotency-Key": resendIdempotencyHeaderValue(input.idempotencyKey) } : {}),
    },
    body: JSON.stringify({
      from: `${input.fromName} <${input.fromEmail}>`,
      to: input.toEmails,
      cc: input.ccEmails.length ? input.ccEmails : undefined,
      subject: input.subject,
      text: input.bodyText,
      attachments: input.attachments.length
        ? input.attachments.map((item) => ({ filename: item.filename, content: item.content.toString("base64"), content_type: item.contentType }))
        : undefined,
    }),
    signal: resendRequestSignal(),
  });
  await assertResendResponseOk(response);
  const payload = await response.json().catch(() => ({}));
  return isPlainRecord(payload) ? String(payload.id || "") : "";
}

export async function listCustomerCrmEmailMessages(query: QueryLike, actor: CrmEmailActor) {
  assertCustomerCrmRead(actor);
  const customerId = String(query.get("customerId") || "").trim();
  await assertScopedCustomerForCrmEmail(actor, customerId);
  const rows = await prisma.crmEmailMessage.findMany({
    where: { customerId, deletedAt: null },
    include: crmEmailMessageInclude(),
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
  const attachmentMap = await listCrmEmailAttachments(rows.map((row) => row.id));
  return { rows: rows.map((row) => serializeEmailMessageWithAttachments(row, attachmentMap.get(row.id) || [])) };
}

export async function parseCrmEmailMessageRequestBody(request: Request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data;")) {
    return { body: assertJsonObject(await request.json()), files: [] as CrmEmailAttachmentFile[] };
  }
  const formData = await request.formData();
  const body: Record<string, unknown> = {};
  for (const key of ["customerId", "toEmails", "ccEmails", "subject", "bodyText", "threadKey", "relatedQuotationId", "relatedOrderId"]) {
    body[key] = formData.get(key);
  }
  return { body, files: await readCrmEmailAttachmentFiles(formData) };
}

async function outgoingAttachmentPayload(attachments: FileAsset[]) {
  return Promise.all(attachments.map(async (asset) => ({
    filename: asset.fileName,
    content: await readObjectStorageObject(asset.storageKey, { maxBytes: CRM_EMAIL_ATTACHMENT_MAX_BYTES }),
    contentType: asset.mimeType,
  })));
}

export async function createCustomerCrmEmailMessage(
  request: AuditRequest,
  actor: CrmEmailActor,
  input: unknown = {},
  files: CrmEmailAttachmentFile[] = [],
) {
  assertCustomerCrmWrite(actor);
  const actorId = requireActorId(actor);
  const body = assertJsonObject(input);
  const settings = await getCrmEmailIntegrationSettings();
  if (!settings.enabled) throw codedError("CRM 邮件模块未启用，请先由管理员在系统设置中开启。", 409, "CRM_EMAIL_MODULE_DISABLED");
  const customerId = String(body.customerId || "").trim();
  await assertScopedCustomerForCrmEmail(actor, customerId);
  const account = await prisma.crmEmailAccount.findUnique({ where: { userId: actorId } });
  if (!account || account.deletedAt || account.status !== EMAIL_ACCOUNT_STATUS_ACTIVE) {
    throw codedError("请先创建个人系统邮箱账户", 409, "CRM_EMAIL_ACCOUNT_REQUIRED");
  }
  const toEmails = emailArray(body.toEmails, "收件人", true);
  const ccEmails = emailArray(body.ccEmails, "抄送人");
  const subject = cleanEmailSubject(body.subject);
  const bodyText = requireText(body.bodyText, "邮件正文").slice(0, 10000);
  const emailMessageId = crypto.randomUUID();
  let attachments: FileAsset[] = [];
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.crmEmailMessage.create({
      data: {
        id: emailMessageId,
        customerId,
        accountId: account.id,
        direction: "OUTBOUND",
        status: EMAIL_MESSAGE_STATUS_QUEUED,
        fromName: account.englishName,
        fromEmail: account.emailAddress,
        toEmails,
        ccEmails,
        subject,
        bodyText,
        threadKey: String(body.threadKey || "").trim() || null,
        relatedQuotationId: String(body.relatedQuotationId || "").trim() || null,
        relatedOrderId: String(body.relatedOrderId || "").trim() || null,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    attachments = await storeCrmEmailAttachments({ tx, actorId, customerId, messageId: emailMessageId, files });
    return created;
  });
  const delivery = await deliverCustomerCrmEmail({ rowId: row.id, settings, account, toEmails, ccEmails, subject, bodyText, attachments, customerId, actorId });
  await runNonCriticalTask("CRM 邮件操作日志写入", () => (
    writeAudit(request, actor, delivery.status === EMAIL_MESSAGE_STATUS_SENT ? "发送 CRM 客户邮件" : "保存 CRM 客户邮件", "crm_email_messages", delivery.row.id, null, {
      ...delivery.row,
      attachmentCount: attachments.length,
    })
  ));
  return {
    message: serializeEmailMessageWithAttachments(delivery.row, attachments.map(serializeCrmEmailAttachment)),
    deliveryMessage: delivery.status === EMAIL_MESSAGE_STATUS_SENT
      ? "邮件已发送并归档到客户往来"
      : delivery.lastError || "邮件已保存到客户往来；外发通道未开启，暂未真实发送。",
  };
}

async function deliverCustomerCrmEmail(input: {
  rowId: string;
  settings: Awaited<ReturnType<typeof getCrmEmailIntegrationSettings>>;
  account: { id: string; englishName: string; emailAddress: string };
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyText: string;
  attachments: FileAsset[];
  customerId: string;
  actorId: string;
}) {
  let status = EMAIL_MESSAGE_STATUS_QUEUED;
  let sentAt: Date | null = null;
  let messageId = "";
  let lastError: string | null = null;
  if (input.settings.outboundEnabled) {
    try {
      messageId = await sendCrmEmailViaResend({
        fromName: input.account.englishName,
        fromEmail: input.account.emailAddress,
        toEmails: input.toEmails,
        ccEmails: input.ccEmails,
        subject: input.subject,
        bodyText: input.bodyText,
        attachments: await outgoingAttachmentPayload(input.attachments),
        idempotencyKey: `crm-email:${input.customerId}:${input.actorId}:${input.rowId}`,
      });
      status = EMAIL_MESSAGE_STATUS_SENT;
      sentAt = new Date();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : "CRM 邮件外发失败";
    }
  }
  const row = await prisma.crmEmailMessage.update({
    where: { id: input.rowId },
    data: { status, messageId: messageId || null, lastError, sentAt },
    include: crmEmailMessageInclude(),
  });
  return { row, status, lastError };
}
