// @ts-nocheck
import { prisma } from "../prisma";
import {
  codedError,
  nonEmpty,
  normalizeEmail,
  requireText,
} from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  INITIAL_ADMIN_EMAIL,
  INITIAL_ADMIN_PASSWORD,
  LOGISTICS_OPERATOR_ROLE,
  ROLES,
  USER_APPROVAL_STATUSES,
  runNonCriticalTask,
} from "./shared-constants";
import { assertRead, assertWrite, permissionError } from "./shared-access";
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

export function avatarInitialFromName(name = "") {
  const text = nonEmpty(name);
  if (!text) return "";
  return text.slice(0, 1).toUpperCase();
}

export function cleanAvatarInitials(value = "") {
  return nonEmpty(value).slice(0, 3).toUpperCase();
}

export function autoAvatarInitialsFor(name = "") {
  return avatarInitialFromName(name) || "N";
}

export function avatarWasAutomatic(user) {
  const current = cleanAvatarInitials(user?.avatarInitials || "");
  if (!current) return true;
  return current === autoAvatarInitialsFor(user?.name || "");
}

export function resolveAvatarInitials(input = {}, name, before = null) {
  if (Object.prototype.hasOwnProperty.call(input, "avatarInitials")) {
    const requested = cleanAvatarInitials(input.avatarInitials);
    if (!requested) return autoAvatarInitialsFor(name);
    const beforeInitials = cleanAvatarInitials(before?.avatarInitials || "");
    if (before && avatarWasAutomatic(before) && requested === beforeInitials && name !== before.name) {
      return autoAvatarInitialsFor(name);
    }
    return requested;
  }
  if (!before || avatarWasAutomatic(before)) return autoAvatarInitialsFor(name);
  return cleanAvatarInitials(before.avatarInitials);
}

export async function backfillMissingAvatarInitials() {
  if (missingAvatarInitialsBackfilled) return;
  missingAvatarInitialsBackfilled = true;
  const users = await prisma.user.findMany({
    select: { id: true, name: true, avatarInitials: true },
  });
  await Promise.all(users.filter((user) => !nonEmpty(user.avatarInitials)).map((user) => prisma.user.update({
    where: { id: user.id },
    data: { avatarInitials: autoAvatarInitialsFor(user.name) },
  })));
}

export async function ensureDefaultUsers() {
  await backfillMissingAvatarInitials();
  const activeAdminCount = await prisma.user.count({
    where: { role: "管理员", isActive: true, approvalStatus: "APPROVED" },
  });
  if (activeAdminCount > 0 || !INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) return null;
  assertSafeInitialAdminConfig();
  const email = normalizeEmail(INITIAL_ADMIN_EMAIL);
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: USER_AUTH_SELECT,
  });
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
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data, select: USER_AUTH_SELECT });
  } else {
    await prisma.user.create({ data, select: USER_AUTH_SELECT });
  }
  return null;
}

export function isInitialAdminPasswordLogin(user, password) {
  return Boolean(
    INITIAL_ADMIN_EMAIL
    && INITIAL_ADMIN_PASSWORD
    && user?.role === "管理员"
    && normalizeEmail(user.email) === normalizeEmail(INITIAL_ADMIN_EMAIL)
    && timingSafeEqualText(String(password || ""), INITIAL_ADMIN_PASSWORD),
  );
}

