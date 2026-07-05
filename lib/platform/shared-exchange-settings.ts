import { prisma } from "../prisma";
import {
  DEFAULT_EXCHANGE_RATE_SETTINGS,
  EXCHANGE_RATE_SETTING_KEY,
  EXCHANGE_RATE_SOURCES,
  EXCHANGE_RATE_TYPES,
  runNonCriticalTask,
} from "./shared-constants";
import { normalizeDateText } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import type { ActorLike, AuditRequestLike, ExchangeRateSettingsInput } from "./shared-exchange-types";

function normalizeSettingsDate(value: unknown, fallback: string) {
  const text = normalizeDateText(value, fallback);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

export function normalizeExchangeRateSettings(value: unknown = {}) {
  const input: ExchangeRateSettingsInput = value && typeof value === "object" ? value as ExchangeRateSettingsInput : {};
  return {
    ...DEFAULT_EXCHANGE_RATE_SETTINGS,
    ...input,
    source: EXCHANGE_RATE_SOURCES.includes(String(input.source || "")) ? String(input.source) : DEFAULT_EXCHANGE_RATE_SETTINGS.source,
    rateType: EXCHANGE_RATE_TYPES.includes(String(input.rateType || "")) ? String(input.rateType) : DEFAULT_EXCHANGE_RATE_SETTINGS.rateType,
    autoUpdate: input.autoUpdate !== false,
    allowManualEdit: input.allowManualEdit !== false,
    allowAdminIncompleteTaxSubmit: input.allowAdminIncompleteTaxSubmit === true,
    allowMultipleOrderLogisticsSuppliers: input.allowMultipleOrderLogisticsSuppliers === true,
    paymentVoucherReminderStartDate: normalizeSettingsDate(
      input.paymentVoucherReminderStartDate,
      DEFAULT_EXCHANGE_RATE_SETTINGS.paymentVoucherReminderStartDate,
    ),
  };
}

export function serializeExchangeRateSetting(setting: unknown) {
  const value = setting && typeof setting === "object" && "value" in setting
    ? (setting as { value?: unknown }).value
    : setting;
  return normalizeExchangeRateSettings(value || {});
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

export async function saveExchangeRateSettings(request: AuditRequestLike, actor: ActorLike, input: ExchangeRateSettingsInput = {}) {
  assertWrite(actor, "settings");
  const value = normalizeExchangeRateSettings({
    source: input.source,
    rateType: input.rateType,
    autoUpdate: input.autoUpdate,
    allowManualEdit: input.allowManualEdit,
    allowAdminIncompleteTaxSubmit: input.allowAdminIncompleteTaxSubmit,
    allowMultipleOrderLogisticsSuppliers: input.allowMultipleOrderLogisticsSuppliers,
    paymentVoucherReminderStartDate: input.paymentVoucherReminderStartDate,
  });
  const before = await prisma.systemSetting.findUnique({ where: { key: EXCHANGE_RATE_SETTING_KEY } });
  const setting = await prisma.systemSetting.upsert({
    where: { key: EXCHANGE_RATE_SETTING_KEY },
    update: { value },
    create: { key: EXCHANGE_RATE_SETTING_KEY, value },
  });
  await runNonCriticalTask("汇率设置操作日志写入", () => writeAudit(request, actor, "更新汇率设置", "system_settings", EXCHANGE_RATE_SETTING_KEY, before, setting));
  return serializeExchangeRateSetting(setting);
}

