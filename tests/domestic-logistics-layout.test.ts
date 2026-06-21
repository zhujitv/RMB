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
  for (const label of ["订单号", "客户简称", "到达地", "运输货物名称", "物流状态", "详情"]) {
    assert.match(moduleSource, new RegExp(`<th>${label}</th>`));
  }
  assert.match(moduleSource, /<td colSpan=\{6\}>/);
});

test("domestic logistics detail keeps per-order fee entry and customs uploads", () => {
  assert.match(moduleSource, /录入费用/);
  assert.match(moduleSource, /CustomsDocumentPanel/);
  assert.match(moduleSource, /集装箱运输明细/);
  assert.match(moduleSource, /出口发票备注/);
});

test("domestic logistics transport detail keeps multi-container fields", () => {
  for (const field of ["containerNo", "truckPlateNo", "trailerPlateNo", "departurePlace", "arrivalPlace", "cargoName"]) {
    assert.match(moduleSource, new RegExp(field));
  }
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
