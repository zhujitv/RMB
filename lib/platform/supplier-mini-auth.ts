import { prisma } from "../prisma";
import { codedError } from "./shared-base-errors";
import { canRead } from "./shared-access";
import { loginCredentials } from "./shared-auth-input";
import { isUnsafeDefaultAdminEmail, verifyLoginPassword } from "./shared-auth-password";
import {
  assertLoginNotRateLimited,
  recordLoginAttempt,
} from "./shared-auth-login";
import { createUserSession, type RequestLike } from "./shared-auth-request";
import { PRODUCT_SUPPLIER_OPERATOR_ROLES, PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";
import { publicUser, USER_AUTH_SELECT } from "./shared-users";

type LoginBody = { email?: unknown; password?: unknown };

function loginError(message: string, code: string, status = 403) {
  return codedError(message, status, code);
}

export async function loginSupplierMiniProgram(request: RequestLike, body: LoginBody) {
  const credentials = loginCredentials(body as Record<string, unknown>);
  const { email, password } = credentials;
  await assertLoginNotRateLimited(request, email);
  if (isUnsafeDefaultAdminEmail(email)) {
    await recordLoginAttempt(request, email, false, null, "default_admin_disabled");
    throw loginError("默认管理员账号不能登录供应商小程序。", "DEFAULT_ADMIN_DISABLED");
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
  if (!PRODUCT_SUPPLIER_OPERATOR_ROLES.includes(user.role as (typeof PRODUCT_SUPPLIER_OPERATOR_ROLES)[number])) {
    await recordLoginAttempt(request, email, false, user.id, "role_not_allowed");
    throw loginError("当前账号不是产品供应商账号。", "SUPPLIER_MINI_ROLE_NOT_ALLOWED");
  }
  const supplier = user.supplierId ? await prisma.supplier.findFirst({
    where: {
      id: user.supplierId,
      deletedAt: null,
      status: "启用",
      supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
      allowFactoryDocumentUpload: true,
    },
    select: { id: true },
  }) : null;
  if (!supplier) {
    await recordLoginAttempt(request, email, false, user.id, "supplier_not_bound");
    throw loginError("账号未绑定有效的产品供应商。", "SUPPLIER_NOT_BOUND");
  }
  if (!canRead(user, "supplierPurchaseOrders") && !canRead(user, "supplierDocuments")) {
    await recordLoginAttempt(request, email, false, user.id, "permission_missing");
    throw loginError("账号未开通供应商小程序权限。", "SUPPLIER_MINI_PERMISSION_MISSING");
  }
  await recordLoginAttempt(request, email, true, user.id);
  const session = await createUserSession(request, user);
  return {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: publicUser(user),
  };
}
