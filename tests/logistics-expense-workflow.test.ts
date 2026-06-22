import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = [
  readFileSync("lib/platform/shared-constants.ts", "utf8"),
  readFileSync("lib/platform/shared-tax.ts", "utf8"),
  readFileSync("lib/platform/shared-tax-completeness.ts", "utf8"),
  readFileSync("lib/platform/shared-tax-sync.ts", "utf8"),
  readFileSync("lib/platform/shared-order-summary.ts", "utf8"),
  readFileSync("lib/platform/shared-order-calculations.ts", "utf8"),
  readFileSync("lib/platform/commission-formula.ts", "utf8"),
  readFileSync("lib/platform/shared-order-serialization-impl.ts", "utf8"),
  readFileSync("lib/platform/shared-serialization.ts", "utf8"),
  readFileSync("lib/platform/shared-order-relations.ts", "utf8"),
  readFileSync("lib/platform/shared-users.ts", "utf8"),
  readFileSync("lib/platform/masters-access.ts", "utf8"),
  readFileSync("lib/platform/cost-records.ts", "utf8"),
  readFileSync("lib/platform/cost-records-shared.ts", "utf8"),
  readFileSync("lib/platform/cost-records-queries.ts", "utf8"),
  readFileSync("lib/platform/cost-records-mutations.ts", "utf8"),
  readFileSync("lib/platform/logistics-expenses.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-shared.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-access.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-invoice.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-queries.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow.ts", "utf8"),
  readFileSync("lib/platform/profit-overview.ts", "utf8"),
  readFileSync("lib/platform/tax-refunds.ts", "utf8"),
].join("\n");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260612190000_logistics_expense_workflow/migration.sql", "utf8");
const containerCountMigration = readFileSync("prisma/migrations/20260622100000_logistics_expense_container_count/migration.sql", "utf8");
const logisticsModule = readFileSync("app/modules/LogisticsFeesModule.tsx", "utf8");
const profitModule = readFileSync("app/modules/ProfitModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const settingsModule = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const reportsModule = readFileSync("app/modules/ReportsModule.tsx", "utf8");
const workspaceStyles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("logistics expenses are stored outside official costs until approved", () => {
  assert.match(schema, /model LogisticsExpense/);
  assert.match(schema, /auditStatus\s+String\s+@default\("草稿"\)/);
  assert.match(schema, /costId\s+String\?\s+@unique/);
  assert.match(schema, /appliedContainerCount\s+Int\?\s+@map\("applied_container_count"\)/);
  assert.match(schema, /model OrderCost[\s\S]*sourceType\s+String\s+@default\("MANUAL"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "logistics_expenses"/);
  assert.match(containerCountMigration, /ADD COLUMN IF NOT EXISTS "applied_container_count" INTEGER/);
});

test("approval generates official costs with source tracking", () => {
  assert.match(backend, /sourceType: "LOGISTICS_EXPENSE"/);
  assert.match(backend, /sourceId: expense\.id/);
  assert.match(backend, /costConfirmed: true/);
  assert.match(backend, /审核通过物流费用/);
  assert.match(costsModule, /label="来源" value=\{cost\.sourceLabel \|\| "人工录入"\}/);
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
  assert.match(logisticsModule, /const isLogisticsSupplier = currentUserRole === "物流供应商"/);
});

test("logistics supplier users must bind to one supplier account", () => {
  assert.match(schema, /model User[\s\S]*supplierId\s+String\?\s+@map\("supplier_id"\)/);
  assert.match(backend, /物流供应商账号必须绑定一个供应商。/);
  assert.match(backend, /LOGISTICS_USER_SUPPLIER_REQUIRED/);
  assert.match(settingsModule, /物流供应商账号必须绑定供应商/);
  assert.match(settingsModule, /绑定供应商/);
});

test("supplier account data scope is supplier-based, not user-created fallback", () => {
  assert.match(backend, /if \(actor\.supplierId\) return \{ supplierId: actor\.supplierId \};/);
  assert.match(backend, /order: \{ is: \{ logisticsSuppliers: \{ some: \{ supplierId: actor\.supplierId \} \} \} \}/);
  assert.match(backend, /if \(!actor\.supplierId \|\| actor\.supplierId !== expense\.supplierId\) return false;/);
});

test("supplier settings include logistics expense and invoice permissions", () => {
  assert.match(schema, /allowLogisticsExpenseEntry Boolean @default\(false\)/);
  assert.match(schema, /allowedLogisticsCostTypes Json\?/);
  assert.match(settingsModule, /label="允许物流费用录入"/);
  assert.match(settingsModule, /label="允许物流发票上传"/);
  assert.match(settingsModule, /允许录入的物流费用类型/);
});

test("invoice upload and confirmation workflow is present", () => {
  assert.match(backend, /uploadLogisticsExpenseInvoice/);
  assert.match(backend, /confirmLogisticsExpenseInvoice/);
  assert.match(backend, /LOGISTICS_INVOICE_AMOUNT_EXCEEDS_APPROVED/);
  assert.match(logisticsModule, /invoiceStatus/);
  assert.match(logisticsModule, /已上传发票/);
  assert.match(logisticsModule, /已确认发票/);
});

test("port charge logistics invoice filenames do not fall back to factory invoice", () => {
  assert.match(backend, /港杂费: "Port-Charges-Invoice"/);
  assert.match(backend, /LOGISTICS_INVOICE_ENGLISH_LABELS\[costType\]/);
  assert.match(backend, /costType: document\.cost\?\.costType \|\| document\.costType/);
  assert.match(backend, /const logisticsCostType = normalizedCostType\(expense\.cost\?\.costType \|\| expense\.costType\)/);
  assert.match(backend, /costType: logisticsCostType/);
  assert.match(backend, /cost: document\.cost \|\| cost/);
  assert.match(backend, /costType: document\.cost\?\.costType \|\| cost\.costType/);
});

test("approval sends invoice notification and preserves failure for audit", () => {
  assert.match(backend, /notifyLogisticsSupplierInvoice/);
  assert.match(backend, /物流费用已审核通过，请开票并上传发票/);
  assert.match(backend, /物流费用开票通知失败/);
  assert.match(backend, /invoiceStatus: "已通知开票"/);
});

test("logistics information page exposes per-order expense entry actions", () => {
  assert.match(logisticsModule, /<h2>物流费用录入<\/h2>/);
  assert.match(logisticsModule, /新增物流费用/);
  assert.match(logisticsModule, /导出对账单/);
  assert.match(domesticLogisticsModule, /录入费用/);
  assert.match(domesticLogisticsModule, /<LogisticsFeesModule/);
});

test("logistics expense supplier picker only keeps logistics-capable suppliers", () => {
  assert.match(logisticsModule, /const LOGISTICS_FEE_SUPPLIER_TYPES = \[/);
  assert.match(logisticsModule, /return suppliers\.filter\(\(supplier\) => LOGISTICS_FEE_SUPPLIER_TYPES\.includes\(supplier\.supplierType \|\| ""\)\);/);
  assert.doesNotMatch(logisticsModule, /工厂供应商/);
});

test("logistics supplier login locks supplier field to current supplier", () => {
  assert.match(logisticsModule, /supplierId: isLockedSupplier \? currentUserSupplierId/);
  assert.match(logisticsModule, /setForm\(\(current\) => \(\{ \.\.\.current, supplierId: currentUserSupplierId \}\)\);/);
  assert.match(logisticsModule, /supplierId: isLockedSupplier \? undefined : form\.supplierId \|\| undefined/);
  assert.match(logisticsModule, /!isLockedSupplier \? \(/);
});

test("logistics expense list groups bills by BL number and keeps item details", () => {
  assert.match(backend, /groupLogisticsExpensesByBill/);
  assert.match(backend, /serializeLogisticsExpenseBill/);
  assert.match(backend, /aggregateLogisticsExpenseStatus/);
  assert.match(logisticsModule, /items = expense\.items\?\.length \? expense\.items : \[expense\]/);
  assert.match(logisticsModule, /费用明细/);
  assert.match(logisticsModule, /LogisticsExpenseItemDetail/);
  assert.doesNotMatch(logisticsModule, /<th>供应商<\/th>/);
});

test("logistics expense form supports whole shipment or applied container count", () => {
  assert.match(logisticsModule, /appliedContainerCount: "shipment"/);
  assert.match(logisticsModule, /lineSubtotal\(item\)/);
  assert.match(logisticsModule, /containerCountOptions\(selectedOrder\)/);
  assert.match(logisticsModule, /单价\/整票/);
  assert.match(logisticsModule, /适用范围/);
  assert.match(backend, /normalizeAppliedContainerCount/);
  assert.match(backend, /LOGISTICS_CONTAINER_COUNT_EXCEEDS_ORDER/);
});

test("sales commission base uses actual received payments minus logistics costs", () => {
  assert.match(backend, /calculateCommissionFormulaBase/);
  assert.match(backend, /ACTUAL_RECEIVED_MINUS_LOGISTICS/);
  assert.match(backend, /source: "ARRIVED_PAYMENTS_CNY"/);
  assert.match(backend, /deductions: \["LOGISTICS_COST_CNY"\]/);
  assert.match(backend, /getCommissionFormulaSettings/);
  assert.match(backend, /logisticsCostCny: summary\.logisticsCostCny/);
  assert.match(backend, /commissionBaseCny: summary\.commissionBaseCny/);
  assert.match(settingsModule, /提成公式/);
  assert.match(settingsModule, /公式模板/);
  assert.match(settingsModule, /commissionDeductionGrid/);
  assert.match(settingsModule, /UiOptionCard/);
  assert.match(settingsModule, /从FOB中扣减物流费用/);
  assert.match(settingsModule, /<UiSwitch[\s\S]*label="提成基数负数归零"/);
  assert.match(settingsModule, /toggleDeduction\(item\.value\)/);
  assert.match(profitModule, /提成基数/);
  assert.doesNotMatch(backend, /const estimatedCommissionBaseCny = Math\.max\(expectedGrossProfit, 0\);/);
  assert.doesNotMatch(backend, /const settleableCommissionBaseCny = Math\.max\(expectedGrossProfit, 0\);/);
});

test("checkbox controls use modern custom selection styling", () => {
  assert.match(settingsModule, /commissionDeductionGrid/);
  assert.match(settingsModule, /UiCheckbox/);
  assert.match(reportsModule, /variant="table"/);
  assert.match(workspaceStyles, /\.uiChoiceCardChecked/);
  assert.match(workspaceStyles, /border-color: #3b82f6/);
  assert.match(workspaceStyles, /background: rgba\(59, 130, 246, 0\.08\)/);
  assert.match(workspaceStyles, /\.checkboxPanel label:has\(input:checked\)/);
  assert.match(workspaceStyles, /\.permissionGroup label:has\(input:checked\)/);
  assert.match(workspaceStyles, /\.inlineCheckbox:has\(input:checked\)/);
  assert.match(workspaceStyles, /\.tableCheckbox:checked/);
  assert.match(workspaceStyles, /background-image: url\("data:image\/svg\+xml/);
});

test("commission settlement requires complete tax refund logistics costs", () => {
  assert.match(backend, /taxDocumentCompleteness\(order\)/);
  assert.match(backend, /taxLogisticsCostsComplete/);
  assert.match(backend, /不可结算：物流费用未完整/);
  assert.match(backend, /TAX_LOGISTICS_COSTS_INCOMPLETE/);
  assert.match(profitModule, /提成前置缺失/);
});