export function publicUser(user) {
  if (!user) return null;
  const customPermissions = normalizedCustomPermissionInput(user.customPermissions, user.role);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || "",
    avatarInitials: user.avatarInitials || "",
    defaultLanguage: user.defaultLanguage || "zh-CN",
    customPermissions,
    permissionMode: customPermissions ? "CUSTOM" : "ROLE",
    supplierId: user.supplierId || "",
    supplierName: user.supplierOperator?.supplierName || "",
    supplierType: user.supplierOperator?.supplierType || "",
    mustChangePassword: Boolean(user.mustChangePassword),
    approvalStatus: user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED"),
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function serializeUser(user) {
  return publicUser(user);
}

export async function updateOwnProfile(request, actor, input = {}) {
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user || !user.isActive) throw permissionError("请先登录", 401);
  const name = requireText(input.name, "姓名");
  const phone = String(input.phone || "").trim();
  const avatarInitials = resolveAvatarInitials(input, name, user);
  const defaultLanguage = ["zh-CN", "en-US"].includes(input.defaultLanguage) ? input.defaultLanguage : null;
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

export async function listUsers(actor, query = null, options = {}) {
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
  };
  const approvalStatus = statusText
    ? (USER_APPROVAL_STATUSES.includes(statusText) ? statusText : statusMap[statusText.toLowerCase()] || statusMap[statusText] || "")
    : "";
  const where = {
    ...(keyword ? {
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { email: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
    ...(ROLES.includes(role) ? { role } : {}),
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

export async function registerUser(request, input = {}) {
  await ensureDefaultUsers();
  const name = requireText(input.name, "姓名");
  const email = requireText(normalizeEmail(input.email), "邮箱");
  const password = String(input.password || "");
  const confirmPassword = String(input.confirmPassword || input.passwordConfirm || "");
  if (confirmPassword && confirmPassword !== password) {
    const error = new Error("两次输入的密码不一致");
    error.status = 400;
    throw error;
  }
  const duplicate = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (duplicate) {
    const error = new Error("该邮箱已提交注册或已存在账号，请联系管理员。");
    error.status = 409;
    throw error;
  }
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: hashPassword(password),
      role: "查看者",
      avatarInitials: resolveAvatarInitials(input, name),
      customPermissions: null,
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

export async function saveUser(request, actor, input, id = null) {
  assertWrite(actor, "users");
  const role = ROLES.includes(input.role) ? input.role : "查看者";
  const customPermissions = normalizedCustomPermissionInput(input.customPermissions || input.permissions, role);
  const before = id ? await prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT }) : null;
  if (id && !before) throw permissionError("用户不存在", 404);
  const name = requireText(input.name, "姓名");
  const approvalStatus = USER_APPROVAL_STATUSES.includes(input.approvalStatus)
    ? input.approvalStatus
    : (id
      ? (before?.approvalStatus || (before?.isActive ? "APPROVED" : "DISABLED"))
      : (input.isActive === false ? "DISABLED" : "APPROVED"));
  const data = {
    name,
    email: requireText(normalizeEmail(input.email), "邮箱"),
    role,
    avatarInitials: resolveAvatarInitials(input, name, before),
    supplierId: null,
    customPermissions: customPermissions || null,
    approvalStatus,
    isActive: approvalStatus === "APPROVED",
  };
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  if (role === LOGISTICS_OPERATOR_ROLE) {
    if (!supplierId) throw codedError("物流供应商账号必须绑定一个供应商。", 400, "LOGISTICS_USER_SUPPLIER_REQUIRED");
    const { assertSupplierActive } = await import("./supplier-masters");
    const supplier = await assertSupplierActive(supplierId);
    if (!DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
      throw codedError("物流供应商账号只能绑定物流、报关、海运或港杂费用供应商。", 400, "LOGISTICS_USER_SUPPLIER_TYPE_INVALID");
    }
    data.supplierId = supplier.id;
  }
  if (input.password) {
    data.passwordHash = hashPassword(input.password);
    data.mustChangePassword = true;
  }
  if (!id && !data.passwordHash) {
    const error = new Error("新建用户必须设置初始密码，禁止使用固定默认密码。");
    error.status = 400;
    throw error;
  }

  const duplicate = await prisma.user.findFirst({
    where: {
      email: { equals: data.email, mode: "insensitive" },
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    const error = new Error("邮箱已存在，不能重复创建");
    error.status = 409;
    throw error;
  }
  const user = id
    ? await prisma.user.update({ where: { id }, data, select: USER_PUBLIC_SELECT })
    : await prisma.user.create({ data, select: USER_PUBLIC_SELECT });
  if (id && (data.passwordHash || data.approvalStatus !== "APPROVED")) await revokeUserSessions(id);
  runNonCriticalTask("用户操作日志写入", () => writeAudit(request, actor, id ? "更新用户" : "新增用户", "users", user.id, before, user));
  return serializeUser(user);
}

export async function updateUserStatus(request, actor, id, status) {
  assertWrite(actor, "users");
  if (!USER_APPROVAL_STATUSES.includes(status)) {
    const error = new Error("请选择有效用户状态");
    error.status = 400;
    throw error;
  }
  const before = await prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT });
  if (!before) throw permissionError("用户不存在", 404);
  if (status === "APPROVED" && before.role === LOGISTICS_OPERATOR_ROLE) {
    if (!before.supplierId) throw codedError("物流供应商账号必须绑定一个供应商后才能启用。", 400, "LOGISTICS_USER_SUPPLIER_REQUIRED");
    const { assertSupplierActive } = await import("./supplier-masters");
    const supplier = await assertSupplierActive(before.supplierId);
    if (!DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
      throw codedError("物流供应商账号只能绑定物流、报关、海运或港杂费用供应商。", 400, "LOGISTICS_USER_SUPPLIER_TYPE_INVALID");
    }
  }
  const user = await prisma.user.update({
    where: { id },
    data: {
      approvalStatus: status,
      isActive: status === "APPROVED",
    },
    select: USER_PUBLIC_SELECT,
  });
  if (status !== "APPROVED") await revokeUserSessions(id);
  runNonCriticalTask("用户状态操作日志写入", () => writeAudit(request, actor, "更新用户状态", "users", id, before, user));
  return serializeUser(user);
}
