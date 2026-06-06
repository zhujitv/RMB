import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { buildOrderDocumentKey, ensureR2Configured, readR2Object, safeFileName, signedDownloadUrl, uploadToR2 } from "./r2";

export const ROLES = ["管理员", "业务员", "财务", "成本录入员", "查看者"];
export const CURRENCIES = ["USD", "EUR", "GBP", "CNY", "HKD"];
export const ORDER_STATUSES = ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"];
export const PAYMENT_STATUSES = ["待确认", "已到账", "部分到账", "已退回", "已取消"];
export const PAYMENT_TYPES = ["预付款", "尾款", "补差款", "其他"];
export const LOGISTICS_COST_TYPES = ["国内拖车费", "报关费", "港杂费", "文件费", "订舱费", "海运费", "目的港费用", "保险费", "其他物流费用"];
export const COMMISSION_LOGISTICS_COST_TYPES = ["国内物流费", ...LOGISTICS_COST_TYPES]
  .filter((item, index, arr) => arr.indexOf(item) === index);
export const COST_TYPES = ["工厂货款", "国内物流费", ...LOGISTICS_COST_TYPES, "佣金", "样品费", "银行手续费", "其他费用"]
  .filter((item, index, arr) => arr.indexOf(item) === index);
export const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
export const INVOICE_STATUSES = ["未收到", "已收到", "不需要发票"];
export const TRADE_TERMS = ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"];
export const PAYMENT_TERM_LABELS = {
  COPY_BL: "见提单复印件付款",
  OA: "OA账期",
  AFTER_ARRIVAL: "到港后付款",
  INSTALLMENT: "分批付款",
};
export const PAYMENT_TERM_TYPES = Object.keys(PAYMENT_TERM_LABELS);
export const PAYMENT_TERMS = Object.values(PAYMENT_TERM_LABELS);
export const SUPPLIER_TYPES = ["工厂供应商", "物流供应商", "报关供应商", "海运供应商", "其他供应商"];
export const SUPPLIER_STATUSES = ["启用", "停用"];
export const EXCHANGE_RATE_SOURCES = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
export const EXCHANGE_RATE_TYPES = ["现汇买入价", "现汇卖出价", "中间价"];
export const ORDER_DOCUMENT_LABELS = {
  CUSTOMS_ENTRY_FORM: "货物报关单",
  RELEASE_NOTICE: "放行通知书",
  CUSTOMS_POWER_OF_ATTORNEY: "报关委托书",
  BILL_OF_LADING: "提单",
  COMMERCIAL_INVOICE: "商业发票",
  PACKING_LIST: "装箱单",
  SALES_CONTRACT: "销售合同",
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
};
export const EXPORT_DOCUMENT_TYPES = ["CUSTOMS_ENTRY_FORM", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY", "BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST"];
export const SALES_DOCUMENT_TYPES = ["SALES_CONTRACT"];
export const TAX_EXPORT_DOCUMENT_TYPES = [...EXPORT_DOCUMENT_TYPES, ...SALES_DOCUMENT_TYPES];
export const SUPPLIER_DOCUMENT_TYPES = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];
export const ORDER_DOCUMENT_TYPES = [...EXPORT_DOCUMENT_TYPES, ...SALES_DOCUMENT_TYPES, ...SUPPLIER_DOCUMENT_TYPES];
export const TAX_REFUND_SUPPLIER_TYPES = ["工厂供应商"];
export const UPLOAD_STATUSES = ["PENDING", "UPLOADING", "SUCCESS", "FAILED"];
export const TAX_REFUND_STATUS_LABELS = {
  NOT_READY: "资料不完整",
  READY: "资料完整待提交",
  SUBMITTED: "已提交退税",
  COMPLETED: "退税完成",
  PROBLEM: "资料异常",
};
export const TAX_REFUND_STATUSES = Object.keys(TAX_REFUND_STATUS_LABELS);
export const CUSTOMER_COMMISSION_STATUSES = ["启用", "停用"];
export const COMMISSION_STATUSES = ["不可结算：订单未收齐", "不可结算：物流成本未确认", "可结算", "已结算"];
export const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;

const EXCHANGE_RATE_SETTING_KEY = "exchange_rate";
const DEFAULT_EXCHANGE_RATE_SETTINGS = {
  source: "中国银行",
  rateType: "现汇买入价",
  autoUpdate: true,
  allowManualEdit: true,
};
const AUTO_RATE_CURRENCIES = ["USD", "EUR", "GBP", "HKD"];
const BOC_CURRENCY_NAMES = {
  USD: "美元",
  EUR: "欧元",
  GBP: "英镑",
  HKD: "港币",
};

const SESSION_COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-fta_session" : "fta_session";
const LEGACY_SESSION_COOKIE_NAME = "fta_user_id";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const SESSION_TOKEN_BYTES = 32;
const PASSWORD_MIN_LENGTH = 8;
const BCRYPT_COST = Math.min(14, Math.max(10, Number(process.env.BCRYPT_COST || 12)));
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_FAILURES = 8;
const SCRYPT_HASH_PREFIX = "scrypt";
const PASSWORD_SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
};

const INITIAL_ADMIN_EMAIL = nonEmpty(process.env.INITIAL_ADMIN_EMAIL);
const INITIAL_ADMIN_PASSWORD = String(process.env.INITIAL_ADMIN_PASSWORD || "");

const WRITE_PERMISSIONS = {
  users: ["管理员"],
  customers: ["管理员"],
  orders: ["管理员", "业务员"],
  payments: ["管理员", "财务"],
  costs: ["管理员", "成本录入员"],
  logistics: ["管理员", "业务员"],
  documents: ["管理员", "业务员", "成本录入员"],
  taxRefund: ["管理员", "财务"],
  commissions: ["管理员", "财务"],
  suppliers: ["管理员"],
  settings: ["管理员"],
  exchangeRates: ["管理员", "财务"],
};

export const ROLE_MENUS = {
  管理员: ["dashboard", "orders", "payments", "costs", "profit", "taxRefund", "reports", "manual", "settings"],
  业务员: ["dashboard", "orders", "profit", "reports", "manual"],
  财务: ["dashboard", "payments", "profit", "taxRefund", "reports", "manual"],
  成本录入员: ["costs", "profit", "manual"],
  查看者: ["dashboard", "profit", "reports", "manual"],
};

export const ROLE_SCOPE_TEXT = {
  管理员: "可查看和管理全部数据",
  业务员: "仅可查看本人客户和订单",
  财务: "可查看全部应收和收款数据",
  成本录入员: "仅可录入成本并查看成本相关数据",
  查看者: "只读权限",
};

const READ_PERMISSIONS = {
  users: ["管理员"],
  customers: ["管理员", "业务员"],
  suppliers: ["管理员", "成本录入员"],
  orders: ["管理员", "业务员", "财务", "成本录入员", "查看者"],
  payments: ["管理员", "业务员", "财务", "查看者"],
  costs: ["管理员", "业务员", "财务", "成本录入员", "查看者"],
  documents: ["管理员", "业务员", "财务", "成本录入员", "查看者"],
  taxRefund: ["管理员", "财务"],
  commissions: ["管理员", "业务员", "财务"],
  reports: ["管理员", "业务员", "财务", "查看者"],
  settings: ["管理员"],
  auditLogs: ["管理员"],
};

const CUSTOMER_VIEW_ALL_ROLES = ["管理员"];
const PERMISSION_MODES = ["ROLE", "CUSTOM"];
const DATA_SCOPES = ["ALL", "OWN", "OWN_COST", "NONE"];
const MENU_KEYS = Object.values(ROLE_MENUS).flat()
  .filter((item, index, arr) => arr.indexOf(item) === index);
const READ_PERMISSION_KEYS = Object.keys(READ_PERMISSIONS);
const WRITE_PERMISSION_KEYS = Object.keys(WRITE_PERMISSIONS);
const UNSAFE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

function permissionMode(value) {
  return PERMISSION_MODES.includes(value) ? value : "ROLE";
}

function checkedPermissionList(values, allowed) {
  const rows = Array.isArray(values) ? values : [];
  return rows
    .map((item) => String(item || "").trim())
    .filter((item, index, arr) => allowed.includes(item) && arr.indexOf(item) === index);
}

function permissionObject(keys, enabledKeys = []) {
  return Object.fromEntries(keys.map((key) => [key, enabledKeys.includes(key)]));
}

function roleReadKeys(role) {
  return READ_PERMISSION_KEYS.filter((area) => READ_PERMISSIONS[area]?.includes(role));
}

function roleWriteKeys(role) {
  return WRITE_PERMISSION_KEYS.filter((area) => WRITE_PERMISSIONS[area]?.includes(role));
}

function roleDataScope(role) {
  if (role === "管理员" || role === "财务" || role === "查看者") return "ALL";
  if (role === "业务员") return "OWN";
  if (role === "成本录入员") return "OWN_COST";
  return "NONE";
}

function customDataScopeFallback(role, writeKeys = []) {
  if (role === "管理员" || role === "财务") return "ALL";
  if (role === "业务员") return "OWN";
  if (role === "成本录入员") return "OWN_COST";
  return writeKeys.length ? "OWN" : roleDataScope(role);
}

function rolePermissionSnapshot(role) {
  const menus = roleMenus(role);
  const readKeys = roleReadKeys(role);
  const writeKeys = roleWriteKeys(role);
  return {
    mode: "ROLE",
    menus,
    readKeys,
    writeKeys,
    reads: permissionObject(READ_PERMISSION_KEYS, readKeys),
    writes: permissionObject(WRITE_PERMISSION_KEYS, writeKeys),
    dataScope: roleDataScope(role),
    scopeText: roleScopeText(role),
  };
}

function normalizedCustomPermissionInput(value, role) {
  const input = value && typeof value === "object" ? value : {};
  const mode = permissionMode(input.mode || input.permissionMode);
  if (mode !== "CUSTOM") return null;
  const fallback = rolePermissionSnapshot(role);
  const menus = checkedPermissionList(input.menus ?? fallback.menus, MENU_KEYS);
  const readKeys = checkedPermissionList(input.reads ?? input.readKeys ?? fallback.readKeys, READ_PERMISSION_KEYS);
  const writeKeys = checkedPermissionList(input.writes ?? input.writeKeys ?? fallback.writeKeys, WRITE_PERMISSION_KEYS);
  const dataScope = DATA_SCOPES.includes(input.dataScope)
    ? input.dataScope
    : customDataScopeFallback(role, writeKeys);
  return {
    mode: "CUSTOM",
    menus,
    reads: readKeys,
    writes: writeKeys,
    dataScope,
  };
}

