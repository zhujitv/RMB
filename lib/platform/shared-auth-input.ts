import {
  codedError,
  normalizeEmail,
  requireText,
  requireValidEmail,
} from "./shared-base-utils";

export const AUTH_INPUT_LIMITS = {
  name: 100,
  email: 254,
  password: 128,
  userAgent: 512,
  verificationToken: 256,
} as const;

function assertLength(value: unknown, label: string, maxLength: number) {
  if (value != null && typeof value !== "string") {
    throw codedError(`${label}格式无效。`, 400, "AUTH_INPUT_INVALID");
  }
  const text = value || "";
  if (text.length > maxLength) {
    throw codedError(`${label}长度不能超过 ${maxLength} 个字符。`, 400, "AUTH_INPUT_TOO_LONG");
  }
  return text;
}

export function requireAuthName(value: unknown) {
  return requireText(assertLength(value, "姓名", AUTH_INPUT_LIMITS.name), "姓名");
}

export function requireAuthEmail(value: unknown) {
  return requireValidEmail(assertLength(value, "邮箱", AUTH_INPUT_LIMITS.email), "邮箱");
}

export function authPassword(value: unknown, label = "密码") {
  return assertLength(value, label, AUTH_INPUT_LIMITS.password);
}

export function loginCredentials(input: Record<string, unknown> = {}) {
  const email = normalizeEmail(assertLength(input.email, "邮箱", AUTH_INPUT_LIMITS.email));
  const password = authPassword(input.password);
  return { email, password };
}

export function boundedUserAgent(value: unknown) {
  const text = String(value || "").trim();
  return text ? text.slice(0, AUTH_INPUT_LIMITS.userAgent) : null;
}

export function verificationTokenInput(value: unknown) {
  const token = assertLength(value, "邮箱验证令牌", AUTH_INPUT_LIMITS.verificationToken).trim();
  if (!token) throw codedError("邮箱验证链接无效。", 400, "EMAIL_VERIFICATION_TOKEN_INVALID");
  return token;
}

type ApplicationOriginEnvironment = Record<string, string | undefined>;

export function trustedApplicationOrigin(
  requestUrl = "",
  environment: ApplicationOriginEnvironment = process.env,
) {
  const configuredValues = [environment.APP_URL, environment.APP_BASE_URL, environment.NEXT_PUBLIC_APP_URL];
  for (const value of configuredValues) {
    try {
      const url = new URL(String(value || ""));
      if (environment.NODE_ENV !== "production" || url.protocol === "https:") return url.origin;
    } catch {}
  }
  if (environment.NODE_ENV !== "production") {
    try {
      const url = new URL(requestUrl);
      if (["http:", "https:"].includes(url.protocol)) return url.origin;
    } catch {}
  }
  const error = codedError("应用公开地址未安全配置。", 500, "APP_ORIGIN_NOT_CONFIGURED");
  error.expose = false;
  throw error;
}
