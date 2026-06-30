import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import crypto from "node:crypto";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../password-policy";
import { formatIpGeolocation, resolveIpGeolocation } from "./ip-geolocation";
import {
  codedError,
  logServerError,
  logServerTiming,
  nonEmpty,
  normalizeEmail,
  requireText,
  requireValidEmail,
  timeServerStep,
} from "./shared-base-utils";
import { writeAudit, writeAuthAudit } from "./shared-audit";
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
import { sendSystemEmail } from "./system-email";

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
  englishName?: string | null;
  department?: string | null;
  email?: string | null;
  role?: string | null;
  phone?: string | null;
  avatarInitials?: string | null;
  avatarUrl?: string | null;
  defaultLanguage?: string | null;
  defaultHome?: string | null;
  pageSize?: number | null;
  loginAlertEnabled?: boolean | null;
  customPermissions?: unknown;
  supplierId?: string | null;
  supplierOperator?: { supplierName?: string | null; supplierType?: string | null } | null;
  mustChangePassword?: boolean | null;
  passwordPolicyPassed?: boolean | null;
  passwordChangedAt?: Date | string | null;
  emailVerified?: boolean | null;
  emailVerifiedAt?: Date | string | null;
  approvalStatus?: string | null;
  isActive?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export const USER_AUTH_SELECT = {
  id: true,
  name: true,
  englishName: true,
  department: true,
  email: true,
  role: true,
  phone: true,
  avatarInitials: true,
  avatarUrl: true,
  defaultLanguage: true,
  defaultHome: true,
  pageSize: true,
  loginAlertEnabled: true,
  customPermissions: true,
  supplierId: true,
  supplierOperator: { select: { supplierName: true, supplierType: true } },
  mustChangePassword: true,
  passwordPolicyPassed: true,
  passwordChangedAt: true,
  emailVerified: true,
  emailVerifiedAt: true,
  approvalStatus: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  englishName: true,
  department: true,
  email: true,
  role: true,
  phone: true,
  avatarInitials: true,
  avatarUrl: true,
  defaultLanguage: true,
  defaultHome: true,
  pageSize: true,
  loginAlertEnabled: true,
  customPermissions: true,
  supplierId: true,
  supplierOperator: { select: { supplierName: true, supplierType: true } },
  mustChangePassword: true,
  passwordPolicyPassed: true,
  passwordChangedAt: true,
  emailVerified: true,
  emailVerifiedAt: true,
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
      passwordPolicyPassed: false,
      emailVerified: true,
      emailVerifiedAt: existing?.emailVerifiedAt || new Date(),
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
    englishName: user.englishName || "",
    department: user.department || "",
    email: user.email,
    role: userRoleDisplayName(user.role),
    avatarInitials: user.avatarInitials || "",
    avatarUrl: user.avatarUrl || "",
    defaultLanguage: user.defaultLanguage || "zh-CN",
    defaultHome: user.defaultHome || "welcome",
    pageSize: user.pageSize || 20,
    loginAlertEnabled: user.loginAlertEnabled !== false,
    customPermissions,
    permissionMode: customPermissions ? "CUSTOM" : "ROLE",
    supplierId: user.supplierId || "",
    supplierName: user.supplierOperator?.supplierName || "",
    supplierType: supplierTypeDisplayName(user.supplierOperator?.supplierType),
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordPolicyPassed: Boolean(user.passwordPolicyPassed),
    passwordChangedAt: user.passwordChangedAt,
    emailVerified: user.emailVerified !== false,
    emailVerifiedAt: user.emailVerifiedAt,
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
  const englishName = String(input.englishName || "").trim().slice(0, 80);
  const avatarInitials = resolveAvatarInitials(input, name, user);
  const avatarUrl = normalizeAvatarUrl(input.avatarUrl);
  const requestedDefaultLanguage = String(input.defaultLanguage || "");
  const defaultLanguage = ["zh-CN", "en-US"].includes(requestedDefaultLanguage) ? requestedDefaultLanguage : null;
  const requestedDefaultHome = String(input.defaultHome || "welcome");
  const defaultHome = ["welcome", "dashboard", "orders", "payments", "costs", "domesticLogistics", "logisticsFees", "taxRefund", "reports", "manual"].includes(requestedDefaultHome)
    ? requestedDefaultHome
    : "welcome";
  const requestedPageSize = Number(input.pageSize || 20);
  const pageSize = [10, 20, 50].includes(requestedPageSize) ? requestedPageSize : 20;
  const loginAlertEnabled = input.loginAlertEnabled !== false;
  const before = publicUser(user);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      englishName: englishName || null,
      avatarInitials,
      avatarUrl,
      defaultLanguage,
      defaultHome,
      pageSize,
      loginAlertEnabled,
    },
  });
  await runNonCriticalTask("个人资料操作日志写入", () => writeAudit(request, actor, "修改本人资料", "users", user.id, before, publicUser(updated)));
  return publicUser(updated);
}

function normalizeAvatarUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > 300_000) throw codedError("头像文件过大，请选择更小的图片。", 400, "AVATAR_TOO_LARGE");
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(text)) {
    throw codedError("头像仅支持 PNG、JPG 或 WebP 图片。", 400, "AVATAR_TYPE_INVALID");
  }
  return text;
}

function browserLabel(userAgent: string | null | undefined) {
  const ua = String(userAgent || "");
  if (!ua) return "未记录";
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  if (/Firefox\//.test(ua)) return "Firefox";
  return "其他浏览器";
}

function osLabel(userAgent: string | null | undefined) {
  const ua = String(userAgent || "");
  if (!ua) return "未记录";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/Linux/i.test(ua)) return "Linux";
  return "未知系统";
}

function deviceBrowserLabel(userAgent: string | null | undefined) {
  if (!userAgent) return "未记录";
  return `${browserLabel(userAgent)} / ${osLabel(userAgent)}`;
}

export async function listOwnLoginRecords(actor: ActorLike, limit = 10) {
  const actorId = requireText(actor?.id, "当前用户");
  const rows = await prisma.loginAttempt.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 10, 1), 10),
    select: {
      id: true,
      createdAt: true,
      ipAddress: true,
      userAgent: true,
      failureReason: true,
      geoCountry: true,
      geoRegion: true,
      geoCity: true,
      geoIsp: true,
      geoSource: true,
      geoResolvedAt: true,
      success: true,
    },
  });
  const loginTimes = rows.map((row) => new Date(row.createdAt).getTime()).filter(Number.isFinite);
  const sessionRows = loginTimes.length
    ? await prisma.userSession.findMany({
      where: {
        userId: actorId,
        createdAt: {
          gte: new Date(Math.min(...loginTimes) - 5 * 60 * 1000),
          lte: new Date(Math.max(...loginTimes) + 5 * 60 * 1000),
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        userAgent: true,
      },
    })
    : [];
  function fallbackSessionUserAgent(loginAt: Date | string) {
    const loginTime = new Date(loginAt).getTime();
    let best: { distance: number; userAgent: string } | null = null;
    for (const session of sessionRows) {
      if (!session.userAgent) continue;
      const distance = Math.abs(new Date(session.createdAt).getTime() - loginTime);
      if (distance > 5 * 60 * 1000) continue;
      if (!best || distance < best.distance) best = { distance, userAgent: session.userAgent };
    }
    return best?.userAgent || "";
  }
  return rows.map((row) => {
    const userAgent = row.userAgent || fallbackSessionUserAgent(row.createdAt);
    const storedGeo = {
      ipAddress: row.ipAddress || "",
      country: row.geoCountry || "",
      region: row.geoRegion || "",
      city: row.geoCity || "",
      isp: row.geoIsp || "",
      source: row.geoSource || "",
    };
    const geo = storedGeo.country || storedGeo.region || storedGeo.city || storedGeo.isp
      ? storedGeo
      : resolveIpGeolocation(row.ipAddress);
    return {
      id: row.id,
      loginAt: row.createdAt,
      ipAddress: row.ipAddress || "未记录",
      region: formatIpGeolocation(geo),
      geoCountry: geo.country || "",
      geoRegion: geo.region || "",
      geoCity: geo.city || "",
      geoIsp: geo.isp || "",
      geoSource: geo.source || "",
      geoResolvedAt: row.geoResolvedAt || null,
      browser: deviceBrowserLabel(userAgent),
      result: row.success ? "成功" : "失败",
      failureReason: row.failureReason || "",
    };
  });
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
  const emailVerified = ["email_verified", "EMAIL_VERIFIED", "已验证"].includes(statusText);
  const emailUnverified = ["email_unverified", "EMAIL_UNVERIFIED", "邮箱未验证", "未验证"].includes(statusText);
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
    ...(emailVerified ? { emailVerified: true } : {}),
    ...(emailUnverified ? { emailVerified: false } : {}),
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

function assertPasswordPolicy(password: unknown) {
  if (!passwordMeetsPolicy(password)) {
    throw codedError(PASSWORD_POLICY_MESSAGE, 400, "PASSWORD_POLICY_WEAK");
  }
}

function requestOriginFromAuditRequest(request: AuditRequestLike) {
  const rawUrl = String((request as { url?: string } | null | undefined)?.url || "");
  try {
    return new URL(rawUrl).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.APP_BASE_URL || "";
  }
}

function verificationTokenHash(token: unknown) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function newVerificationToken() {
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
  await sendSystemEmail({
    recipientEmails: [user.email],
    subject: "NEXTWOOD 供应链协同平台邮箱验证",
    body: [
      `${user.name || "您好"}：`,
      "",
      "请点击以下链接完成邮箱验证。",
      "",
      verifyUrl,
      "",
      "邮箱验证完成后，管理员审核通过后方可登录平台。",
      "",
      "如果您并未申请注册 NEXTWOOD 供应链协同平台，请忽略本邮件。",
    ].join("\n"),
    idempotencyKey,
  });
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
