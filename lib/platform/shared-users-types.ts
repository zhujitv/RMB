import { nonEmpty } from "./shared-base-utils";
import { type AccessUser } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { supplierTypeDisplayName, userRoleDisplayName } from "./shared-constants";
import { normalizedCustomPermissionInput } from "./shared-permission-data";

export type UserInput = Record<string, unknown>;
export type UserListQuery = { get(name: string): string | null } | null;
export type UserListOptions = { paginated?: boolean };
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ActorLike = AccessUser;
export type AvatarUserLike = {
  avatarInitials?: string | null;
  name?: string | null;
};
export type UserRowLike = Record<string, unknown> & {
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

export function asUserRow(value: unknown): UserRowLike {
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
