import { prisma } from "../prisma";
import { logServerTiming, timeServerStep } from "./shared-base-utils";
import { DOMESTIC_LOGISTICS_SUPPLIER_TYPES, LOGISTICS_OPERATOR_ROLE, isProductSupplierOperatorRole, isProductSupplierType } from "./shared-constants";
import { USER_AUTH_SELECT, ensureDefaultUsers } from "./shared-users";
import { permissionError } from "./shared-access";
import { isUnsafeDefaultAdminEmail, sessionTokenHash } from "./shared-auth-password";
import { assertSameOriginRequest, requestSessionToken, revokeUserSessions, type GetActorOptions, type RequestLike } from "./shared-auth-request";

export async function getActor(request: RequestLike, { required = true, allowPasswordChangeRequired = false }: GetActorOptions = {}) {
  const startedAt = Date.now();
  const sessionToken = requestSessionToken(request);
  let outcome = "unknown";
  let role = "";
  const baseContext = {
    required,
    allowPasswordChangeRequired,
    sessionPresent: Boolean(sessionToken),
  };
  try {
    if (!sessionToken) {
      outcome = required ? "missing-session" : "optional-no-session";
      if (!required) return null;
      throw permissionError("请先登录", 401);
    }
    await timeServerStep("workbench-init-timing", "getActor.ensureDefaultUsers", () => ensureDefaultUsers(), baseContext);
    assertSameOriginRequest(request);
    const session = await timeServerStep("workbench-init-timing", "getActor.sessionLookup", () => prisma.userSession.findFirst({
      where: {
        tokenHash: sessionTokenHash(sessionToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: { select: USER_AUTH_SELECT } },
    }), baseContext);
    if (session) {
      if (!session.user) {
        outcome = "user-not-found";
        const error = permissionError("登录会话对应的用户不存在，请重新登录或联系管理员。", 401);
        error.code = "AUTH_USER_NOT_FOUND";
        throw error;
      }
      role = session.user.role || "";
      if (!session.user.id) {
        outcome = "user-id-missing";
        const error = new Error("账户初始化失败：用户ID为空。") as Error & { status?: number; code?: string };
        error.status = 500;
        error.code = "AUTH_USER_ID_MISSING";
        throw error;
      }
      if (!role) {
        outcome = "role-missing";
        const error = new Error("账户初始化失败：用户角色为空，请联系管理员。") as Error & { status?: number; code?: string };
        error.status = 500;
        error.code = "AUTH_ROLE_MISSING";
        throw error;
      }
      if (!session.user.isActive) {
        outcome = "user-disabled";
        const error = permissionError("账号已停用，请联系管理员。", 403);
        error.code = "USER_DISABLED";
        throw error;
      }
      if (session.user.approvalStatus !== "APPROVED") {
        outcome = "approval-pending";
        const error = permissionError("账号正在等待管理员审核", 403);
        error.code = "USER_PENDING_APPROVAL";
        throw error;
      }
      if (isUnsafeDefaultAdminEmail(session.user.email)) {
        await timeServerStep("workbench-init-timing", "getActor.revokeUnsafeDefaultAdminSessions", () => revokeUserSessions(session.user.id), {
          ...baseContext,
          role,
        });
        outcome = "unsafe-default-admin";
        throw permissionError("默认管理员账号已被禁用，请使用公司管理员账号登录。", 403);
      }
      if (session.user.mustChangePassword && !allowPasswordChangeRequired) {
        const error = permissionError("首次登录必须修改密码", 403);
        error.code = "PASSWORD_CHANGE_REQUIRED";
        outcome = "password-change-required";
        throw error;
      }
      if (session.user.emailVerified === false) {
        await timeServerStep("workbench-init-timing", "getActor.revokeEmailUnverifiedSessions", () => revokeUserSessions(session.user.id), {
          ...baseContext,
          role,
        });
        outcome = "email-not-verified";
        const error = permissionError("请先完成邮箱验证", 403);
        error.code = "EMAIL_NOT_VERIFIED";
        throw error;
      }
      if (session.user.passwordPolicyPassed === false && !allowPasswordChangeRequired) {
        const error = permissionError("当前密码安全强度不足，请先修改密码后继续使用平台。", 403);
        error.code = "PASSWORD_CHANGE_REQUIRED";
        outcome = "password-policy-required";
        throw error;
      }
      if (session.user.role === LOGISTICS_OPERATOR_ROLE || isProductSupplierOperatorRole(session.user.role)) {
        const supplierId = session.user.supplierId;
        if (!supplierId) {
          await timeServerStep("workbench-init-timing", "getActor.revokeUnboundSupplierSessions", () => revokeUserSessions(session.user.id), {
            ...baseContext,
            role,
          });
          outcome = "supplier-unbound";
          throw permissionError(`${session.user.role}未绑定供应商，请联系管理员。`, 403);
        }
        const supplier = await timeServerStep("workbench-init-timing", "getActor.supplierLookup", () => prisma.supplier.findFirst({
          where: { id: supplierId, deletedAt: null, status: "启用" },
          select: { id: true, supplierType: true, allowFactoryDocumentUpload: true },
        }), { ...baseContext, role });
        const supplierMatchesRole = session.user.role === LOGISTICS_OPERATOR_ROLE
          ? Boolean(supplier && DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType))
          : Boolean(supplier && isProductSupplierType(supplier.supplierType) && supplier.allowFactoryDocumentUpload);
        if (!supplierMatchesRole) {
          await timeServerStep("workbench-init-timing", "getActor.revokeInvalidSupplierSessions", () => revokeUserSessions(session.user.id), {
            ...baseContext,
            role,
          });
          outcome = "supplier-invalid";
          throw permissionError("绑定供应商不存在、已停用或未开启对应供应商门户权限，请联系管理员。", 403);
        }
      }
      outcome = "ready";
      return session.user;
    }
    outcome = required ? "invalid-session" : "optional-invalid-session";
    if (!required) return null;
    throw permissionError("请先登录", 401);
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      ...baseContext,
      step: "getActor.total",
      outcome,
      role,
    });
  }
}
