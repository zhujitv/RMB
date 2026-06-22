import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = [
  readFileSync("lib/platform/logistics-cost-types.ts", "utf8"),
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
const menuFile = readFileSync("app/menu.ts", "utf8");
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");
const migration = readFileSync("prisma/migrations/20260612190000_logistics_expense_workflow/migration.sql", "utf8");
const containerCountMigration = readFileSync("prisma/migrations/20260622100000_logistics_expense_container_count/migration.sql", "utf8");
const invoiceNotificationMigration = readFileSync("prisma/migrations/20260622233000_logistics_expense_invoice_notification/migration.sql", "utf8");
const logisticsModule = readFileSync("app/modules/LogisticsFeesModule.tsx", "utf8");
const deleteExpenseSource = logisticsModule.match(/async function deleteExpense[\s\S]*?\n  async function withdrawExpense/)?.[0] || "";
const logisticsReviewRoute = readFileSync("app/api/logistics-costs/review/route.ts", "utf8");
const logisticsExpenseDeleteRoute = readFileSync("app/api/logistics-expenses/[id]/route.ts", "utf8");
const logisticsExpenseBatchRoute = readFileSync("app/api/logistics-expenses/batch-update/route.ts", "utf8");
const logisticsExpenseBatchSaveRoute = readFileSync("app/api/logistics-expenses/batch-save/route.ts", "utf8");
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
  assert.match(schema, /billingMethod\s+String\?\s+@map\("billing_method"\)/);
  assert.match(schema, /billingQuantity\s+Decimal\?\s+@map\("billing_quantity"\)/);
  assert.match(schema, /invoiceNotifiedAt\s+DateTime\?\s+@map\("invoice_notified_at"\)/);
  assert.match(schema, /model OrderCost[\s\S]*sourceType\s+String\s+@default\("MANUAL"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "logistics_expenses"/);
  assert.match(containerCountMigration, /ADD COLUMN IF NOT EXISTS "applied_container_count" INTEGER/);
  assert.match(invoiceNotificationMigration, /ADD COLUMN IF NOT EXISTS "invoice_notified_at"/);
});

