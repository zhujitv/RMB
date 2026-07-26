import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { normalizeEmail, codedError } from "./shared-base-utils";
import {
  BCRYPT_COST,
  INITIAL_ADMIN_EMAIL,
  INITIAL_ADMIN_PASSWORD,
  PASSWORD_MIN_LENGTH,
  PASSWORD_SCRYPT_PARAMS,
  SCRYPT_HASH_PREFIX,
  SESSION_TOKEN_BYTES,
  UNSAFE_INITIAL_ADMIN_EMAILS,
  UNSAFE_INITIAL_ADMIN_PASSWORDS,
} from "./shared-constants";
import { passwordMeetsPolicy } from "../password-policy";

export function sha256Hex(value: unknown) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function randomToken(bytes = SESSION_TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sessionTokenHash(token: unknown) {
  return sha256Hex(token);
}

export function timingSafeEqualText(left: unknown, right: unknown) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function legacySha256PasswordHash(password: unknown) {
  return sha256Hex(password);
}

export function isLegacySha256Hash(value: unknown) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

export function isBcryptHash(value: unknown) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

export function scryptPasswordHash(password: unknown) {
  const plain = String(password || "");
  const salt = randomToken(16);
  const { N, r, p, keyLength } = PASSWORD_SCRYPT_PARAMS;
  const derived = crypto.scryptSync(plain, salt, keyLength, { N, r, p }).toString("base64url");
  return `${SCRYPT_HASH_PREFIX}$${N}$${r}$${p}$${salt}$${derived}`;
}

export function bcryptPasswordHash(password: unknown) {
  return bcrypt.hashSync(String(password || ""), BCRYPT_COST);
}

export function hashPassword(password: unknown) {
  const plain = String(password || "");
  if (plain.length < PASSWORD_MIN_LENGTH) {
    throw codedError(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`, 400, "PASSWORD_TOO_SHORT");
  }
  return bcryptPasswordHash(plain);
}

export function upgradePasswordHash(password: unknown) {
  return hashPassword(password);
}

export function passwordHashNeedsUpgrade(passwordHash: unknown) {
  return !isBcryptHash(passwordHash);
}

export async function verifyPassword(password: unknown, passwordHash: unknown) {
  const stored = String(passwordHash || "");
  if (isBcryptHash(stored)) {
    try {
      return await bcrypt.compare(String(password || ""), stored);
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

const LOGIN_DUMMY_PASSWORD_HASH = "$2b$12$M9IbpCX0Tswtpvnec5KSg..qTUM/1B2IeOTogMsj9acJpYKV1PXl6";

export async function verifyLoginPassword(password: unknown, passwordHash: unknown) {
  const stored = String(passwordHash || "");
  const matched = stored ? await verifyPassword(password, stored) : false;
  if (!isBcryptHash(stored)) {
    await verifyPassword(password, LOGIN_DUMMY_PASSWORD_HASH);
  }
  return Boolean(stored) && matched;
}

export function unsafeInitialAdminConfig(email: unknown, password: unknown) {
  const normalizedEmail = normalizeEmail(email);
  return UNSAFE_INITIAL_ADMIN_EMAILS.includes(normalizedEmail)
    || UNSAFE_INITIAL_ADMIN_PASSWORDS.includes(String(password || ""));
}

export function isUnsafeDefaultAdminEmail(email: unknown) {
  return UNSAFE_INITIAL_ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function assertSafeInitialAdminConfig() {
  if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) return false;
  if (unsafeInitialAdminConfig(INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD) || !passwordMeetsPolicy(INITIAL_ADMIN_PASSWORD)) {
    throw codedError("生产环境禁止使用默认管理员账号或默认密码，请重新配置 INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD。", 500, "UNSAFE_INITIAL_ADMIN_CONFIG");
  }
  return true;
}
