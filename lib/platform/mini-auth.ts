import { prisma } from "../prisma";
import { codedError } from "./shared-base-errors";
import { loginCredentials } from "./shared-auth-input";
import { isUnsafeDefaultAdminEmail, verifyLoginPassword } from "./shared-auth-password";
import {
  assertLoginNotRateLimited,
  recordLoginAttempt,
} from "./shared-auth-login";
import { createUserSession, type RequestLike } from "./shared-auth-request";
import { publicUser, USER_AUTH_SELECT } from "./shared-users";

type LoginBody = { email?: unknown; password?: unknown };

function loginError(message: string, code: string, status = 403) {
  return codedError(message, status, code);
}

export async function loginMiniProgram(request: RequestLike, body: LoginBody) {
  const { email, password } = loginCredentials(body as Record<string, unknown>);
  await assertLoginNotRateLimited(request, email);
  if (isUnsafeDefaultAdminEmail(email)) {
    await recordLoginAttempt(request, email, false, null, "default_admin_disabled");
    throw loginError("默认管理员账号不能登录小程序。", "DEFAULT_ADMIN_DISABLED");
  }
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
    select: { ...USER_AUTH_SELECT, passwordHash: true },
  });
  if (!user || !(await verifyLoginPassword(password, user.passwordHash))) {
    await recordLoginAttempt(request, email, false, user?.id || null, "invalid_credentials");
    throw loginError("邮箱或密码错误", "INVALID_CREDENTIALS", 401);
  }
  if (user.emailVerified === false) {
    await recordLoginAttempt(request, email, false, user.id, "email_not_verified");
    throw loginError("请先完成邮箱验证", "EMAIL_NOT_VERIFIED");
  }
  const approvalStatus = user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED");
  if (!user.isActive || approvalStatus !== "APPROVED") {
    await recordLoginAttempt(request, email, false, user.id, "account_not_active");
    throw loginError("账号未启用或尚未通过审核，请联系管理员。", "USER_NOT_ACTIVE");
  }
  if (user.mustChangePassword || user.passwordPolicyPassed === false) {
    await recordLoginAttempt(request, email, false, user.id, "password_change_required");
    throw loginError("请先在 RMB 网页端修改密码，再登录小程序。", "PASSWORD_CHANGE_REQUIRED");
  }
  await recordLoginAttempt(request, email, true, user.id);
  const session = await createUserSession(request, user);
  return {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: publicUser(user),
  };
}
