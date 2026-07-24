import { canWrite } from "./shared-access";
import { DEFAULT_COMPANY_PROFILE_SETTINGS, nonEmpty } from "./shared";
import type { TodoUser } from "./workbench-todos-types";

export function uniqueIds(values: Array<string | null | undefined>) {
  return values.map((value) => nonEmpty(value)).filter((value, index, arr) => value && arr.indexOf(value) === index);
}

export function configuredOwnerIdsFromValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return uniqueIds(value.map((item) => nonEmpty(item)));
  if (typeof value === "string") return uniqueIds(value.split(/[,，\s]+/).map((item) => nonEmpty(item)));
  if (typeof value !== "object") return [];
  const input = value as Record<string, unknown>;
  return uniqueIds([
    ...configuredOwnerIdsFromValue(input.defaultFinanceUserId),
    ...configuredOwnerIdsFromValue(input.defaultFinanceUserIds),
    ...configuredOwnerIdsFromValue(input.financeUserId),
    ...configuredOwnerIdsFromValue(input.financeUserIds),
    ...configuredOwnerIdsFromValue(input.taxRefundArchiveFinanceUserId),
    ...configuredOwnerIdsFromValue(input.taxRefundArchiveFinanceUserIds),
    ...configuredOwnerIdsFromValue(input.ownerUserId),
    ...configuredOwnerIdsFromValue(input.ownerUserIds),
    ...configuredOwnerIdsFromValue(input.userId),
    ...configuredOwnerIdsFromValue(input.userIds),
    ...configuredOwnerIdsFromValue(input.defaultUserId),
    ...configuredOwnerIdsFromValue(input.defaultUserIds),
  ]);
}

export function taxRefundArchiveOwnerIdsFromSetting(value: unknown) {
  return configuredOwnerIdsFromValue(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function ownerCompanyKey(value: unknown) {
  return nonEmpty(value).toLowerCase();
}

export function uniqueCompanyKeys(values: unknown[]) {
  return values.map(ownerCompanyKey).filter((value, index, arr) => value && arr.indexOf(value) === index);
}

export function companyKeysFromRecord(input: Record<string, unknown>) {
  return uniqueCompanyKeys([
    input.companyId, input.company_id, input.companyCode, input.companyKey, input.companyName,
    input.companyNameZh, input.companyNameEn, input.shortName, input.name, input.ownerCompanyId,
    input.ownerCompanyName, input.businessCompanyId, input.businessCompanyName,
  ]);
}

export function companyOwnerEntriesFromMapping(value: unknown): Array<{ companyKeys: string[]; ownerIds: string[] }> {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => companyOwnerEntriesFromMapping(item));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([companyKey, ownerConfig]) => {
    const ownerIds = configuredOwnerIdsFromValue(ownerConfig);
    const extraCompanyKeys = isRecord(ownerConfig) ? companyKeysFromRecord(ownerConfig) : [];
    const companyKeys = uniqueCompanyKeys([companyKey, ...extraCompanyKeys]);
    return ownerIds.length && companyKeys.length ? [{ companyKeys, ownerIds }] : [];
  });
}

export function taxRefundArchiveCompanyOwnerEntriesFromSetting(value: unknown): Array<{ companyKeys: string[]; ownerIds: string[] }> {
  if (!isRecord(value)) return [];
  const directCompanyKeys = companyKeysFromRecord(value);
  const directOwnerIds = configuredOwnerIdsFromValue(value);
  const entries = directCompanyKeys.length && directOwnerIds.length
    ? [{ companyKeys: directCompanyKeys, ownerIds: directOwnerIds }]
    : [];
  for (const mapping of [value.byCompany, value.companies, value.companyOwners, value.companyFinanceOwners,
    value.defaultFinanceByCompany, value.defaultFinanceOwnersByCompany, value.taxRefundArchiveFinanceOwnersByCompany]) {
    entries.push(...companyOwnerEntriesFromMapping(mapping));
  }
  return entries;
}

export function systemCompanyKeysFromProfile(value: unknown) {
  const profile = isRecord(value) ? value : {};
  return uniqueCompanyKeys([
    profile.companyId, profile.companyCode, profile.companyKey, profile.companyName,
    profile.companyNameZh || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh,
    profile.companyNameEn || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameEn,
    profile.shortName || DEFAULT_COMPANY_PROFILE_SETTINGS.shortName,
    profile.brandName || DEFAULT_COMPANY_PROFILE_SETTINGS.brandName,
  ]);
}

export function taxRefundArchiveOwnerUsersFromIds(users: TodoUser[], ownerIds: string[]) {
  const result: TodoUser[] = [];
  for (const ownerId of uniqueIds(ownerIds)) {
    const user = users.find((item) => item.id === ownerId && canWrite(item, "taxRefund"));
    if (user && !result.some((item) => item.id === user.id)) result.push(user);
  }
  return result;
}