test("approval generates official costs with source tracking", () => {
  assert.match(backend, /sourceType: "LOGISTICS_EXPENSE"/);
  assert.match(backend, /sourceId: expense\.id/);
  assert.match(backend, /costConfirmed: true/);
  assert.match(backend, /审核通过物流费用/);
  assert.match(backend, /reviewLogisticsExpenseBills/);
  assert.match(backend, /invoiceNotifiedAt: now/);
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

test("logistics cost type dictionary includes advance and drop-off fees in business order", () => {
  assert.match(backend, /"拖车费",\s*"报关费",\s*"港杂费",\s*"进港费",\s*"提箱费",\s*"落箱费",\s*"预提费",\s*"查验费",\s*"超重费",\s*"海运费",\s*"保险费",\s*"其他物流费用"/);
  assert.match(backend, /预提费: "Advance Charge"/);
  assert.match(backend, /落箱费: "Container Drop-off Fee"/);
  assert.match(backend, /预提费: "Advance-Charge-Invoice"/);
  assert.match(backend, /落箱费: "Container-Drop-off-Fee-Invoice"/);
  assert.match(logisticsModule, /const COST_TYPES = \[\.\.\.LOGISTICS_COST_TYPES\]/);
  assert.match(settingsModule, /LOGISTICS_COST_TYPES/);
  assert.match(costsModule, /COST_FILTER_TYPES = \[\.\.\.QUICK_COST_TYPES, \.\.\.LOGISTICS_COST_TYPES\]/);
  assert.match(reportsModule, /\.\.\.LOGISTICS_COST_TYPES/);
});

test("approval sends invoice notification and preserves failure for audit", () => {
  assert.match(backend, /notifyLogisticsSupplierInvoice/);
  assert.match(backend, /物流费用已审核通过，请开票并上传发票/);
  assert.match(backend, /物流费用开票通知失败/);
  assert.match(backend, /invoiceStatus: "已通知开票"/);
});

test("logistics information page exposes per-order expense entry actions", () => {
  assert.match(logisticsModule, /title = "物流费用录入"/);
  assert.match(logisticsModule, /<h2>\{title\}<\/h2>/);
  assert.match(logisticsModule, /新增物流费用/);
  assert.match(logisticsModule, /导出对账单/);
  assert.match(domesticLogisticsModule, /录入费用/);
  assert.match(domesticLogisticsModule, /<LogisticsFeesModule/);
});

test("admin has a direct logistics expense review menu", () => {
  assert.match(menuFile, /\{ key: "logisticsReview", label: "物流费用审核"/);
  assert.match(menuFile, /管理员: \["dashboard", "orders", "payments", "costs", "profit", "domesticLogistics", "logisticsReview"/);
  assert.match(workspaceShell, /activeMenu === "logisticsReview"/);
  assert.match(workspaceShell, /title="物流费用审核"/);
  assert.match(workspaceShell, /initialStatus="待审核"/);
  assert.match(workspaceShell, /hideCreateAction/);
  assert.match(logisticsModule, /initialStatus = ""/);
  assert.match(logisticsModule, /useState\(initialStatus\)/);
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
  assert.match(backend, /domesticLogisticsInfos[\s\S]*transportItems/);
  assert.match(logisticsModule, /items = expense\.items\?\.length \? expense\.items : \[expense\]/);
  assert.match(logisticsModule, /className=\{styles\.containerTypeColumn\}>柜型/);
  assert.match(logisticsModule, /logisticsExpenseContainerSummary/);
  assert.match(logisticsModule, /LogisticsBillContainerInfo/);
  assert.match(logisticsModule, /柜型汇总：/);
  assert.match(logisticsModule, /柜号列表：/);
  assert.match(logisticsModule, /未录入集装箱信息/);
  assert.match(logisticsModule, /费用明细/);
  assert.match(logisticsModule, /LogisticsExpenseDetailsTable/);
  assert.match(logisticsModule, /logisticsDetailTable/);
  assert.match(logisticsModule, /同步成本状态/);
  assert.match(logisticsModule, /<th>操作<\/th>/);
  assert.doesNotMatch(logisticsModule, /<th>供应商<\/th>/);
});

test("logistics expense approval works at bill level and groups invoice emails by supplier", () => {
  assert.match(logisticsReviewRoute, /export async function PATCH/);
  assert.match(logisticsReviewRoute, /reviewLogisticsExpenseBills\(request, actor, body\)/);
  assert.match(logisticsReviewRoute, /开票通知已按供应商合并发送/);
  assert.match(backend, /export async function reviewLogisticsExpenseBills/);
  assert.match(backend, /normalizeLogisticsExpenseReviewIdentifiers/);
  assert.match(backend, /loadLogisticsExpenseBillRowsForAction/);
  assert.match(backend, /notifyLogisticsSupplierInvoiceBills\(approvedRows\)/);
  assert.match(backend, /const bySupplier = new Map/);
  assert.match(backend, /group\.bills\.push\(bill\)/);
  assert.match(backend, /sendShippingDocumentsEmail\(\{[\s\S]*recipientEmails: \[email\]/);
  assert.match(backend, /待开票费用清单/);
  assert.match(backend, /订单号：/);
  assert.match(backend, /提单号：/);
  assert.match(backend, /柜型\/柜量：/);
  assert.match(backend, /客户简称：/);
  assert.match(backend, /费用合计：/);
  assert.match(backend, /费用明细：/);
  assert.match(backend, /发票上传入口/);
  assert.match(backend, /invoiceStatus: \["已上传", "已确认"\]\.includes\(row\.invoiceStatus\) \? row\.invoiceStatus : "已通知开票"/);
  assert.match(backend, /paymentStatus: "待付款"/);
  assert.match(backend, /reviewedById: actor\.id/);
  assert.match(backend, /reviewedAt: now/);
  assert.match(backend, /invoiceNotifiedAt: now/);
  assert.doesNotMatch(backend, /for \(const bill[\s\S]*notifyLogisticsSupplierInvoice\(bill/);
});

test("logistics expense page supports single bill review and merged batch review", () => {
  assert.match(logisticsModule, /selectedBillIds/);
  assert.match(logisticsModule, /selectedReviewableRows/);
  assert.match(logisticsModule, /toggleAllReviewableBills/);
  assert.match(logisticsModule, /reviewSelectedBills/);
  assert.match(logisticsModule, /\/api\/logistics-costs\/review/);
  assert.match(logisticsModule, /合并审核 \/ 批量审核/);
  assert.match(logisticsModule, /同一供应商只发送一封邮件/);
  assert.match(logisticsModule, /审核通过并通知开票/);
  assert.match(logisticsModule, /logisticsExpenseBillCanApprove/);
  assert.match(logisticsModule, /<UiCheckbox[\s\S]*variant="table"[\s\S]*选择本页待审核账单/);
  assert.match(logisticsModule, /selectionEnabled=\{canReviewExpense\}/);
  assert.match(workspaceStyles, /\.dataTable th\.selectionColumn/);
  assert.doesNotMatch(logisticsModule, />通过<\/button>/);
});

test("draft logistics expense bills can be submitted for review", () => {
  assert.match(backend, /input\.action === "submit"/);
  assert.match(backend, /只有草稿或已驳回费用可以提交审核。/);
  assert.match(backend, /auditStatus: "待审核"/);
  assert.match(backend, /submittedAt: new Date\(\)/);
  assert.match(backend, /rejectReason: null/);
  assert.match(logisticsModule, /submitDraftExpenseBill/);
  assert.match(logisticsModule, /action: "submit"/);
  assert.match(logisticsModule, /物流费用已提交审核/);
  assert.match(logisticsModule, /renderBillSubmitControls/);
  assert.match(logisticsModule, /提交中\.\.\." : "提交审核"/);
  assert.match(logisticsModule, /请先保存本账单明细，再提交审核/);
  assert.match(logisticsModule, /logisticsExpenseBillCanSubmit/);
});

test("logistics expense form supports positive applied quantity", () => {
  assert.match(logisticsModule, /appliedContainerCount: "1"/);
  assert.match(logisticsModule, /billingMethod: "按柜"/);
  assert.match(logisticsModule, /lineSubtotal\(item\)/);
  assert.match(logisticsModule, /type="number"/);
  assert.match(logisticsModule, /min="1"/);
  assert.match(logisticsModule, /单价/);
  assert.match(logisticsModule, /适用数量/);
  assert.match(backend, /normalizeAppliedContainerCount/);
  assert.match(backend, /适用数量必须为正整数/);
  assert.doesNotMatch(logisticsModule, /const BILLING_METHODS/);
  assert.doesNotMatch(logisticsModule, /计费方式/);
  assert.doesNotMatch(logisticsModule, /适用数量\/范围/);
  assert.doesNotMatch(logisticsModule, /<th>适用范围<\/th>/);
  assert.doesNotMatch(logisticsModule, /单价\/整票/);
  assert.doesNotMatch(logisticsModule, /containerCountOptions/);
});

test("logistics suppliers can edit price and quantity before audit approval", () => {
  assert.match(backend, /before \? before\.auditStatus/);
  assert.doesNotMatch(backend, /LOGISTICS_EXPENSE_PENDING_LOCKED/);
  assert.doesNotMatch(backend, /待审核费用不能直接修改/);
  assert.match(backend, /LOGISTICS_EXPENSE_APPROVED_LOCKED/);
  assert.match(logisticsModule, /canEditAmount=\{isLogisticsSupplier\}/);
  assert.match(logisticsModule, /logisticsExpenseEditBlockReason/);
  assert.match(logisticsModule, /editableLineSubtotal/);
  assert.match(logisticsModule, /LogisticsExpenseDraft/);
  assert.match(logisticsModule, /className=\{styles\.inlineRemarkInput\}/);
  assert.match(logisticsModule, /已审核，不能修改/);
  assert.match(logisticsModule, /saveStateDirty/);
  assert.match(logisticsModule, /saveStateSaved/);
  assert.match(logisticsModule, /保存本账单明细/);
  assert.match(logisticsModule, /有未保存修改/);
  assert.match(logisticsModule, /saveBillDetails/);
  assert.match(logisticsModule, /\/api\/logistics-expenses\/batch-save/);
  assert.match(workspaceStyles, /\.logisticsContainerInfoCard/);
  assert.match(workspaceStyles, /\.dataTable th\.containerTypeColumn/);
  assert.doesNotMatch(logisticsModule, /<th>计费方式<\/th>/);
  assert.match(logisticsModule, /<th>适用数量<\/th>/);
  assert.match(logisticsModule, /<th className=\{styles\.numericCell\}>单价\/金额<\/th>/);
  assert.doesNotMatch(logisticsModule, /<th>集装箱柜型<\/th>/);
  assert.doesNotMatch(logisticsModule, /保存备注/);
  assert.doesNotMatch(logisticsModule, /保存金额/);
  assert.doesNotMatch(logisticsModule, /action: "updateAmount"/);
  assert.match(logisticsModule, /remark: safeDraft\.remark\.trim\(\)/);
  assert.doesNotMatch(logisticsModule, /logistics-save-amount-btn/);
  assert.doesNotMatch(logisticsModule, /primaryButtonCompact[^\\n]*保存金额/);
  assert.match(workspaceStyles, /\.billSaveButton/);
  assert.match(workspaceStyles, /background: #2563eb/);
  assert.match(workspaceStyles, /background: #1d4ed8/);
  assert.match(workspaceStyles, /background: #e5e7eb/);
  assert.match(workspaceStyles, /\.billAddLineButton/);
  assert.match(workspaceStyles, /\.logisticsTypographyScope \.primaryButtonCompact \{[\s\S]*background: #2563eb;[\s\S]*color: #ffffff;/);
  assert.match(workspaceStyles, /\.logisticsTypographyScope \.primaryButtonCompact:hover:not\(:disabled\),[\s\S]*background: #1d4ed8;[\s\S]*color: #ffffff;/);
  assert.match(workspaceStyles, /\.logisticsTypographyScope \.primaryButtonCompact:disabled,[\s\S]*background: #e5e7eb;[\s\S]*color: #374151;/);
  assert.match(workspaceStyles, /\.logisticsTypographyScope \.secondaryButton:disabled,[\s\S]*background: #e5e7eb;[\s\S]*color: #374151;/);
  assert.match(workspaceStyles, /\.logisticsTypographyScope \.billSaveButton \{[\s\S]*background: #2563eb;[\s\S]*color: #ffffff;/);
  assert.match(workspaceStyles, /\.logisticsTypographyScope \.billAddLineButton \{[\s\S]*background: #eff6ff;[\s\S]*color: #1d4ed8;/);
  assert.match(workspaceStyles, /\.logisticsTypographyScope \.logisticsLineDeleteButton:disabled[\s\S]*background: #e5e7eb;[\s\S]*color: #374151;/);
  assert.match(workspaceStyles, /\.inlineAmountEditor input[\s\S]*width: 100px/);
  assert.match(workspaceStyles, /th:nth-child\(3\)[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /th:nth-child\(7\)[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /th:nth-child\(8\)[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /\.inlineQuantityInput[\s\S]*width: 90px/);
  assert.match(workspaceStyles, /\.inlineQuantityInput[\s\S]*margin: 0 auto/);
  assert.match(workspaceStyles, /\.inlineQuantityInput[\s\S]*-moz-appearance: textfield/);
  assert.match(workspaceStyles, /\.inlineQuantityInput[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /\.inlineQuantityInput::-webkit-outer-spin-button,[\s\S]*\.inlineQuantityInput::-webkit-inner-spin-button[\s\S]*-webkit-appearance: none;[\s\S]*margin: 0;/);
  assert.match(workspaceStyles, /\.inlineRemarkInput[\s\S]*width: 140px/);
  assert.match(workspaceStyles, /\.inlineCostTypeSelect/);
  assert.doesNotMatch(workspaceStyles, /\.inlineBillingMethodSelect/);
  assert.match(workspaceStyles, /th:nth-child\(6\)[\s\S]*width: 160px/);
  assert.match(workspaceStyles, /\.costSyncCell[\s\S]*flex-direction: column/);
  assert.match(workspaceStyles, /\.costSyncCell[\s\S]*align-items: center/);
  assert.match(workspaceStyles, /\.compactDetailActions[\s\S]*align-items: center/);
  assert.match(workspaceStyles, /overflow-x: auto/);
  assert.match(workspaceStyles, /color: #ffffff/);
  assert.match(logisticsExpenseBatchRoute, /export async function PATCH/);
  assert.match(logisticsExpenseBatchRoute, /batchUpdateLogisticsExpenses/);
  assert.match(backend, /export async function batchUpdateLogisticsExpenses/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_QUANTITY_INVALID/);
  assert.match(backend, /第 \$\{index \+ 1\} 行/);
});

test("logistics expense bill details can add create and delete rows through one local batch save", () => {
  assert.match(logisticsModule, /editingExpenseRows/);
  assert.match(logisticsModule, /newExpenseRows/);
  assert.match(logisticsModule, /deletedExpenseIds/);
  assert.match(logisticsModule, /\+ 新增费用明细/);
  assert.match(logisticsModule, /createTemporaryLogisticsExpenseRow/);
  assert.match(logisticsModule, /logisticsExpenseDraftCreatePayload/);
  assert.match(logisticsModule, /creates: newExpenseRows\.map/);
  assert.match(logisticsModule, /deletes: deletedExpenseIds/);
  assert.match(logisticsModule, /onStageDelete/);
  assert.match(logisticsModule, /isTemporary \? "移除" : "删除"/);
  assert.match(logisticsModule, /第 \$\{lineNo\} 行金额不能为空/);
  assert.match(logisticsModule, /第 \$\{lineNo\} 行请选择费用类型/);
  assert.match(logisticsModule, /reconcileLogisticsExpenseRowsAfterBatchSave/);
  assert.match(logisticsExpenseBatchSaveRoute, /export async function PATCH/);
  assert.match(logisticsExpenseBatchSaveRoute, /batchSaveLogisticsExpenses/);
  assert.match(logisticsExpenseBatchSaveRoute, /message: "✓ 已保存"/);
  assert.match(backend, /export async function batchSaveLogisticsExpenses/);
  assert.match(backend, /const updates = Array\.isArray\(input\.updates\)/);
  assert.match(backend, /const creates = Array\.isArray\(input\.creates\)/);
  assert.match(backend, /const deletes = Array\.isArray\(input\.deletes\)/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_REQUIRED/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_CREATE_COST_TYPE_REQUIRED/);
  assert.match(backend, /parseLogisticsExpenseGroupKey/);
  assert.doesNotMatch(logisticsModule, /window\.location|location\.href|router\.refresh|reload\(/);
});

test("logistics expense detail rows can delete unapproved unsynced items", () => {
  assert.match(logisticsExpenseDeleteRoute, /export async function DELETE/);
  assert.match(logisticsExpenseDeleteRoute, /deleteLogisticsExpense/);
  assert.match(logisticsExpenseDeleteRoute, /message: "已删除"/);
  assert.match(backend, /export async function deleteLogisticsExpense/);
  assert.match(backend, /LOGISTICS_EXPENSE_SYNCED_COST_DELETE_BLOCKED/);
  assert.match(backend, /LOGISTICS_EXPENSE_APPROVED_DELETE_BLOCKED/);
  assert.match(backend, /LOGISTICS_EXPENSE_INVOICED_DELETE_BLOCKED/);
  assert.match(backend, /deletedAt: new Date\(\)/);
  assert.match(logisticsModule, /\/api\/logistics-expenses\/\$\{encodeURIComponent\(expense\.id\)\}/);
  assert.match(logisticsModule, /删除物流费用明细/);
  assert.match(logisticsModule, /确定删除这条费用明细吗？删除后不可恢复。/);
  assert.match(logisticsModule, /const \[deletingId, setDeletingId\]/);
  assert.match(logisticsModule, /删除中\.\.\./);
  assert.match(logisticsModule, /event\.stopPropagation\(\)/);
  assert.match(deleteExpenseSource, /setRows/);
  assert.match(logisticsModule, /removeLogisticsExpenseFromRows/);
  assert.match(deleteExpenseSource, /loadStatement\(statementMonth\)/);
  assert.match(deleteExpenseSource, /setNotice\("已删除"\)/);
  assert.doesNotMatch(deleteExpenseSource, /loadExpenses\(/);
  assert.doesNotMatch(deleteExpenseSource, /setExpandedId\(""\)/);
  assert.doesNotMatch(logisticsModule, /window\.location|location\.href|router\.refresh|reload\(/);
  assert.match(logisticsModule, /费用明细/);
  assert.match(logisticsModule, /账单合计/);
  assert.match(logisticsModule, /logisticsLineDeleteButton/);
  assert.match(workspaceStyles, /\.logisticsLineDeleteButton/);
  assert.match(workspaceStyles, /border: 1px solid #fecaca/);
  assert.match(workspaceStyles, /th:nth-child\(8\)[\s\S]*width: 140px/);
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
