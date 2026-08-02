import type { NextRequest } from "next/server";
import { prisma } from "../prisma";
import { codedError, nonEmpty } from "./shared-base-utils";
import { loginCredentials, boundedUserAgent } from "./shared-auth-input";
import { randomToken, sessionTokenHash, verifyLoginPassword } from "./shared-auth-password";
import { assertLoginNotRateLimited, recordLoginAttempt } from "./shared-auth-login";
import { requestIp } from "./shared-auth-request";
import { exchangeWechatMiniLoginCode } from "./wechat-mini-provider";

const SESSION_DAYS = 30;

function bearerToken(request: NextRequest) {
  const header = nonEmpty(request.headers.get("authorization"));
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,256})$/i);
  return match?.[1] || "";
}

export async function loginWechatMini(request: NextRequest, input: Record<string, unknown>) {
  const credentials = loginCredentials(input);
  const code = nonEmpty(input.code).slice(0, 128);
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(code)) throw codedError("微信登录凭证无效", 400, "WECHAT_MINI_CODE_INVALID");
  await assertLoginNotRateLimited(request, credentials.email);
  const user = await prisma.user.findFirst({
    where: { email: { equals: credentials.email, mode: "insensitive" } },
    select: {
      id: true, name: true, email: true, passwordHash: true, role: true, supplierId: true,
      customPermissions: true, mustChangePassword: true, passwordPolicyPassed: true,
      emailVerified: true, approvalStatus: true, isActive: true, deletedAt: true,
    },
  });
  const passwordMatches = await verifyLoginPassword(credentials.password, user?.passwordHash);
  if (!user || !passwordMatches) {
    await recordLoginAttempt(request, credentials.email, false, user?.id || null, user ? "wrong_password" : "user_not_found");
    throw codedError("邮箱或密码错误", 401, "INVALID_CREDENTIALS");
  }
  if (!user.emailVerified) throw codedError("请先在网页端完成邮箱验证", 403, "EMAIL_NOT_VERIFIED");
  if (!user.isActive || user.deletedAt || user.approvalStatus !== "APPROVED") throw codedError("账号未启用或未通过审核", 403, "USER_DISABLED");
  if (user.mustChangePassword || !user.passwordPolicyPassed) throw codedError("请先在网页端修改密码后再登录小程序", 403, "PASSWORD_CHANGE_REQUIRED");
  const identity = await exchangeWechatMiniLoginCode(code);
  const occupied = await prisma.wechatMiniBinding.findUnique({ where: { openId: identity.openId } });
  if (occupied && occupied.userId !== user.id) throw codedError("该微信已绑定其他系统账号", 409, "WECHAT_MINI_ALREADY_BOUND");
  await recordLoginAttempt(request, credentials.email, true, user.id);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const binding = await prisma.$transaction(async (tx) => {
    const saved = await tx.wechatMiniBinding.upsert({
      where: { userId: user.id },
      update: { openId: identity.openId, unionId: identity.unionId, enabled: true, lastLoginAt: new Date() },
      create: { userId: user.id, openId: identity.openId, unionId: identity.unionId, lastLoginAt: new Date() },
    });
    await tx.wechatMiniSession.create({
      data: {
        userId: user.id,
        bindingId: saved.id,
        tokenHash: sessionTokenHash(token),
        expiresAt,
        ipAddress: requestIp(request),
        userAgent: boundedUserAgent(request.headers.get("user-agent")),
      },
    });
    const staleSessions = await tx.wechatMiniSession.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      skip: 5,
      select: { id: true },
    });
    if (staleSessions.length) await tx.wechatMiniSession.updateMany({
      where: { id: { in: staleSessions.map((item) => item.id) } },
      data: { revokedAt: new Date() },
    });
    return saved;
  });
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    binding: { enabled: binding.enabled },
  };
}

export async function requireWechatMiniActor(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) throw codedError("请先登录小程序", 401, "WECHAT_MINI_UNAUTHENTICATED");
  const session = await prisma.wechatMiniSession.findFirst({
    where: {
      tokenHash: sessionTokenHash(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
      binding: { enabled: true },
      user: { isActive: true, approvalStatus: "APPROVED", deletedAt: null },
    },
    include: {
      binding: { select: { id: true, openId: true, enabled: true } },
      user: {
        select: {
          id: true, name: true, email: true, role: true, supplierId: true,
          customPermissions: true, mustChangePassword: true, passwordPolicyPassed: true,
          isActive: true, approvalStatus: true,
        },
      },
    },
  });
  if (!session) throw codedError("小程序登录已过期，请重新登录", 401, "WECHAT_MINI_SESSION_EXPIRED");
  if (session.user.mustChangePassword || !session.user.passwordPolicyPassed) {
    throw codedError("请先在网页端修改密码", 403, "PASSWORD_CHANGE_REQUIRED");
  }
  if (!session.lastUsedAt || session.lastUsedAt.getTime() < Date.now() - 5 * 60_000) {
    await prisma.wechatMiniSession.updateMany({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  return { ...session.user, bindingId: session.binding.id, openId: session.binding.openId, miniSessionId: session.id };
}

export async function logoutWechatMini(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) return;
  await prisma.wechatMiniSession.updateMany({
    where: { tokenHash: sessionTokenHash(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
