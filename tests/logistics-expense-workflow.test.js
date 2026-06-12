import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync("lib/platform-db.js", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260612190000_logistics_expense_workflow/migration.sql", "utf8");
const app = readFileSync("app.js", "utf8");
const publicApp = readFileSync("public/app.js", "utf8");
const html = readFileSync("index.html", "utf8");
const publicHtml = readFileSync("public/index.html", "utf8");
const css = readFileSync("styles.css", "utf8");
const publicCss = readFileSync("public/styles.css", "utf8");

test("logistics expenses are stored outside official costs until approved", () => {
  assert.match(schema, /model LogisticsExpense/);
  assert.match(schema, /auditStatus\s+String\s+@default\("草稿"\)/);
  assert.match(schema, /costId\s+String\?\s+@unique/);
  assert.match(schema, /model OrderCost[\s\S]*sourceType\s+String\s+@default\("MANUAL"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "logistics_expenses"/);
});

test("approval generates official costs with source tracking", () => {
  assert.match(backend, /sourceType: "LOGISTICS_EXPENSE"/);
  assert.match(backend, /sourceId: expense\.id/);
  assert.match(backend, /costConfirmed: true/);
  assert.match(backend, /审核通过物流费用/);
});

test("manual logistics costs are blocked from ordinary cost entry", () => {
  assert.match(backend, /LOGISTICS_COST_REQUIRES_EXPENSE_WORKFLOW/);
  assert.match(backend, /该类费用请从物流费用录入模块提交，审核通过后自动进入成本。/);
});

test("duplicate official logistics cost generation is blocked by order and cost type", () => {
  assert.match(backend, /LOGISTICS_EXPENSE_DUPLICATE_COST/);
  assert.match(backend, /同一订单同一物流费用类型已存在正式成本/);
  assert.match(migration, /order_costs_source_unique/);
});

test("supplier role is renamed and scoped to assigned logistics work", () => {
  assert.match(backend, /export const LOGISTICS_OPERATOR_ROLE = "物流供应商"/);
  assert.match(migration, /WHERE "role" = '物流资料录入员'/);
  assert.match(backend, /logisticsSuppliers: \{ some: \{ supplierId: actor\.supplierId \} \}/);
  assert.doesNotMatch(backend, /documents: \["管理员", "业务员", "财务", "成本录入员", LOGISTICS_OPERATOR_ROLE\]/);
});

test("logistics supplier users must bind to one supplier account", () => {
  assert.match(schema, /model User[\s\S]*supplierId\s+String\?\s+@map\("supplier_id"\)/);
  assert.match(backend, /const USER_AUTH_SELECT = \{[\s\S]*supplierId: true/);
  assert.match(backend, /物流供应商账号必须绑定一个供应商。/);
  assert.match(backend, /LOGISTICS_USER_SUPPLIER_REQUIRED/);
  assert.match(backend, /data\.supplierId = supplier\.id/);
});

test("supplier account data scope is supplier-based, not user-created fallback", () => {
  assert.match(backend, /if \(actor\.supplierId\) return \{ supplierId: actor\.supplierId \};/);
  assert.doesNotMatch(backend, /createdById: actor\.id \}, \{ supplierId: "__no_supplier__"/);
  assert.doesNotMatch(backend, /submittedByUserId === actor\.id/);
  assert.match(backend, /order: \{ is: \{ logisticsSuppliers: \{ some: \{ supplierId: actor\.supplierId \} \} \} \}/);
});

test("supplier settings include logistics expense and invoice permissions", () => {
  for (const source of [html, publicHtml]) {
    assert.match(source, /supplier-logistics-expense-entry/);
    assert.match(source, /supplier-logistics-invoice-upload/);
    assert.match(source, /supplier-logistics-cost-types/);
  }
  assert.match(backend, /allowLogisticsExpenseEntry/);
  assert.match(backend, /allowedLogisticsCostTypes/);
});

test("invoice upload and confirmation workflow is present", () => {
  assert.match(backend, /uploadLogisticsExpenseInvoice/);
  assert.match(backend, /confirmLogisticsExpenseInvoice/);
  assert.match(backend, /LOGISTICS_INVOICE_AMOUNT_EXCEEDS_APPROVED/);
  assert.match(app, /openLogisticsInvoiceDrawer/);
  assert.match(publicApp, /openLogisticsInvoiceDrawer/);
});

test("approval sends invoice notification and preserves failure for audit", () => {
  assert.match(backend, /notifyLogisticsSupplierInvoice/);
  assert.match(backend, /物流费用已审核通过，请开票并上传发票/);
  assert.match(backend, /物流费用开票通知失败/);
  assert.match(backend, /invoiceStatus: "已通知开票"/);
});

test("logistics information page exposes expense entry list and actions", () => {
  for (const source of [html, publicHtml]) {
    assert.match(source, /物流费用录入/);
    assert.match(source, /logistics-expense-table/);
    assert.match(source, /open-logistics-expense-drawer/);
    assert.match(source, /export-logistics-statement/);
  }
});

test("logistics expense modal uses wide desktop layout without horizontal window drag", () => {
  for (const source of [css, publicCss]) {
    assert.match(source, /\.logistics-expense-drawer \.tax-detail-panel[\s\S]*width: 96vw;[\s\S]*max-width: 1400px;/);
    assert.match(source, /\.logistics-expense-drawer \.form-grid[\s\S]*overflow-x: hidden;/);
    assert.match(source, /\.logistics-expense-drawer \.form-actions[\s\S]*position: sticky;[\s\S]*bottom: 0;[\s\S]*justify-content: flex-end;/);
    assert.match(source, /\.logistics-invoice-drawer \.tax-detail-panel[\s\S]*width: min\(96vw, 920px\);/);
    assert.match(source, /\.order-search-results:empty[\s\S]*display: none;/);
  }
  assert.match(html, /class="logistics-expense-search-field"/);
  assert.match(publicHtml, /class="logistics-expense-search-field"/);
});

test("logistics expense item table keeps desktop columns visible and allows mobile overflow", () => {
  for (const source of [css, publicCss]) {
    assert.match(source, /\.logistics-expense-items table[\s\S]*min-width: 0;[\s\S]*table-layout: fixed;/);
    assert.match(source, /\.logistics-expense-items th:nth-child\(3\),[\s\S]*\.logistics-expense-items td:nth-child\(3\)[\s\S]*width: 124px;/);
    assert.match(source, /\.logistics-expense-items th:nth-child\(4\),[\s\S]*\.logistics-expense-items td:nth-child\(4\)[\s\S]*width: 112px;/);
    assert.match(source, /\.logistics-expense-items th:nth-child\(5\),[\s\S]*\.logistics-expense-items td:nth-child\(5\)[\s\S]*width: 136px;/);
    assert.match(source, /@media \(max-width: 1199px\)[\s\S]*\.logistics-expense-items \.table-wrap[\s\S]*overflow-x: auto;/);
    assert.match(source, /#logistics-expense-total[\s\S]*justify-self: end;[\s\S]*font-size: 16px;[\s\S]*font-weight: 800;/);
  }
});

test("user management exposes supplier binding for logistics supplier accounts", () => {
  for (const source of [html, publicHtml]) {
    assert.match(source, /user-supplier-field/);
    assert.match(source, /一个供应商可绑定多个用户账号/);
  }
  assert.match(app, /supplierId: \$\("#user-role"\)\.value === "物流供应商" \? \(\$\("#user-supplier"\)\?\.value \|\| ""\) : ""/);
  assert.match(publicApp, /supplierId: \$\("#user-role"\)\.value === "物流供应商" \? \(\$\("#user-supplier"\)\?\.value \|\| ""\) : ""/);
});

test("cost list displays official cost source", () => {
  assert.match(app, /sourceLabel/);
  assert.match(publicApp, /sourceLabel/);
  assert.match(html, /<th>来源<\/th>/);
  assert.match(publicHtml, /<th>来源<\/th>/);
});
