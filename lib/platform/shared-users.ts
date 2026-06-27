import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  codedError,
  logServerTiming,
  nonEmpty,
  normalizeEmail,
  requireText,
  requireValidEmail,
  timeServerStep,
} from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  INITIAL_ADMIN_EMAIL,
  INITIAL_ADMIN_PASSWORD,
  LOGISTICS_OPERATOR_ROLE,
  PRODUCT_SUPPLIER_OPERATOR_ROLE,
  PRODUCT_SUPPLIER_OPERATOR_ROLES,
  ROLES,
  USER_APPROVAL_STATUSES,
  isProductSupplierOperatorRole,
  isProductSupplierType,
  runNonCriticalTask,
  supplierTypeDisplayName,
  userRoleDisplayName,
} from "./shared-constants";
import { assertRead, assertWrite, permissionError, type AccessUser } from "./shared-access";
import {
  normalizedCustomPermissionInput,
  pageParams,
  pageResult,
} from "./shared-permission-data";
import {
  assertSafeInitialAdminConfig,
  hashPassword,
  revokeUserSessions,
  timingSafeEqualText,
} from "./shared-auth";

type UserInput = Record<string, unknown>;
type UserListQuery = { get(name: string): string | null } | null;
type UserListOptions = { paginated?: boolean };
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ActorLike = AccessUser;
type AvatarUserLike = {
  avatarInitials?: string | null;
  name?: string | null;
};
type UserRowLike = Record<string, unknown> & {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
  avatarInitials?: string | null;
  defaultLanguage?: string | null;
  customPermissions?: unknown;
  supplierId?: string | null;
  supplierOperator?: { supplierName?: string | null; supplierType?: string | null } | null;
  mustChangePassword?: boolean | null;
  approvalStatus?: string | null;
  isActive?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export const USER_AUTH_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  avatarInitials: true,
  defaultLanguage: true,
  customPermissions: true,
  supplierId: true,
  supplierOperator: { select: { supplierName: true, supplierType: true } },
  mustChangePassword: true,
  approvalStatus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  avatarInitials: true,
  defaultLanguage: true,
  customPermissions: true,
  supplierId: true,
  supplierOperator: { select: { supplierName: true, supplierType: true } },
  mustChangePassword: true,
  approvalStatus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

let missingAvatarInitialsBackfilled = false;

export function avatarInitialFromName(name: unknown = "") {
  const text = nonEmpty(name);
  if (!text) return "";
  return text.slice(0, 1).toUpperCase();
}

export function cleanAvatarInitials(value: unknown = "") {
  return nonEmpty(value).slice(0, 3).toUpperCase();
}

export function autoAvatarInitialsFor(name: unknown = "") {
  return avatarInitialFromName(name) || "N";
}

export function avatarWasAutomatic(user: AvatarUserLike | null | undefined) {
  const current = cleanAvatarInitials(user?.avatarInitials || "");
  if (!current) return true;
  return current === autoAvatarInitialsFor(user?.name || "");
}

export function resolveAvatarInitials(input: UserInput = {}, name: unknown, before: AvatarUserLike | null = null) {
  if (Object.prototype.hasOwnProperty.call(input, "avatarInitials")) {
    const requested = cleanAvatarInitials(String(input.avatarInitials || ""));
    if (!requested) return autoAvatarInitialsFor(name);
    const beforeInitials = cleanAvatarInitials(before?.avatarInitials || "");
    if (before && avatarWasAutomatic(before) && requested === beforeInitials && name !== before.name) {
      return autoAvatarInitialsFor(name);
    }
    return requested;
  }
  if (!before || avatarWasAutomatic(before)) return autoAvatarInitialsFor(name);
  return cleanAvatarInitials(before.avatarInitials || "");
}

export async function backfillMissingAvatarInitials() {
  const startedAt = Date.now();
  if (missingAvatarInitialsBackfilled) {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "backfillMissingAvatarInitials.total",
      skipped: true,
    });
    return;
  }
  missingAvatarInitialsBackfilled = true;
  try {
    const users = await timeServerStep("workbench-init-timing", "backfillMissingAvatarInitials.userLookup", () => prisma.user.findMany({
      select: { id: true, name: true, avatarInitials: true },
    }));
    const usersNeedingInitials = users.filter((user) => !nonEmpty(user.avatarInitials));
    await timeServerStep("workbench-init-timing", "backfillMissingAvatarInitials.userUpdates", () => Promise.all(usersNeedingInitials.map((user) => prisma.user.update({
      where: { id: user.id },
      data: { avatarInitials: autoAvatarInitialsFor(user.name) },
    }))), { updateCount: usersNeedingInitials.length });
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "backfillMissingAvatarInitials.total",
      skipped: false,
    });
  }
}