function effectivePermissions(user) {
  const role = user?.role || "";
  const base = rolePermissionSnapshot(role);
  const custom = normalizedCustomPermissionInput(user?.customPermissions, role);
  if (!custom) return base;
  return {
    mode: "CUSTOM",
    menus: custom.menus,
    readKeys: custom.reads,
    writeKeys: custom.writes,
    reads: permissionObject(READ_PERMISSION_KEYS, custom.reads),
    writes: permissionObject(WRITE_PERMISSION_KEYS, custom.writes),
    dataScope: custom.dataScope,
    scopeText: `${roleScopeText(role)}；自定义组合权限`,
  };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken(bytes = SESSION_TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sessionTokenHash(token) {
  return sha256Hex(token);
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function legacySha256PasswordHash(password) {
  return sha256Hex(password);
}

function isLegacySha256Hash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

function scryptPasswordHash(password) {
  const plain = String(password || "");
  const salt = randomToken(16);
  const { N, r, p, keyLength } = PASSWORD_SCRYPT_PARAMS;
  const derived = crypto.scryptSync(plain, salt, keyLength, { N, r, p }).toString("base64url");
  return `${SCRYPT_HASH_PREFIX}$${N}$${r}$${p}$${salt}$${derived}`;
}

function bcryptPasswordHash(password) {
  return bcrypt.hashSync(String(password || ""), BCRYPT_COST);
}

export function hashPassword(password) {
  const plain = String(password || "");
  if (plain.length < PASSWORD_MIN_LENGTH) {
    const error = new Error(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
    error.status = 400;
    throw error;
  }
  return bcryptPasswordHash(plain);
}

export function upgradePasswordHash(password) {
  return hashPassword(password);
}

export function passwordHashNeedsUpgrade(passwordHash) {
  return !isBcryptHash(passwordHash);
}

export function verifyPassword(password, passwordHash) {
  const stored = String(passwordHash || "");
  if (isBcryptHash(stored)) {
    try {
      return bcrypt.compareSync(String(password || ""), stored);
    } catch {
      return false;
    }
  }
  if (isLegacySha256Hash(stored)) {
    return timingSafeEqualText(legacySha256PasswordHash(password), stored);
  }
  const [prefix, nText, rText, pText, salt, derived] = stored.split("$");
  if (prefix !== SCRYPT_HASH_PREFIX || !salt || !derived) return false;
  try {
    const N = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    const keyLength = Buffer.from(derived, "base64url").length || PASSWORD_SCRYPT_PARAMS.keyLength;
    const candidate = crypto.scryptSync(String(password || ""), salt, keyLength, { N, r, p }).toString("base64url");
    return timingSafeEqualText(candidate, derived);
  } catch {
    return false;
  }
}

export async function ensureDefaultUsers() {
  const count = await prisma.user.count();
  if (count === 0 && INITIAL_ADMIN_EMAIL && INITIAL_ADMIN_PASSWORD) {
    await prisma.user.create({
      data: {
        name: nonEmpty(process.env.INITIAL_ADMIN_NAME) || "系统管理员",
        email: normalizeEmail(INITIAL_ADMIN_EMAIL),
        passwordHash: hashPassword(INITIAL_ADMIN_PASSWORD),
        role: "管理员",
        mustChangePassword: true,
        isActive: true,
      },
    });
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

function permissionError(message = "没有权限执行该操作", status = 403) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requestIp(request) {
  return request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request?.headers?.get("x-real-ip")
    || null;
}

function requestSessionToken(request) {
  return request?.cookies?.get(SESSION_COOKIE_NAME)?.value
    || request?.cookies?.get("fta_session")?.value
    || request?.cookies?.get("__Host-fta_session")?.value
    || "";
}

function requestOrigin(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

function headerOrigin(value) {
  const text = String(value || "").trim();
  if (!text || text === "null") return "";
  try {
    return new URL(text).origin;
  } catch {
    return "";
  }
}

function assertSameOriginRequest(request) {
  const method = String(request?.method || "GET").toUpperCase();
  if (!UNSAFE_METHODS.includes(method)) return;
  const expectedOrigin = requestOrigin(request);
  if (!expectedOrigin) return;
  const origin = headerOrigin(request.headers?.get("origin"));
  const referer = headerOrigin(request.headers?.get("referer"));
  if (origin && origin !== expectedOrigin) {
    throw permissionError("请求来源不合法", 403);
  }
  if (!origin && referer && referer !== expectedOrigin) {
    throw permissionError("请求来源不合法", 403);
  }
  if (process.env.NODE_ENV === "production" && !origin && !referer) {
    throw permissionError("缺少请求来源校验信息", 403);
  }
}

export function setSessionCookie(response, token) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.set(LEGACY_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function clearSessionCookies(response) {
  [SESSION_COOKIE_NAME, "fta_session", "__Host-fta_session", LEGACY_SESSION_COOKIE_NAME].forEach((name) => {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  });
}

export async function createUserSession(request, user) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: sessionTokenHash(token),
      expiresAt,
      userAgent: request?.headers?.get("user-agent")?.slice(0, 500) || null,
      ipAddress: requestIp(request),
    },
  });
  return { token, expiresAt };
}

export async function revokeCurrentSession(request) {
  const token = requestSessionToken(request);
  if (!token) return;
  assertSameOriginRequest(request);
  await prisma.userSession.updateMany({
    where: {
      tokenHash: sessionTokenHash(token),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function revokeUserSessions(userId) {
  if (!userId) return;
  await prisma.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function getActor(request, { required = true, allowPasswordChangeRequired = false } = {}) {
  await ensureDefaultUsers();
  const sessionToken = requestSessionToken(request);
  if (sessionToken) {
    assertSameOriginRequest(request);
    const session = await prisma.userSession.findFirst({
      where: {
        tokenHash: sessionTokenHash(sessionToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { is: { isActive: true } },
      },
      include: { user: true },
    });
    if (session?.user) {
      if (session.user.mustChangePassword && !allowPasswordChangeRequired) {
        const error = permissionError("首次登录必须修改密码", 403);
        error.code = "PASSWORD_CHANGE_REQUIRED";
        throw error;
      }
      return session.user;
    }
  }
  if (!required) return null;
  throw permissionError("请先登录", 401);
}

export function loginAttemptKey(request, email) {
  return sha256Hex(`${requestIp(request) || "unknown"}:${normalizeEmail(email)}`);
}

export async function assertLoginNotRateLimited(request, email) {
  const key = loginAttemptKey(request, email);
  const since = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MS);
  const failures = await prisma.loginAttempt.count({
    where: {
      key,
      success: false,
      createdAt: { gte: since },
    },
  });
  if (failures >= LOGIN_RATE_LIMIT_MAX_FAILURES) {
    const error = new Error("登录失败次数过多，请 15 分钟后再试。");
    error.status = 429;
    throw error;
  }
}

export async function recordLoginAttempt(request, email, success, userId = null) {
  await prisma.loginAttempt.create({
    data: {
      key: loginAttemptKey(request, email),
      email: normalizeEmail(email) || null,
      ipAddress: requestIp(request),
      success: Boolean(success),
      userId,
    },
  });
}

export async function changeOwnPassword(request, actor, input = {}) {
  const currentPassword = String(input.currentPassword || "");
  const newPassword = String(input.newPassword || "");
  const confirmPassword = String(input.confirmPassword || input.newPasswordConfirm || "");
  if (confirmPassword && confirmPassword !== newPassword) {
    const error = new Error("两次输入的新密码不一致");
    error.status = 400;
    throw error;
  }
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user || !user.isActive) throw permissionError("请先登录", 401);
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    const error = new Error("当前密码错误");
    error.status = 403;
    throw error;
  }
  if (verifyPassword(newPassword, user.passwordHash)) {
    const error = new Error("新密码不能与当前密码相同");
    error.status = 400;
    throw error;
  }
  const before = { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
    },
  });
  await revokeUserSessions(user.id);
  await writeAudit(request, actor, "修改本人密码", "users", user.id, before, {
    id: updated.id,
    email: updated.email,
    role: updated.role,
    mustChangePassword: updated.mustChangePassword,
  });
  return publicUser(updated);
}

export function roleMenus(role) {
  return ROLE_MENUS[role] || [];
}

export function roleScopeText(role) {
  return ROLE_SCOPE_TEXT[role] || "未配置权限";
}

export function rolePermissions(user) {
  const permissions = effectivePermissions(user);
  return {
    mode: permissions.mode,
    menus: permissions.menus,
    readKeys: permissions.readKeys,
    writeKeys: permissions.writeKeys,
    dataScope: permissions.dataScope,
    scopeText: permissions.scopeText,
    writes: permissions.writes,
    reads: permissions.reads,
  };
}

export function canRead(user, area) {
  return Boolean(effectivePermissions(user).reads?.[area]);
}

export function assertRead(user, area) {
  if (!canRead(user, area)) {
    throw permissionError("没有权限查看该数据");
  }
}

export function canWrite(user, area) {
  return Boolean(effectivePermissions(user).writes?.[area]);
}

export function assertWrite(user, area) {
  if (!canWrite(user, area)) {
    throw permissionError("没有权限执行该操作");
  }
}

export function apiError(error, fallback = "请求处理失败") {
  console.error(error);
  const isProduction = process.env.NODE_ENV === "production";
  const exposeDetails = process.env.EXPOSE_ERROR_DETAILS === "true";
  const status = error?.status || 500;
  const safeMessage = isProduction && status >= 500 && !error?.expose ? fallback : (error?.message || fallback);
  return NextResponse.json(
    {
      error: safeMessage,
      code: error?.code || undefined,
      details: exposeDetails || !isProduction ? (error?.details || undefined) : undefined,
    },
    { status },
  );
}

export function ok(data = {}) {
  return NextResponse.json(data);
}

export function dateFromInput(value) {
  if (!value) return null;
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

export function dateToInput(value) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function amountCny(amount, rate) {
  return Math.round(num(amount) * num(rate, 1) * 100) / 100;
}

export function nonEmpty(value) {
  return String(value ?? "").trim();
}

export function normalizeEmail(value) {
  return nonEmpty(value).toLowerCase();
}

export function optional(value) {
  const text = nonEmpty(value);
  return text || null;
}

export function requirePositive(value, label) {
  const number = num(value);
  if (number <= 0) {
    const error = new Error(`${label}必须大于 0`);
    error.status = 400;
    throw error;
  }
  return number;
}

export function requireText(value, label) {
  const text = nonEmpty(value);
  if (!text) {
    const error = new Error(`${label}不能为空`);
    error.status = 400;
    throw error;
  }
  return text;
}

const PAYMENT_TERM_TYPE_BY_LABEL = Object.fromEntries(
  Object.entries(PAYMENT_TERM_LABELS).map(([type, label]) => [label, type]),
);

function paymentTermLabel(type, fallback = "") {
  return PAYMENT_TERM_LABELS[type] || fallback || "";
}

function validPaymentTermType(type) {
  return PAYMENT_TERM_TYPES.includes(type);
}

function addDays(date, days) {
  if (!date || !Number.isFinite(Number(days))) return null;
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + Math.round(Number(days)));
  return result;
}

function normalizeCreditDays(value, required = false) {
  if (value === "" || value == null) {
    if (!required) return null;
    const error = new Error("账期天数不能为空");
    error.status = 400;
    throw error;
  }
  const days = Math.round(num(value));
  if (days < 0) {
    const error = new Error("账期天数不能小于 0");
    error.status = 400;
    throw error;
  }
  return days;
}

function resolvePaymentTerm(input, before) {
  const rawType = optional(input.paymentTermType);
  const rawLabel = optional(input.paymentTerm);
  const fromLabel = rawLabel ? PAYMENT_TERM_TYPE_BY_LABEL[rawLabel] : null;
  const type = validPaymentTermType(rawType) ? rawType : fromLabel;
  if (type) return { type, label: paymentTermLabel(type) };
  if (before) {
    return {
      type: before.paymentTermType || null,
      label: before.paymentTerm || paymentTermLabel(before.paymentTermType, "OA账期"),
    };
  }
  const error = new Error("请选择有效付款条款");
  error.status = 400;
  throw error;
}

function normalizeInstallments(input, finalAmount, exchangeRate) {
  const rows = Array.isArray(input) ? input : [];
  const cleaned = rows
    .map((item) => ({
      ratio: Math.round(num(item?.ratio) * 100) / 100,
      condition: nonEmpty(item?.condition),
    }))
    .filter((item) => item.ratio > 0 || item.condition);
  if (!cleaned.length) {
    const error = new Error("分批付款请至少录入一个付款节点");
    error.status = 400;
    throw error;
  }
  let ratioTotal = 0;
  const normalized = cleaned.map((item, index) => {
    if (!(item.ratio > 0)) {
      const error = new Error(`第 ${index + 1} 个付款节点比例必须大于 0`);
      error.status = 400;
      throw error;
    }
    if (!item.condition) {
      const error = new Error(`第 ${index + 1} 个付款节点条件不能为空`);
      error.status = 400;
      throw error;
    }
    ratioTotal += item.ratio;
    const amount = Math.round(finalAmount * (item.ratio / 100) * 100) / 100;
    return {
      ratio: item.ratio,
      condition: item.condition,
      amount,
      amountCny: amountCny(amount, exchangeRate),
    };
  });
  if (Math.abs(ratioTotal - 100) > 0.01) {
    const error = new Error("分批付款比例合计必须等于 100%");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function todayInputInChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeDateText(value, fallback = todayInputInChina()) {
  if (!value) return fallback;
  if (value instanceof Date) return dateToInput(value);
  const text = String(value).trim();
  return text ? text.slice(0, 10).replaceAll("/", "-") : fallback;
}

function normalizeExchangeRateSettings(value = {}) {
  return {
    ...DEFAULT_EXCHANGE_RATE_SETTINGS,
    ...(value && typeof value === "object" ? value : {}),
    source: EXCHANGE_RATE_SOURCES.includes(value?.source) ? value.source : DEFAULT_EXCHANGE_RATE_SETTINGS.source,
    rateType: EXCHANGE_RATE_TYPES.includes(value?.rateType) ? value.rateType : DEFAULT_EXCHANGE_RATE_SETTINGS.rateType,
    autoUpdate: value?.autoUpdate !== false,
    allowManualEdit: value?.allowManualEdit !== false,
  };
}

function serializeExchangeRateSetting(setting) {
  return normalizeExchangeRateSettings(setting?.value || setting || {});
}

export async function getExchangeRateSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: EXCHANGE_RATE_SETTING_KEY } });
  if (setting) return serializeExchangeRateSetting(setting);
  const created = await prisma.systemSetting.create({
    data: {
      key: EXCHANGE_RATE_SETTING_KEY,
      value: DEFAULT_EXCHANGE_RATE_SETTINGS,
    },
  });
  return serializeExchangeRateSetting(created);
}

export async function saveExchangeRateSettings(request, actor, input = {}) {
  assertWrite(actor, "settings");
  const value = normalizeExchangeRateSettings({
    source: input.source,
    rateType: input.rateType,
    autoUpdate: input.autoUpdate,
    allowManualEdit: input.allowManualEdit,
  });
  const before = await prisma.systemSetting.findUnique({ where: { key: EXCHANGE_RATE_SETTING_KEY } });
  const setting = await prisma.systemSetting.upsert({
    where: { key: EXCHANGE_RATE_SETTING_KEY },
    update: { value },
    create: { key: EXCHANGE_RATE_SETTING_KEY, value },
  });
  await writeAudit(request, actor, "更新汇率设置", "system_settings", EXCHANGE_RATE_SETTING_KEY, before, setting);
  return serializeExchangeRateSetting(setting);
}

function htmlText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseBocRate(value) {
  const number = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round((number / 100) * 1000000) / 1000000 : null;
}

function exchangeSourceOrder(preferred) {
  const priority = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
  if (!preferred || !priority.includes(preferred)) return priority;
  return [preferred, ...priority.filter((source) => source !== preferred)];
}

async function fetchBocRates(rateDate, rateType) {
  const response = await fetch("https://www.boc.cn/sourcedb/whpj/", { cache: "no-store" });
  if (!response.ok) return [];
  const html = await response.text();
  const rows = [...html.matchAll(/<tr[^>]*data-currency=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.flatMap((match) => {
    const currency = Object.entries(BOC_CURRENCY_NAMES).find(([, name]) => name === match[1])?.[0];
    if (!currency) return [];
    const cells = [...match[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlText(cell[1]));
    const publishedDate = (cells[6] || "").slice(0, 10).replaceAll("/", "-") || rateDate;
    if (publishedDate !== rateDate && rateDate !== todayInputInChina()) return [];
    const buy = parseBocRate(cells[1]);
    const sell = parseBocRate(cells[3]);
    const middle = parseBocRate(cells[5]) || (buy && sell ? Math.round(((buy + sell) / 2) * 1000000) / 1000000 : null);
    const rateMap = {
      "现汇买入价": buy,
      "现汇卖出价": sell,
      "中间价": middle,
    };
    const rateToCny = rateMap[rateType];
    return rateToCny ? [{ currency, rateToCny, rateDate: publishedDate, source: "中国银行", rateType }] : [];
  });
}

function addDaysText(dateText, days) {
  const date = dateFromInput(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchOfficialFallbackRates(source, rateDate, rateType) {
  if (rateType !== "中间价") return [];
  const body = new URLSearchParams({
    startDate: addDaysText(rateDate, -10),
    endDate: rateDate,
    queryYN: "true",
  });
  const response = await fetch("https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const html = await response.text();
  const rows = [...html.matchAll(/<tr class="first"[\s\S]*?<\/tr>/gi)]
    .map((row) => [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlText(cell[1])))
    .filter((cells) => /^\d{4}-\d{2}-\d{2}$/.test(cells[0]) && cells[0] <= rateDate)
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  const cells = rows[0];
  if (!cells) return [];
  const map = [
    ["USD", cells[1]],
    ["EUR", cells[2]],
    ["HKD", cells[4]],
    ["GBP", cells[5]],
  ];
  return map.flatMap(([currency, value]) => {
    const rateToCny = parseBocRate(value);
    return rateToCny ? [{ currency, rateToCny, rateDate: cells[0], source, rateType }] : [];
  });
}

async function fetchThirdPartyRates(rateDate, rateType) {
  const response = await fetch(`https://api.frankfurter.app/${encodeURIComponent(rateDate)}?from=CNY&to=${AUTO_RATE_CURRENCIES.join(",")}`, { cache: "no-store" });
  if (!response.ok) return [];
  const data = await response.json();
  const actualDate = normalizeDateText(data.date, rateDate);
  return Object.entries(data.rates || {}).flatMap(([currency, rateFromCny]) => {
    const rate = Number(rateFromCny);
    if (!AUTO_RATE_CURRENCIES.includes(currency) || !(rate > 0)) return [];
    return [{
      currency,
      rateToCny: Math.round((1 / rate) * 1000000) / 1000000,
      rateDate: actualDate,
      source: "第三方API",
      rateType,
    }];
  });
}

async function fetchRatesBySource(source, rateDate, rateType) {
  if (source === "中国银行") return fetchBocRates(rateDate, rateType);
  if (source === "中国外汇交易中心" || source === "国家外汇管理局") return fetchOfficialFallbackRates(source, rateDate, rateType);
  if (source === "第三方API") return fetchThirdPartyRates(rateDate, rateType);
  return [];
}

async function saveExchangeRateRows(rows) {
  const saved = [];
  for (const row of rows) {
    const rateDate = dateFromInput(row.rateDate);
    if (!row.currency || !rateDate || !(Number(row.rateToCny) > 0)) continue;
    const item = await prisma.exchangeRate.upsert({
      where: {
        currency_rateDate_source_rateType: {
          currency: row.currency,
          rateDate,
          source: row.source,
          rateType: row.rateType,
        },
      },
      update: { rateToCny: row.rateToCny },
      create: {
        currency: row.currency,
        rateDate,
        source: row.source,
        rateType: row.rateType,
        rateToCny: row.rateToCny,
      },
    });
    saved.push(item);
  }
  return saved;
}

function serializeExchangeRate(row, requestedDate = "") {
  if (!row) return null;
  const rateDate = dateToInput(row.rateDate);
  return {
    id: row.id,
    currency: row.currency,
    rateToCny: Number(row.rateToCny),
    rateDate,
    source: row.source,
    rateType: row.rateType,
    isFallbackDate: Boolean(requestedDate && rateDate !== requestedDate),
    message: requestedDate && rateDate !== requestedDate ? "今日汇率获取失败，已使用最近可用汇率。" : "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findCachedExchangeRate(currency, rateDate, rateType, source = "", exact = false) {
  const date = dateFromInput(rateDate);
  const where = {
    currency,
    rateType,
    ...(source ? { source } : {}),
    rateDate: exact ? date : { lte: date },
  };
  return prisma.exchangeRate.findFirst({
    where,
    orderBy: [{ rateDate: "desc" }, { updatedAt: "desc" }],
  });
}

export async function refreshExchangeRatesForDate(rateDateInput = todayInputInChina(), options = {}) {
  const settings = await getExchangeRateSettings();
  const rateDate = normalizeDateText(rateDateInput);
  const rateType = EXCHANGE_RATE_TYPES.includes(options.rateType) ? options.rateType : settings.rateType;
  const sourceOrder = exchangeSourceOrder(options.source || settings.source);
  let lastError = null;
  for (const source of sourceOrder) {
    try {
      const rows = await fetchRatesBySource(source, rateDate, rateType);
      if (!rows.length) continue;
      const saved = await saveExchangeRateRows(rows);
      if (saved.length) {
        return {
          ok: true,
          source: saved[0].source,
          rateType,
          rateDate,
          rates: saved.map((row) => serializeExchangeRate(row, rateDate)),
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  return {
    ok: false,
    source: "",
    rateType,
    rateDate,
    rates: [],
    message: "今日汇率获取失败，已使用最近可用汇率。",
    error: lastError?.message || "未能获取汇率",
  };
}

export async function refreshExchangeRates(request, actor, input = {}) {
  assertWrite(actor, "exchangeRates");
  const result = await refreshExchangeRatesForDate(input.rateDate || input.date, {
    source: input.source,
    rateType: input.rateType,
  });
  await writeAudit(request, actor, "手动刷新汇率", "exchange_rates", result.rateDate, null, result);
  return result;
}

export async function getExchangeRateQuote(input = {}, actor = null) {
  const settings = await getExchangeRateSettings();
  const currency = requireText(input.currency || "CNY", "币种").toUpperCase();
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const rateDate = normalizeDateText(input.rateDate || input.date);
  const rateType = EXCHANGE_RATE_TYPES.includes(input.rateType) ? input.rateType : settings.rateType;
  const source = EXCHANGE_RATE_SOURCES.includes(input.source) ? input.source : settings.source;
  if (currency === "CNY") {
    return {
      currency,
      rateToCny: 1,
      rateDate,
      source: "系统",
      rateType,
      isFallbackDate: false,
      message: "",
      settings,
    };
  }
  const exact = await findCachedExchangeRate(currency, rateDate, rateType, source, true)
    || await findCachedExchangeRate(currency, rateDate, rateType, "", true);
  if (exact && !input.forceRefresh) {
    return { ...serializeExchangeRate(exact, rateDate), settings };
  }
  if (settings.autoUpdate || input.forceRefresh) {
    await refreshExchangeRatesForDate(rateDate, { source, rateType });
  }
  const cached = await findCachedExchangeRate(currency, rateDate, rateType, source)
    || await findCachedExchangeRate(currency, rateDate, rateType, "");
  if (cached) {
    return { ...serializeExchangeRate(cached, rateDate), settings };
  }
  const error = new Error("未找到可用汇率，请财务手动刷新汇率后再保存。");
  error.status = 404;
  throw error;
}

async function resolveExchangeRateSnapshot(input, actor, { currency, defaultDate, allowHistoricalSource = false } = {}) {
  const settings = await getExchangeRateSettings();
  const finalCurrency = requireText(currency || input.currency, "币种").toUpperCase();
  if (!CURRENCIES.includes(finalCurrency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const exchangeRate = requirePositive(input.exchangeRate, "汇率");
  const exchangeRateDate = normalizeDateText(input.exchangeRateDate || input.rateDate || defaultDate);
  const exchangeRateSource = optional(input.exchangeRateSource) || (finalCurrency === "CNY" ? "系统" : "手动");
  const exchangeRateType = EXCHANGE_RATE_TYPES.includes(input.exchangeRateType)
    ? input.exchangeRateType
    : (allowHistoricalSource && input.exchangeRateType === "历史录入" ? "历史录入" : settings.rateType);
  if (finalCurrency === "CNY" && Math.abs(exchangeRate - 1) > 0.000001) {
    const error = new Error("人民币汇率必须等于 1");
    error.status = 400;
    throw error;
  }
  if (finalCurrency !== "CNY" && Math.abs(exchangeRate - 1) <= 0.000001 && !(actor?.role === "管理员" && input.manualRateConfirmed === true)) {
    const error = new Error("非人民币汇率不能保存为 1，除非管理员手动确认");
    error.status = 400;
    throw error;
  }
  if (exchangeRateSource === "历史录入" && !allowHistoricalSource) {
    const error = new Error("不能为新记录伪造历史录入汇率来源");
    error.status = 403;
    throw error;
  }
  if (finalCurrency !== "CNY" && exchangeRateSource === "手动" && !["管理员", "财务"].includes(actor?.role)) {
    const error = new Error("当前用户只能使用系统自动汇率");
    error.status = 403;
    throw error;
  }
  if (finalCurrency !== "CNY" && !settings.allowManualEdit && exchangeRateSource === "手动" && actor?.role !== "管理员") {
    const error = new Error("系统设置不允许手动修改汇率，请使用系统自动汇率");
    error.status = 403;
    throw error;
  }
  return {
    currency: finalCurrency,
    exchangeRate,
    exchangeRateDate: dateFromInput(exchangeRateDate),
    exchangeRateSource,
    exchangeRateType,
  };
}

export function publicUser(user) {
  if (!user) return null;
  const customPermissions = normalizedCustomPermissionInput(user.customPermissions, user.role);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    customPermissions,
    permissionMode: customPermissions ? "CUSTOM" : "ROLE",
    mustChangePassword: Boolean(user.mustChangePassword),
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeUser(user) {
  return publicUser(user);
}

export function serializeCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    country: customer.country || "",
    defaultCurrency: customer.defaultCurrency,
    salespersonUserId: customer.salespersonUserId || "",
    salespersonName: customer.salesperson?.name || "",
    commissionRate: Number(customer.commissionRate || 0),
    commissionStatus: customer.commissionStatus || "启用",
    contactPerson: customer.contactPerson || "",
    contactEmail: customer.contactEmail || "",
    contactPhone: customer.contactPhone || "",
    remark: customer.remark || "",
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function serializeSupplier(supplier) {
  return {
    id: supplier.id,
    supplierName: supplier.supplierName,
    supplierType: supplier.supplierType,
    country: supplier.country || "",
    contactPerson: supplier.contactPerson || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    invoiceTitle: supplier.invoiceTitle || "",
    taxNumber: supplier.taxNumber || "",
    bankName: supplier.bankName || "",
    bankAccount: supplier.bankAccount || "",
    remark: supplier.remark || "",
    status: supplier.status,
    createdBy: serializeUser(supplier.createdBy),
    updatedBy: serializeUser(supplier.updatedBy),
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

function serializePayment(payment) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    orderNo: payment.order?.orderNo || "",
    customerName: payment.order?.customerNameSnapshot || payment.order?.customer?.name || "",
    country: payment.order?.customer?.country || payment.order?.country || "",
    salespersonName: payment.order?.salesperson?.name || "",
    paymentDate: dateToInput(payment.paymentDate),
    currency: payment.currency,
    exchangeRate: Number(payment.exchangeRate),
    exchangeRateDate: dateToInput(payment.exchangeRateDate),
    exchangeRateSource: payment.exchangeRateSource || "",
    exchangeRateType: payment.exchangeRateType || "",
    amount: Number(payment.amount),
    amountCny: Number(payment.amountCny),
    paymentType: payment.paymentType || "尾款",
    status: payment.status,
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
    createdBy: serializeUser(payment.createdBy),
    updatedBy: serializeUser(payment.updatedBy),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function serializeCost(cost) {
  return {
    id: cost.id,
    orderId: cost.orderId,
    orderNo: cost.order?.orderNo || "",
    blNo: cost.order?.blNo || "",
    billOfLadingNo: cost.order?.blNo || "",
    customerId: cost.order?.customerId || "",
    customerName: cost.order?.customerNameSnapshot || cost.order?.customer?.name || "",
    country: cost.order?.customer?.country || cost.order?.country || "",
    salespersonName: cost.order?.salesperson?.name || "",
    orderCurrency: cost.order?.currency || "",
    orderExchangeRate: Number(cost.order?.exchangeRate || 0),
    orderStatus: cost.order?.status || "",
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierNameSnapshot: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierType: cost.supplier?.supplierType || "",
    costType: cost.costType,
    vendorName: cost.supplierNameSnapshot || cost.vendorName,
    currency: cost.currency,
    exchangeRate: Number(cost.exchangeRate),
    exchangeRateDate: dateToInput(cost.exchangeRateDate),
    exchangeRateSource: cost.exchangeRateSource || "",
    exchangeRateType: cost.exchangeRateType || "",
    amount: Number(cost.amount),
    amountCny: Number(cost.amountCny),
    paymentStatus: cost.paymentStatus,
    costConfirmed: Boolean(cost.costConfirmed),
    costConfirmedAt: cost.costConfirmedAt,
    paymentDate: dateToInput(cost.paymentDate),
    invoiceStatus: cost.invoiceStatus,
    remark: cost.remark || "",
    createdBy: serializeUser(cost.createdBy),
    updatedBy: serializeUser(cost.updatedBy),
    documents: (cost.documents || []).map(serializeOrderDocument),
    createdAt: cost.createdAt,
    updatedAt: cost.updatedAt,
  };
}

function serializeOrderDocument(document) {
  return {
    id: document.id,
    orderId: document.orderId,
    costId: document.costId || "",
    supplierId: document.supplierId || "",
    relatedModule: document.relatedModule || "EXPORT",
    orderNo: document.order?.orderNo || "",
    blNo: document.order?.blNo || "",
    billOfLadingNo: document.order?.blNo || "",
    customerName: document.order?.customerNameSnapshot || document.order?.customer?.name || "",
    supplierName: document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "",
    supplierType: document.supplier?.supplierType || document.cost?.supplier?.supplierType || "",
    costType: document.cost?.costType || "",
    documentType: document.documentType,
    documentTypeLabel: ORDER_DOCUMENT_LABELS[document.documentType] || document.documentType,
    fileName: document.fileName,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
    uploadStatus: document.uploadStatus,
    uploadStatusLabel: uploadStatusLabel(document.uploadStatus),
    uploadProgress: document.uploadProgress,
    uploadedBy: serializeUser(document.uploadedBy),
    uploadedByName: document.uploadedBy?.name || "",
    uploadedAt: document.uploadedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function uploadStatusLabel(status) {
  return {
    PENDING: "等待上传",
    UPLOADING: "上传中",
    SUCCESS: "上传成功",
    FAILED: "上传失败",
  }[status] || status || "-";
}

export function documentCompleteness(documents = []) {
  return taxDocumentCompleteness({ documents });
}

function successDocument(doc) {
  return doc && !doc.deletedAt && doc.uploadStatus === "SUCCESS";
}

function supplierKey(cost) {
  return cost.supplierId || `vendor:${cost.supplierNameSnapshot || cost.vendorName || cost.id}`;
}

function supplierNameForCost(cost) {
  return cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "未命名供应商";
}

function supplierTypeForCost(cost) {
  return cost.supplierType || cost.supplier?.supplierType || "";
}

function isTaxRefundSupplierCost(cost) {
  return TAX_REFUND_SUPPLIER_TYPES.includes(supplierTypeForCost(cost));
}

function isTaxRefundSupplierDocument(document) {
  const supplierType = document.supplier?.supplierType || document.cost?.supplier?.supplierType || "";
  return TAX_REFUND_SUPPLIER_TYPES.includes(supplierType);
}

function confirmedFactorySupplierMismatch(input = {}) {
  return input.factorySupplierMismatchConfirmed === true || input.factorySupplierMismatchConfirmed === "true";
}

function booleanInput(value, fallback = false) {
  if (value === true || value === "true" || value === "已确认") return true;
  if (value === false || value === "false" || value === "未确认") return false;
  return Boolean(fallback);
}

function inputHasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

function canConfirmLogisticsCost(actor) {
  return ["管理员", "财务"].includes(actor?.role) || (canWrite(actor, "commissions") && canRead(actor, "payments"));
}

export function taxDocumentCompleteness(order = {}) {
  const documents = order.documents || [];
  const costs = (order.costs || []).filter((cost) => !cost.deletedAt && cost.supplierId && isTaxRefundSupplierCost(cost));
  const successDocs = documents.filter(successDocument);
  const hasOrderType = (type) => successDocs.some((doc) => doc.documentType === type && !doc.costId && doc.relatedModule !== "SUPPLIER");
  const exportMissing = TAX_EXPORT_DOCUMENT_TYPES.filter((type) => !hasOrderType(type));
  const supplierEntries = Object.values(costs.reduce((acc, cost) => {
    const key = supplierKey(cost);
    acc[key] ||= {
      key,
      supplierId: cost.supplierId,
      supplierName: supplierNameForCost(cost),
      costIds: [],
      earliestCostCreatedAt: cost.createdAt,
    };
    acc[key].costIds.push(cost.id);
    if (cost.createdAt && (!acc[key].earliestCostCreatedAt || cost.createdAt < acc[key].earliestCostCreatedAt)) {
      acc[key].earliestCostCreatedAt = cost.createdAt;
    }
    return acc;
  }, {}));
  const supplierMissing = [];
  supplierEntries.forEach((entry) => {
    const costCreatedAt = entry.earliestCostCreatedAt ? new Date(entry.earliestCostCreatedAt) : null;
    const daysSinceCostCreated = costCreatedAt ? Math.floor((Date.now() - costCreatedAt.getTime()) / 86400000) : 0;
    SUPPLIER_DOCUMENT_TYPES.forEach((type) => {
      const exists = successDocs.some((doc) => (
        doc.documentType === type
        && doc.relatedModule === "SUPPLIER"
        && (doc.supplierId === entry.supplierId || entry.costIds.includes(doc.costId))
      ));
      if (!exists) supplierMissing.push({
        supplierId: entry.supplierId,
        supplierName: entry.supplierName,
        documentType: type,
        label: `${supplierEntries.length > 1 ? entry.supplierName : ""}${type === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂合同" : "工厂发票"}`,
        reminderDue: daysSinceCostCreated >= 3,
        daysSinceCostCreated,
      });
    });
  });
  const exportCompleted = TAX_EXPORT_DOCUMENT_TYPES.length - exportMissing.length;
  const supplierTotal = supplierEntries.length * SUPPLIER_DOCUMENT_TYPES.length;
  const supplierCompleted = supplierTotal - supplierMissing.length;
  const missingLabels = [
    ...exportMissing.map((type) => ORDER_DOCUMENT_LABELS[type] || type),
    ...supplierMissing.map((item) => item.label),
  ];
  const total = TAX_EXPORT_DOCUMENT_TYPES.length + supplierTotal;
  const completed = exportCompleted + supplierCompleted;
  return {
    complete: missingLabels.length === 0,
    total,
    completed,
    missingTypes: [...exportMissing, ...supplierMissing.map((item) => item.documentType)],
    missingLabels,
    export: { completed: exportCompleted, total: TAX_EXPORT_DOCUMENT_TYPES.length, missingTypes: exportMissing },
    supplier: {
      completed: supplierCompleted,
      total: supplierTotal,
      missing: supplierMissing,
      reminders: supplierMissing.filter((item) => item.reminderDue),
      suppliers: supplierEntries,
    },
    text: missingLabels.length === 0 ? "资料完整" : `缺失：${missingLabels.join("、")}`,
  };
}

function derivedTaxRefundStatus(order, documents = order?.documents || []) {
  const status = order?.taxRefundStatus || "NOT_READY";
  if (["SUBMITTED", "COMPLETED", "PROBLEM"].includes(status)) return status;
  return taxDocumentCompleteness({ ...order, documents }).complete ? "READY" : "NOT_READY";
}

function confirmedPayment(payment) {
  return ["已到账", "部分到账"].includes(payment.status) && !payment.deletedAt;
}

function validCost(cost) {
  return cost.paymentStatus !== "已取消" && !cost.deletedAt;
}

function commissionRateFromOrder(order) {
  return Math.max(0, Number(order.salespersonCommissionRate || 0));
}

function commissionLogisticsCosts(order) {
  return (order.costs || []).filter((cost) => validCost(cost) && COMMISSION_LOGISTICS_COST_TYPES.includes(cost.costType));
}

function logisticsCostsConfirmed(costs) {
  return costs.length > 0 && costs.every((cost) => cost.costConfirmed === true);
}

function derivedCommissionStatus(order, summary) {
  if (order.commissionStatus === "已结算") return "已结算";
  if (summary.arrivedOutstandingCny > 0 || !["已收齐", "多收款"].includes(order.status)) return "不可结算：订单未收齐";
  if (!summary.logisticsCostConfirmed) return "不可结算：物流成本未确认";
  return "可结算";
}

function depositRatioForPaymentTerm(paymentTermType, before) {
  if (!paymentTermType && before) return before.depositRatio == null ? null : Number(before.depositRatio);
  return null;
}

function calcReminderStatus({ outstandingCny, dueDate, reminderDays }) {
  if (outstandingCny <= 0) return { status: "已结清", overdueDays: 0 };
  if (!dueDate) return { status: "未到期", overdueDays: 0 };
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const diff = Math.round((due.getTime() - todayDate.getTime()) / 86400000);
  if (diff < 0) return { status: "已逾期", overdueDays: Math.abs(diff) };
  if (diff <= Number(reminderDays || 0)) return { status: "即将到期", overdueDays: 0 };
  return { status: "未到期", overdueDays: 0 };
}

export function summarizeOrder(order) {
  const estimatedAmount = Number(order.estimatedReceivableAmount ?? order.receivableAmount);
  const estimatedCny = Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny);
  const actualAmount = order.actualShipmentAmount == null ? null : Number(order.actualShipmentAmount);
  const actualCny = order.actualShipmentAmountCny == null ? null : Number(order.actualShipmentAmountCny);
  const finalAmount = Number(order.finalReceivableAmount ?? (actualAmount ?? estimatedAmount));
  const finalCny = Number(order.finalReceivableAmountCny ?? (actualCny ?? estimatedCny));
  const receivableCny = finalCny;
  const receivableAmount = finalAmount;
  const exchangeRate = Number(order.exchangeRate) || 1;
  const confirmedPaymentsCny = (order.payments || [])
    .filter(confirmedPayment)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const arrivedPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const receivedDepositCny = (order.payments || [])
    .filter((payment) => payment.paymentType === "预付款" && payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const pendingPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "待确认" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const totalCostCny = (order.costs || [])
    .filter(validCost)
    .reduce((sum, cost) => sum + Number(cost.amountCny), 0);
  const logisticsCosts = commissionLogisticsCosts(order);
  const logisticsCostCny = logisticsCosts.reduce((sum, cost) => sum + Number(cost.amountCny), 0);
  const arrivedBalanceCny = receivableCny - arrivedPaymentsCny;
  const arrivedOutstandingCny = Math.max(arrivedBalanceCny, 0);
  const balanceCny = receivableCny - confirmedPaymentsCny;
  const outstandingCny = Math.max(balanceCny, 0);
  const overpaidCny = Math.max(-balanceCny, 0);
  const balanceAmount = receivableAmount - (confirmedPaymentsCny / exchangeRate);
  const outstandingAmount = Math.max(balanceAmount, 0);
  const overpaidAmount = Math.max(-balanceAmount, 0);
  const depositRatio = order.depositRatio == null ? null : Number(order.depositRatio);
  const requiredDepositAmount = depositRatio == null ? 0 : Math.round(receivableCny * depositRatio * 100) / 100;
  const depositGapCny = Math.max(requiredDepositAmount - receivedDepositCny, 0);
  const depositOverpaidCny = Math.max(receivedDepositCny - requiredDepositAmount, 0);
  const expectedGrossProfit = receivableCny - totalCostCny;
  const actualGrossProfit = confirmedPaymentsCny - totalCostCny;
  const grossMargin = receivableCny > 0 ? expectedGrossProfit / receivableCny : 0;
  const commissionRate = commissionRateFromOrder(order);
  const logisticsCostConfirmed = logisticsCostsConfirmed(logisticsCosts);
  const estimatedCommissionBaseCny = Math.max(arrivedPaymentsCny - logisticsCostCny, 0);
  const estimatedCommissionCny = Math.round(estimatedCommissionBaseCny * commissionRate) / 100;
  const settleableCommissionBaseCny = Math.max(arrivedPaymentsCny - logisticsCostCny, 0);
  const settleableCommissionCny = Math.round(settleableCommissionBaseCny * commissionRate) / 100;
  const reminder = calcReminderStatus({
    outstandingCny,
    dueDate: order.dueDate,
    reminderDays: order.reminderDays,
  });

  const summary = {
    receivableCny,
    receivableAmount,
    estimatedReceivableAmount: estimatedAmount,
    estimatedReceivableAmountCny: estimatedCny,
    actualShipmentAmount: actualAmount,
    actualShipmentAmountCny: actualCny,
    finalReceivableAmount: finalAmount,
    finalReceivableAmountCny: finalCny,
    confirmedPaymentsCny,
    arrivedPaymentsCny,
    prepaidAmountCny: receivedDepositCny,
    receivedDepositCny,
    requiredDepositAmount,
    requiredDepositAmountCny: requiredDepositAmount,
    depositGapCny,
    depositOverpaidCny,
    depositRatio,
    pendingPaymentsCny,
    arrivedBalanceCny,
    arrivedOutstandingCny,
    balanceCny,
    balanceAmount,
    outstandingCny,
    outstandingAmount,
    overpaidCny,
    overpaidAmount,
    isOverpaid: overpaidCny > 0,
    isUnderpaid: outstandingCny > 0,
    totalCostCny,
    logisticsCostCny,
    confirmedLogisticsCostCny: logisticsCostConfirmed ? logisticsCostCny : 0,
    logisticsCostConfirmed,
    commissionRate,
    commissionBaseCny: estimatedCommissionBaseCny,
    estimatedCommissionBaseCny,
    estimatedCommissionCny,
    settleableCommissionBaseCny,
    settleableCommissionCny,
    expectedGrossProfit,
    actualGrossProfit,
    grossMargin,
    reminderStatus: reminder.status,
    overdueDays: reminder.overdueDays,
  };
  summary.commissionStatus = derivedCommissionStatus(order, summary);
  summary.commissionCanSettle = summary.commissionStatus === "可结算";
  summary.commissionAmountCny = summary.commissionStatus === "已结算" || summary.commissionCanSettle
    ? settleableCommissionCny
    : estimatedCommissionCny;
  return summary;
}

export function serializeOrder(order) {
  const summary = summarizeOrder(order);
  const paymentInstallments = Array.isArray(order.paymentInstallments) ? order.paymentInstallments : [];
  const paymentTermDisplay = paymentTermLabel(order.paymentTermType, order.paymentTerm);
  const documents = (order.documents || []).map(serializeOrderDocument);
  const costs = (order.costs || []).map(serializeCost);
  const completeness = taxDocumentCompleteness(order);
  const taxRefundStatus = derivedTaxRefundStatus(order, order.documents || []);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId,
    customerName: order.customerNameSnapshot || order.customer?.name || "",
    customerNameSnapshot: order.customerNameSnapshot || order.customer?.name || "",
    salespersonId: order.salespersonUserId || "",
    salespersonUserId: order.salespersonUserId || "",
    salespersonName: order.salesperson?.name || "",
    salespersonCommissionRate: Number(order.salespersonCommissionRate || 0),
    commissionRate: Number(order.salespersonCommissionRate || 0),
    commissionStatus: summary.commissionStatus,
    commissionStatusRaw: order.commissionStatus || "未结算",
    commissionSettledById: order.commissionSettledById || "",
    commissionSettledByName: order.commissionSettledBy?.name || "",
    commissionSettledAt: order.commissionSettledAt || null,
    commissionSettlementRemark: order.commissionSettlementRemark || "",
    country: order.customer?.country || order.country || "",
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate),
    exchangeRateDate: dateToInput(order.exchangeRateDate),
    exchangeRateSource: order.exchangeRateSource || "",
    exchangeRateType: order.exchangeRateType || "",
    estimatedReceivableAmount: Number(order.estimatedReceivableAmount ?? order.receivableAmount),
    estimatedReceivableAmountCny: Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny),
    actualShipmentAmount: order.actualShipmentAmount == null ? "" : Number(order.actualShipmentAmount),
    actualShipmentAmountCny: order.actualShipmentAmountCny == null ? "" : Number(order.actualShipmentAmountCny),
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    receivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    tradeTerm: order.tradeTerm,
    paymentTerm: paymentTermDisplay,
    paymentTermRaw: order.paymentTerm || "",
    paymentTermType: order.paymentTermType || "",
    paymentTermDisplay,
    depositRatio: order.depositRatio == null ? "" : Number(order.depositRatio) * 100,
    expectedPaymentDate: dateToInput(order.expectedPaymentDate),
    expectedArrivalDate: dateToInput(order.expectedArrivalDate),
    expectedShipmentDate: dateToInput(order.expectedShipmentDate),
    blDate: dateToInput(order.blDate),
    paymentInstallments,
    paymentInstallmentText: paymentInstallments.map((item) => (
      `${item.condition || "-"}：${Number(item.ratio || 0)}% / ${Number(item.amount || 0).toFixed(2)}`
    )).join("；"),
    taxRefundStatus,
    taxRefundStatusLabel: TAX_REFUND_STATUS_LABELS[taxRefundStatus] || taxRefundStatus,
    documentCompleteness: completeness,
    documents,
    costs,
    creditDays: order.creditDays ?? "",
    dueDate: dateToInput(order.dueDate),
    reminderDays: order.reminderDays,
    status: order.status,
    remark: order.remark || "",
    createdBy: serializeUser(order.createdBy),
    updatedBy: serializeUser(order.updatedBy),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary,
  };
}

export function includeOrderRelations() {
  return {
    customer: true,
    salesperson: true,
    commissionSettledBy: true,
    createdBy: true,
    updatedBy: true,
    payments: {
      where: { deletedAt: null },
      include: { createdBy: true, updatedBy: true },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    },
    costs: {
      where: { deletedAt: null },
      include: {
        supplier: true,
        createdBy: true,
        updatedBy: true,
        documents: {
          where: { deletedAt: null },
          include: { uploadedBy: true, supplier: true },
          orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
        },
      },
      orderBy: [{ createdAt: "desc" }],
    },
    documents: {
      where: { deletedAt: null },
      include: { uploadedBy: true, cost: { include: { supplier: true } }, supplier: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
  };
}

const SENSITIVE_AUDIT_KEY_PATTERN = /(password|passwordHash|token|secret|accessKey|authorization|cookie|session|storageKey|r2Key|r2Bucket|fileUrl)/i;

function sanitizeAuditData(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return "[TRUNCATED]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditData(item, depth + 1));
  if (typeof value.toJSON === "function" && value.constructor?.name === "Decimal") return value.toJSON();
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_AUDIT_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeAuditData(item, depth + 1),
  ]));
}

export async function writeAudit(request, user, action, entityType, entityId, beforeData, afterData) {
  await prisma.auditLog.create({
    data: {
      userId: user?.id,
      action,
      entityType,
      entityId,
      beforeData: beforeData == null ? undefined : sanitizeAuditData(beforeData),
      afterData: afterData == null ? undefined : sanitizeAuditData(afterData),
      ipAddress: requestIp(request),
    },
  });
}

export function applyCommonFilters(rows, query) {
  const monthValue = (value) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 7);
    return String(value).slice(0, 7);
  };
  const month = query.get("month") || "";
  const keyword = (query.get("keyword") || "").toLowerCase();
  const orderText = (query.get("order") || "").toLowerCase();
  const party = (query.get("party") || "").toLowerCase();
  const country = (query.get("country") || "").toLowerCase();
  const currency = query.get("currency") || "";
  const orderStatus = query.get("orderStatus") || "";
  const paymentStatus = query.get("paymentStatus") || "";
  const reminderStatus = query.get("reminderStatus") || "";
  const costType = query.get("costType") || "";

  return rows.filter((row) => {
    const createdMonth = monthValue(row.createdAt);
    const dateMonth = monthValue(row.paymentDate || row.paymentDateText || row.paymentDate || row.createdAt);
    const nestedSupplierText = (row.costs || []).map((cost) => `${cost.supplierName || ""} ${cost.vendorName || ""}`).join(" ");
    const keywordText = `${row.orderNo || ""} ${row.blNo || ""} ${row.billOfLadingNo || ""} ${row.customerName || ""} ${row.supplierName || ""} ${row.vendorName || ""} ${row.salespersonName || ""} ${row.country || ""} ${nestedSupplierText}`.toLowerCase();
    if (month && createdMonth !== month && dateMonth !== month) return false;
    if (keyword && !keywordText.includes(keyword)) return false;
    if (orderText && !`${row.orderNo || ""} ${row.blNo || ""}`.toLowerCase().includes(orderText)) return false;
    if (party && !`${row.customerName || ""} ${row.supplierName || row.vendorName || ""} ${row.salespersonName || ""}`.toLowerCase().includes(party)) return false;
    if (country && !String(row.country || "").toLowerCase().includes(country)) return false;
    if (currency && row.currency !== currency) return false;
    if (orderStatus && row.summary && row.status !== orderStatus) return false;
    if (paymentStatus && row.paymentStatus !== undefined && row.paymentStatus !== paymentStatus) return false;
    if (paymentStatus && row.paymentStatus === undefined && row.bankReference !== undefined && row.status !== paymentStatus) return false;
    if (reminderStatus && row.summary?.reminderStatus !== reminderStatus && row.reminderStatus !== reminderStatus) return false;
    if (costType && row.costType !== undefined && row.costType !== costType) return false;
    return true;
  });
}

export async function listUsers(actor) {
  assertRead(actor, "users");
  await ensureDefaultUsers();
  const users = await prisma.user.findMany({ orderBy: [{ createdAt: "asc" }] });
  return users.map(serializeUser);
}

export async function saveUser(request, actor, input, id = null) {
  assertWrite(actor, "users");
  const role = ROLES.includes(input.role) ? input.role : "查看者";
  const customPermissions = normalizedCustomPermissionInput(input.customPermissions || input.permissions, role);
  const data = {
    name: requireText(input.name, "姓名"),
    email: requireText(normalizeEmail(input.email), "邮箱"),
    role,
    customPermissions: customPermissions || null,
    isActive: input.isActive !== false,
  };
  if (input.password) {
    data.passwordHash = hashPassword(input.password);
    data.mustChangePassword = true;
  }
  if (!id && !data.passwordHash) {
    const error = new Error("新增用户必须设置初始密码");
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

  const before = id ? await prisma.user.findUnique({ where: { id } }) : null;
  const user = id
    ? await prisma.user.update({ where: { id }, data })
    : await prisma.user.create({ data });
  if (id && data.passwordHash) await revokeUserSessions(id);
  await writeAudit(request, actor, id ? "更新用户" : "新增用户", "users", user.id, before, user);
  return serializeUser(user);
}

function canViewAllCustomers(actor) {
  const permissions = effectivePermissions(actor);
  return CUSTOMER_VIEW_ALL_ROLES.includes(actor?.role) || (canRead(actor, "customers") && permissions.dataScope === "ALL");
}

function customerAccessWhere(actor) {
  if (!actor) return {};
  if (canViewAllCustomers(actor)) return {};
  if (actor.role === "业务员") return { salespersonUserId: actor.id };
  return { id: "__no_customer_access__" };
}

async function assertCustomerScope(actor, customerId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    include: { salesperson: true },
  });
  if (!customer) {
    const error = new Error("请选择有效客户");
    error.status = 400;
    throw error;
  }
  if (!canViewAllCustomers(actor) && customer.salespersonUserId !== actor.id) {
    const error = new Error("无权限使用该客户");
    error.status = 403;
    throw error;
  }
  return customer;
}

async function resolveSalespersonUserId(input, actor, customer, before = null) {
  if (actor.role === "业务员") return actor.id;
  const requestedId = optional(input.salespersonUserId || input.salespersonId);
  if (requestedId) {
    const user = await prisma.user.findFirst({ where: { id: requestedId, isActive: true } });
    if (!user) {
      const error = new Error("请选择有效业务员");
      error.status = 400;
      throw error;
    }
    return user.id;
  }
  return before?.salespersonUserId || customer.salespersonUserId || actor.id;
}

async function resolveCustomerSalespersonUserId(input, actor, before = null) {
  if (actor.role === "业务员") return actor.id;
  if (!canWrite(actor, "customers")) return before?.salespersonUserId || null;
  const requestedId = optional(input.salespersonUserId);
  if (!requestedId) return null;
  const user = await prisma.user.findFirst({ where: { id: requestedId, isActive: true } });
  if (!user) {
    const error = new Error("请选择有效负责业务员");
    error.status = 400;
    throw error;
  }
  return user.id;
}

export async function listCustomers(query, actor = null) {
  assertRead(actor, "customers");
  const keyword = (query.get("keyword") || query.get("party") || "").trim();
  const where = {
    deletedAt: null,
    ...customerAccessWhere(actor),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { country: { contains: keyword, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const customers = await prisma.customer.findMany({
    where,
    include: { salesperson: true },
    orderBy: [{ name: "asc" }],
  });
  return customers.map(serializeCustomer);
}

export async function listAvailableCustomers(query, actor) {
  if (!canWrite(actor, "orders")) return [];
  return listCustomers(query, actor);
}

export async function saveCustomer(request, actor, input, id = null) {
  assertWrite(actor, "customers");
  const name = requireText(input.name, "客户");
  const before = id
    ? await prisma.customer.findFirst({ where: { id, deletedAt: null }, include: { salesperson: true } })
    : null;
  if (id && !before) {
    const error = new Error("客户不存在或已删除");
    error.status = 404;
    throw error;
  }
  if (before && !canViewAllCustomers(actor) && before.salespersonUserId !== actor.id) {
    const error = new Error("无权限维护该客户");
    error.status = 403;
    throw error;
  }
  const salespersonUserId = await resolveCustomerSalespersonUserId(input, actor, before);
  const duplicate = await prisma.customer.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    const error = new Error("客户名称已存在，不能重复创建");
    error.status = 409;
    throw error;
  }
  const defaultCurrency = optional(input.defaultCurrency);
  if (defaultCurrency && !CURRENCIES.includes(defaultCurrency)) {
    const error = new Error("请选择有效默认币种");
    error.status = 400;
    throw error;
  }
  const data = {
    name,
    country: optional(input.country),
    defaultCurrency,
    salespersonUserId,
    commissionRate: Math.max(0, Math.round(num(input.commissionRate, before?.commissionRate || 0) * 100) / 100),
    commissionStatus: CUSTOMER_COMMISSION_STATUSES.includes(input.commissionStatus) ? input.commissionStatus : (before?.commissionStatus || "启用"),
    contactPerson: optional(input.contactPerson),
    contactEmail: optional(input.contactEmail),
    contactPhone: optional(input.contactPhone),
    remark: optional(input.remark),
  };
  const customer = id
    ? await prisma.customer.update({ where: { id }, data, include: { salesperson: true } })
    : await prisma.customer.create({ data, include: { salesperson: true } });
  await writeAudit(request, actor, id ? "更新客户" : "新增客户", "customers", customer.id, before, customer);
  return serializeCustomer(customer);
}

export async function deleteCustomer(request, actor, id) {
  assertWrite(actor, "customers");
  const before = await prisma.customer.findUnique({ where: { id } });
  if (before && !canViewAllCustomers(actor) && before.salespersonUserId !== actor.id) {
    const error = new Error("无权限删除该客户");
    error.status = 403;
    throw error;
  }
  const orderCount = await prisma.receivableOrder.count({ where: { customerId: id, deletedAt: null } });
  if (orderCount > 0) {
    const error = new Error("客户存在关联订单，不能删除，只能保留或修改客户资料");
    error.status = 400;
    throw error;
  }
  const row = await prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit(request, actor, "删除客户", "customers", id, before, row);
}

export async function listSuppliers(query, actor = null, onlyActive = false) {
  assertRead(actor, "suppliers");
  const keyword = nonEmpty(query.get("q") || query.get("keyword") || query.get("party"));
  const where = {
    deletedAt: null,
    ...((onlyActive || actor?.role !== "管理员") ? { status: "启用" } : {}),
    ...(keyword ? {
      OR: [
        { supplierName: { contains: keyword, mode: "insensitive" } },
        { invoiceTitle: { contains: keyword, mode: "insensitive" } },
        { contactPerson: { contains: keyword, mode: "insensitive" } },
        { supplierType: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
  };
  const suppliers = await prisma.supplier.findMany({
    where,
    include: { createdBy: true, updatedBy: true },
    orderBy: [{ supplierName: "asc" }],
    take: onlyActive ? 50 : undefined,
  });
  return suppliers.map(serializeSupplier);
}

export async function listAvailableSuppliers(query, actor) {
  return listSuppliers(query, actor, true);
}

async function assertSupplierActive(supplierId) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    include: { createdBy: true, updatedBy: true },
  });
  if (!supplier) {
    const error = new Error("请选择有效供应商");
    error.status = 400;
    throw error;
  }
  if (supplier.status !== "启用") {
    const error = new Error("供应商已停用，不能用于成本录入");
    error.status = 400;
    throw error;
  }
  return supplier;
}

export async function saveSupplier(request, actor, input, id = null) {
  assertWrite(actor, "suppliers");
  const supplierName = requireText(input.supplierName || input.name, "供应商名称");
  const before = id
    ? await prisma.supplier.findFirst({ where: { id, deletedAt: null }, include: { createdBy: true, updatedBy: true } })
    : null;
  if (id && !before) {
    const error = new Error("供应商不存在或已删除");
    error.status = 404;
    throw error;
  }
  const duplicate = await prisma.supplier.findFirst({
    where: {
      supplierName: { equals: supplierName, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    const error = new Error("供应商名称已存在，不能重复创建");
    error.status = 409;
    throw error;
  }
  const data = {
    supplierName,
    supplierType: SUPPLIER_TYPES.includes(input.supplierType) ? input.supplierType : "其他供应商",
    country: optional(input.country),
    contactPerson: optional(input.contactPerson),
    phone: optional(input.phone),
    email: optional(input.email),
    address: optional(input.address),
    invoiceTitle: optional(input.invoiceTitle),
    taxNumber: optional(input.taxNumber),
    bankName: optional(input.bankName),
    bankAccount: optional(input.bankAccount),
    remark: optional(input.remark),
    status: SUPPLIER_STATUSES.includes(input.status) ? input.status : "启用",
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  const supplier = id
    ? await prisma.supplier.update({ where: { id }, data, include: { createdBy: true, updatedBy: true } })
    : await prisma.supplier.create({ data, include: { createdBy: true, updatedBy: true } });
  await writeAudit(request, actor, id ? "更新供应商" : "新增供应商", "suppliers", supplier.id, before, supplier);
  return serializeSupplier(supplier);
}

export async function deleteSupplier(request, actor, id) {
  assertWrite(actor, "suppliers");
  const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!before) {
    const error = new Error("供应商不存在或已删除");
    error.status = 404;
    throw error;
  }
  const costCount = await prisma.orderCost.count({ where: { supplierId: id, deletedAt: null } });
  if (costCount > 0) {
    const error = new Error("该供应商已有成本记录，不能删除，只能停用。");
    error.status = 400;
    throw error;
  }
  const row = await prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.id } });
  await writeAudit(request, actor, "删除供应商", "suppliers", id, before, row);
}

function validateDuplicateOrder(orderNo, id = null) {
  return prisma.receivableOrder.findFirst({
    where: {
      orderNo,
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
}

function orderAccessWhere(actor) {
  if (!canRead(actor, "orders")) return { id: "__no_order_access__" };
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return {};
  if (scope === "OWN") return { OR: [{ createdById: actor.id }, { salespersonUserId: actor.id }] };
  if (scope === "OWN_COST") {
    return { costs: { some: { createdById: actor.id, deletedAt: null } } };
  }
  return { id: "__no_order_access__" };
}

function scopeOrderForActor(order, actor) {
  if (effectivePermissions(actor).dataScope !== "OWN_COST" || !order) return order;
  return {
    ...order,
    payments: [],
    costs: (order.costs || []).filter((cost) => !cost.deletedAt && cost.createdById === actor.id),
    documents: (order.documents || []).filter((document) => (
      document.relatedModule === "SUPPLIER"
      && (document.cost?.createdById === actor.id || (order.costs || []).some((cost) => cost.id === document.costId && cost.createdById === actor.id))
    )),
  };
}

function canAccessOrder(actor, order) {
  if (!canRead(actor, "orders")) return false;
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return order.createdById === actor.id || order.salespersonUserId === actor.id;
  if (scope === "OWN_COST") {
    return (order.costs || []).some((cost) => !cost.deletedAt && cost.createdById === actor.id);
  }
  return false;
}

function canCreateCostForOrder(actor) {
  return canWrite(actor, "costs");
}

function costAccessWhere(actor) {
  if (!canRead(actor, "costs")) return { id: "__no_cost_access__" };
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return {};
  if (scope === "OWN") {
    return { order: { is: { OR: [{ createdById: actor.id }, { salespersonUserId: actor.id }] } } };
  }
  if (scope === "OWN_COST") return { createdById: actor.id };
  return { id: "__no_cost_access__" };
}

export async function listOrders(query, actor) {
  assertRead(actor, "orders");
  const where = {
    deletedAt: null,
    ...orderAccessWhere(actor),
  };
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
  return applyCommonFilters(orders.map((order) => serializeOrder(scopeOrderForActor(order, actor))), query);
}

export async function getOrder(id, actor) {
  assertRead(actor, "orders");
  const order = await prisma.receivableOrder.findFirst({
    where: {
      id,
      deletedAt: null,
      ...orderAccessWhere(actor),
    },
    include: includeOrderRelations(),
  });
  if (!order) {
    const error = new Error("应收订单不存在或无权查看");
    error.status = 404;
    throw error;
  }
  return serializeOrder(scopeOrderForActor(order, actor));
}

function serializeReceivableSearchOrder(order) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId || "",
    customerName: order.customerNameSnapshot || order.customer?.name || "",
    customerNameSnapshot: order.customerNameSnapshot || order.customer?.name || "",
    salespersonId: order.salespersonUserId || "",
    salespersonUserId: order.salespersonUserId || "",
    salespersonName: order.salesperson?.name || "",
    country: order.customer?.country || order.country || "",
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate),
    exchangeRateDate: dateToInput(order.exchangeRateDate),
    exchangeRateSource: order.exchangeRateSource || "",
    exchangeRateType: order.exchangeRateType || "",
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    status: order.status,
    dueDate: dateToInput(order.dueDate),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary: {
      outstandingCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny ?? 0),
      confirmedPaymentsCny: 0,
    },
  };
}

export async function searchReceivableOrders(query, actor) {
  assertRead(actor, "orders");
  const q = nonEmpty(query.get("q"));
  const filters = [
    orderAccessWhere(actor),
    q ? {
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { blNo: { contains: q, mode: "insensitive" } },
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    } : {},
  ].filter((item) => Object.keys(item).length);
  const where = {
    deletedAt: null,
    ...(filters.length ? { AND: filters } : {}),
  };
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
    take: 20,
  });
  return orders.map((order) => serializeOrder(scopeOrderForActor(order, actor)));
}

export async function saveOrder(request, actor, input, id = null) {
  assertWrite(actor, "orders");
  const before = id
    ? await prisma.receivableOrder.findFirst({ where: { id, deletedAt: null }, include: includeOrderRelations() })
    : null;
  if (id && !before) {
    const error = new Error("应收订单不存在或已删除");
    error.status = 404;
    throw error;
  }
  if (before && !canAccessOrder(actor, before)) {
    const error = new Error("无权限修改该应收订单");
    error.status = 403;
    throw error;
  }
  const customer = await assertCustomerScope(actor, requireText(input.customerId, "客户"));
  const orderNo = requireText(input.orderNo, "订单号");
  const blNo = optional(input.blNo || input.billOfLadingNo);
  const duplicate = await validateDuplicateOrder(orderNo, id);
  if (duplicate) {
    const error = new Error("订单号已存在，不能重复提交");
    error.status = 409;
    throw error;
  }
  if (id) {
    const unfinishedDocuments = await prisma.orderDocument.count({
      where: {
        orderId: id,
        deletedAt: null,
        uploadStatus: { not: "SUCCESS" },
      },
    });
    if (unfinishedDocuments > 0) {
      const error = new Error("存在未完成上传的文件，请处理后再提交。");
      error.status = 400;
      throw error;
    }
  }
  const estimatedReceivableAmount = requirePositive(input.estimatedReceivableAmount ?? input.receivableAmount, "预计应收金额");
  const actualShipmentAmount = input.actualShipmentAmount === "" || input.actualShipmentAmount == null
    ? null
    : requirePositive(input.actualShipmentAmount, "实际发货金额");
  const finalReceivableAmount = input.finalReceivableAmount === "" || input.finalReceivableAmount == null
    ? (actualShipmentAmount ?? estimatedReceivableAmount)
    : requirePositive(input.finalReceivableAmount, "最终应收金额");
  const paymentTermInfo = resolvePaymentTerm(input, before);
  const paymentTermType = paymentTermInfo.type;
  const paymentTerm = paymentTermInfo.label;
  const depositRatio = depositRatioForPaymentTerm(paymentTermType, before);
  const currency = optional(input.currency)?.toUpperCase();
  if (!currency) {
    const error = new Error("请选择币种");
    error.status = 400;
    throw error;
  }
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const exchange = await resolveExchangeRateSnapshot(input, actor, {
    currency,
    defaultDate: todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const salespersonUserId = await resolveSalespersonUserId(input, actor, customer, before);
  const salespersonCommissionRate = before
    ? Number(before.salespersonCommissionRate || 0)
    : (customer.commissionStatus === "停用" ? 0 : Math.max(0, Number(customer.commissionRate || 0)));
  const createdAt = before?.createdAt || new Date();
  const baseCreatedDate = dateFromInput(createdAt.toISOString().slice(0, 10));
  const expectedArrivalDate = paymentTermType === "AFTER_ARRIVAL"
    ? dateFromInput(input.expectedArrivalDate || input.expectedPaymentDate)
    : (!paymentTermType && before ? before.expectedArrivalDate : null);
  const expectedShipmentDate = paymentTermType === "COPY_BL"
    ? dateFromInput(input.expectedShipmentDate || input.expectedPaymentDate)
    : (!paymentTermType && before ? before.expectedShipmentDate : null);
  const blDate = paymentTermType === "COPY_BL"
    ? dateFromInput(input.blDate)
    : (!paymentTermType && before ? before.blDate : null);
  const creditDays = ["OA", "AFTER_ARRIVAL"].includes(paymentTermType)
    ? normalizeCreditDays(input.creditDays, true)
    : (!paymentTermType && before ? before.creditDays : null);
  if (paymentTermType === "AFTER_ARRIVAL" && !expectedArrivalDate) {
    const error = new Error("到港后付款请填写预计到港日期");
    error.status = 400;
    throw error;
  }
  const dueDate = paymentTermType === "OA"
    ? addDays(baseCreatedDate, creditDays)
    : paymentTermType === "AFTER_ARRIVAL"
      ? addDays(expectedArrivalDate, creditDays)
      : paymentTermType === "COPY_BL"
        ? (blDate || expectedShipmentDate || dateFromInput(input.dueDate))
        : paymentTermType === "INSTALLMENT"
          ? dateFromInput(input.dueDate)
          : (dateFromInput(input.dueDate) || before?.dueDate || null);
  const expectedPaymentDate = paymentTermType === "AFTER_ARRIVAL"
    ? expectedArrivalDate
    : paymentTermType === "COPY_BL"
      ? expectedShipmentDate
      : (!paymentTermType && before ? before.expectedPaymentDate : null);
  const paymentInstallments = paymentTermType === "INSTALLMENT"
    ? normalizeInstallments(input.paymentInstallments, finalReceivableAmount, exchangeRate)
    : (!paymentTermType && before ? before.paymentInstallments : null);
  if (dueDate && createdAt && dueDate < new Date(createdAt.toISOString().slice(0, 10))) {
    const error = new Error("到期日不能早于订单创建日期");
    error.status = 400;
    throw error;
  }
  const data = {
    orderNo,
    blNo,
    customerId: customer.id,
    customerNameSnapshot: before && before.customerId === customer.id ? before.customerNameSnapshot : customer.name,
    salespersonUserId,
    salespersonCommissionRate,
    country: optional(customer.country),
    currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    estimatedReceivableAmount,
    estimatedReceivableAmountCny: amountCny(estimatedReceivableAmount, exchangeRate),
    actualShipmentAmount,
    actualShipmentAmountCny: actualShipmentAmount == null ? null : amountCny(actualShipmentAmount, exchangeRate),
    finalReceivableAmount,
    finalReceivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    receivableAmount: finalReceivableAmount,
    receivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    tradeTerm: TRADE_TERMS.includes(input.tradeTerm) ? input.tradeTerm : "FOB",
    paymentTerm,
    paymentTermType,
    depositRatio,
    expectedPaymentDate,
    expectedArrivalDate,
    expectedShipmentDate,
    blDate,
    paymentInstallments,
    creditDays,
    dueDate,
    reminderDays: Math.max(0, Math.round(num(input.reminderDays, 7))),
    status: ORDER_STATUSES.includes(input.status) ? input.status : "已确认",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  if (before && before.status === "已关闭" && actor.role !== "管理员") {
    const error = new Error("已关闭订单不能修改");
    error.status = 400;
    throw error;
  }
  const order = id
    ? await prisma.receivableOrder.update({ where: { id }, data, include: includeOrderRelations() })
    : await prisma.receivableOrder.create({ data, include: includeOrderRelations() });
  await writeAudit(request, actor, id ? "更新应收订单" : "新增应收订单", "receivable_orders", order.id, before, order);
  const shouldSyncStatus = data.actualShipmentAmount != null || order.payments?.some(confirmedPayment);
  const synced = shouldSyncStatus ? await syncOrderStatus(order.id) : order;
  return serializeOrder(synced || order);
}

export async function deleteOrder(request, actor, id) {
  assertWrite(actor, "orders");
  const before = await prisma.receivableOrder.findUnique({ where: { id }, include: includeOrderRelations() });
  if (!before || before.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
  if (!canAccessOrder(actor, before)) {
    const error = new Error("无权限删除该应收订单");
    error.status = 403;
    throw error;
  }
  const row = await prisma.receivableOrder.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await writeAudit(request, actor, "删除应收订单", "receivable_orders", id, before, row);
}

async function assertOrderOpen(orderId, actor) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { customer: true, costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } } },
  });
  if (!order) {
    const error = new Error("请选择有效应收订单");
    error.status = 400;
    throw error;
  }
  if (!canAccessOrder(actor, order)) {
    const error = new Error("无权限访问该应收订单");
    error.status = 403;
    throw error;
  }
  if (["已关闭", "已取消"].includes(order.status) && actor.role !== "管理员") {
    const error = new Error("已关闭或已取消订单不能继续新增收款或成本");
    error.status = 400;
    throw error;
  }
  return order;
}

async function assertCostWritableOrder(orderId, actor, before = null) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { customer: true },
  });
  if (!order) {
    const error = new Error("请选择有效应收订单");
    error.status = 400;
    throw error;
  }
  if (["已关闭", "已取消"].includes(order.status) && actor.role !== "管理员") {
    const error = new Error("已关闭或已取消订单不能继续新增收款或成本");
    error.status = 400;
    throw error;
  }
  const scope = effectivePermissions(actor).dataScope;
  if (actor.role === "成本录入员" || scope === "OWN_COST") {
    if (!canWrite(actor, "costs")) throw permissionError("没有权限执行该操作");
    if (before) {
      if (before.createdById !== actor.id) throw permissionError("只能维护自己录入的成本记录");
      if (before.orderId !== order.id) throw permissionError("成本录入员不能转移历史成本到其他订单");
      return order;
    }
    if (scope !== "ALL") throw permissionError("成本录入员只能维护已分配或自己已录入成本的订单");
    return order;
  }
  if (!canAccessOrder(actor, { ...order, costs: [] })) {
    const error = new Error("无权限访问该应收订单");
    error.status = 403;
    throw error;
  }
  return order;
}

async function assertOrderCanReceivePayment(order) {
  if (["已关闭", "已取消"].includes(order.status)) {
    const error = new Error("已关闭或已取消订单不能新增收款");
    error.status = 400;
    throw error;
  }
  const confirmed = await prisma.payment.aggregate({
    where: {
      orderId: order.id,
      deletedAt: null,
      status: { in: ["已到账", "部分到账"] },
    },
    _sum: { amountCny: true },
  });
  const finalReceivableCny = Number(order.finalReceivableAmountCny ?? order.receivableAmountCny);
  const outstandingCny = finalReceivableCny - Number(confirmed._sum.amountCny || 0);
  if (outstandingCny <= 0) {
    const error = new Error("订单已收齐，不能新增收款");
    error.status = 400;
    throw error;
  }
}

export async function syncOrderStatus(orderId) {
  const order = await prisma.receivableOrder.findUnique({
    where: { id: orderId },
    include: includeOrderRelations(),
  });
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return order;
  const summary = summarizeOrder(order);
  let status = order.actualShipmentAmount == null ? "已确认" : "已发货";
  if (summary.overpaidCny > 0) status = "多收款";
  else if (summary.outstandingCny <= 0) status = "已收齐";
  else if (summary.confirmedPaymentsCny > 0) status = "部分收款";
  if (status !== order.status) {
    return prisma.receivableOrder.update({
      where: { id: orderId },
      data: { status },
      include: includeOrderRelations(),
    });
  }
  return order;
}

export async function listPayments(query, actor = null) {
  assertRead(actor, "payments");
  const rows = await prisma.payment.findMany({
    where: {
      deletedAt: null,
      ...(actor?.role === "业务员"
        ? { order: { is: { OR: [{ createdById: actor.id }, { salespersonUserId: actor.id }] } } }
        : {}),
    },
    include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
  });
  return applyCommonFilters(rows.map(serializePayment), query);
}

export async function savePayment(request, actor, input, id = null) {
  assertWrite(actor, "payments");
  const before = id ? await prisma.payment.findFirst({ where: { id, deletedAt: null } }) : null;
  if (id && !before) {
    const error = new Error("收款记录不存在或已删除");
    error.status = 404;
    throw error;
  }
  const order = await assertOrderOpen(requireText(input.orderId, "关联订单"), actor);
  if (!id || before.orderId !== order.id) {
    await assertOrderCanReceivePayment(order);
  }
  const amount = requirePositive(input.amount, "收款金额");
  const paymentDate = dateFromInput(input.paymentDate) || dateFromInput(todayInputInChina());
  const currency = requireText(input.currency || order.currency, "币种");
  const exchange = await resolveExchangeRateSnapshot(input, actor, {
    currency,
    defaultDate: paymentDate,
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const data = {
    orderId: order.id,
    paymentDate,
    currency: exchange.currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchangeRate),
    paymentType: PAYMENT_TYPES.includes(input.paymentType) ? input.paymentType : "尾款",
    status: PAYMENT_STATUSES.includes(input.status) ? input.status : "待确认",
    bankReference: optional(input.bankReference),
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  const payment = id
    ? await prisma.payment.update({ where: { id }, data, include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true } })
    : await prisma.payment.create({ data, include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true } });
  await syncOrderStatus(order.id);
  await writeAudit(request, actor, id ? "更新收款" : "新增收款", "payments", payment.id, before, payment);
  return serializePayment(payment);
}

export async function deletePayment(request, actor, id) {
  assertWrite(actor, "payments");
  const before = await prisma.payment.findUnique({ where: { id }, include: { order: true } });
  if (!before || before.deletedAt) throw permissionError("收款记录不存在或已删除", 404);
  if (!canAccessOrder(actor, before.order)) throw permissionError("无权限删除该收款记录");
  const payment = await prisma.payment.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await syncOrderStatus(payment.orderId);
  await writeAudit(request, actor, "删除收款", "payments", id, before, payment);
}

export async function listCosts(query, actor = null) {
  assertRead(actor, "costs");
  const rows = await prisma.orderCost.findMany({
    where: {
      deletedAt: null,
      ...costAccessWhere(actor),
    },
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
  return applyCommonFilters(rows.map(serializeCost), query);
}

async function buildCostData(order, actor, input, id = null, before = null) {
  const supplier = await assertSupplierActive(requireText(input.supplierId || input.supplier_id, "供应商"));
  const amount = requirePositive(input.amount, "成本金额");
  const currency = requireText(input.currency || "CNY", "币种");
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效成本币种");
    error.status = 400;
    throw error;
  }
  const exchange = await resolveExchangeRateSnapshot(input, actor, {
    currency,
    defaultDate: input.paymentDate || todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const costType = COST_TYPES.includes(input.costType) ? input.costType : "其他费用";
  if (costType === "工厂货款" && supplier.supplierType !== "工厂供应商" && !confirmedFactorySupplierMismatch(input)) {
    const error = new Error("当前成本类型为工厂货款，但供应商类型不是工厂供应商，请确认是否修改供应商资料。");
    error.status = 409;
    throw error;
  }
  const costConfirmed = booleanInput(input.costConfirmed, before?.costConfirmed || false);
  const data = {
    orderId: order.id,
    supplierId: supplier.id,
    supplierNameSnapshot: supplier.supplierName,
    costType,
    vendorName: supplier.supplierName,
    currency: exchange.currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchangeRate),
    paymentStatus: COST_PAYMENT_STATUSES.includes(input.paymentStatus) ? input.paymentStatus : "待支付",
    costConfirmed,
    costConfirmedAt: costConfirmed ? (before?.costConfirmedAt || new Date()) : null,
    paymentDate: dateFromInput(input.paymentDate),
    invoiceStatus: INVOICE_STATUSES.includes(input.invoiceStatus) ? input.invoiceStatus : "未收到",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  return data;
}

function includeCostRelations() {
  return {
    order: { include: { customer: true, salesperson: true } },
    supplier: true,
    createdBy: true,
    updatedBy: true,
    documents: {
      where: { deletedAt: null },
      include: { uploadedBy: true, supplier: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
  };
}

export async function saveCost(request, actor, input, id = null) {
  assertWrite(actor, "costs");
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: true } }) : null;
  if (id && (!before || before.deletedAt)) throw permissionError("成本记录不存在或已删除", 404);
  if (before && actor.role === "成本录入员" && before.createdById !== actor.id) throw permissionError("只能维护自己录入的成本记录");
  if (before && actor.role !== "成本录入员" && !canAccessOrder(actor, before.order)) throw permissionError("无权限修改该成本记录");
  const order = await assertCostWritableOrder(requireText(input.orderId || input.receivableOrderId || input.order_id, "关联订单"), actor, before);
  const data = await buildCostData(order, actor, input, id, before);
  const cost = id
    ? await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() })
    : await prisma.orderCost.create({ data, include: includeCostRelations() });
  await writeAudit(request, actor, id ? "更新成本" : "新增成本", "order_costs", cost.id, before, cost);
  return serializeCost(cost);
}

export async function saveCosts(request, actor, input) {
  assertWrite(actor, "costs");
  const order = await assertCostWritableOrder(requireText(input.orderId || input.receivableOrderId || input.order_id, "关联订单"), actor);
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) {
    const error = new Error("请至少录入一条供应商成本");
    error.status = 400;
    throw error;
  }
  const rows = await Promise.all(items.map((item) => buildCostData(order, actor, {
    ...input,
    ...item,
    costType: item.costType || input.costType,
    paymentStatus: item.paymentStatus || input.paymentStatus,
    paymentDate: item.paymentDate ?? input.paymentDate,
    invoiceStatus: item.invoiceStatus || input.invoiceStatus,
    remark: item.remark ?? input.remark,
  })));
  const costs = await prisma.$transaction(
    rows.map((data) => prisma.orderCost.create({ data, include: includeCostRelations() })),
  );
  await Promise.all(costs.map((cost) => writeAudit(request, actor, "新增成本", "order_costs", cost.id, null, cost)));
  return costs.map(serializeCost);
}

export async function deleteCost(request, actor, id) {
  assertWrite(actor, "costs");
  const before = await prisma.orderCost.findUnique({ where: { id }, include: { order: true } });
  if (!before || before.deletedAt) throw permissionError("成本记录不存在或已删除", 404);
  if (actor.role === "成本录入员" && before.createdById !== actor.id) throw permissionError("只能删除自己录入的成本记录");
  if (actor.role !== "成本录入员" && !canAccessOrder(actor, before.order)) throw permissionError("无权限删除该成本记录");
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await writeAudit(request, actor, "删除成本", "order_costs", id, before, cost);
}

async function buildLogisticsCostData(order, actor, input, id = null, before = null) {
  const supplierName = requireText(input.supplierName || input.vendorName, "供应商名称");
  const amount = requirePositive(input.amount, "物流费用金额");
  const currency = requireText(input.currency || order.currency || "CNY", "币种");
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const exchange = await resolveExchangeRateSnapshot(input, actor, {
    currency,
    defaultDate: todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const costType = LOGISTICS_COST_TYPES.includes(input.costType) ? input.costType : "其他物流费用";
  const previousCostConfirmed = before?.costConfirmed || false;
  const requestedCostConfirmed = booleanInput(input.costConfirmed, previousCostConfirmed);
  if (inputHasOwn(input, "costConfirmed") && requestedCostConfirmed !== previousCostConfirmed && !canConfirmLogisticsCost(actor)) {
    throw permissionError("没有权限确认物流成本，需由管理员或财务确认");
  }
  const costConfirmed = canConfirmLogisticsCost(actor) ? requestedCostConfirmed : previousCostConfirmed;
  return {
    orderId: order.id,
    supplierId: null,
    supplierNameSnapshot: supplierName,
    vendorName: supplierName,
    costType,
    currency: exchange.currency,
    exchangeRate: exchange.exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchange.exchangeRate),
    paymentStatus: input.isPaid === true || input.isPaid === "true"
      ? "已支付"
      : (COST_PAYMENT_STATUSES.includes(input.paymentStatus) ? input.paymentStatus : "待支付"),
    costConfirmed,
    costConfirmedAt: costConfirmed ? (before?.costConfirmedAt || new Date()) : null,
    paymentDate: dateFromInput(input.paymentDate),
    invoiceStatus: INVOICE_STATUSES.includes(input.invoiceStatus) ? input.invoiceStatus : "未收到",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
}

export async function saveLogisticsCost(request, actor, input, id = null) {
  assertWrite(actor, "logistics");
  const order = await assertOrderOpen(requireText(input.orderId || input.order_id, "关联订单"), actor);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: true } }) : null;
  if (id && (!before || before.deletedAt || !LOGISTICS_COST_TYPES.includes(before.costType))) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (before && !canAccessOrder(actor, before.order)) throw permissionError("无权限修改该物流费用");
  const data = await buildLogisticsCostData(order, actor, input, id, before);
  const cost = id
    ? await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() })
    : await prisma.orderCost.create({ data, include: includeCostRelations() });
  await writeAudit(request, actor, id ? "修改物流费用" : "新增物流费用", "order_costs", cost.id, before, cost);
  return serializeCost(cost);
}

export async function deleteLogisticsCost(request, actor, id) {
  assertWrite(actor, "logistics");
  const before = await prisma.orderCost.findUnique({ where: { id }, include: { order: true } });
  if (!before || before.deletedAt || !LOGISTICS_COST_TYPES.includes(before.costType)) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (!canAccessOrder(actor, before.order)) throw permissionError("无权限删除该物流费用");
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await writeAudit(request, actor, "删除物流费用", "order_costs", id, before, cost);
}

function normalizeAttachmentRelatedType(value) {
  const type = String(value || "").trim();
  return {
    orders: "receivable_orders",
    receivableOrder: "receivable_orders",
    receivable_orders: "receivable_orders",
    payments: "payments",
    payment: "payments",
    order_costs: "order_costs",
    costs: "order_costs",
    cost: "order_costs",
  }[type] || type;
}

async function assertAttachmentScope(actor, relatedTypeInput, relatedId, mode = "read") {
  const relatedType = normalizeAttachmentRelatedType(relatedTypeInput);
  if (!relatedId) throw permissionError("关联 ID 不能为空", 400);
  if (relatedType === "receivable_orders") {
    if (mode === "read") assertRead(actor, "orders");
    if (mode === "write") assertWrite(actor, "orders");
    const order = await prisma.receivableOrder.findFirst({
      where: { id: relatedId, deletedAt: null },
      include: { costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } } },
    });
    if (!order) throw permissionError("关联订单不存在", 404);
    if (!canAccessOrder(actor, order)) throw permissionError("无权限访问该订单附件");
    return { relatedType, relatedId };
  }
  if (relatedType === "payments") {
    if (mode === "read") assertRead(actor, "payments");
    if (mode === "write") assertWrite(actor, "payments");
    const payment = await prisma.payment.findFirst({
      where: { id: relatedId, deletedAt: null },
      include: { order: { include: { costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } } } } },
    });
    if (!payment) throw permissionError("关联收款不存在", 404);
    if (!canAccessOrder(actor, payment.order)) throw permissionError("无权限访问该收款附件");
    return { relatedType, relatedId };
  }
  if (relatedType === "order_costs") {
    if (mode === "read") assertRead(actor, "costs");
    if (mode === "write") assertWrite(actor, "costs");
    const cost = await prisma.orderCost.findFirst({
      where: { id: relatedId, deletedAt: null },
      include: { order: true },
    });
    if (!cost) throw permissionError("关联成本不存在", 404);
    if (actor.role === "成本录入员" && cost.createdById !== actor.id) throw permissionError("只能访问自己录入成本的附件");
    if (actor.role !== "成本录入员" && !canAccessOrder(actor, cost.order)) throw permissionError("无权限访问该成本附件");
    return { relatedType, relatedId };
  }
  throw permissionError("不支持的附件关联类型", 400);
}

export async function listAttachments(query, actor) {
  const relatedTypeInput = query.get("relatedType") || "";
  const relatedId = query.get("relatedId") || "";
  const { relatedType } = await assertAttachmentScope(actor, relatedTypeInput, relatedId, "read");
  const rows = await prisma.attachment.findMany({
    where: { deletedAt: null, relatedType, relatedId },
    include: { uploadedBy: true },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows;
}

export async function saveAttachment(request, actor, input) {
  assertWrite(actor, "attachments");
  const fileUrl = requireText(input.fileUrl, "文件地址");
  if (fileUrl.startsWith("/uploads") || fileUrl.includes("/uploads/")) {
    const error = new Error("禁止使用 /uploads 本地存储，请使用 Cloudflare R2 / S3 上传接口。");
    error.status = 400;
    error.code = "LOCAL_UPLOADS_NOT_ALLOWED";
    throw error;
  }
  if (!/^https:\/\//i.test(fileUrl)) {
    const error = new Error("附件地址必须使用 HTTPS");
    error.status = 400;
    throw error;
  }
  const { relatedType, relatedId } = await assertAttachmentScope(actor, input.relatedType, input.relatedId, "write");
  const row = await prisma.attachment.create({
    data: {
      relatedType,
      relatedId,
      fileName: safeFileName(requireText(input.fileName, "文件名")),
      fileUrl,
      fileSize: input.fileSize ? Number(input.fileSize) : null,
      mimeType: optional(input.mimeType),
      uploadedById: actor.id,
    },
  });
  await writeAudit(request, actor, "新增附件", "attachments", row.id, null, row);
  return row;
}

export async function deleteAttachment(request, actor, id) {
  assertWrite(actor, "attachments");
  const before = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw permissionError("附件不存在或已删除", 404);
  await assertAttachmentScope(actor, before.relatedType, before.relatedId, "write");
  const row = await prisma.attachment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await writeAudit(request, actor, "删除附件", "attachments", id, before, row);
  return row;
}

async function assertDocumentOrder(orderId, actor) {
  assertRead(actor, "documents");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      customer: true,
      createdBy: true,
      salesperson: true,
      costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } },
    },
  });
  if (!order) throw permissionError("请选择有效应收订单", 400);
  if (!canAccessOrder(actor, order)) throw permissionError("无权限访问该订单单证");
  return order;
}

