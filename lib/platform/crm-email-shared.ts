import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  canRead,
  canWrite,
  codedError,
  isPlainRecord,
  parseEmailList,
  validEmail,
} from "./shared";
import { quotationText, type QuotationActor } from "./quotation-values";

export const CRM_EMAIL_SETTING_KEY = "crm_email_integration";
export const CRM_EMAIL_DEFAULT_DOMAIN = "crm.nextwood.net";
export const EMAIL_ACCOUNT_STATUS_ACTIVE = "ACTIVE";
export const EMAIL_MESSAGE_STATUS_QUEUED = "QUEUED";
export const EMAIL_MESSAGE_STATUS_SENT = "SENT";
export const CRM_EMAIL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type QueryLike = { get(key: string): string | null };
export type AuditRequest = Parameters<typeof import("./shared").writeAudit>[0];
export type CrmEmailActor = QuotationActor;
export type CrmEmailDatabase = Prisma.TransactionClient | typeof prisma;
export type CrmEmailAttachmentFile = {
  originalFileName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  body: Buffer;
  contentSha256: string;
};

export const DEFAULT_CRM_EMAIL_INTEGRATION_SETTINGS = {
  enabled: false,
  mailDomain: process.env.CRM_EMAIL_DOMAIN || CRM_EMAIL_DEFAULT_DOMAIN,
  outboundEnabled: false,
  inboundEnabled: false,
  outboundProvider: "RESEND",
  moduleMode: "SUBDOMAIN_PERSONAL_ACCOUNT",
};

export type CrmEmailIntegrationSettings = ReturnType<typeof normalizeCrmEmailIntegrationSettings>;

export function requireActorId(actor: CrmEmailActor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

export function assertCustomerCrmRead(actor: CrmEmailActor) {
  if (!canRead(actor, "customers") && !canRead(actor, "quotations")) {
    throw codedError("没有权限查看客户 CRM 邮件", 403, "PERMISSION_DENIED");
  }
}

export function assertCustomerCrmWrite(actor: CrmEmailActor) {
  if (!canWrite(actor, "customers") && !canWrite(actor, "quotations")) {
    throw codedError("没有权限维护客户 CRM 邮件", 403, "PERMISSION_DENIED");
  }
}

function cleanDomain(value: unknown) {
  const domain = String(value || "").trim().toLowerCase()
    .replace(/^@+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!domain) return CRM_EMAIL_DEFAULT_DOMAIN;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    throw codedError("CRM 邮箱域名格式错误", 400, "CRM_EMAIL_DOMAIN_INVALID");
  }
  return domain;
}

export function normalizeCrmEmailIntegrationSettings(value: unknown = {}) {
  const input = isPlainRecord(value) ? value : {};
  const outboundProvider = String(input.outboundProvider || DEFAULT_CRM_EMAIL_INTEGRATION_SETTINGS.outboundProvider).toUpperCase();
  return {
    enabled: input.enabled === true,
    mailDomain: cleanDomain(input.mailDomain || DEFAULT_CRM_EMAIL_INTEGRATION_SETTINGS.mailDomain),
    outboundEnabled: input.outboundEnabled === true,
    inboundEnabled: input.inboundEnabled === true,
    outboundProvider: outboundProvider === "RESEND" ? "RESEND" : "RESEND",
    moduleMode: "SUBDOMAIN_PERSONAL_ACCOUNT",
  };
}

export function serializeCrmEmailIntegrationSettings(value: unknown = {}) {
  return normalizeCrmEmailIntegrationSettings(value);
}

export async function readStoredCrmEmailSettingValue(database?: CrmEmailDatabase) {
  const setting = await (database || prisma).systemSetting.findUnique({ where: { key: CRM_EMAIL_SETTING_KEY } });
  return setting?.value || DEFAULT_CRM_EMAIL_INTEGRATION_SETTINGS;
}

export async function assertScopedCustomerForCrmEmail(actor: CrmEmailActor, customerId: string) {
  await assertCustomerScope(actor, customerId);
}

export function emailArray(value: unknown, label: string, required = false) {
  const emails = parseEmailList(value);
  if (required && !emails.length) throw codedError(`${label}不能为空`, 400, "CRM_EMAIL_RECIPIENT_REQUIRED");
  const invalid = emails.filter((email) => !validEmail(email));
  if (invalid.length) throw codedError(`${label}格式错误：${invalid.join("，")}`, 400, "CRM_EMAIL_RECIPIENT_INVALID");
  if (emails.length > 20) throw codedError(`${label}最多 20 个邮箱`, 400, "CRM_EMAIL_RECIPIENT_LIMIT");
  return emails;
}

export function cleanEmailSubject(value: unknown) {
  return quotationText(value, "邮件主题", 200, true);
}