export async function ensureDefaultUsers() {
  const startedAt = Date.now();
  let outcome = "unknown";
  try {
    await timeServerStep("workbench-init-timing", "ensureDefaultUsers.backfillMissingAvatarInitials", () => backfillMissingAvatarInitials());
    const activeAdminCount = await timeServerStep("workbench-init-timing", "ensureDefaultUsers.activeAdminCount", () => prisma.user.count({
      where: { role: "管理员", isActive: true, approvalStatus: "APPROVED" },
    }));
    if (activeAdminCount > 0) {
      outcome = "active-admin-exists";
      return null;
    }
    if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) {
      outcome = "initial-admin-env-missing";
      return null;
    }
    assertSafeInitialAdminConfig();
    const email = normalizeEmail(INITIAL_ADMIN_EMAIL);
    const existing = await timeServerStep("workbench-init-timing", "ensureDefaultUsers.initialAdminLookup", () => prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: USER_AUTH_SELECT,
    }));
    const data = {
      name: nonEmpty(process.env.INITIAL_ADMIN_NAME) || existing?.name || "系统管理员",
      email,
      passwordHash: hashPassword(INITIAL_ADMIN_PASSWORD),
      role: "管理员",
      avatarInitials: resolveAvatarInitials({}, nonEmpty(process.env.INITIAL_ADMIN_NAME) || existing?.name || "系统管理员", existing),
      mustChangePassword: true,
      approvalStatus: "APPROVED",
      isActive: true,
    };
    await timeServerStep("workbench-init-timing", "ensureDefaultUsers.initialAdminUpsert", () => (
      existing
        ? prisma.user.update({ where: { id: existing.id }, data, select: USER_AUTH_SELECT })
        : prisma.user.create({ data, select: USER_AUTH_SELECT })
    ), { mode: existing ? "update" : "create" });
    outcome = existing ? "initial-admin-updated" : "initial-admin-created";
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "ensureDefaultUsers.total",
      outcome,
    });
  }
  return null;
}

export function isInitialAdminPasswordLogin(user: { role?: string | null; email?: string | null } | null | undefined, password: unknown) {
  return Boolean(
    INITIAL_ADMIN_EMAIL
    && INITIAL_ADMIN_PASSWORD
    && user?.role === "管理员"
    && normalizeEmail(user.email) === normalizeEmail(INITIAL_ADMIN_EMAIL)
    && timingSafeEqualText(String(password || ""), INITIAL_ADMIN_PASSWORD),
  );
}

function asUserRow(value: unknown): UserRowLike {
  return (value && typeof value === "object" ? value : {}) as UserRowLike;
}