export async function listOrderDocuments(query, actor) {
  assertRead(actor, "documents");
  const orderId = query.get("orderId") || "";
  const documentType = query.get("documentType") || "";
  const where = {
    deletedAt: null,
    ...(orderId ? { orderId } : {}),
    ...(ORDER_DOCUMENT_TYPES.includes(documentType) ? { documentType } : {}),
    ...(actor?.role === "业务员"
      ? { order: { is: { OR: [{ createdById: actor.id }, { salespersonUserId: actor.id }] } } }
      : {}),
    ...(actor?.role === "成本录入员"
      ? { cost: { is: { createdById: actor.id } } }
      : {}),
  };
  if (orderId) await assertDocumentOrder(orderId, actor);
  const rows = await prisma.orderDocument.findMany({
    where,
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeOrderDocument);
}

function relatedModuleForDocumentType(documentType) {
  if (SUPPLIER_DOCUMENT_TYPES.includes(documentType)) return "SUPPLIER";
  if (SALES_DOCUMENT_TYPES.includes(documentType)) return "SALES";
  return "EXPORT";
}

function canReadDocument(actor, document) {
  if (!canRead(actor, "documents")) return false;
  if (["管理员", "财务", "查看者"].includes(actor?.role)) return true;
  if (actor?.role === "业务员") return canAccessOrder(actor, document.order);
  if (actor?.role === "成本录入员") return document.relatedModule === "SUPPLIER" && document.cost?.createdById === actor.id;
  return false;
}

function canModifyDocument(actor, document) {
  if (!canWrite(actor, "documents")) return false;
  if (actor?.role === "管理员") return true;
  if (actor?.role === "业务员") return document.relatedModule !== "SUPPLIER" && canAccessOrder(actor, document.order);
  if (actor?.role === "成本录入员") return document.relatedModule === "SUPPLIER" && document.cost?.createdById === actor.id;
  return false;
}

async function resolveDocumentScope({ orderId, documentType, costId, supplierId }, actor) {
  const relatedModule = relatedModuleForDocumentType(documentType);
  const order = await assertDocumentOrder(orderId, actor);
  if (relatedModule === "SUPPLIER") {
    if (!["管理员", "成本录入员"].includes(actor.role)) throw permissionError("无权限上传供应商资料");
    const cost = await prisma.orderCost.findFirst({
      where: {
        id: requireText(costId, "成本记录"),
        orderId: order.id,
        deletedAt: null,
      },
      include: { order: true, supplier: true },
    });
    if (!cost) throw permissionError("请选择有效供应商成本记录", 400);
    if (!cost.supplierId) throw permissionError("该成本记录未关联供应商，不能上传供应商资料", 400);
    if (supplierId && supplierId !== cost.supplierId) throw permissionError("供应商与成本记录不匹配", 400);
    if (actor.role === "成本录入员" && cost.createdById !== actor.id) throw permissionError("只能维护自己录入成本对应的资料");
    return { order, relatedModule, cost, supplierId: cost.supplierId };
  }
  if (!["管理员", "业务员"].includes(actor.role)) throw permissionError("无权限上传出口资料或销售合同");
  return { order, relatedModule, cost: null, supplierId: null };
}

export async function uploadOrderDocument(request, actor, { orderId, documentType, file, costId = "", supplierId = "" }) {
  assertWrite(actor, "documents");
  if (!ORDER_DOCUMENT_TYPES.includes(documentType)) throw permissionError("请选择有效单证类型", 400);
  const { order, relatedModule, cost, supplierId: resolvedSupplierId } = await resolveDocumentScope({ orderId, documentType, costId, supplierId }, actor);
  const originalFileName = safeFileName(file?.name || "document.pdf");
  const mimeType = file?.type || "application/pdf";
  if (!originalFileName.toLowerCase().endsWith(".pdf") || mimeType !== "application/pdf") {
    const error = permissionError("文件类型不允许，只能上传 PDF 文件", 400);
    error.code = "FILE_TYPE_NOT_ALLOWED";
    throw error;
  }
  const fileSize = Number(file.size || 0);
  if (fileSize > MAX_PDF_UPLOAD_BYTES) {
    const error = permissionError("文件超过大小限制，最大支持 20MB PDF。", 413);
    error.code = "FILE_TOO_LARGE";
    throw error;
  }
  const { bucket: r2Bucket } = ensureR2Configured();
  const arrayBuffer = await file.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (body.byteLength > MAX_PDF_UPLOAD_BYTES) {
    const error = permissionError("文件超过大小限制，最大支持 20MB PDF。", 413);
    error.code = "FILE_TOO_LARGE";
    throw error;
  }
  if (body.byteLength < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
    const error = permissionError("文件格式错误，只能上传有效 PDF 文件", 400);
    error.code = "FILE_SIGNATURE_INVALID";
    throw error;
  }
  const pdfTail = body.subarray(Math.max(0, body.byteLength - 2048)).toString("latin1");
  if (!pdfTail.includes("%%EOF")) {
    const error = permissionError("文件格式错误，只能上传完整 PDF 文件", 400);
    error.code = "FILE_SIGNATURE_INVALID";
    throw error;
  }
  const storageKey = buildOrderDocumentKey({
    orderId: order.id,
    documentType,
    fileName: `${Date.now()}-${crypto.randomUUID()}.pdf`,
    relatedModule,
    supplierId: resolvedSupplierId || "",
  });
  await uploadToR2({ key: storageKey, body, contentType: mimeType });
  let document;
  try {
    document = await prisma.orderDocument.create({
      data: {
        orderId: order.id,
        costId: cost?.id || null,
        supplierId: resolvedSupplierId || null,
        relatedModule,
        documentType,
        fileName: originalFileName,
        fileSize: Number(file.size || body.byteLength || 0),
        mimeType,
        r2Bucket,
        storageKey,
        fileUrl: null,
        uploadStatus: "SUCCESS",
        uploadProgress: 100,
        uploadedById: actor.id,
        uploadedAt: new Date(),
      },
      include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    });
  } catch (error) {
    const dbError = new Error(`数据库写入失败：${error?.message || "未知错误"}`);
    dbError.status = 500;
    dbError.code = "DATABASE_WRITE_FAILED";
    throw dbError;
  }
  await writeAudit(request, actor, "上传文件", "order_documents", document.id, null, {
    orderNo: order.orderNo,
    fileName: document.fileName,
    documentType,
  });
  return serializeOrderDocument(document);
}

export async function deleteOrderDocument(request, actor, id) {
  assertWrite(actor, "documents");
  const before = await prisma.orderDocument.findUnique({
    where: { id },
    include: { order: true, cost: true, supplier: true, uploadedBy: true },
  });
  if (!before || before.deletedAt) throw permissionError("单证不存在或已删除", 404);
  if (!canModifyDocument(actor, before)) throw permissionError("无权限删除该订单单证");
  const document = await prisma.orderDocument.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
  });
  await writeAudit(request, actor, "删除文件", "order_documents", id, before, {
    orderNo: before.order?.orderNo,
    fileName: before.fileName,
  });
  return serializeOrderDocument(document);
}

