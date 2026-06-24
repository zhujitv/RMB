import { prisma } from "../prisma";
import {
  COMPANY_PROFILE_SETTING_KEY,
  DEFAULT_COMPANY_PROFILE_SETTINGS,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, codedError, isPlainRecord, nonEmpty, normalizeEmail, validEmail } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

const TEXT_LIMITS = {
  brandName: 40,
  systemName: 80,
  companyNameZh: 120,
  companyNameEn: 160,
  shortName: 60,
  website: 200,
  contactEmail: 120,
  contactPhone: 60,
  address: 240,
  logoUrl: 240,
  footerText: 180,
};

type CompanyProfileInput = {
  brandName?: unknown;
  systemName?: unknown;
  companyNameZh?: unknown;
  companyNameEn?: unknown;
  shortName?: unknown;
  website?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  address?: unknown;
  logoUrl?: unknown;
  footerText?: unknown;
};

type ErrorWithStatus = {
  status?: number;
};

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type SystemSettingLike = {
  value?: unknown;
} | null | undefined;

function cleanText(value: unknown, fallback = "", limit = 120) {
  const text = nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .slice(0, limit)
    .trim();
  return text || fallback;
}

function cleanOptionalText(value: unknown, limit = 120) {
  return cleanText(value, "", limit);
}

function optionalHttpUrl(value: unknown, label: string) {
  const text = cleanOptionalText(value, TEXT_LIMITS.website);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw codedError(`${label}只支持 http 或 https`, 400, "VALIDATION_INVALID_URL");
    }
    return url.toString();
  } catch (error) {
    if ((error as ErrorWithStatus | null)?.status) throw error;
    throw codedError(`${label}格式错误`, 400, "VALIDATION_INVALID_URL");
  }
}

function optionalEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!email) return "";
  if (!validEmail(email)) throw codedError("联系邮箱格式错误", 400, "VALIDATION_INVALID_EMAIL");
  return email;
}

export function normalizeCompanyProfileSettings(value: unknown = {}) {
  const input: CompanyProfileInput = isPlainRecord(value) ? value : {};
  return {
    brandName: cleanText(input.brandName, DEFAULT_COMPANY_PROFILE_SETTINGS.brandName, TEXT_LIMITS.brandName),
    systemName: cleanText(input.systemName, DEFAULT_COMPANY_PROFILE_SETTINGS.systemName, TEXT_LIMITS.systemName),
    companyNameZh: cleanText(input.companyNameZh, DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh, TEXT_LIMITS.companyNameZh),
    companyNameEn: cleanOptionalText(input.companyNameEn, TEXT_LIMITS.companyNameEn),
    shortName: cleanText(input.shortName, DEFAULT_COMPANY_PROFILE_SETTINGS.shortName, TEXT_LIMITS.shortName),
    website: optionalHttpUrl(input.website ?? DEFAULT_COMPANY_PROFILE_SETTINGS.website, "官网地址"),
    contactEmail: optionalEmail(input.contactEmail),
    contactPhone: cleanOptionalText(input.contactPhone, TEXT_LIMITS.contactPhone),
    address: cleanOptionalText(input.address, TEXT_LIMITS.address),
    logoUrl: input.logoUrl ? optionalHttpUrl(input.logoUrl, "Logo 地址") : "",
    footerText: cleanOptionalText(input.footerText, TEXT_LIMITS.footerText),
  };
}

export function serializeCompanyProfileSetting(setting: SystemSettingLike) {
  return normalizeCompanyProfileSettings(setting?.value || setting || {});
}

export async function getCompanyProfileSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: COMPANY_PROFILE_SETTING_KEY } });
  if (setting) return serializeCompanyProfileSetting(setting);
  const created = await prisma.systemSetting.create({
    data: {
      key: COMPANY_PROFILE_SETTING_KEY,
      value: DEFAULT_COMPANY_PROFILE_SETTINGS,
    },
  });
  return serializeCompanyProfileSetting(created);
}

export async function readCompanyProfileSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  return getCompanyProfileSettings();
}

export async function saveCompanyProfileSettings(request: AuditRequestLike, actor: SettingsActor, input: unknown = {}) {
  assertWrite(actor, "settings");
  const value = normalizeCompanyProfileSettings(assertJsonObject(input));
  const before = await prisma.systemSetting.findUnique({ where: { key: COMPANY_PROFILE_SETTING_KEY } });
  const setting = await prisma.systemSetting.upsert({
    where: { key: COMPANY_PROFILE_SETTING_KEY },
    update: { value },
    create: { key: COMPANY_PROFILE_SETTING_KEY, value },
  });
  await runNonCriticalTask("公司资料设置操作日志写入", () => (
    writeAudit(request, actor, "更新公司资料", "system_settings", COMPANY_PROFILE_SETTING_KEY, before, setting)
  ));
  return serializeCompanyProfileSetting(setting);
}
