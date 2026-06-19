// @ts-nocheck
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

export function normalizeCommissionFormulaSettings(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  const preset = COMMISSION_FORMULA_PRESETS[input.mode] || DEFAULT_COMMISSION_FORMULA_SETTINGS;
  const source = COMMISSION_FORMULA_SOURCES.includes(input.source) ? input.source : preset.source;
  const rawDeductions = Array.isArray(input.deductions) ? input.deductions : preset.deductions;
  const deductions = rawDeductions
    .filter((item, index, arr) => COMMISSION_FORMULA_DEDUCTIONS.includes(item) && arr.indexOf(item) === index);
  return {
    ...DEFAULT_COMMISSION_FORMULA_SETTINGS,
    ...preset,
    ...input,
    mode: preset.mode === "CUSTOM" ? "CUSTOM" : preset.mode,
    label: String(input.label || preset.label || DEFAULT_COMMISSION_FORMULA_SETTINGS.label),
    source,
    deductions,
    floorAtZero: input.floorAtZero !== false,
    sourceLabel: COMMISSION_FORMULA_SOURCE_LABELS[source] || source,
    deductionLabels: deductions.map((item) => COMMISSION_FORMULA_DEDUCTION_LABELS[item] || item),
  };
}

export function serializeCommissionFormulaSetting(setting) {
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

export async function saveCommissionFormulaSettings(request, actor, input = {}) {
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

export function commissionMetricValue(metrics, key) {
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

export function calculateCommissionFormulaBase(metrics, settings) {
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
