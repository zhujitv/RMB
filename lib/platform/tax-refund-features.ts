import { prisma } from "../prisma";
import {
  DEFAULT_TAX_REFUND_FEATURE_SETTINGS,
  TAX_REFUND_FEATURES_SETTING_KEY,
  runNonCriticalTask,
} from "./shared-constants";
import { assertRead, assertWrite } from "./shared-access";
import { codedError, isPlainRecord, logServerError } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";

type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type SystemSettingLike = { value?: unknown } | null | undefined;
type FeatureFlagReadContext = {
  path?: string;
  userId?: string;
  role?: string;
};

export type TaxRefundFeatureSettings = typeof DEFAULT_TAX_REFUND_FEATURE_SETTINGS;

export function normalizeTaxRefundFeatureSettings(value: unknown = {}): TaxRefundFeatureSettings {
  const input = isPlainRecord(value) ? value : {};
  const enabled = input.enabled !== false;
  return {
    enabled,
    companyHsLibraryEnabled: enabled && input.companyHsLibraryEnabled !== false,
    calculationEnabled: false,
    addCompanyHsFromOcrEnabled: false,
  };
}

export function serializeTaxRefundFeatureSetting(setting: SystemSettingLike) {
  return normalizeTaxRefundFeatureSettings(setting?.value || setting || DEFAULT_TAX_REFUND_FEATURE_SETTINGS);
}

export async function getTaxRefundFeatureSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: TAX_REFUND_FEATURES_SETTING_KEY } });
  return setting ? serializeTaxRefundFeatureSetting(setting) : normalizeTaxRefundFeatureSettings(DEFAULT_TAX_REFUND_FEATURE_SETTINGS);
}

export async function readTaxRefundFeatureSettings(actor: ActorLike) {
  assertRead(actor, "settings");
  return getTaxRefundFeatureSettings();
}

export async function readTaxRefundFeatureFlags() {
  return getTaxRefundFeatureSettings();
}

export async function readSafeTaxRefundFeatureFlags(context: FeatureFlagReadContext = {}) {
  try {
    return await getTaxRefundFeatureSettings();
  } catch (error) {
    logServerError("tax refund feature flags fallback to defaults", error, context);
    return normalizeTaxRefundFeatureSettings(DEFAULT_TAX_REFUND_FEATURE_SETTINGS);
  }
}

export async function saveTaxRefundFeatureSettings(request: AuditRequestLike, actor: ActorLike, input: unknown = {}) {
  assertWrite(actor, "settings");
  const value = normalizeTaxRefundFeatureSettings(input);
  const before = await prisma.systemSetting.findUnique({ where: { key: TAX_REFUND_FEATURES_SETTING_KEY } });
  const setting = await prisma.systemSetting.upsert({
    where: { key: TAX_REFUND_FEATURES_SETTING_KEY },
    update: { value },
    create: { key: TAX_REFUND_FEATURES_SETTING_KEY, value },
  });
  await runNonCriticalTask("企业HS编码设置日志写入", () => writeAudit(
    request,
    actor,
    "更新企业HS编码设置",
    "system_settings",
    TAX_REFUND_FEATURES_SETTING_KEY,
    before,
    setting,
  ));
  return serializeTaxRefundFeatureSetting(setting);
}

export async function assertTaxRefundFeatureEnabled(feature: keyof TaxRefundFeatureSettings, message: string) {
  const settings = await getTaxRefundFeatureSettings();
  if (settings.enabled && settings[feature]) return settings;
  throw codedError(message, 403, "TAX_REFUND_FEATURE_DISABLED");
}

export async function isTaxRefundCalculationFeatureEnabled() {
  return false;
}
