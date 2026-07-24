import crypto from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../password-policy";
import { codedError, logServerError, requireText, requireValidEmail } from "./shared-base-utils";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit, writeAuthAudit } from "./shared-audit";
import { hashPassword } from "./shared-auth-password";
import { NOTIFICATION_TEMPLATE_TYPES, sendNotificationEmail } from "./notification-engine";
import { ensureDefaultUsers } from "./shared-users-bootstrap";
import {
  USER_PUBLIC_SELECT,
  type AuditRequestLike,
  type UserInput,
  resolveAvatarInitials,
  serializeUser,
} from "./shared-users-types";

export function assertPasswordPolicy(password: unknown) {
  if (!passwordMeetsPolicy(password)) {
    throw codedError(PASSWORD_POLICY_MESSAGE, 400, "PASSWORD_POLICY_WEAK");
  }
}

export function requestOriginFromAuditRequest(request: AuditRequestLike) {
  const rawUrl = String((request as { url?: string } | null | undefined)?.url || "");
  try {
    return new URL(rawUrl).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.APP_BASE_URL || "";
  }
}

export function verificationTokenHash(token: unknown) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function newVerificationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function createEmailVerificationToken(userId: string) {
  await prisma.emailVerificationToken.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  const token = newVerificationToken();
  const row = await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: verificationTokenHash(token),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    },
  });
  return { token, idempotencyKey: `email-verification-${row.id}` };
}

async function sendEmailVerification(request: AuditRequestLike, user: { id: string; name?: string | null; email: string }) {
  const { token, idempotencyKey } = await createEmailVerificationToken(user.id);
  const origin = requestOriginFromAuditRequest(request);
  const verifyUrl = `${origin || ""}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const delivery = await sendNotificationEmail({
    type: NOTIFICATION_TEMPLATE_TYPES.USER_EMAIL_VERIFICATION,
    recipientEmails: [user.email],
    ignoreTemplateCc: true,
    variables: {
      name: user.name || "您好",
      verifyUrl,
    },
    idempotencyKey,
    relatedEntityType: "users",
    relatedEntityId: user.id,
    context: { purpose: "email_verification" },
  });
  if (delivery.skipped || delivery.sent !== true) {
    throw codedError(delivery.error || "邮箱验证通知模板已停用，未发送。", 409, "NOTIFICATION_TEMPLATE_DISABLED");
  }
}

export async function verifyRegistrationEmail(token: unknown, request: AuditRequestLike = null) {
  if (!String(token || "").trim()) throw codedError("邮箱验证链接无效。", 400, "EMAIL_VERIFICATION_TOKEN_INVALID");
  const tokenHash = verificationTokenHash(token);
  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: { select: USER_PUBLIC_SELECT } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw codedError("邮箱验证链接无效或已过期，请重新提交注册申请或联系管理员。", 400, "EMAIL_VERIFICATION_TOKEN_INVALID");
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    return tx.user.update({
      where: { id: row.userId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
      select: USER_PUBLIC_SELECT,
    });
  });
  await runNonCriticalTask("邮箱验证操作日志写入", () => writeAuthAudit(request, {
    action: "邮箱验证成功",
    success: true,
    reason: "email_verified",
    userId: updated.id,
    loginIdHash: crypto.createHash("sha256").update(String(updated.email || "")).digest("hex").slice(0, 16),
    details: {
      approvalStatus: updated.approvalStatus,
      emailVerified: updated.emailVerified,
    },
  }));
  return serializeUser(updated);
}

export async function registerUser(request: AuditRequestLike, input: UserInput = {}) {
  await ensureDefaultUsers();
  const name = requireText(input.name, "姓名");
  const email = requireValidEmail(input.email, "邮箱");
  const password = String(input.password || "");
  const confirmPassword = String(input.confirmPassword || input.passwordConfirm || "");
  if (!confirmPassword || confirmPassword !== password) {
    throw codedError("两次输入的密码不一致。", 400, "PASSWORD_CONFIRM_MISMATCH");
  }
  assertPasswordPolicy(password);
  const duplicate = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (duplicate) {
    throw codedError("该邮箱已注册，请直接登录或联系管理员。", 409, "EMAIL_ALREADY_EXISTS");
  }
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(password),
      role: "业务员",
      avatarInitials: resolveAvatarInitials(input, name),
      customPermissions: Prisma.JsonNull,
      mustChangePassword: false,
      passwordPolicyPassed: true,
      emailVerified: false,
      emailVerifiedAt: null,
      approvalStatus: "PENDING",
      isActive: false,
    },
  });
  try {
    await sendEmailVerification(request, user);
  } catch (error: unknown) {
    logServerError("email verification send failed", error, { userId: user.id });
    await prisma.user.delete({ where: { id: user.id } }).catch((deleteError: unknown) => {
      logServerError("email verification rollback failed", deleteError, { userId: user.id });
    });
    throw codedError("注册申请已提交，但邮箱验证邮件发送失败，请联系管理员重新发送。", 500, "EMAIL_VERIFICATION_SEND_FAILED");
  }
  await runNonCriticalTask("用户注册操作日志写入", () => writeAudit(request, null, "用户自助注册", "users", user.id, null, {
    id: user.id,
    email: user.email,
    name: user.name,
    approvalStatus: user.approvalStatus,
    emailVerified: user.emailVerified,
  }));
  return { id: user.id, email: user.email, name: user.name, approvalStatus: user.approvalStatus, emailVerified: user.emailVerified };
}
