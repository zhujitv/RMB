import crypto from "node:crypto";
import type { FileAsset } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertJsonObject, codedError, normalizeEmail, requireText, runNonCriticalTask, validEmail, writeAudit } from "./shared";
import { timingSafeEqualText } from "./shared-auth-password";
import {
  cleanEmailSubject,
  EMAIL_ACCOUNT_STATUS_ACTIVE,
  emailArray,
  type AuditRequest,
  type CrmEmailAttachmentFile,
} from "./crm-email-shared";
import { getCrmEmailIntegrationSettings } from "./crm-email-settings";
import { readCrmEmailAttachmentFiles, serializeCrmEmailAttachment, storeCrmEmailAttachments } from "./crm-email-attachments";
import { crmEmailMessageInclude, serializeEmailMessageWithAttachments } from "./crm-email-serialization";

function assertCrmInboundSecret(request: Request) {
  const secret = String(process.env.CRM_EMAIL_INBOUND_SECRET || "").trim();
  if (secret.length < 32) throw codedError("CRM 邮件入站密钥未配置，已拒绝写入。", 503, "CRM_EMAIL_INBOUND_SECRET_NOT_CONFIGURED");
  const authorization = String(request.headers.get("authorization") || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const headerSecret = String(request.headers.get("x-crm-email-secret") || "").trim();
  if (!timingSafeEqualText(bearer || headerSecret, secret)) {
    throw codedError("CRM 邮件入站密钥不正确", 401, "CRM_EMAIL_INBOUND_SECRET_INVALID");
  }
}

export async function parseInboundCrmEmailRequest(request: Request) {
  assertCrmInboundSecret(request);
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data;")) {
    return { body: assertJsonObject(await request.json()), files: [] as CrmEmailAttachmentFile[] };
  }
  const formData = await request.formData();
  const body: Record<string, unknown> = {};
  for (const key of ["customerId", "fromEmail", "fromName", "toEmails", "ccEmails", "subject", "bodyText", "messageId", "threadKey"]) {
    body[key] = formData.get(key);
  }
  return { body, files: await readCrmEmailAttachmentFiles(formData) };
}

async function resolveInboundCustomerId(body: Record<string, unknown>) {
  const requestedCustomerId = String(body.customerId || "").trim();
  if (requestedCustomerId) {
    const customer = await prisma.customer.findFirst({ where: { id: requestedCustomerId, deletedAt: null }, select: { id: true } });
    if (!customer) throw codedError("入站邮件指定客户不存在", 404, "CRM_EMAIL_INBOUND_CUSTOMER_NOT_FOUND");
    return customer.id;
  }
  const fromEmail = normalizeEmail(body.fromEmail);
  if (!validEmail(fromEmail)) throw codedError("入站邮件缺少有效发件邮箱", 400, "CRM_EMAIL_INBOUND_FROM_INVALID");
  const customers = await prisma.customer.findMany({
    where: { contactEmail: { equals: fromEmail, mode: "insensitive" }, deletedAt: null },
    select: { id: true },
    take: 2,
  });
  if (!customers.length) throw codedError("未能根据发件邮箱匹配客户，请在回调中传入 customerId", 409, "CRM_EMAIL_INBOUND_CUSTOMER_UNMATCHED");
  if (customers.length > 1) throw codedError("发件邮箱匹配到多个客户，请在回调中传入 customerId", 409, "CRM_EMAIL_INBOUND_CUSTOMER_AMBIGUOUS");
  return customers[0].id;
}

async function resolveInboundAccountId(toEmails: string[]) {
  if (!toEmails.length) return null;
  const account = await prisma.crmEmailAccount.findFirst({
    where: { emailAddress: { in: toEmails }, deletedAt: null, status: EMAIL_ACCOUNT_STATUS_ACTIVE },
    orderBy: { createdAt: "asc" },
  });
  return account?.id || null;
}

export async function recordInboundCustomerCrmEmailMessage(
  request: AuditRequest,
  input: unknown = {},
  files: CrmEmailAttachmentFile[] = [],
) {
  const settings = await getCrmEmailIntegrationSettings();
  if (!settings.enabled || !settings.inboundEnabled) throw codedError("CRM 邮件入站通道未启用", 409, "CRM_EMAIL_INBOUND_DISABLED");
  const body = assertJsonObject(input);
  const customerId = await resolveInboundCustomerId(body);
  const fromEmail = normalizeEmail(body.fromEmail);
  if (!validEmail(fromEmail)) throw codedError("入站邮件发件邮箱格式错误", 400, "CRM_EMAIL_INBOUND_FROM_INVALID");
  const toEmails = emailArray(body.toEmails, "收件人");
  const ccEmails = emailArray(body.ccEmails, "抄送人");
  const providerMessageId = String(body.messageId || "").trim().slice(0, 300) || null;
  if (providerMessageId) {
    const existing = await prisma.crmEmailMessage.findUnique({ where: { messageId: providerMessageId }, include: crmEmailMessageInclude() });
    if (existing) return { message: serializeEmailMessageWithAttachments(existing), deliveryMessage: "入站邮件已存在，已跳过重复写入" };
  }
  const emailMessageId = crypto.randomUUID();
  let attachments: FileAsset[] = [];
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.crmEmailMessage.create({
      data: {
        id: emailMessageId,
        customerId,
        accountId: await resolveInboundAccountId(toEmails),
        direction: "INBOUND",
        status: "RECEIVED",
        fromName: String(body.fromName || "").trim().slice(0, 120) || null,
        fromEmail,
        toEmails,
        ccEmails,
        subject: cleanEmailSubject(body.subject),
        bodyText: requireText(body.bodyText, "邮件正文").slice(0, 10000),
        messageId: providerMessageId,
        threadKey: String(body.threadKey || "").trim() || providerMessageId,
        receivedAt: new Date(),
      },
      include: crmEmailMessageInclude(),
    });
    attachments = await storeCrmEmailAttachments({ tx, actorId: "", customerId, messageId: emailMessageId, files });
    return created;
  });
  await runNonCriticalTask("CRM 入站邮件日志写入", () => (
    writeAudit(request, null, "接收 CRM 客户邮件", "crm_email_messages", row.id, null, { ...row, attachmentCount: attachments.length })
  ));
  return {
    message: serializeEmailMessageWithAttachments(row, attachments.map(serializeCrmEmailAttachment)),
    deliveryMessage: "入站邮件已归档到客户往来",
  };
}
