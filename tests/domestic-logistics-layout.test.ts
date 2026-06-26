import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleSource = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const css = readFileSync("app/WorkspaceShell.module.css", "utf8");
const sharedBaseUtils = readFileSync("lib/platform/shared-base-utils.ts", "utf8");
const domesticLogisticsOps = readFileSync("lib/platform/domestic-logistics-ops.ts", "utf8");
const sharedConstants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");

test("domestic logistics list keeps compact accepted columns", () => {
  for (const label of ["订单号", "客户简称", "到达地", "运输货物名称", "物流状态", "费用录入状态", "详情"]) {
    assert.match(moduleSource, new RegExp(`<th>${label}</th>`));
  }
  assert.match(moduleSource, /<td colSpan=\{7\}>/);
  assert.match(moduleSource, /DomesticLogisticsExpenseStatusButton/);
  assert.match(moduleSource, /focusBillId=\{expenseFocus\.billId\}/);
});

test("domestic logistics detail keeps per-order fee entry and customs uploads", () => {
  assert.match(moduleSource, /录入费用/);
  assert.match(moduleSource, /CustomsDocumentPanel/);
  assert.match(moduleSource, /集装箱运输明细/);
  assert.match(moduleSource, /集装箱管理/);
  assert.match(moduleSource, /出口发票备注/);
});

test("domestic logistics list exposes logistics fee entry status from backend", () => {
  assert.match(domesticLogisticsOps, /logisticsBills: \{/);
  assert.match(domesticLogisticsOps, /logisticsExpenses: \{/);
  assert.match(domesticLogisticsOps, /LOGISTICS_EXPENSE_STATUS_PRIORITY/);
  assert.match(domesticLogisticsOps, /domesticLogisticsExpenseStatusSummary/);
  assert.match(domesticLogisticsOps, /domesticLogisticsBillDisplayStatus/);
  assert.match(domesticLogisticsOps, /const bills = \(order\.logisticsBills \|\| \[\]\)/);
  assert.match(domesticLogisticsOps, /logisticsExpenseStatus: expenseStatus\.status/);
  assert.match(domesticLogisticsOps, /logisticsExpenseBillId: expenseStatus\.billId/);
  assert.doesNotMatch(
    domesticLogisticsOps.match(/function domesticLogisticsExpenseDisplayStatus[\s\S]*?\n}/)?.[0] || "",
    /invoiceStatus|paymentStatus/,
  );
});

test("domestic logistics list sorts by unified numeric progress score", () => {
  assert.match(domesticLogisticsOps, /DOMESTIC_LOGISTICS_PROGRESS_WEIGHT/);
  assert.match(domesticLogisticsOps, /const logisticsStatus = domesticLogisticsStatusText\(info\);/);
  assert.match(domesticLogisticsOps, /const feeStatus = domesticLogisticsExpenseStatusSummary\(order\)\.status;/);
  assert.match(domesticLogisticsOps, /Math\.max\(\s*DOMESTIC_LOGISTICS_PROGRESS_WEIGHT\[logisticsStatus\] \?\? 0,\s*DOMESTIC_LOGISTICS_PROGRESS_WEIGHT\[feeStatus\] \?\? 0,\s*\)/);
  assert.match(domesticLogisticsOps, /domesticLogisticsSortRank\(a\) - domesticLogisticsSortRank\(b\)/);
  assert.doesNotMatch(domesticLogisticsOps, /logisticsStatus\.localeCompare|feeStatus\.localeCompare|logisticsExpenseStatus\.localeCompare/);
});

test("domestic logistics transport detail keeps multi-container fields", () => {
  for (const field of ["containerNo", "containerType", "sealNo", "truckPlateNo", "trailerPlateNo", "departurePlace", "arrivalPlace", "cargoName"]) {
    assert.match(moduleSource, new RegExp(field));
  }
  assert.match(moduleSource, /CONTAINER_TYPE_OPTIONS = \["20GP", "40GP", "40HQ", "45HQ"\]/);
  assert.match(moduleSource, /新增集装箱/);
  assert.match(moduleSource, /请选择柜型/);
  assert.match(domesticLogisticsOps, /normalizeDomesticContainerType/);
  assert.match(domesticLogisticsOps, /DOMESTIC_CONTAINER_NO_REQUIRED/);
  assert.match(domesticLogisticsOps, /DOMESTIC_CONTAINER_TYPE_REQUIRED/);
  assert.match(domesticLogisticsOps, /DOMESTIC_CONTAINER_TYPE_INVALID/);
});

test("domestic logistics form controls keep consistent input and select height", () => {
  assert.match(css, /\.transportItemCard input,\n\.transportItemCard select,/);
  assert.match(css, /\.transportItemCard input,\n\.transportItemCard select \{[\s\S]*height: 40px;[\s\S]*min-height: 40px;/);
  assert.match(css, /\.transportItemCard input,\n\.transportItemCard select[\s\S]*border-radius: 8px;[\s\S]*padding: 0 12px;[\s\S]*font-size: 14px;[\s\S]*line-height: 20px;/);
  assert.match(css, /\.transportItemCard select,[\s\S]*\.logisticsItemsRow select \{[\s\S]*appearance: none;/);
  assert.match(css, /\.logisticsTypographyScope \.transportItemCard input,[\s\S]*\.logisticsTypographyScope \.transportItemCard select,[\s\S]*height: 40px;[\s\S]*border-radius: 8px;/);
  assert.match(css, /\.logisticsTypographyScope \.transportItemCard label,[\s\S]*line-height: 20px;/);
});

test("domestic logistics supports bulk warehouse entry mode", () => {
  for (const text of ["BULK_WAREHOUSE", "散货进舱", "散货进舱明细", "进舱编号/唛头", "进舱仓库"]) {
    assert.match(moduleSource, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(sharedConstants, /BULK_WAREHOUSE/);
  assert.match(sharedConstants, /散货进舱/);
  assert.match(domesticLogisticsOps, /进舱日期/);
});

test("domestic logistics no longer exposes ocean auto tracking feature", () => {
  for (const text of ["海运自动跟踪", "每天自动同步一次", "立即同步", "OCEAN_TRACKING_API_URL", "/api/ocean-carriers", "/api/cron/ocean-tracking"]) {
    assert.doesNotMatch(moduleSource, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(vercelConfig, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("shared workspace styles provide full-width expandable detail cards", () => {
  assert.match(css, /\.detailRow td[\s\S]*padding: 0;/);
  assert.match(css, /\.detailCard[\s\S]*border-radius: 12px;/);
  assert.match(css, /\.detailCard[\s\S]*overflow-x: hidden;/);
  assert.match(css, /\.detailGrid[\s\S]*grid-template-columns:/);
});

test("domestic logistics save keeps date and blank-row safeguards", () => {
  assert.match(sharedBaseUtils, /value instanceof Date/);
  assert.match(sharedBaseUtils, /Number\.isNaN\(date\.getTime\(\)\) \? null : date/);
  assert.match(moduleSource, /Object\.values\(item\)\.some\(Boolean\)/);
  assert.match(domesticLogisticsOps, /meaningfulRawItems/);
});
