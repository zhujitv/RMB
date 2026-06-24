import { prisma } from "../prisma";
import {
  COMMISSION_FORMULA_DEDUCTIONS,
  COMMISSION_FORMULA_PRESETS,
  COMMISSION_FORMULA_SETTING_KEY,
  COMMISSION_FORMULA_SOURCES,
  DEFAULT_COMMISSION_FORMULA_SETTINGS,
  runNonCriticalTask,
} from "./shared-constants";
import { assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { isPlainRecord } from "./shared-base-utils";

export const COMMISSION_FORMULA_SOURCE_LABELS = {
  ARRIVED_PAYMENTS_CNY: "实际到账货款",
  FOB_CNY: "FOB总额",
  EXPECTED_GROSS_PROFIT_CNY: "预计利润",
  REALIZED_GROSS_PROFIT_CNY: "实际利润",
};

export const COMMISSION_FORMULA_DEDUCTION_LABELS = {
  LOGISTICS_COST_CNY: "物流成本总和",
  TOTAL_COST_CNY: "总成本",
  CONFIRMED_TOTAL_COST_CNY: "已确认总成本",
  PAID_CONFIRMED_COST_CNY: "已支付确认成本",
};

type CommissionFormulaInput = Record<string, unknown>;
type CommissionMetrics = Record<string, unknown>;
type CommissionFormulaSource = keyof typeof COMMISSION_FORMULA_SOURCE_LABELS;
type CommissionFormulaDeduction = keyof typeof COMMISSION_FORMULA_DEDUCTION_LABELS;
type CommissionFormulaMode = keyof typeof COMMISSION_FORMULA_PRESETS;
type SettingsActor = Parameters<typeof assertWrite>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type SystemSettingLike = { value?: unknown } | null | undefined;
const DEFAULT_COMMISSION_FORMULA_SOURCE: CommissionFormulaSource = "ARRIVED_PAYMENTS_CNY";
type NormalizedCommissionFormulaSettings = {
  mode: string;
  label: string;
  source: CommissionFormulaSource;
  deductions: CommissionFormulaDeduction[];
  floorAtZero: boolean;
  sourceLabel: string;
  deductionLabels: string[];
};

function hasOwn<T extends object>(value: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isFormulaMode(value: string): value is CommissionFormulaMode {
  return hasOwn(COMMISSION_FORMULA_PRESETS, value);
}

function isFormulaSource(value: string): value is CommissionFormulaSource {
  return COMMISSION_FORMULA_SOURCES.includes(value);
}

function isFormulaDeduction(value: string): value is CommissionFormulaDeduction {
  return COMMISSION_FORMULA_DEDUCTIONS.includes(value);
}

export function normalizeCommissionFormulaSettings(value: unknown = {}): NormalizedCommissionFormulaSettings {
  const input: CommissionFormulaInput = isPlainRecord(value) ? value : {};
  const mode = String(input.mode || "");
  const preset = isFormulaMode(mode) ? COMMISSION_FORMULA_PRESETS[mode] : DEFAULT_COMMISSION_FORMULA_SETTINGS;
  const inputSource = String(input.source || "");
  const source: CommissionFormulaSource = isFormulaSource(inputSource)
    ? inputSource
    : (isFormulaSource(preset.source) ? preset.source : DEFAULT_COMMISSION_FORMULA_SOURCE);
  const rawDeductions = Array.isArray(input.deductions) ? input.deductions : preset.deductions;
  const deductions = rawDeductions
    .map((item) => String(item || ""))
    .filter((item, index, arr): item is CommissionFormulaDeduction => isFormulaDeduction(item) && arr.indexOf(item) === index);
  return {
    mode: preset.mode === "CUSTOM" ? "CUSTOM" : preset.mode,
    label: String(input.label || preset.label || DEFAULT_COMMISSION_FORMULA_SETTINGS.label),
    source,
    deductions,
    floorAtZero: input.floorAtZero !== false,
    sourceLabel: COMMISSION_FORMULA_SOURCE_LABELS[source] || source,
    deductionLabels: deductions.map((item) => COMMISSION_FORMULA_DEDUCTION_LABELS[item] || item),
  };
}

export function serializeCommissionFormulaSetting(setting: SystemSettingLike) {
  return normalizeCommissionFormulaSettings(setting?.value || setting || {});
}

export async function getCommissionFormulaSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: COMMISSION_FORMULA_SETTING_KEY } });
  if (setting) return serializeCommissionFormulaSetting(setting);
  const created = await prisma.systemSetting.create({
    data: {
      key: COMMISSION_FORMULA_SETTING_KEY,
      value: DEFAULT_COMMISSION_FORMULA_SETTINGS,
    },
  });
  return serializeCommissionFormulaSetting(created);
}

export async function saveCommissionFormulaSettings(request: AuditRequestLike, actor: SettingsActor, input: CommissionFormulaInput = {}) {
  assertWrite(actor, "settings");
  const value = normalizeCommissionFormulaSettings({
    mode: input.mode,
    label: input.label,
    source: input.source,
    deductions: input.deductions,
    floorAtZero: input.floorAtZero,
  });
  const before = await prisma.systemSetting.findUnique({ where: { key: COMMISSION_FORMULA_SETTING_KEY } });
  const setting = await prisma.systemSetting.upsert({
    where: { key: COMMISSION_FORMULA_SETTING_KEY },
    update: { value },
    create: { key: COMMISSION_FORMULA_SETTING_KEY, value },
  });
  await runNonCriticalTask("提成公式设置操作日志写入", () => writeAudit(request, actor, "更新提成公式设置", "system_settings", COMMISSION_FORMULA_SETTING_KEY, before, setting));
  return serializeCommissionFormulaSetting(setting);
}

export function commissionMetricValue(metrics: CommissionMetrics, key: string) {
  if (key === "ARRIVED_PAYMENTS_CNY") return Number(metrics.arrivedPaymentsCny || 0);
  if (key === "FOB_CNY") return Number(metrics.receivableCny || 0);
  if (key === "EXPECTED_GROSS_PROFIT_CNY") return Number(metrics.expectedGrossProfit || 0);
  if (key === "REALIZED_GROSS_PROFIT_CNY") return Number(metrics.realizedGrossProfit || 0);
  if (key === "LOGISTICS_COST_CNY") return Number(metrics.logisticsCostCny || 0);
  if (key === "TOTAL_COST_CNY") return Number(metrics.totalCostCny || 0);
  if (key === "CONFIRMED_TOTAL_COST_CNY") return Number(metrics.confirmedTotalCostCny || 0);
  if (key === "PAID_CONFIRMED_COST_CNY") return Number(metrics.paidConfirmedCostCny || 0);
  return 0;
}

export function calculateCommissionFormulaBase(metrics: CommissionMetrics, settings: unknown) {
  const formula = normalizeCommissionFormulaSettings(settings);
  const sourceAmount = commissionMetricValue(metrics, formula.source);
  const deductionAmount = formula.deductions.reduce((sum, key) => sum + commissionMetricValue(metrics, key), 0);
  const rawBase = sourceAmount - deductionAmount;
  const baseCny = Math.round((formula.floorAtZero ? Math.max(rawBase, 0) : rawBase) * 100) / 100;
  return {
    ...formula,
    sourceAmount,
    deductionAmount,
    rawBase,
    baseCny,
    description: `${formula.sourceLabel}${formula.deductionLabels.length ? ` - ${formula.deductionLabels.join(" - ")}` : ""}`,
  };
}
