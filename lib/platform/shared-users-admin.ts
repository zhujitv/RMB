import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError, logServerError, nonEmpty, normalizeEmail, requireText, requireValidEmail } from "./shared-base-utils";
import { assertWrite, permissionError } from "./shared-access";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LOGISTICS_OPERATOR_ROLE,
  PRODUCT_SUPPLIER_OPERATOR_ROLE,
  ROLES,
  USER_APPROVAL_STATUSES,
  isProductSupplierOperatorRole,
  isProductSupplierType,
  runNonCriticalTask,
} from "./shared-constants";
import { normalizedCustomPermissionInput } from "./shared-permission-data";
import { hashPassword, revokeUserSessions } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { assertPasswordPolicy } from "./shared-users-registration";
import {
  USER_PUBLIC_SELECT,
  type ActorLike,
  type AuditRequestLike,
  type UserInput,
  resolveAvatarInitials,
  serializeUser,
} from "./shared-users-types";

export async function saveUser(request: AuditRequestLike, actor: ActorLike, input: UserInput, id: string | null = null) {
  assertWrite(actor, "users");
  const requestedRole = String(input.role || "");
  const role = isProductSupplierOperatorRole(requestedRole)
    ? PRODUCT_SUPPLIER_OPERATOR_ROLE
    : (ROLES.includes(requestedRole) ? requestedRole : "业务员");
  const customPermissions = normalizedCustomPermissionInput(input.customPermissions || input.permissions, role);
  const before = id ? await prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT }) : null;
  if (id && !before) throw permissionError("用户不存在", 404);
  const name = requireText(input.name, "姓名");
  const email = requireValidEmail(input.email, "邮箱");
  const emailChanged = Boolean(id && before && normalizeEmail(before.email) !== email);
  const emailIsAdminVerified = !id || emailChanged;
  const requestedApprovalStatus = String(input.approvalStatus || "");
  const approvalStatus = USER_APPROVAL_STATUSES.includes(requestedApprovalStatus)
    ? requestedApprovalStatus
    : (id
      ? (before?.approvalStatus || (before?.isActive ? "APPROVED" : "DISABLED"))
      : (input.isActive === false ? "DISABLED" : "APPROVED"));
  const data: Record<string, unknown> = {
    name,
    email,
    role,
    avatarInitials: resolveAvatarInitials(input, name, before),
    supplierId: null,
    customPermissions: customPermissions || null,
    approvalStatus,
    isActive: approvalStatus === "APPROVED",
  };
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  if (role === LOGISTICS_OPERATOR_ROLE || isProductSupplierOperatorRole(role)) {
    if (!supplierId) throw codedError(`${role}必须绑定一个供应商。`, 400, "SUPPLIER_ID_MISSING");
    const { assertSupplierActive } = await import("./supplier-masters");
    const supplier = await assertSupplierActive(supplierId);
    if (role === LOGISTICS_OPERATOR_ROLE && !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
      throw codedError("当前角色只能绑定物流供应商", 400, "SUPPLIER_TYPE_MISMATCH");
    }
    if (isProductSupplierOperatorRole(role) && !isProductSupplierType(supplier.supplierType)) {
      throw codedError("当前角色只能绑定产品供应商", 400, "SUPPLIER_TYPE_MISMATCH");
    }
    data.supplierId = supplier.id;
  }
  if (input.password) {
    assertPasswordPolicy(input.password);
    data.passwordHash = hashPassword(String(input.password));
    data.mustChangePassword = true;
    data.passwordPolicyPassed = false;
  }
  if (!id && !data.passwordHash) {
    throw codedError("新建用户必须设置初始密码，禁止使用固定默认密码。", 400, "INITIAL_PASSWORD_REQUIRED");
  }
  if (emailIsAdminVerified) {
    data.emailVerified = true;
    data.emailVerifiedAt = new Date();
  }
  if (id && approvalStatus === "APPROVED" && before?.emailVerified === false && !emailIsAdminVerified) {
    throw codedError("邮箱未验证，不能启用账号。", 400, "EMAIL_NOT_VERIFIED");
  }

  const duplicate = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    throw codedError("邮箱已存在，不能重复创建", 409, "EMAIL_ALREADY_EXISTS");
  }
  let user;
  try {
    user = id
      ? await prisma.user.update({ where: { id }, data: data as Prisma.UserUncheckedUpdateInput, select: USER_PUBLIC_SELECT })
      : await prisma.user.create({ data: data as Prisma.UserUncheckedCreateInput, select: USER_PUBLIC_SELECT });
  } catch (error: unknown) {
    logServerError("user role or supplier update failed", error, { userId: id, role, supplierId: data.supplierId });
    throw codedError("用户角色或供应商绑定保存失败。", 500, "ROLE_UPDATE_FAILED");
  }
  if (id && (data.passwordHash || data.approvalStatus !== "APPROVED")) await revokeUserSessions(id);
  if (id && emailChanged) {
    await runNonCriticalTask("邮箱验证令牌失效", () => prisma.emailVerificationToken.updateMany({
      where: { userId: id, usedAt: null },
      data: { usedAt: new Date() },
    }));
  }
  runNonCriticalTask("用户操作日志写入", () => writeAudit(request, actor, id ? "更新用户" : "新增用户", "users", user.id, before, user));
  return serializeUser(user);
}

export async function updateUserStatus(request: AuditRequestLike, actor: ActorLike, id: string, status: unknown) {
  assertWrite(actor, "users");
  const nextStatus = String(status || "");
  if (!USER_APPROVAL_STATUSES.includes(nextStatus)) {
    throw codedError("请选择有效用户状态", 400, "USER_STATUS_INVALID");
  }
  const before = await prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT });
  if (!before) throw permissionError("用户不存在", 404);
  if (nextStatus === "APPROVED" && before.emailVerified === false) {
    throw codedError("邮箱未验证，不能启用账号。", 400, "EMAIL_NOT_VERIFIED");
  }
  if (nextStatus === "APPROVED" && (before.role === LOGISTICS_OPERATOR_ROLE || isProductSupplierOperatorRole(before.role))) {
    if (!before.supplierId) throw codedError(`${before.role}必须绑定一个供应商后才能启用。`, 400, "SUPPLIER_ID_MISSING");
    const { assertSupplierActive } = await import("./supplier-masters");
    const supplier = await assertSupplierActive(before.supplierId);
    if (before.role === LOGISTICS_OPERATOR_ROLE && !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
      throw codedError("当前角色只能绑定物流供应商", 400, "SUPPLIER_TYPE_MISMATCH");
    }
    if (isProductSupplierOperatorRole(before.role) && !isProductSupplierType(supplier.supplierType)) {
      throw codedError("当前角色只能绑定产品供应商", 400, "SUPPLIER_TYPE_MISMATCH");
    }
  }
  const user = await prisma.user.update({
    where: { id },
    data: {
      approvalStatus: nextStatus,
      isActive: nextStatus === "APPROVED",
    },
    select: USER_PUBLIC_SELECT,
  });
  if (nextStatus !== "APPROVED") await revokeUserSessions(id);
  runNonCriticalTask("用户状态操作日志写入", () => writeAudit(request, actor, "更新用户状态", "users", id, before, user));
  return serializeUser(user);
}