export async function getOrderDocumentDownload(request, actor, id) {
  assertRead(actor, "documents");
  const document = await prisma.orderDocument.findUnique({
    where: { id },
    include: { order: { include: { customer: true } }, cost: true, supplier: true, uploadedBy: true },
  });
  if (!document || document.deletedAt) throw permissionError("单证不存在或已删除", 404);
  if (!canReadDocument(actor, document)) throw permissionError("无权限下载该订单单证");
  if (document.uploadStatus !== "SUCCESS") throw permissionError("文件尚未上传成功，不能下载", 400);
  const url = await signedDownloadUrl(document.storageKey, document.fileName);
  await writeAudit(request, actor, "下载文件", "order_documents", document.id, null, {
    orderNo: document.order?.orderNo,
    fileName: document.fileName,
  });
  return { url, document: serializeOrderDocument(document) };
}

export async function listTaxRefundOrders(query, actor) {
  assertRead(actor, "taxRefund");
  const orders = await listOrders(query, actor);
  return orders.map((order) => ({
    ...order,
    taxRefundStatus: order.taxRefundStatus,
    taxRefundStatusLabel: TAX_REFUND_STATUS_LABELS[order.taxRefundStatus] || order.taxRefundStatus,
  }));
}

export async function updateTaxRefundStatus(request, actor, orderId, status) {
  assertWrite(actor, "taxRefund");
  if (!TAX_REFUND_STATUSES.includes(status)) throw permissionError("请选择有效退税状态", 400);
  const before = await prisma.receivableOrder.findFirst({ where: { id: orderId, deletedAt: null }, include: includeOrderRelations() });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const completeness = taxDocumentCompleteness(before);
  if (["READY", "SUBMITTED", "COMPLETED"].includes(status) && !completeness.complete) {
    throw permissionError(`资料不完整，${completeness.text}`, 400);
  }
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: { taxRefundStatus: status, updatedById: actor.id },
    include: includeOrderRelations(),
  });
  await writeAudit(request, actor, "修改退税状态", "receivable_orders", order.id, before, order);
  return serializeOrder(order);
}

