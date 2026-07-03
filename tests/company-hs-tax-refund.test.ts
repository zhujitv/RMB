import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260702152000_company_hs/migration.sql", "utf8");
const service = readFileSync("lib/platform/company-hs.ts", "utf8");
const taxRefundFeatures = readFileSync("lib/platform/tax-refund-features.ts", "utf8");
const permissions = readFileSync("lib/platform/shared-permission-data.ts", "utf8");
const menu = readFileSync("app/menu.ts", "utf8");
const authMeRoute = readFileSync("app/api/auth/me/route.ts", "utf8");
const authPermissionsRoute = readFileSync("app/api/auth/permissions/route.ts", "utf8");
const settingsRoute = readFileSync("app/api/settings/tax-refund-features/route.ts", "utf8");
const settingsModule = readFileSync("app/modules/settings/module-view.tsx", "utf8");
const settingsCards = readFileSync("app/modules/settings/settings-cards.tsx", "utf8");

test("company HS master data is modeled as enterprise HS reference data", () => {
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

test("enterprise HS feature is controlled by modular settings", () => {
  assert.match(taxRefundFeatures, /TAX_REFUND_FEATURES_SETTING_KEY/);
  assert.match(taxRefundFeatures, /DEFAULT_TAX_REFUND_FEATURE_SETTINGS/);
  assert.match(taxRefundFeatures, /assertTaxRefundFeatureEnabled/);
  assert.match(taxRefundFeatures, /readSafeTaxRefundFeatureFlags/);
  assert.match(taxRefundFeatures, /fallback to defaults/);
  assert.match(service, /assertTaxRefundFeatureEnabled\("companyHsLibraryEnabled"/);
  assert.match(service, /TAX_REFUND_OCR_CALC_DISABLED/);
  assert.doesNotMatch(taxRefundFeatures, /calculationEnabled/);
  assert.doesNotMatch(taxRefundFeatures, /addCompanyHsFromOcrEnabled/);
  assert.match(menu, /features\?: \{ taxRefund\?:/);
  assert.match(menu, /item\.key !== "companyHs" \|\| taxRefundFeaturesEnabled/);
  assert.match(authMeRoute, /readSafeTaxRefundFeatureFlags/);
  assert.match(authPermissionsRoute, /readSafeTaxRefundFeatureFlags/);
  assert.match(settingsRoute, /readTaxRefundFeatureSettings\(actor\)/);
  assert.match(settingsRoute, /saveTaxRefundFeatureSettings\(request, actor, body\)/);
  assert.match(settingsModule, /taxRefundFeatures/);
  assert.match(settingsCards, /TaxRefundFeatureSettingsCard/);
  assert.match(settingsCards, /启用企业HS编码库/);
  assert.doesNotMatch(settingsCards, /启用退税计算功能|退税金额计算|OCR新增企业HS/);
});