export function publicUser(userInput: unknown) {
  if (!userInput) return null;
  const user = asUserRow(userInput);
  const customPermissions = normalizedCustomPermissionInput(user.customPermissions, String(user.role || ""));
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: userRoleDisplayName(user.role),
    phone: user.phone || "",
    avatarInitials: user.avatarInitials || "",
    defaultLanguage: user.defaultLanguage || "zh-CN",
    customPermissions,
    permissionMode: customPermissions ? "CUSTOM" : "ROLE",
    supplierId: user.supplierId || "",
    supplierName: user.supplierOperator?.supplierName || "",
    supplierType: supplierTypeDisplayName(user.supplierOperator?.supplierType),
    mustChangePassword: Boolean(user.mustChangePassword),
    approvalStatus: user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED"),
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function serializeUser(user: unknown) {
  return publicUser(user);
}

export async function updateOwnProfile(request: AuditRequestLike, actor: ActorLike, input: UserInput = {}) {
  const actorId = requireText(actor?.id, "当前用户");
  const user = await prisma.user.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) throw permissionError("请先登录", 401);
  const name = requireText(input.name, "姓名");
  const phone = String(input.phone || "").trim();
  const avatarInitials = resolveAvatarInitials(input, name, user);
  const requestedDefaultLanguage = String(input.defaultLanguage || "");
  const defaultLanguage = ["zh-CN", "en-US"].includes(requestedDefaultLanguage) ? requestedDefaultLanguage : null;
  const before = publicUser(user);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      phone: phone || null,
      avatarInitials,
      defaultLanguage,
    },
  });
  await runNonCriticalTask("个人资料操作日志写入", () => writeAudit(request, actor, "修改本人资料", "users", user.id, before, publicUser(updated)));
  return publicUser(updated);
}