export async function settleCommission(request, actor, orderId, input = {}) {
  assertWrite(actor, "commissions");
  const before = await prisma.receivableOrder.findFirst({ where: { id: orderId, deletedAt: null }, include: includeOrderRelations() });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const summary = summarizeOrder(before);
  if (summary.arrivedOutstandingCny > 0 || !["已收齐", "多收款"].includes(before.status)) {
    throw permissionError("当前订单货款尚未全部到账，不能结算业务员提成。", 400);
  }
  if (!summary.logisticsCostConfirmed) {
    throw permissionError("当前订单物流成本尚未确认完成，不能结算业务员提成。", 400);
  }
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: {
      commissionStatus: "已结算",
      commissionSettledById: actor.id,
      commissionSettledAt: new Date(),
      commissionSettlementRemark: optional(input.remark),
      updatedById: actor.id,
    },
    include: includeOrderRelations(),
  });
  await writeAudit(request, actor, "结算业务员提成", "receivable_orders", order.id, before, order);
  return serializeOrder(order);
}

function taxPackageName(order) {
  return `退税资料_${safeFileName(order.orderNo || "订单")}_${safeFileName(order.blNo || "待发货")}_${safeFileName(order.customerNameSnapshot || order.customer?.name || "客户")}.zip`;
}

