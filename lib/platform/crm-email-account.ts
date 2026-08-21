import { prisma } from "../prisma";
import { assertJsonObject, codedError, runNonCriticalTask, writeAudit } from "./shared";
import {
  EMAIL_ACCOUNT_STATUS_ACTIVE,
  type AuditRequest,
  type CrmEmailActor,
  requireActorId,
} from "./crm-email-shared";
import { getCrmEmailIntegrationSettings } from "./crm-email-settings";

function normalizeEnglishName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function localPartFromEnglishName(value: string) {
  const localPart = value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ".")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 64);
  if (!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(localPart)) {
    throw codedError("英文名只能生成英文邮箱前缀，请使用英文姓名，例如 tony 或 tony.zhang", 400, "CRM_EMAIL_ENGLISH_NAME_INVALID");
  }
  return localPart;
}

function serializeEmailAccount(row: {
  id: string;
  userId: string;
  englishName: string;
  localPart: string;
  emailAddress: string;
  status: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
} | null) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    englishName: row.englishName,
    localPart: row.localPart,
    emailAddress: row.emailAddress,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function readOwnCrmEmailAccount(actor: CrmEmailActor) {
  const actorId = requireActorId(actor);
  const [settings, account, user] = await Promise.all([
    getCrmEmailIntegrationSettings(),
    prisma.crmEmailAccount.findUnique({ where: { userId: actorId } }),
    prisma.user.findUnique({ where: { id: actorId }, select: { englishName: true } }),
  ]);
  return { settings, account: serializeEmailAccount(account), suggestedEnglishName: user?.englishName || "" };
}

export async function saveOwnCrmEmailAccount(request: AuditRequest, actor: CrmEmailActor, input: unknown = {}) {
  const actorId = requireActorId(actor);
  const body = assertJsonObject(input);
  const englishName = normalizeEnglishName(body.englishName);
  if (!englishName) throw codedError("请先填写英文名，用于生成系统个人邮箱", 400, "CRM_EMAIL_ENGLISH_NAME_REQUIRED");
  const localPart = localPartFromEnglishName(englishName);
  const settings = await getCrmEmailIntegrationSettings();
  const emailAddress = `${localPart}@${settings.mailDomain}`;
  const before = await prisma.crmEmailAccount.findUnique({ where: { userId: actorId } });
  const duplicate = await prisma.crmEmailAccount.findFirst({
    where: {
      OR: [{ localPart }, { emailAddress: { equals: emailAddress, mode: "insensitive" } }],
      NOT: { userId: actorId },
      deletedAt: null,
    },
  });
  if (duplicate) throw codedError("该英文名生成的系统邮箱已被使用，请换一个英文名", 409, "CRM_EMAIL_ACCOUNT_DUPLICATE");
  const account = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actorId }, data: { englishName } });
    return tx.crmEmailAccount.upsert({
      where: { userId: actorId },
      update: { englishName, localPart, emailAddress, status: EMAIL_ACCOUNT_STATUS_ACTIVE, deletedAt: null },
      create: { userId: actorId, englishName, localPart, emailAddress, status: EMAIL_ACCOUNT_STATUS_ACTIVE },
    });
  });
  await runNonCriticalTask("CRM 邮件账户操作日志写入", () => (
    writeAudit(request, actor, before ? "更新 CRM 邮件账户" : "创建 CRM 邮件账户", "crm_email_accounts", account.id, before, account)
  ));
  return { settings, account: serializeEmailAccount(account) };
}