export async function listUsers(actor: ActorLike, query: UserListQuery = null, options: UserListOptions = {}) {
  assertRead(actor, "users");
  await ensureDefaultUsers();
  const keyword = nonEmpty(query?.get("keyword") || query?.get("q") || query?.get("search"));
  const role = nonEmpty(query?.get("role"));
  const statusText = nonEmpty(query?.get("status") || query?.get("approvalStatus"));
  const statusMap = {
    active: "APPROVED",
    enabled: "APPROVED",
    approved: "APPROVED",
    pending: "PENDING",
    rejected: "REJECTED",
    disabled: "DISABLED",
    inactive: "DISABLED",
    "启用": "APPROVED",
    "已通过": "APPROVED",
    "待审核": "PENDING",
    "已拒绝": "REJECTED",
    "停用": "DISABLED",
    "已停用": "DISABLED",
  } satisfies Record<string, string>;
  const approvalStatus = statusText
    ? (USER_APPROVAL_STATUSES.includes(statusText) ? statusText : (statusMap as Record<string, string>)[statusText.toLowerCase()] || (statusMap as Record<string, string>)[statusText] || "")
    : "";
  const where: Prisma.UserWhereInput = {
    ...(keyword ? {
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { email: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
    ...(isProductSupplierOperatorRole(role)
      ? { role: { in: PRODUCT_SUPPLIER_OPERATOR_ROLES } }
      : (ROLES.includes(role) ? { role } : {})),
    ...(USER_APPROVAL_STATUSES.includes(approvalStatus) ? { approvalStatus } : {}),
  };
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 100);
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        orderBy: [{ createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageResult(users.map(serializeUser), total, page, pageSize);
  }
  const users = await prisma.user.findMany({
    where,
    select: USER_PUBLIC_SELECT,
    orderBy: [{ createdAt: "asc" }],
  });
  return users.map(serializeUser);
}

export async function registerUser(request: AuditRequestLike, input: UserInput = {}) {
  await ensureDefaultUsers();
  const name = requireText(input.name, "姓名");
  const email = requireValidEmail(input.email, "邮箱");
  const password = String(input.password || "");
  const confirmPassword = String(input.confirmPassword || input.passwordConfirm || "");
  if (confirmPassword && confirmPassword !== password) {
    throw codedError("两次输入的密码不一致", 400, "PASSWORD_CONFIRM_MISMATCH");
  }
  const duplicate = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (duplicate) {
    throw codedError("该邮箱已提交注册或已存在账号，请联系管理员。", 409, "EMAIL_ALREADY_EXISTS");
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
      approvalStatus: "PENDING",
      isActive: false,
    },
  });
  await runNonCriticalTask("用户注册操作日志写入", () => writeAudit(request, null, "用户自助注册", "users", user.id, null, {
    id: user.id,
    email: user.email,
    name: user.name,
    approvalStatus: user.approvalStatus,
  }));
  return { id: user.id, email: user.email, name: user.name, approvalStatus: user.approvalStatus };
}

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
  const requestedApprovalStatus = String(input.approvalStatus || "");
  const approvalStatus = USER_APPROVAL_STATUSES.includes(requestedApprovalStatus)
    ? requestedApprovalStatus
    : (id
      ? (before?.approvalStatus || (before?.isActive ? "APPROVED" : "DISABLED"))
      : (input.isActive === false ? "DISABLED" : "APPROVED"));
  const data: Record<string, unknown> = {
    name,
    email: requireValidEmail(input.email, "邮箱"),
    role,
    avatarInitials: resolveAvatarInitials(input, name, before),
    supplierId: null,
    customPermissions: customPermissions || null,
    approvalStatus,
    isActive: approvalStatus === "APPROVED",
  };
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  if (role === LOGISTICS_OPERATOR_ROLE || isProductSupplierOperatorRole(role)) {
    if (!supplierId) throw codedError(`${role}必须绑定一个供应商。`, 400, "SUPPLIER_USER_SUPPLIER_REQUIRED");
    const { assertSupplierActive } = await import("./supplier-masters");
    const supplier = await assertSupplierActive(supplierId);
    if (role === LOGISTICS_OPERATOR_ROLE && !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
      throw codedError("物流供应商账号只能绑定物流、报关、海运或港杂费用供应商。", 400, "LOGISTICS_USER_SUPPLIER_TYPE_INVALID");
    }
    if (isProductSupplierOperatorRole(role) && !isProductSupplierType(supplier.supplierType)) {
      throw codedError("产品供应商账号只能绑定产品供应商。", 400, "FACTORY_USER_SUPPLIER_TYPE_INVALID");
    }
    if (isProductSupplierOperatorRole(role) && !supplier.allowFactoryDocumentUpload) {
      throw codedError("产品供应商账号绑定的供应商必须先开启资料回传权限。", 400, "FACTORY_USER_SUPPLIER_UPLOAD_DISABLED");
    }
    data.supplierId = supplier.id;
  }
  if (input.password) {
    data.passwordHash = hashPassword(String(input.password));
    data.mustChangePassword = true;
  }
  if (!id && !data.passwordHash) {
    throw codedError("新建用户必须设置初始密码，禁止使用固定默认密码。", 400, "INITIAL_PASSWORD_REQUIRED");
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
  const user = id
    ? await prisma.user.update({ where: { id }, data: data as Prisma.UserUncheckedUpdateInput, select: USER_PUBLIC_SELECT })
    : await prisma.user.create({ data: data as Prisma.UserUncheckedCreateInput, select: USER_PUBLIC_SELECT });
  if (id && (data.passwordHash || data.approvalStatus !== "APPROVED")) await revokeUserSessions(id);
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
  if (nextStatus === "APPROVED" && (before.role === LOGISTICS_OPERATOR_ROLE || isProductSupplierOperatorRole(before.role))) {
    if (!before.supplierId) throw codedError(`${before.role}必须绑定一个供应商后才能启用。`, 400, "SUPPLIER_USER_SUPPLIER_REQUIRED");
    const { assertSupplierActive } = await import("./supplier-masters");
    const supplier = await assertSupplierActive(before.supplierId);
    if (before.role === LOGISTICS_OPERATOR_ROLE && !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
      throw codedError("物流供应商账号只能绑定物流、报关、海运或港杂费用供应商。", 400, "LOGISTICS_USER_SUPPLIER_TYPE_INVALID");
    }
    if (isProductSupplierOperatorRole(before.role) && !isProductSupplierType(supplier.supplierType)) {
      throw codedError("产品供应商账号只能绑定产品供应商。", 400, "FACTORY_USER_SUPPLIER_TYPE_INVALID");
    }
    if (isProductSupplierOperatorRole(before.role) && !supplier.allowFactoryDocumentUpload) {
      throw codedError("产品供应商账号绑定的供应商必须先开启资料回传权限。", 400, "FACTORY_USER_SUPPLIER_UPLOAD_DISABLED");
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