function archiveFileName(type, index, total, supplierName = "") {
  const base = ORDER_DOCUMENT_LABELS[type] || type;
  if (supplierName) return `供应商资料/${safeFileName(supplierName)}/${base}${total > 1 ? `_${index + 1}` : ""}.pdf`;
  return `${base}${total > 1 ? `_${index + 1}` : ""}.pdf`;
}

export async function buildTaxRefundPackage(request, actor, orderId, documentType = "") {
  assertRead(actor, "taxRefund");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      customer: true,
      documents: {
        where: { deletedAt: null, uploadStatus: "SUCCESS" },
        include: { uploadedBy: true, cost: { include: { supplier: true } }, supplier: true },
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或已删除", 404);
  const selectedTypes = ORDER_DOCUMENT_TYPES.includes(documentType) ? [documentType] : ORDER_DOCUMENT_TYPES;
  const documents = order.documents
    .filter((document) => (
      selectedTypes.includes(document.documentType)
      && (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType) || isTaxRefundSupplierDocument(document))
    ))
    .sort((a, b) => ORDER_DOCUMENT_TYPES.indexOf(a.documentType) - ORDER_DOCUMENT_TYPES.indexOf(b.documentType) || a.createdAt - b.createdAt);
  if (!documents.length) throw permissionError("没有可下载的 PDF 单证", 404);
  const zip = new JSZip();
  for (const type of selectedTypes) {
    const typeDocs = documents.filter((document) => document.documentType === type);
    if (SUPPLIER_DOCUMENT_TYPES.includes(type)) {
      const groups = Object.values(typeDocs.reduce((acc, document) => {
        const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
        acc[supplierName] ||= [];
        acc[supplierName].push(document);
        return acc;
      }, {}));
      for (const group of groups) {
        for (let index = 0; index < group.length; index += 1) {
          const document = group[index];
          const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
          zip.file(archiveFileName(type, index, group.length, supplierName), await readR2Object(document.storageKey));
        }
      }
    } else {
      const folder = "出口资料";
      for (let index = 0; index < typeDocs.length; index += 1) {
        const document = typeDocs[index];
        zip.file(`${folder}/${archiveFileName(type, index, typeDocs.length)}`, await readR2Object(document.storageKey));
      }
    }
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await writeAudit(request, actor, documentType ? "下载单证分类ZIP" : "下载ZIP", "receivable_orders", order.id, null, {
    orderNo: order.orderNo,
    documentType: documentType || "ALL",
    fileCount: documents.length,
  });
  return {
    buffer,
    fileName: taxPackageName(order),
  };
}

export async function getProfitAnalysis(query, actor) {
  assertRead(actor, "orders");
  return listOrders(query, actor);
}

export async function getReminders(query, actor) {
  const orders = await listOrders(query, actor);
  return orders
    .filter((order) => ["即将到期", "已逾期"].includes(order.summary.reminderStatus))
    .sort((a, b) => {
      if (b.summary.overdueDays !== a.summary.overdueDays) return b.summary.overdueDays - a.summary.overdueDays;
      return String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"));
    });
}

export async function getOverview(query, actor) {
  const [orders, payments, costs] = await Promise.all([
    canRead(actor, "orders") ? listOrders(query, actor) : [],
    canRead(actor, "payments") ? listPayments(query, actor) : [],
    canRead(actor, "costs") ? listCosts(query, actor) : [],
  ]);
  const total = orders.reduce((acc, order) => {
    acc.receivable += order.summary.receivableCny;
    acc.confirmed += order.summary.confirmedPaymentsCny;
    acc.pending += order.summary.pendingPaymentsCny;
    acc.outstanding += order.summary.outstandingCny;
    acc.requiredDepositAmount += order.summary.requiredDepositAmount;
    acc.receivedDeposit += order.summary.receivedDepositCny;
    acc.depositGap += order.summary.depositGapCny;
    acc.cost += order.summary.totalCostCny;
    acc.expectedProfit += order.summary.expectedGrossProfit;
    acc.actualProfit += order.summary.actualGrossProfit;
    if (order.summary.reminderStatus === "已逾期") acc.overdueOrders += 1;
    if (order.summary.reminderStatus === "即将到期") acc.dueSoonOrders += 1;
    return acc;
  }, {
    receivable: 0,
    confirmed: 0,
    pending: 0,
    outstanding: 0,
    requiredDepositAmount: 0,
    receivedDeposit: 0,
    depositGap: 0,
    cost: 0,
    expectedProfit: 0,
    actualProfit: 0,
    overdueOrders: 0,
    dueSoonOrders: 0,
  });
  total.grossMargin = total.receivable > 0 ? total.expectedProfit / total.receivable : 0;

  const groupBy = (items, labelFn, valueFn) => Object.values(items.reduce((acc, item) => {
    const label = labelFn(item) || "未填写";
    acc[label] ||= { label, amount: 0, count: 0 };
    acc[label].amount += valueFn(item);
    acc[label].count += 1;
    return acc;
  }, {})).sort((a, b) => b.amount - a.amount);

  return {
    totals: { ...total, orderCount: orders.length, paymentCount: payments.length, costCount: costs.length },
    orderProfits: orders,
    costStructure: groupBy(costs, (cost) => cost.costType, (cost) => cost.amountCny),
    reminders: await getReminders(query, actor),
    bySalesperson: groupBy(orders, (order) => order.salespersonName, (order) => order.summary.receivableCny),
    byCustomer: groupBy(orders, (order) => order.customerName, (order) => order.summary.receivableCny),
    byMonth: groupBy(orders, (order) => String(order.createdAt).slice(0, 7), (order) => order.summary.receivableCny),
  };
}

export async function getAuditLogs(query) {
  // Caller must be an administrator; keep this guard for direct internal reuse.
  const logs = await prisma.auditLog.findMany({
    include: { user: true },
    orderBy: [{ createdAt: "desc" }],
    take: Math.min(200, Math.max(20, Number(query.get("limit") || 100))),
  });
  return logs.map((log) => ({
    id: log.id,
    user: serializeUser(log.user),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    beforeData: log.beforeData,
    afterData: log.afterData,
    ipAddress: log.ipAddress || "",
    createdAt: log.createdAt,
  }));
}
