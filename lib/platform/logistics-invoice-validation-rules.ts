import { prisma } from "../prisma";
import {
  DEFAULT_LOGISTICS_INVOICE_VALIDATION_RULES,
  LOGISTICS_INVOICE_VALIDATION_RULES_SETTING_KEY,
} from "./shared-constants";
import { assertJsonObject, nonEmpty } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

type ActorLike = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type LogisticsInvoiceValidationRule = {
  label: string;
  keywords: string[];
};

export type LogisticsInvoiceValidationRules = Record<string, LogisticsInvoiceValidationRule>;

function uniqueKeywords(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,，;；]+/);
  return raw
    .map((item) => nonEmpty(item))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

export function normalizeLogisticsInvoiceValidationRules(value: unknown = {}): LogisticsInvoiceValidationRules {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_LOGISTICS_INVOICE_VALIDATION_RULES).map(([key, fallback]) => {
    const current = input[key] && typeof input[key] === "object" ? input[key] as Record<string, unknown> : {};
    const keywords = uniqueKeywords(current.keywords);
    return [key, {
      label: nonEmpty(current.label) || fallback.label,
      keywords: keywords.length ? keywords : [...fallback.keywords],
    }];
  }));
}

export async function getLogisticsInvoiceValidationRules() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: LOGISTICS_INVOICE_VALIDATION_RULES_SETTING_KEY },
  });
  return normalizeLogisticsInvoiceValidationRules(setting?.value || DEFAULT_LOGISTICS_INVOICE_VALIDATION_RULES);
}

export async function readLogisticsInvoiceValidationRules(actor: ActorLike) {
  assertRead(actor, "settings");
  return getLogisticsInvoiceValidationRules();
}

export async function saveLogisticsInvoiceValidationRules(
  request: AuditRequestLike,
  actor: ActorLike,
  input: unknown = {},
) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const before = await prisma.systemSetting.findUnique({
    where: { key: LOGISTICS_INVOICE_VALIDATION_RULES_SETTING_KEY },
  });
  const value = normalizeLogisticsInvoiceValidationRules(data.rules || data);
  const setting = await prisma.systemSetting.upsert({
    where: { key: LOGISTICS_INVOICE_VALIDATION_RULES_SETTING_KEY },
    update: { value },
    create: { key: LOGISTICS_INVOICE_VALIDATION_RULES_SETTING_KEY, value },
  });
  await writeAudit(request, actor, "更新物流费用发票校验规则", "system_settings", LOGISTICS_INVOICE_VALIDATION_RULES_SETTING_KEY, before, setting);
  return value;
}
