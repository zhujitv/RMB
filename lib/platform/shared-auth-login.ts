import { prisma } from "../prisma";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../password-policy";
import { formatIpGeolocation, resolveIpGeolocation } from "./ip-geolocation";
import { codedError, normalizeEmail, sanitizeForLog } from "./shared-base-utils";
import { LOGIN_RATE_LIMIT_MAX_FAILURES, LOGIN_RATE_LIMIT_WINDOW_MS, runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { publicUser } from "./shared-users";
import { permissionError } from "./shared-access";
import { hashPassword, sha256Hex, verifyPassword } from "./shared-auth-password";
import { authPassword, boundedUserAgent } from "./shared-auth-input";
import { requestIp, revokeUserSessions, type ActorLike, type RequestLike } from "./shared-auth-request";
import { NOTIFICATION_TEMPLATE_TYPES, sendNotificationEmail } from "./notification-engine";

type LoginAlertUser = {
  id: string;
  name?: string | null;
  email: string;
  loginAlertEnabled?: boolean | null;
};

type LoginAlertAttempt = {
  id?: string | null;
  createdAt?: Date | string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  geoCountry?: string | null;
  geoRegion?: string | null;
  geoCity?: string | null;
  geoIsp?: string | null;
  geoSource?: string | null;
} | null | undefined;

function loginDeviceLabel(userAgent: unknown) {
  const ua = String(userAgent || "");
  const browser = /Edg\//.test(ua) ? "Microsoft Edge"
    : /Chrome\//.test(ua) && !/Chromium\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "其他浏览器";
  const os = /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
    : /Windows NT/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
    : /Linux/i.test(ua) ? "Linux"
    : "未知系统";
  return ua ? `${browser} / ${os}` : "未记录";
}

function loginAtText(value: Date | string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(Number.isNaN(date.getTime()) ? new Date() : date);
}

export async function sendUserLoginAlert(user: LoginAlertUser, attempt: LoginAlertAttempt) {
  if (user.loginAlertEnabled === false || !attempt?.id) return { sent: false, skipped: true };
  const ipAddress = attempt.ipAddress || "未记录";
  const storedGeo = {
    ipAddress,
    country: attempt.geoCountry || "",
    region: attempt.geoRegion || "",
    city: attempt.geoCity || "",
    isp: attempt.geoIsp || "",
    source: attempt.geoSource || "",
  };
  const location = storedGeo.country || storedGeo.region || storedGeo.city
    ? formatIpGeolocation(storedGeo)
    : formatIpGeolocation(resolveIpGeolocation(ipAddress));
  return sendNotificationEmail({
    type: NOTIFICATION_TEMPLATE_TYPES.USER_LOGIN_ALERT,
    recipientEmails: [user.email],
    ignoreTemplateCc: true,
    variables: {
      name: user.name || "您好",
      loginAt: loginAtText(attempt.createdAt),
      location: location || "未识别",
      ipAddress,
      device: loginDeviceLabel(attempt.userAgent),
    },
    idempotencyKey: `user-login-alert-${attempt.id}`,
    relatedEntityType: "users",
    relatedEntityId: user.id,
    context: { purpose: "login_alert" },
  });
}

export function loginAttemptKey(request: RequestLike, email: unknown) {
  return sha256Hex(`${requestIp(request) || "unknown"}:${normalizeEmail(email)}`);
}

export async function assertLoginNotRateLimited(request: RequestLike, email: unknown) {
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
    throw codedError("登录失败次数过多，请 15 分钟后再试。", 429, "LOGIN_RATE_LIMITED");
  }
}

export async function recordLoginAttempt(request: RequestLike, email: unknown, success: unknown, userId: string | null = null, failureReason: string | null = null) {
  const ipAddress = requestIp(request);
  const ipGeo = resolveIpGeolocation(ipAddress);
  const userAgent = boundedUserAgent(request?.headers?.get("user-agent"));
  console.info("login attempt captured", sanitizeForLog({
    ipAddress,
    userAgent,
    success: Boolean(success),
    failureReason: success ? null : failureReason,
    geo: {
      country: ipGeo.country,
      region: ipGeo.region,
      city: ipGeo.city,
      source: ipGeo.source,
    },
  }));
  return prisma.loginAttempt.create({
    data: {
      key: loginAttemptKey(request, email),
      email: normalizeEmail(email) || null,
      ipAddress,
      userAgent,
      failureReason: success ? null : failureReason,
      geoCountry: ipGeo.country || null,
      geoRegion: ipGeo.region || null,
      geoCity: ipGeo.city || null,
      geoIsp: ipGeo.isp || null,
      geoSource: ipGeo.source || null,
      geoResolvedAt: new Date(),
      success: Boolean(success),
      userId,
    },
  });
}

export async function changeOwnPassword(request: RequestLike, actor: ActorLike, input: Record<string, unknown> = {}) {
  if (!actor?.id) throw permissionError("请先登录", 401);
  const currentPassword = authPassword(input.currentPassword, "当前密码");
  const newPassword = authPassword(input.newPassword, "新密码");
  const confirmPassword = authPassword(input.confirmPassword || input.newPasswordConfirm, "确认密码");
  if (!confirmPassword || confirmPassword !== newPassword) {
    throw codedError("两次输入的新密码不一致。", 400, "PASSWORD_CONFIRM_MISMATCH");
  }
  if (!passwordMeetsPolicy(newPassword)) {
    throw codedError(PASSWORD_POLICY_MESSAGE, 400, "PASSWORD_POLICY_WEAK");
  }
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user || !user.isActive) throw permissionError("请先登录", 401);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw codedError("当前密码错误", 403, "CURRENT_PASSWORD_INVALID");
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw codedError("新密码不能与当前密码相同", 400, "PASSWORD_REUSED");
  }
  const before = { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      passwordPolicyPassed: true,
      passwordChangedAt: new Date(),
    },
  });
  await revokeUserSessions(user.id);
  await runNonCriticalTask("密码修改操作日志写入", () => writeAudit(request, actor, "修改本人密码", "users", user.id, before, {
    id: updated.id,
    email: updated.email,
    role: updated.role,
    mustChangePassword: updated.mustChangePassword,
  }));
  return publicUser(updated);
}
