import { nonEmpty } from "./shared-base-utils";

export const SESSION_COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-fta_session" : "fta_session";
export const LEGACY_SESSION_COOKIE_NAME = "fta_user_id";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
export const SESSION_TOKEN_BYTES = 32;
export const PASSWORD_MIN_LENGTH = 8;
export const BCRYPT_COST = Math.min(14, Math.max(10, Number(process.env.BCRYPT_COST || 12)));
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_FAILURES = 8;
export const SCRYPT_HASH_PREFIX = "scrypt";
export const PASSWORD_SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
};

export const INITIAL_ADMIN_EMAIL = nonEmpty(process.env.INITIAL_ADMIN_EMAIL);
export const INITIAL_ADMIN_PASSWORD = nonEmpty(process.env.INITIAL_ADMIN_PASSWORD);
export const UNSAFE_INITIAL_ADMIN_EMAILS = ["admin@example.com"];
export const UNSAFE_INITIAL_ADMIN_PASSWORDS = ["12345678", "admin123456", "password"];
