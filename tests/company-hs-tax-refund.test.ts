import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260702152000_company_hs/migration.sql", "utf8");
const service = readFileSync("lib/platform/company-hs.ts", "utf8");
const taxCalculation = readFileSync("lib/platform/export-tax-refund-calculations.ts", "utf8");
const taxRefundFeatures = readFileSync("lib/platform/tax-refund-features.ts", "utf8");
const permissions = readFileSync("lib/platform/shared-permission-data.ts", "utf8");
const menu = readFileSync("app/menu.ts", "utf8");
const authMeRoute = readFileSync("app/api/auth/me/route.ts", "utf8");
const authPermissionsRoute = readFileSync("app/api/auth/permissions/route.ts", "utf8");
const settingsRoute = readFileSync("app/api/settings/tax-refund-features/route.ts", "utf8");
const settingsModule = readFileSync("app/modules/settings/module-view.tsx", "utf8");
const settingsCards = readFileSync("app/modules/settings/settings-cards.tsx", "utf8");
const taxDetail = readFileSync("app/modules/tax-refund/detail-components.tsx", "utf8");

test("company HS master data is modeled as the enterprise rebate-rate source", () => {
  assert.match(schema, /model CompanyHs \{/);
  assert.match(schema, /hsCode\s+String\s+@unique\s+@map\("hs_code"\)/);
  assert.match(schema, /cnName\s+String\s+@map\("cn_name"\)/);
  assert.match(schema, /rebateRate\s+Decimal\s+@map\("rebate_rate"\)\s+@db\.Decimal\(8, 4\)/);
  assert.match(schema, /deletedAt\s+DateTime\?\s+@map\("deleted_at"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "company_hs"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "company_hs_hs_code_key"/);
});

test("company HS maintenance is admin writable and fuzzy searchable", () => {
  assert.match(permissions, /companyHs: \["管理员"\]/);
  assert.match(permissions, /companyHs: \["管理员", "财务"\]/);
  assert.match(menu, /key: "companyHs"[\s\S]*label: "企业HS编码"/);
  assert.match(service, /HS编码必须是10位数字/);
  assert.match(service, /必须为0-13之间的数字/);
  assert.match(service, /hsCode: \{ contains: keyword/);
  assert.match(service, /cnName: \{ contains: keyword/);
  assert.match(service, /enName: \{ contains: keyword/);
  assert.match(service, /keywords: \{ contains: keyword/);
  assert.match(service, /data: \{ isEnabled: false, deletedAt: new Date\(\) \}/);
});

test("tax refund calculation uses company HS and exposes OCR add-to-library flow", () => {
  assert.match(taxCalculation, /prisma\.companyHs\.findFirst/);
  assert.doesNotMatch(taxCalculation, /exportTaxRebateRate\.findFirst/);
  assert.match(taxCalculation, /"HS编码未维护"/);
  assert.match(taxCalculation, /"供应商发票匹配"/);
  assert.match(taxCalculation, /"重新计算利润"/);
  assert.match(taxDetail, /新增到企业HS库/);
  assert.match(taxDetail, /onCreateCompanyHs/);
});

test("enterprise HS tax refund feature is controlled by modular settings", () => {
  assert.match(taxRefundFeatures, /TAX_REFUND_FEATURES_SETTING_KEY/);
  assert.match(taxRefundFeatures, /DEFAULT_TAX_REFUND_FEATURE_SETTINGS/);
  assert.match(taxRefundFeatures, /assertTaxRefundFeatureEnabled/);
  assert.match(taxRefundFeatures, /readSafeTaxRefundFeatureFlags/);
  assert.match(taxRefundFeatures, /fallback to defaults/);
  assert.match(service, /assertTaxRefundFeatureEnabled\("companyHsLibraryEnabled"/);
  assert.match(service, /assertTaxRefundFeatureEnabled\("addCompanyHsFromOcrEnabled"/);
  assert.match(taxCalculation, /getTaxRefundFeatureSettings/);
  assert.match(taxCalculation, /TAX_REFUND_FEATURE_DISABLED/);
  assert.match(menu, /features\?: \{ taxRefund\?:/);
  assert.match(menu, /item\.key !== "companyHs" \|\| taxRefundFeaturesEnabled/);
  assert.match(authMeRoute, /readSafeTaxRefundFeatureFlags/);
  assert.match(authPermissionsRoute, /readSafeTaxRefundFeatureFlags/);
  assert.match(settingsRoute, /readTaxRefundFeatureSettings\(actor\)/);
  assert.match(settingsRoute, /saveTaxRefundFeatureSettings\(request, actor, body\)/);
  assert.match(settingsModule, /taxRefundFeatures/);
  assert.match(settingsCards, /TaxRefundFeatureSettingsCard/);
  assert.match(settingsCards, /启用退税计算功能/);
});
