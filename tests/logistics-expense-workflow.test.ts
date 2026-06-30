import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { readSettingsModuleSource, readWorkspaceStylesSource } from "./source-helpers.ts";

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
  readFileSync("lib/platform/notification-templates.ts", "utf8"),
  readFileSync("lib/platform/logistics-invoice-groups.ts", "utf8"),
  readFileSync("lib/platform/logistics-bill-state-machine.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-queries.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow.ts", "utf8"),
  readFileSync("lib/platform/profit-overview.ts", "utf8"),
  readFileSync("lib/platform/tax-refunds.ts", "utf8"),
].join("\n");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const menuFile = readFileSync("app/menu.ts", "utf8");
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");
const supplierMasters = readFileSync(
  "lib/platform/supplier-masters.ts",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260612190000_logistics_expense_workflow/migration.sql",
  "utf8",
);
const containerCountMigration = readFileSync(
  "prisma/migrations/20260622100000_logistics_expense_container_count/migration.sql",
  "utf8",
);
const invoiceNotificationMigration = readFileSync(
  "prisma/migrations/20260622233000_logistics_expense_invoice_notification/migration.sql",
  "utf8",
);
const invoiceGroupMigration = readFileSync(
  "prisma/migrations/20260623073000_logistics_invoice_group_uploads/migration.sql",
  "utf8",
);
const removeInvoiceManualFieldsMigration = readFileSync(
  "prisma/migrations/20260623194500_remove_logistics_invoice_manual_fields/migration.sql",
  "utf8",
);
const logisticsBillMigration = readFileSync(
  "prisma/migrations/20260624103000_logistics_bills/migration.sql",
  "utf8",
);
const logisticsInvoiceUsdGroupingMigration = readFileSync(
  "prisma/migrations/20260626235000_fix_logistics_invoice_usd_grouping/migration.sql",
  "utf8",
);
const logisticsBillConvergenceMigration = readFileSync(
  "prisma/migrations/20260627120000_converge_logistics_expense_status_to_bills/migration.sql",
  "utf8",
);
const logisticsBillStateMachine = readFileSync(
  "lib/platform/logistics-bill-state-machine.ts",
  "utf8",
);
const logisticsFeesMain = readFileSync(
  "app/modules/LogisticsFeesModule.tsx",
  "utf8",
);
const logisticsFeesModel = readFileSync(
  "app/modules/logistics-fees/model.ts",
  "utf8",
);
const logisticsFeesDetails = readFileSync(
  "app/modules/logistics-fees/details-drawer.tsx",
  "utf8",
);
const logisticsFeesForm = readFileSync(
  "app/modules/logistics-fees/expense-form.tsx",
  "utf8",
);
const logisticsFeesInvoices = readFileSync(
  "app/modules/logistics-fees/invoice-groups-panel.tsx",
  "utf8",
);
const logisticsFeesShared = readFileSync(
  "app/modules/logistics-fees/shared.tsx",
  "utf8",
);
const logisticsFeesBillTable = readFileSync(
  "app/modules/logistics-fees/bill-table.tsx",
  "utf8",
);
const logisticsFeesMonthlySummary = readFileSync(
  "app/modules/logistics-fees/monthly-summary.tsx",
  "utf8",
);
const logisticsModule = [
  logisticsFeesMain,
  logisticsFeesModel,
  logisticsFeesDetails,
  logisticsFeesForm,
  logisticsFeesInvoices,
  logisticsFeesShared,
  logisticsFeesBillTable,
  logisticsFeesMonthlySummary,
].join("\n");
const deleteExpenseSource =
  logisticsFeesMain.match(
    /async function deleteExpense[\s\S]*?\n  async function withdrawExpense/,
  )?.[0] || "";
const withdrawExpenseSource =
  logisticsFeesMain.match(
    /async function withdrawExpense[\s\S]*?\n  async function submitDraftExpenseBill/,
  )?.[0] || "";
const saveBillDetailsSource =
  logisticsFeesMain.match(
    /async function saveBillDetails[\s\S]*?\n  async function deleteExpense/,
  )?.[0] || "";
const frontendAggregateStatusSource =
  logisticsFeesShared.match(
    /export function aggregateClientLogisticsExpenseStatus[\s\S]*?\n}\n\nexport function logisticsInvoiceGroupsForBill/,
  )?.[0] || "";
const logisticsExpenseDetailLineSource =
  logisticsFeesDetails.match(
    /function LogisticsExpenseDetailLine[\s\S]*?\n}\s*$/,
  )?.[0] || "";
const logisticsExpenseFormSource =
  logisticsFeesForm.match(
    /export function LogisticsExpenseForm[\s\S]*?\n}\s*$/,
  )?.[0] || "";
const invoiceUploadFormSource =
  logisticsFeesInvoices.match(
    /function InvoiceUploadForm[\s\S]*?\n}\s*$/,
  )?.[0] || "";
const monthlySummaryComponentSource =
  logisticsFeesShared.match(
    /export function MonthlySummaryComponent[\s\S]*?\n}\n\nexport function buildMonthlySummary/,
  )?.[0] || "";
const supplierSectionComponentSource =
  logisticsFeesShared.match(
    /export function SupplierSectionComponent[\s\S]*?\n}\n\nexport function StatusPill/,
  )?.[0] || "";
const billTableComponentSource =
  logisticsFeesBillTable.match(
    /function LogisticsExpenseBillTable[\s\S]*?\n}\n\nfunction LogisticsExpenseCompactRow/,
  )?.[0] || "";
const backendAggregateStatusSource =
  backend.match(
    /export function aggregateLogisticsExpenseStatus[\s\S]*?\n}\n\nexport function logisticsExpenseBillAuditStatus/,
  )?.[0] || "";
const submitLogisticsExpenseBillSource =
  backend.match(
    /export async function submitLogisticsExpenseBill[\s\S]*?\n}\n\nexport async function batchUpdateLogisticsExpenses/,
  )?.[0] || "";
const reviewLogisticsExpenseBillsSource =
  backend.match(
    /export async function reviewLogisticsExpenseBills[\s\S]*?\n}\n\nasync function approveLogisticsExpenseBillRowsInTransaction/,
  )?.[0] || "";
const approveLogisticsExpenseBillRowsSource =
  backend.match(
    /async function approveLogisticsExpenseBillRowsInTransaction[\s\S]*?\n}\n\nasync function updateLogisticsExpenseCostIds/,
  )?.[0] || "";
const updateLogisticsExpensePaymentStatusSource =
  backend.match(
    /export async function updateLogisticsExpensePaymentStatus[\s\S]*?\n}\n\n/,
  )?.[0] || "";
const logisticsCostRoute = readFileSync(
  "app/api/logistics-costs/[id]/route.ts",
  "utf8",
);
const logisticsInvoiceRoute = readFileSync(
  "app/api/logistics-costs/[id]/invoice/route.ts",
  "utf8",
);
const logisticsReviewRoute = readFileSync(
  "app/api/logistics-costs/review/route.ts",
  "utf8",
);
const notificationTemplateRoute = readFileSync(
  "app/api/settings/notification-templates/route.ts",
  "utf8",
);
const logisticsExpenseDeleteRoute = readFileSync(
  "app/api/logistics-expenses/[id]/route.ts",
  "utf8",
);
const logisticsExpenseBatchRoute = readFileSync(
  "app/api/logistics-expenses/batch-update/route.ts",
  "utf8",
);
const logisticsExpenseBatchSaveRoute = readFileSync(
  "app/api/logistics-expenses/batch-save/route.ts",
  "utf8",
);
const profitModule = readFileSync("app/modules/ProfitModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync(
  "app/modules/DomesticLogisticsModule.tsx",
  "utf8",
);
const settingsModuleMain = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const settingsModule = readSettingsModuleSource();
const notificationTemplateCardSource =
  settingsModule.match(
    /export function NotificationTemplateSettingsCard[\s\S]*?\n}\n/,
  )?.[0] || "";
const saveNotificationTemplateSource =
  settingsModuleMain.match(
    /async function saveNotificationTemplateSettings[\s\S]*?\n\n  return \(/,
  )?.[0] || "";
const notificationTemplateFormSource =
  settingsModule.match(
    /export function notificationTemplateFormFromSettings[\s\S]*?\n}\n/,
  )?.[0] || "";
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const reportsModule = readFileSync("app/modules/ReportsModule.tsx", "utf8");
const workspaceStyles = readWorkspaceStylesSource();
const logisticsExpenseQueries = readFileSync(
  "lib/platform/logistics-expense-queries.ts",
  "utf8",
);
const listLogisticsExpensesSource =
  logisticsExpenseQueries.match(
    /export async function listLogisticsExpenses[\s\S]*?\n}\n\nfunction logisticsExpenseBillListWhere/,
  )?.[0] || "";
const logisticsSupplierStatementSource =
  logisticsExpenseQueries.match(
    /export async function logisticsSupplierStatement[\s\S]*?\n}\n\nfunction logisticsPaymentLedgerRow/,
  )?.[0] || "";

test("logistics expenses are stored outside official costs until approved", () => {
  assert.match(schema, /model LogisticsExpense/);
  assert.match(schema, /auditStatus\s+String\s+@default\("草稿"\)/);
  assert.match(schema, /costId\s+String\?\s+@unique/);
  assert.match(
    schema,
    /appliedContainerCount\s+Int\?\s+@map\("applied_container_count"\)/,
  );
  assert.match(schema, /billingMethod\s+String\?\s+@map\("billing_method"\)/);
  assert.match(
    schema,
    /billingQuantity\s+Decimal\?\s+@map\("billing_quantity"\)/,
  );
  assert.match(
    schema,
    /invoiceNotifiedAt\s+DateTime\?\s+@map\("invoice_notified_at"\)/,
  );
  assert.match(
    schema,
    /invoiceNotificationError\s+String\?\s+@map\("invoice_notification_error"\)/,
  );
  assert.match(
    schema,
    /invoiceDocumentId\s+String\?\s+@map\("invoice_document_id"\)/,
  );
  assert.doesNotMatch(
    schema,
    /\binvoiceNo\b|\binvoiceDate\b|\binvoiceAmount\b|\binvoiceRemark\b|invoiceSellerName|invoiceBuyerName|invoiceRecognitionStatus|invoiceRecognitionMessage|invoiceRecognizedAt/,
  );
  assert.match(schema, /@@index\(\[invoiceDocumentId\]\)/);
  assert.match(
    schema,
    /model OrderCost[\s\S]*sourceType\s+String\s+@default\("MANUAL"\)/,
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "logistics_expenses"/);
  assert.match(
    containerCountMigration,
    /ADD COLUMN IF NOT EXISTS "applied_container_count" INTEGER/,
  );
  assert.match(
    invoiceNotificationMigration,
    /ADD COLUMN IF NOT EXISTS "invoice_notified_at"/,
  );
  assert.match(
    invoiceGroupMigration,
    /ADD COLUMN IF NOT EXISTS "invoice_notification_error"/,
  );
  assert.match(
    invoiceGroupMigration,
    /DROP INDEX IF EXISTS "logistics_expenses_invoice_document_id_key"/,
  );
  assert.match(
    invoiceGroupMigration,
    /logistics_expenses_invoice_document_id_idx/,
  );
  assert.match(
    removeInvoiceManualFieldsMigration,
    /DROP COLUMN IF EXISTS "invoice_no"/,
  );
  assert.match(
    removeInvoiceManualFieldsMigration,
    /DROP COLUMN IF EXISTS "invoice_recognition_status"/,
  );
  assert.equal(existsSync("lib/logistics-invoice-parser.ts"), false);
  assert.equal(
    existsSync(
      "prisma/migrations/20260623193000_logistics_invoice_recognition/migration.sql",
    ),
    false,
  );
});

test("approval generates official costs with source tracking", () => {
  assert.match(backend, /sourceType: "LOGISTICS_EXPENSE"/);
  assert.match(backend, /sourceId: expense\.id/);
  assert.match(backend, /costConfirmed: true/);
  assert.match(backend, /审核通过物流费用/);
  assert.match(backend, /reviewLogisticsExpenseBills/);
  assert.match(
    backend,
    /invoiceNotifiedAt: result\.sent \? now : row\.invoiceNotifiedAt/,
  );
  assert.match(
    costsModule,
    /label="来源" value=\{cost\.sourceLabel \|\| "人工录入"\}/,
  );
});

test("manual logistics costs are blocked from ordinary cost entry", () => {
  assert.match(backend, /LOGISTICS_COST_REQUIRES_EXPENSE_WORKFLOW/);
  assert.match(
    backend,
    /该类费用请从物流费用录入模块提交，审核通过后自动进入成本。/,
  );
});

test("duplicate official logistics cost generation is blocked by order and cost type", () => {
  assert.match(backend, /LOGISTICS_EXPENSE_DUPLICATE_COST/);
  assert.match(backend, /同一订单同一物流费用类型已存在正式成本/);
  assert.match(migration, /order_costs_source_unique/);
});

test("supplier role is renamed and scoped to assigned logistics work", () => {
  assert.match(backend, /export const LOGISTICS_OPERATOR_ROLE = "物流供应商"/);
  assert.match(migration, /WHERE "role" = '物流资料录入员'/);
  assert.match(
    backend,
    /logisticsSuppliers: \{ some: \{ supplierId: actor\.supplierId \} \}/,
  );
  assert.match(
    logisticsModule,
    /const isLogisticsSupplier = currentUserRole === "物流供应商"/,
  );
});

test("logistics supplier users must bind to one supplier account", () => {
  assert.match(
    schema,
    /model User[\s\S]*supplierId\s+String\?\s+@map\("supplier_id"\)/,
  );
  assert.match(backend, /SUPPLIER_ID_MISSING/);
  assert.match(backend, /SUPPLIER_TYPE_MISMATCH/);
  assert.match(backend, /ROLE_UPDATE_FAILED/);
  assert.match(backend, /DOMESTIC_LOGISTICS_SUPPLIER_TYPES = \[[\s\S]*LOGISTICS_SUPPLIER_TYPE_CODE/);
  assert.match(backend, /PRODUCT_SUPPLIER_TYPES = \[[\s\S]*PRODUCT_SUPPLIER_TYPE_CODE/);
  assert.match(backend, /supplierId: null/);
  assert.match(backend, /当前角色只能绑定物流供应商/);
  assert.match(backend, /当前角色只能绑定产品供应商/);
  assert.doesNotMatch(backend, /产品供应商绑定的供应商必须先开启资料回传权限。/);
  assert.match(settingsModule, /SUPPLIER_ACCOUNT_ROLES/);
  assert.match(settingsModule, /绑定供应商/);
});

test("supplier account data scope is supplier-based, not user-created fallback", () => {
  assert.match(
    backend,
    /if \(actor\.supplierId\) return \{ supplierId: actor\.supplierId \};/,
  );
  assert.match(
    backend,
    /order: \{ is: \{ logisticsSuppliers: \{ some: \{ supplierId: actor\.supplierId \} \} \} \}/,
  );
  assert.match(
    backend,
    /if \(!actor\.supplierId \|\| actor\.supplierId !== expense\.supplierId\) return false;/,
  );
});

test("supplier settings include logistics expense and invoice permissions", () => {
  assert.match(schema, /allowLogisticsExpenseEntry Boolean @default\(false\)/);
  assert.match(schema, /allowedLogisticsCostTypes Json\?/);
  assert.match(settingsModule, /label="允许物流费用录入"/);
  assert.match(settingsModule, /label="允许物流发票上传"/);
  assert.match(settingsModule, /允许录入的物流费用类型/);
  assert.match(settingsModule, /<strong>物流供应商权限<\/strong>/);
  assert.match(settingsModule, /<strong>产品供应商权限<\/strong>/);
  assert.match(
    supplierMasters,
    /const isLogisticsSupplierType = DOMESTIC_LOGISTICS_SUPPLIER_TYPES\.includes\(supplierType\)/,
  );
  assert.match(
    supplierMasters,
    /if \(isLogisticsSupplierType && allowLogisticsExpenseEntry && !allowedLogisticsCostTypes\.length\)/,
  );
  assert.doesNotMatch(
    supplierMasters,
    /allowFactoryDocumentUpload && supplierType !== "工厂供应商"/,
  );
});

test("invoice upload and confirmation workflow is present", () => {
  assert.match(backend, /uploadLogisticsExpenseInvoice/);
  assert.match(backend, /confirmLogisticsExpenseInvoice/);
  assert.match(backend, /readValidatedInvoiceUploadFile/);
  assert.doesNotMatch(
    backend,
    /LOGISTICS_INVOICE_AMOUNT_EXCEEDS_APPROVED|LOGISTICS_INVOICE_FORCE_REASON_REQUIRED/,
  );
  assert.match(logisticsModule, /invoiceStatus/);
  assert.match(logisticsModule, /已上传发票/);
  assert.match(logisticsModule, /已确认发票/);
});

test("port charge logistics invoice filenames do not fall back to factory invoice", () => {
  assert.match(backend, /港杂费: "Port-Charges-Invoice"/);
  assert.match(backend, /LOGISTICS_INVOICE_ENGLISH_LABELS\[costType\]/);
  assert.match(
    backend,
    /costType: document\.cost\?\.costType \|\| document\.costType/,
  );
  assert.match(
    backend,
    /const logisticsCostType = normalizedCostType\(expense\.cost\?\.costType \|\| expense\.costType\)/,
  );
  assert.match(backend, /costType: logisticsCostType/);
  assert.match(backend, /cost: document\.cost \|\| cost/);
  assert.match(
    backend,
    /costType: document\.cost\?\.costType \|\| cost\.costType/,
  );
});

test("logistics cost type dictionary includes document ENS advance and drop-off fees in business order", () => {
  assert.match(
    backend,
    /value: "拖车费"[\s\S]*value: "报关费"[\s\S]*value: "港杂费"[\s\S]*value: "打单费"[\s\S]*value: "ENS", label: "ENS费"[\s\S]*value: "进港费"[\s\S]*value: "提箱费"[\s\S]*value: "落箱费"[\s\S]*value: "预提费"[\s\S]*value: "查验费"[\s\S]*value: "超重费"[\s\S]*value: "海运费"[\s\S]*value: "保险费"[\s\S]*value: "其他物流费用"/,
  );
  assert.match(
    backend,
    /LOGISTICS_COST_TYPES = LOGISTICS_COST_TYPE_OPTIONS\.map/,
  );
  assert.match(
    backend,
    /LOGISTICS_USD_COST_TYPES = \["海运费", "ENS", "保险费"\]/,
  );
  assert.match(backend, /ENS费: "ENS"/);
  assert.match(backend, /打单费: "Document Processing Fee"/);
  assert.match(backend, /ENS: "ENS Fee"/);
  assert.match(backend, /预提费: "Advance Charge"/);
  assert.match(backend, /落箱费: "Container Drop-off Fee"/);
  assert.match(backend, /打单费: "Document-Processing-Fee-Invoice"/);
  assert.match(backend, /ENS: "ENS-Fee-Invoice"/);
  assert.match(backend, /预提费: "Advance-Charge-Invoice"/);
  assert.match(backend, /落箱费: "Container-Drop-off-Fee-Invoice"/);
  assert.match(
    logisticsModule,
    /export const COST_TYPES = \[\.\.\.LOGISTICS_COST_TYPES\]/,
  );
  assert.match(logisticsModule, /COST_TYPE_OPTIONS\.map/);
  assert.match(
    logisticsModule,
    /logisticsCostTypeLocksCurrency\(item\.costType\)/,
  );
  assert.match(
    logisticsModule,
    /apiJson<ExchangeRateResponse>\(\s*`\/api\/exchange-rates\?\$\{new URLSearchParams\(\{ currency: normalized \}\)\}`,\s*\)/,
  );
  assert.match(settingsModule, /LOGISTICS_COST_TYPE_OPTIONS/);
  assert.match(
    costsModule,
    /COST_FILTER_TYPES = \[\.\.\.QUICK_COST_TYPES, \.\.\.LOGISTICS_COST_TYPES\]/,
  );
  assert.match(costsModule, /logisticsCostTypeLabel\(cost\.costType \|\| ""\)/);
  assert.match(reportsModule, /\.\.\.LOGISTICS_COST_TYPES/);
  assert.match(reportsModule, /LOGISTICS_COST_TYPE_OPTIONS/);
});

test("logistics expense entry prevents Enter-triggered submit and row creation", () => {
  assert.match(
    logisticsModule,
    /onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*\}\}/,
  );
  assert.doesNotMatch(logisticsModule, /type="submit"/);
  assert.match(
    logisticsModule,
    /className=\{styles\.logisticsDetailTableWrap\}[\s\S]*?onKeyDown=\{preventEnterFormSubmit\}/,
  );
  assert.match(
    logisticsModule,
    /onKeyDown=\{preventEnterFormSubmit\}[\s\S]*?onClick=\{\(\) => addExpenseItem\(false\)\}/,
  );
  assert.match(
    logisticsModule,
    /onKeyDown=\{preventEnterFormSubmit\}[\s\S]*?onClick=\{\(\) => addExpenseItem\(true\)\}/,
  );
  assert.match(invoiceUploadFormSource, /onKeyDown=\{preventEnterFormSubmit\}/);
});

test("logistics invoice upload starts on file selection and shows upload progress", () => {
  assert.match(invoiceUploadFormSource, /onChange=\{handleFileChange\}/);
  assert.match(invoiceUploadFormSource, /uploadInvoice\(selectedFile\)/);
  assert.match(invoiceUploadFormSource, /uploadFormDataWithProgress/);
  assert.match(invoiceUploadFormSource, /validatePdfUploadFile/);
  assert.match(invoiceUploadFormSource, /上传中 \$\{nextProgress\}%/);
  assert.match(invoiceUploadFormSource, /styles\.invoiceUploadProgressBar/);
  assert.match(invoiceUploadFormSource, /accept=\{PDF_UPLOAD_ACCEPT\}/);
  assert.match(
    invoiceUploadFormSource,
    /仅支持 PDF，最大 \{PDF_UPLOAD_MAX_SIZE_LABEL\}。选择文件后自动上传。/,
  );
  assert.doesNotMatch(invoiceUploadFormSource, /JPG|PNG|20MB/);
  assert.doesNotMatch(invoiceUploadFormSource, /apiJson|fetch\(/);
  assert.doesNotMatch(invoiceUploadFormSource, />上传发票</);
  assert.match(
    workspaceStyles,
    /\.invoiceUploadStatus\[data-status="uploading"\]/,
  );
  assert.match(workspaceStyles, /\.invoiceUploadProgressBar span/);
});

test("logistics expense entry grid keeps compact fixed columns", () => {
  assert.match(
    workspaceStyles,
    /\.logisticsItemsTable \{[\s\S]*overflow-x: auto;[\s\S]*table-layout: fixed;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsHead,\n\.logisticsItemsRow \{[\s\S]*grid-template-columns: 140px 90px 120px 80px 90px 120px 160px 80px;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsRow input,\n\.logisticsItemsRow select \{[\s\S]*height: 32px;[\s\S]*max-width: 100%;[\s\S]*box-sizing: border-box;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsRow > select:nth-of-type\(2\) \{[\s\S]*width: 72px;[\s\S]*min-width: 72px;[\s\S]*max-width: 72px;[\s\S]*padding-right: 22px;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsRow > :nth-child\(2\) \{[\s\S]*width: 80px;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsRow > :nth-child\(3\) \{[\s\S]*width: 110px;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsRow > :nth-child\(5\) \{[\s\S]*width: 80px;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsRow > strong:nth-child\(6\) \{[\s\S]*width: 110px;[\s\S]*text-overflow: ellipsis;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsRow > :nth-child\(8\) \{[\s\S]*width: 80px;/,
  );
});

test("logistics expense entry add buttons sit below the expense input rows", () => {
  const headerSource =
    logisticsExpenseFormSource.match(
      /<div className=\{styles\.logisticsItemsHeader\}>[\s\S]*?<\/div>\n        <div className=\{styles\.logisticsItemsTable\}>/,
    )?.[0] || "";
  assert.doesNotMatch(headerSource, /添加费用|复制上一行|headerActions/);
  assert.match(
    logisticsExpenseFormSource,
    /className=\{styles\.logisticsItemsInlineActions\}/,
  );
  assert.ok(
    logisticsExpenseFormSource.indexOf(
      "className={styles.logisticsItemsInlineActions}",
    ) >
      logisticsExpenseFormSource.indexOf(
        "className={styles.logisticsItemsRow}",
      ),
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsInlineActions \{[\s\S]*justify-content: flex-start;[\s\S]*padding: 2px 8px 0;/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsItemsInlineActions \{[\s\S]*min-width: 936px;/,
  );
});

test("approval sends invoice notification and preserves failure for audit", () => {
  assert.match(backend, /notifyLogisticsSupplierInvoice/);
  assert.match(backend, /notifyLogisticsSupplierInvoiceBills/);
  assert.match(backend, /renderLogisticsInvoiceNotificationEmail/);
  assert.match(backend, /getLogisticsInvoiceNotificationSettings/);
  assert.match(backend, /autoSendOnApproval/);
  assert.match(backend, /recipientEmailFields/);
  assert.match(backend, /ccAdminEmails/);
  assert.match(backend, /ccEmails/);
  assert.match(backend, /skipped/);
  assert.match(backend, /resolveLogisticsSupplierInvoiceRecipients/);
  assert.match(backend, /resolveLogisticsSupplierInvoiceEmail/);
  assert.match(backend, /logisticsInvoiceNotificationAdminEmails/);
  assert.match(backend, /logisticsInvoiceNotificationCcEmails/);
  assert.match(backend, /supplier\.operatorUsers\.email/);
  assert.match(backend, /supplier\.contactEmail/);
  assert.match(backend, /supplier\.financeEmail/);
  assert.match(backend, /物流供应商未配置有效邮箱，已检查/);
  assert.match(backend, /物流费用已审核通过，请开票并上传发票/);
  assert.match(backend, /recipientEmails: resolved\.emails/);
  assert.match(backend, /role: "管理员"/);
  assert.match(backend, /applyLogisticsExpenseInvoiceNotificationResults/);
  assert.match(backend, /物流费用开票通知失败/);
  assert.match(backend, /invoiceStatus: nextInvoiceStatus/);
  assert.match(
    backend,
    /invoiceNotificationError: result\.sent \|\| result\.skipped \? null/,
  );
  assert.match(backend, /通知失败/);
});

test("settings include configurable logistics invoice notification template", () => {
  assert.match(
    backend,
    /LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY = "logistics_invoice_notification_template"/,
  );
  assert.match(backend, /DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS/);
  assert.match(
    backend,
    /export async function readLogisticsInvoiceNotificationSettings/,
  );
  assert.match(
    backend,
    /export async function saveLogisticsInvoiceNotificationSettings/,
  );
  assert.match(backend, /applyTemplate\(settings\.bodyTemplate/);
  assert.match(
    notificationTemplateRoute,
    /readLogisticsInvoiceNotificationSettings\(actor\)/,
  );
  assert.match(
    notificationTemplateRoute,
    /saveLogisticsInvoiceNotificationSettings\(request, actor, body\)/,
  );
  assert.match(
    settingsModule,
    /type SettingsTabKey = "companyProfile"[\s\S]*"notificationTemplates"/,
  );
  assert.match(settingsModule, /label: "通知模板"/);
  assert.match(settingsModule, /\/api\/settings\/notification-templates/);
  assert.match(settingsModule, /NotificationTemplateSettingsCard/);
  assert.match(settingsModule, /物流费用开票通知模板/);
  assert.match(settingsModule, /物流公司收件邮箱来源/);
  assert.match(settingsModule, /默认抄送管理员/);
  assert.match(settingsModule, /额外抄送邮箱/);
  assert.match(settingsModule, /recipientEmailFields/);
  assert.match(settingsModule, /ccAdminEmails/);
  assert.match(settingsModule, /ccEmails/);
  assert.match(settingsModule, /保存通知模板/);
  assert.match(settingsModule, /可用变量/);
  assert.match(settingsModule, /模板预览/);
  assert.match(settingsModule, /审核通过后自动发送/);
});

test("notification template editor keeps formal fields editable and persists current state", () => {
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.invoiceRequirements\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("invoiceRequirements", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.bodyTemplate\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("bodyTemplate", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.ccEmails\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("ccEmails", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.uploadUrl\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("uploadUrl", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.singleSubjectTemplate\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("singleSubjectTemplate", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.batchSubjectTemplate\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("batchSubjectTemplate", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.signature\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("signature", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /<textarea readOnly value=\{preview\}/,
  );
  assert.doesNotMatch(
    notificationTemplateCardSource,
    /value=\{currentForm\.(invoiceRequirements|bodyTemplate|ccEmails|uploadUrl|singleSubjectTemplate|batchSubjectTemplate|signature)\}[\s\S]{0,120}(readOnly|disabled)/,
  );
  assert.match(
    saveNotificationTemplateSource,
    /const payload = \{ \.\.\.notificationTemplateForm \}/,
  );
  assert.match(saveNotificationTemplateSource, /method: "PATCH"/);
  assert.match(
    saveNotificationTemplateSource,
    /body: JSON\.stringify\(payload\)/,
  );
  assert.match(
    saveNotificationTemplateSource,
    /const nextSettings = await fetchNotificationTemplateSettings\(\)/,
  );
  assert.match(
    notificationTemplateFormSource,
    /templateStringSetting\(settings, "bodyTemplate"/,
  );
  assert.match(
    notificationTemplateFormSource,
    /templateStringSetting\(settings, "invoiceRequirements"/,
  );
  assert.match(
    backend,
    /if \(value === undefined \|\| value === null\) return fallback/,
  );
  assert.doesNotMatch(backend, /return text \|\| fallback/);
  assert.match(backend, /prisma\.systemSetting\.upsert/);
});

test("logistics information page exposes per-order expense entry actions", () => {
  assert.match(logisticsModule, /title = "物流费用录入"/);
  assert.match(logisticsModule, /<h2>\{title\}<\/h2>/);
  assert.match(logisticsModule, /新增物流费用/);
  assert.match(logisticsModule, /导出对账单/);
  assert.match(domesticLogisticsModule, /录入费用/);
  assert.match(domesticLogisticsModule, /onOpenLogisticsFees/);
  assert.doesNotMatch(domesticLogisticsModule, /<LogisticsFeesModule/);
});

test("logistics fee entry is exposed through the standalone logistics fees menu", () => {
  assert.doesNotMatch(
    menuFile,
    /\{ key: "logisticsReview", label: "物流费用审核"/,
  );
  assert.doesNotMatch(menuFile, /logisticsReview", "taxRefund"/);
  assert.match(menuFile, /\{ key: "domesticLogistics", label: "物流信息"/);
  assert.match(menuFile, /\{ key: "logisticsFees", label: "物流费用"/);
  assert.doesNotMatch(domesticLogisticsModule, /<LogisticsFeesModule/);
  assert.match(workspaceShell, /normalizeWorkspaceMenuKey\(menuKey: string\)/);
  assert.match(
    workspaceShell,
    /menuKey === "logisticsReview" \? "logisticsFees" : menuKey/,
  );
  assert.match(
    workspaceShell,
    /activeMenu === "logisticsFees"[\s\S]*<LogisticsFeesModule/,
  );
  assert.match(workspaceShell, /title="物流费用"/);
  assert.doesNotMatch(workspaceShell, /title="物流费用审核"/);
  assert.doesNotMatch(workspaceShell, /hideCreateAction/);
  assert.match(logisticsModule, /initialStatus = ""/);
  assert.match(logisticsModule, /useState\(initialStatus\)/);
});

test("logistics expense supplier picker only keeps logistics-capable suppliers", () => {
  assert.match(logisticsModule, /const LOGISTICS_FEE_SUPPLIER_TYPES = \[/);
  assert.match(
    logisticsModule,
    /return suppliers\.filter\(\(supplier\) =>[\s\S]*?LOGISTICS_FEE_SUPPLIER_TYPES\.includes\(supplier\.supplierType \|\| ""\)[\s\S]*?\);/,
  );
  assert.doesNotMatch(logisticsModule, /工厂供应商/);
});

test("logistics supplier login locks supplier field to current supplier", () => {
  assert.match(
    logisticsModule,
    /supplierId: isLockedSupplier\s*\?\s*currentUserSupplierId/,
  );
  assert.match(
    logisticsModule,
    /setForm\(\(current\) => \(\{[\s\S]*?\.\.\.current,[\s\S]*?supplierId: currentUserSupplierId[\s\S]*?\}\)\);/,
  );
  assert.match(
    logisticsModule,
    /supplierId: isLockedSupplier\s*\?\s*undefined\s*:\s*form\.supplierId \|\| undefined/,
  );
  assert.match(logisticsModule, /!isLockedSupplier \? \(/);
});

test("logistics expense list groups rows by shipment and keeps item details", () => {
  assert.match(backend, /groupLogisticsExpensesByShipment/);
  assert.match(backend, /serializeLogisticsExpenseShipment/);
  assert.doesNotMatch(backend, /filters\.view === "items"/);
  assert.match(backend, /shipmentNo/);
  assert.match(backend, /totalCNY/);
  assert.match(backend, /totalUSD/);
  assert.match(backend, /shipmentBillIds/);
  assert.match(backend, /serializeLogisticsExpenseBill/);
  assert.match(backend, /aggregateLogisticsExpenseStatus/);
  assert.match(backend, /LOGISTICS_EXPENSE_BILL_SORT_PRIORITY/);
  assert.match(
    backend,
    /草稿: 10[\s\S]*已驳回: 20[\s\S]*待审核: 30[\s\S]*待开票: 40[\s\S]*部分上传发票: 50[\s\S]*已上传发票: 60[\s\S]*待付款: 70[\s\S]*部分付款: 80[\s\S]*已付款: 90[\s\S]*审核通过: 100/,
  );
  assert.match(backend, /\.sort\(compareLogisticsExpenseBillsForDisplay\)/);
  assert.match(
    backend,
    /logisticsExpenseBillSortRank\(left\) - logisticsExpenseBillSortRank\(right\)/,
  );
  assert.match(
    backend,
    /logisticsExpenseBillUpdatedAtValue\(right\) - logisticsExpenseBillUpdatedAtValue\(left\)/,
  );
  assert.match(logisticsModule, /LOGISTICS_EXPENSE_BILL_SORT_PRIORITY/);
  assert.match(logisticsModule, /sortLogisticsExpenseBillsForDisplay/);
  assert.match(
    logisticsModule,
    /const nextRows = sortLogisticsExpenseBillsForDisplay/,
  );
  assert.match(logisticsModule, /setRows\(nextRows\)/);
  assert.match(logisticsModule, /logisticsExpenseShipmentBillIds/);
  assert.match(logisticsModule, /logisticsExpenseSelectionSelected/);
  assert.match(
    logisticsModule,
    /logisticsExpenseBillSortRank\(left\) -\s*logisticsExpenseBillSortRank\(right\)/,
  );
  assert.match(backend, /domesticLogisticsInfos[\s\S]*transportItems/);
  assert.match(backend, /function resolveLogisticsExpenseVesselVoyage/);
  assert.match(
    backend,
    /vesselVoyage: resolveLogisticsExpenseVesselVoyage\(order\)/,
  );
  assert.match(
    logisticsModule,
    /items = expense\.items\?\.length \? expense\.items : \[expense\]/,
  );
  assert.match(logisticsModule, /className=\{styles\.amountColumn\}>CNY 合计/);
  assert.match(logisticsModule, /className=\{styles\.amountColumn\}>USD 合计/);
  assert.match(logisticsModule, /logisticsExpenseContainerSummary/);
  assert.match(
    logisticsModule,
    /<DetailField[\s\S]*?label="船名航次"[\s\S]*?value=\{expense\.order\?\.vesselVoyage \|\| expense\.vesselVoyage \|\| "-"\}/,
  );
  assert.doesNotMatch(logisticsModule, /LogisticsBillContainerInfo/);
  assert.doesNotMatch(logisticsModule, /柜号：/);
  assert.doesNotMatch(logisticsModule, /装货港：/);
  assert.doesNotMatch(logisticsModule, /柜型汇总：/);
  assert.doesNotMatch(logisticsModule, /柜号列表：/);
  assert.match(logisticsModule, /费用明细/);
  assert.match(logisticsModule, /LogisticsExpenseDetailsTable/);
  assert.match(logisticsModule, /logisticsDetailTable/);
  assert.match(logisticsModule, /成本同步/);
  assert.match(logisticsModule, /<th>操作<\/th>/);
  assert.doesNotMatch(logisticsModule, /<th>供应商<\/th>/);
});

test("logistics expense list reads avoid transactions for count and pagination", () => {
  assert.match(listLogisticsExpensesSource, /prisma\.logisticsBill\.count/);
  assert.match(listLogisticsExpensesSource, /prisma\.logisticsBill\.findMany/);
  assert.doesNotMatch(listLogisticsExpensesSource, /prisma\.\$transaction/);
});

test("logistics expense approval works at bill level and groups invoice emails by supplier", () => {
  assert.match(logisticsReviewRoute, /export async function PATCH/);
  assert.match(
    logisticsReviewRoute,
    /reviewLogisticsExpenseBills\(request, actor, body\)/,
  );
  assert.match(logisticsReviewRoute, /开票通知已按供应商合并发送/);
  assert.match(backend, /export async function reviewLogisticsExpenseBills/);
  assert.match(backend, /normalizeLogisticsExpenseReviewIdentifiers/);
  assert.match(backend, /loadLogisticsExpenseBillRowsForAction/);
  assert.match(backend, /notifyLogisticsSupplierInvoiceBills\(approvedRows\)/);
  assert.match(
    backend,
    /applyLogisticsExpenseInvoiceNotificationResults\(approvedRows, emailResults, actor, now\)/,
  );
  assert.match(backend, /const bySupplier = new Map/);
  assert.match(backend, /group\.bills\.push\(bill\)/);
  assert.match(
    backend,
    /sendShippingDocumentsEmail\(\{[\s\S]*recipientEmails: resolved\.emails/,
  );
  assert.match(backend, /sendShippingDocumentsEmail\(\{[\s\S]*ccEmails/);
  assert.match(backend, /待开票费用清单/);
  assert.match(backend, /订单号：/);
  assert.match(backend, /提单号：/);
  assert.match(backend, /柜型\/柜量：/);
  assert.match(backend, /客户简称：/);
  assert.match(backend, /费用合计：/);
  assert.match(backend, /人民币实际费用合计：/);
  assert.match(backend, /\$\{item\.currency\} 外币费用合计：/);
  assert.match(settingsModule, /USD 外币费用合计：/);
  assert.match(backend, /折人民币总合计：/);
  assert.match(backend, /费用明细：/);
  assert.match(backend, /请分别上传：/);
  assert.match(backend, /formatInvoiceGroupAmount/);
  assert.match(backend, /formatInvoiceGroupAmount\(group\)/);
  assert.match(backend, /`\$\{label\}：\$\{amount\}`/);
  assert.match(settingsModule, /港杂费发票：CNY ¥800\.00/);
  assert.match(settingsModule, /拖车及其他费用合并发票：CNY ¥2,650\.00/);
  assert.doesNotMatch(backend, /备注：\$\{variables\.remark\}/);
  assert.doesNotMatch(settingsModule, /"   备注：2650\*1"/);
  assert.match(backend, /报关费、港杂费必须分别开票上传。/);
  assert.match(
    backend,
    /海运费、ENS费、保险费及所有 USD 费用统一归入“海运费发票”上传。/,
  );
  assert.match(
    backend,
    /其他 CNY 物流费用可合并为“拖车及其他费用合并发票”上传。/,
  );
  assert.match(backend, /发票上传入口/);
  assert.match(backend, /invoiceStatus: nextInvoiceStatus/);
  assert.match(backend, /paymentStatus: "待付款"/);
  assert.match(backend, /reviewedById: actor\.id/);
  assert.match(backend, /reviewedAt: now/);
  assert.match(
    backend,
    /invoiceNotifiedAt: result\.sent \? now : row\.invoiceNotifiedAt/,
  );
  assert.match(
    backend,
    /LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS = \{ timeout: 15000, maxWait: 10000 \}/,
  );
  assert.match(backend, /approveLogisticsExpenseBillRowsInTransaction/);
  assert.match(schema, /model LogisticsBill/);
  assert.match(schema, /billId\s+String\?\s+@map\("bill_id"\)/);
  assert.match(
    logisticsBillMigration,
    /CREATE TABLE IF NOT EXISTS "logistics_bills"/,
  );
  assert.match(
    logisticsBillMigration,
    /UPDATE "logistics_expenses" le[\s\S]*SET "bill_id" = lb\."id"/,
  );
  assert.match(
    logisticsBillConvergenceMigration,
    /LogisticsBill is the only workflow-state source/,
  );
  assert.match(logisticsBillConvergenceMigration, /le\."bill_id" IS NULL/);
  assert.doesNotMatch(logisticsBillConvergenceMigration, /SET "audit_status"/);
  assert.match(
    approveLogisticsExpenseBillRowsSource,
    /tx\.logisticsBill\.update/,
  );
  assert.doesNotMatch(
    approveLogisticsExpenseBillRowsSource,
    /tx\.logisticsExpense\.updateMany\(\{[\s\S]*auditStatus: "审核通过"/,
  );
  assert.match(
    approveLogisticsExpenseBillRowsSource,
    /createOrUpdateCostFromLogisticsExpense\(prisma, before, actor\)/,
  );
  assert.match(
    approveLogisticsExpenseBillRowsSource,
    /updateLogisticsExpenseCostIds\(prisma, costLinks\)/,
  );
  assert.match(
    backend,
    /prisma\.logisticsBill\.updateMany\(\{[\s\S]*auditStatus: "审核通过"/,
  );
  assert.doesNotMatch(
    backend,
    /prisma\.logisticsExpense\.updateMany\(\{[\s\S]*auditStatus: "审核通过"/,
  );
  assert.match(backend, /UPDATE "logistics_expenses"[\s\S]*CASE "id"/);
  assert.match(
    reviewLogisticsExpenseBillsSource,
    /await approveLogisticsExpenseBillRowsInTransaction\(bill\.rows, actor, reviewRemark, now\)/,
  );
  assert.match(
    reviewLogisticsExpenseBillsSource,
    /const savedRows = await loadLogisticsExpenseBillRowsForAction\(bill\.billId, actor\)/,
  );
  assert.doesNotMatch(
    reviewLogisticsExpenseBillsSource,
    /notifyLogisticsSupplierInvoiceBills[\s\S]*prisma\.\$transaction/,
  );
  assert.doesNotMatch(
    approveLogisticsExpenseBillRowsSource,
    /tx\.logisticsExpense\.update\(/,
  );
  assert.doesNotMatch(
    approveLogisticsExpenseBillRowsSource,
    /include: includeLogisticsExpenseRelations/,
  );
  assert.match(logisticsReviewRoute, /maskLogisticsReviewTimeoutError/);
  assert.match(logisticsReviewRoute, /审核失败：系统处理超时，请稍后重试。/);
  assert.match(logisticsCostRoute, /maskLogisticsReviewTimeoutError/);
  assert.match(logisticsCostRoute, /审核失败：系统处理超时，请稍后重试。/);
  assert.match(backend, /logisticsExpenseBillAuditStatus/);
  assert.match(
    backendAggregateStatusSource,
    /if \(field === "auditStatus"\) return logisticsExpenseBillAuditStatus\(rows\)/,
  );
  assert.doesNotMatch(
    backendAggregateStatusSource,
    /部分草稿|部分待审核|部分驳回|部分审核通过/,
  );
  assert.match(
    frontendAggregateStatusSource,
    /if \(field === "auditStatus"\)[\s\S]*?return logisticsExpenseBillAuditStatus\(items\)/,
  );
  assert.doesNotMatch(
    frontendAggregateStatusSource,
    /部分草稿|部分待审核|部分驳回|部分审核通过/,
  );
  assert.doesNotMatch(
    backend,
    /for \(const bill[\s\S]*notifyLogisticsSupplierInvoice\(bill/,
  );
});

test("logistics invoice upload is grouped by required invoice categories", () => {
  assert.match(backend, /LOGISTICS_INVOICE_GROUPS/);
  assert.match(backend, /报关费发票/);
  assert.match(backend, /港杂费发票/);
  assert.match(backend, /海运费发票/);
  assert.match(backend, /拖车及其他费用合并发票/);
  assert.match(backend, /OCEAN_FREIGHT_INVOICE_GROUP_KEY/);
  assert.match(
    backend,
    /TRUCKING_OTHER_USD_BLOCK_MESSAGE = "USD 不允许出现在拖车及其他费用合并发票"/,
  );
  assert.match(backend, /logisticsInvoiceGroupForExpense/);
  assert.match(backend, /logisticsInvoiceGroupsForExpenses/);
  assert.match(
    backend,
    /normalizedInvoiceCurrency\(expense\.currency\) === "USD"/,
  );
  assert.match(backend, /aggregateLogisticsExpenseInvoiceStatus/);
  assert.match(
    backend,
    /logisticsInvoiceGroupForKey\(formData\.get\("invoiceGroup"\)/,
  );
  assert.match(
    backend,
    /const targetRows = rows\.filter\(\(row\) => logisticsInvoiceExpenseMatchesGroup\(row, invoiceGroup\)\)/,
  );
  assert.match(backend, /includedFeeTypes/);
  assert.match(
    logisticsModule,
    /logisticsInvoiceGroupForExpense\(item\)\?\.key === group\.key/,
  );
  assert.match(
    logisticsInvoiceUsdGroupingMigration,
    /logistics_invoice_notification_template/,
  );
  assert.match(
    logisticsInvoiceUsdGroupingMigration,
    /所有 USD 费用统一归入“海运费发票”/,
  );
  assert.match(
    logisticsInvoiceUsdGroupingMigration,
    /LIKE '%ENS费%拖车及其他费用合并发票%'/,
  );
  assert.match(backend, /invoiceDocumentId: document\.id/);
  assert.match(backend, /invoiceStatus: "已上传"/);
  assert.doesNotMatch(backend, /paymentStatus: "已开票"/);
  assert.doesNotMatch(
    backend,
    /recognizeLogisticsInvoicePdfBuffer|invoiceRecognition|invoiceSellerName|invoiceBuyerName|invoiceRecognizedAt/,
  );
  assert.match(logisticsModule, /LogisticsInvoiceGroupsPanel/);
  assert.match(logisticsModule, /按费用类型分组上传，同一分组上传一次即可。/);
  assert.match(logisticsModule, /已上传文件列表/);
  assert.match(logisticsModule, /PdfPreviewButton/);
  assert.match(logisticsInvoiceRoute, /export async function DELETE/);
  assert.match(backend, /export async function deleteLogisticsExpenseInvoice/);
  assert.match(backend, /invoiceDocumentId: null/);
  assert.match(logisticsModule, /body\.set\("invoiceGroup", group\.key\)/);
  assert.match(invoiceUploadFormSource, /type="file"/);
  assert.match(invoiceUploadFormSource, /选择文件后自动上传/);
  assert.doesNotMatch(
    invoiceUploadFormSource,
    /body\.set\("invoiceNo"|body\.set\("invoiceDate"|body\.set\("invoiceAmount"|body\.set\("remark"/,
  );
  assert.doesNotMatch(
    logisticsModule,
    /发票号：|开票日期：|识别金额：|销售方：|购买方：|自动识别中|识别成功|识别失败/,
  );
  assert.doesNotMatch(
    backend,
    /requireText\(formData\.get\("invoiceNo"\)|requirePositive\(formData\.get\("invoiceAmount"\)|请选择开票日期/,
  );
  assert.match(logisticsModule, /onInvoiceUploaded=\{\(result\) =>/);
  assert.match(
    logisticsModule,
    /applyLogisticsExpenseMutationResult\(result\)/,
  );
  assert.match(workspaceStyles, /\.logisticsInvoiceGroupsPanel/);
  assert.match(workspaceStyles, /\.logisticsInvoiceGroupCard/);
  assert.doesNotMatch(
    logisticsModule,
    /compactInvoiceUpload[\s\S]*InvoiceUploadForm/,
  );
});

test("withdraw and invoice notification mutations keep current logistics bill expanded locally", () => {
  assert.match(logisticsCostRoute, /withdrawLogisticsExpenseBill/);
  assert.match(logisticsCostRoute, /resendLogisticsExpenseInvoiceNotice/);
  assert.match(logisticsCostRoute, /message: "物流费用账单已撤回为草稿"/);
  assert.match(logisticsCostRoute, /\(body\.action \|\| ""\) === "withdraw"/);
  assert.match(
    backend,
    /const billAuditStatus = aggregateLogisticsExpenseStatus\(rows, "auditStatus"\)/,
  );
  assert.doesNotMatch(
    backend.match(
      /export async function withdrawLogisticsExpenseBill[\s\S]*?\nexport async function submitLogisticsExpenseBill/,
    )?.[0] || "",
    /rows\.find\(\(row\) => row\.auditStatus !== "待审核"\)/,
  );
  assert.match(backend, /\[logistics-expense\.withdraw\]/);
  assert.match(
    withdrawExpenseSource,
    /applyLogisticsExpenseMutationResult\(result\)/,
  );
  assert.match(withdrawExpenseSource, /action: "withdraw"/);
  assert.match(withdrawExpenseSource, /确认撤回该物流费用账单/);
  assert.match(withdrawExpenseSource, /账单下所有费用明细将同步回草稿/);
  assert.doesNotMatch(withdrawExpenseSource, /loadExpenses\(/);
  assert.doesNotMatch(withdrawExpenseSource, /setExpandedId\(""\)/);
  assert.match(logisticsModule, /renderBillWithdrawControls/);
  assert.match(logisticsModule, /撤回账单/);
  assert.match(logisticsModule, /async function resendInvoiceNotice/);
  assert.match(logisticsModule, /action: "resendInvoiceNotice"/);
  assert.match(logisticsModule, /重新发送开票通知/);
  assert.match(logisticsModule, /reconcileLogisticsExpenseMutationRows/);
  assert.match(logisticsModule, /replaceLogisticsExpenseBillsInRows/);
  assert.match(workspaceStyles, /\.logisticsBillInvoiceNoticeError/);
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
  assert.match(
    logisticsModule,
    /<UiCheckbox[\s\S]*variant="table"[\s\S]*选择本页待审核账单/,
  );
  assert.match(logisticsModule, /selectionEnabled=\{canReviewExpense\}/);
  assert.match(workspaceStyles, /\.dataTable th\.selectionColumn/);
  assert.doesNotMatch(logisticsModule, />通过<\/button>/);
});

test("pending logistics expense bills can be rejected with supplier-facing reason", () => {
  assert.match(backend, /export async function rejectLogisticsExpenseBill/);
  assert.match(backend, /loadLogisticsExpenseBillRowsForAction/);
  assert.match(backend, /驳回物流费用必须填写原因/);
  assert.match(backend, /未找到可驳回的物流费用账单/);
  assert.match(backend, /中存在非待审核费用，不能驳回/);
  assert.match(backend, /auditStatus: "已驳回"/);
  assert.match(backend, /invoiceStatus: "未通知"/);
  assert.match(backend, /paymentStatus: "待开票"/);
  assert.match(backend, /reviewedById: actor\.id/);
  assert.match(backend, /reviewedAt: now/);
  assert.match(backend, /rejectReason/);
  assert.match(logisticsCostRoute, /reviewAction === "reject"/);
  assert.match(logisticsCostRoute, /物流费用账单已驳回/);
  assert.match(logisticsModule, /title: "驳回物流费用账单"/);
  assert.match(logisticsModule, /inputRequiredMessage: "请填写驳回原因。"/);
  assert.match(logisticsModule, /className=\{styles\.billApproveButton\}/);
  assert.match(logisticsModule, /className=\{styles\.billRejectButton\}/);
  assert.match(logisticsModule, /审核通过并通知开票/);
  assert.match(logisticsModule, /"驳回"/);
  assert.match(logisticsModule, /replaceLogisticsExpenseItemsInRows/);
  assert.match(logisticsModule, /markLogisticsExpenseBillRejected/);
  assert.match(logisticsModule, /logisticsBillRejectNotice/);
  assert.match(logisticsModule, /驳回原因/);
  const rejectSource =
    logisticsModule.match(
      /async function rejectExpense[\s\S]*?\n  async function resendInvoiceNotice/,
    )?.[0] || "";
  assert.doesNotMatch(
    rejectSource,
    /loadExpenses|loadStatement|setExpandedId\(""\)/,
  );
  assert.match(
    workspaceStyles,
    /\.billApproveButton \{[\s\S]*background: var\(--button-primary-bg\)/,
  );
  assert.match(
    workspaceStyles,
    /\.billRejectButton \{[\s\S]*background: var\(--button-danger-bg\)/,
  );
  assert.match(workspaceStyles, /\.logisticsBillRejectNotice/);
});

test("draft logistics expense bills can be submitted for review", () => {
  assert.match(backend, /export async function submitLogisticsExpenseBill/);
  assert.match(backend, /loadLogisticsExpenseBillRowsForSubmit/);
  assert.match(
    submitLogisticsExpenseBillSource,
    /prisma\.logisticsBill\.update/,
  );
  assert.doesNotMatch(
    submitLogisticsExpenseBillSource,
    /prisma\.logisticsExpense\.updateMany/,
  );
  assert.match(backend, /只有草稿或已驳回费用可以提交审核。/);
  assert.match(backend, /auditStatus: "待审核"/);
  assert.match(backend, /submittedAt = new Date\(\)/);
  assert.match(backend, /rejectReason: null/);
  assert.match(backend, /void runNonCriticalTask\("物流费用提交审核日志写入"/);
  assert.match(submitLogisticsExpenseBillSource, /updatedIds: ids/);
  assert.match(
    submitLogisticsExpenseBillSource,
    /console\.warn\("submit-audit-slow-log"/,
  );
  assert.match(submitLogisticsExpenseBillSource, /durationMs/);
  assert.doesNotMatch(
    submitLogisticsExpenseBillSource,
    /loadLogisticsExpenseBillRowsForAction/,
  );
  assert.doesNotMatch(
    submitLogisticsExpenseBillSource,
    /serializeLogisticsExpenseBill\(savedRows\)|savedRows\.map\(serializeLogisticsExpense\)/,
  );
  assert.match(logisticsModule, /submitDraftExpenseBill/);
  assert.match(logisticsModule, /action: "submitBill"/);
  assert.match(logisticsModule, /timeoutMs: 10000/);
  assert.match(logisticsModule, /markLogisticsExpenseBillSubmitted/);
  assert.match(logisticsModule, /物流费用已提交审核/);
  assert.match(logisticsModule, /提交失败：/);
  assert.match(logisticsModule, /提交超时，请重试/);
  assert.match(logisticsModule, /renderBillSubmitControls/);
  assert.match(logisticsModule, /提交中\.\.\." : "提交审核"/);
  assert.match(logisticsModule, /请先保存本账单明细，再提交审核/);
  assert.match(logisticsModule, /logisticsExpenseBillCanSubmit/);
  assert.doesNotMatch(
    logisticsModule.match(
      /async function submitDraftExpenseBill[\s\S]*?\n  async function rejectExpense/,
    )?.[0] || "",
    /loadExpenses|loadStatement/,
  );
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

test("logistics suppliers can edit price and quantity only while bill is draft or rejected", () => {
  assert.match(backend, /beforeAuditStatus/);
  assert.match(backend, /logisticsExpenseBillAuditStatusValue\(before\)/);
  assert.match(backend, /logisticsExpenseBillEditBlockReason/);
  assert.match(backend, /待审核账单不能修改，请先撤回为草稿。/);
  assert.match(backend, /待审核账单不能删除明细，请先撤回为草稿。/);
  assert.match(backend, /LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED/);
  assert.match(backend, /LOGISTICS_EXPENSE_APPROVED_LOCKED/);
  assert.match(logisticsModule, /canEditAmount=\{isLogisticsSupplier\}/);
  assert.match(logisticsModule, /canEditBillDetails/);
  assert.match(logisticsModule, /logisticsExpenseBillIsEditable/);
  assert.match(logisticsModule, /logisticsExpenseEditBlockReason/);
  assert.match(logisticsModule, /editableLineSubtotal/);
  assert.match(logisticsModule, /LogisticsExpenseDraft/);
  assert.match(logisticsModule, /className=\{styles\.inlineRemarkInput\}/);
  assert.match(logisticsBillStateMachine, /已审核，不能修改。/);
  assert.match(logisticsModule, /saveStateDirty/);
  assert.match(logisticsModule, /saveStateSaved/);
  assert.match(logisticsModule, /保存本账单明细/);
  assert.match(logisticsModule, /有未保存修改/);
  assert.match(logisticsModule, /saveBillDetails/);
  assert.match(logisticsModule, /\/api\/logistics-expenses\/batch-save/);
  assert.match(workspaceStyles, /\.logisticsContainerInfoCard/);
  assert.match(workspaceStyles, /\.dataTable th\.containerTypeColumn/);
  assert.doesNotMatch(logisticsModule, /<th>计费方式<\/th>/);
  assert.match(logisticsModule, /<th>数量<\/th>/);
  assert.match(
    logisticsModule,
    /<th className=\{styles\.numericCell\}>金额<\/th>/,
  );
  assert.doesNotMatch(
    logisticsModule,
    /<th className=\{styles\.numericCell\}>折人民币<\/th>/,
  );
  assert.match(
    logisticsModule,
    /formatOriginalCurrencyAccounting\(\s*originalCurrency,\s*originalAmount,?\s*\)/,
  );
  assert.doesNotMatch(
    logisticsExpenseDetailLineSource,
    /formatCnyAccounting\(expense\.amountCny \|\| expense\.amount \|\| 0\)[\s\S]*<span>\{expense\.currency/,
  );
  assert.match(logisticsModule, /<th>发票状态<\/th>/);
  assert.match(logisticsModule, /<th>成本同步<\/th>/);
  assert.doesNotMatch(
    logisticsExpenseDetailLineSource,
    /onWithdraw|onMarkPaid|onConfirmInvoice|确认发票|标记付款/,
  );
  assert.doesNotMatch(
    logisticsExpenseDetailLineSource,
    /提交审核|撤回账单|审核通过并通知开票|驳回/,
  );
  assert.doesNotMatch(logisticsModule, /<th>集装箱柜型<\/th>/);
  assert.doesNotMatch(logisticsModule, /<th>序号<\/th>/);
  assert.doesNotMatch(logisticsModule, /保存备注/);
  assert.doesNotMatch(logisticsModule, /保存金额/);
  assert.doesNotMatch(logisticsModule, /action: "updateAmount"/);
  assert.match(logisticsModule, /remark: safeDraft\.remark\.trim\(\)/);
  assert.doesNotMatch(logisticsModule, /logistics-save-amount-btn/);
  assert.doesNotMatch(logisticsModule, /primaryButtonCompact[^\\n]*保存金额/);
  assert.match(workspaceStyles, /\.billSaveButton/);
  assert.match(workspaceStyles, /background: var\(--button-primary-bg\)/);
  assert.match(workspaceStyles, /background: var\(--button-primary-hover\)/);
  assert.match(workspaceStyles, /background: var\(--button-disabled-bg\)/);
  assert.match(workspaceStyles, /\.billAddLineButton/);
  assert.match(
    workspaceStyles,
    /\.logisticsTypographyScope \.primaryButtonCompact \{[\s\S]*background: var\(--button-primary-bg\);[\s\S]*color: var\(--button-primary-text\);/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsTypographyScope \.primaryButtonCompact:hover:not\(:disabled\),[\s\S]*background: var\(--button-primary-hover\);[\s\S]*color: var\(--button-primary-text\);/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsTypographyScope \.primaryButtonCompact:disabled,[\s\S]*background: var\(--button-disabled-bg\);[\s\S]*color: var\(--button-disabled-text\);/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsTypographyScope \.secondaryButton:disabled,[\s\S]*background: var\(--button-disabled-bg\);[\s\S]*color: var\(--button-disabled-text\);/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsTypographyScope \.billSaveButton \{[\s\S]*background: var\(--button-primary-bg\);[\s\S]*color: var\(--button-primary-text\);/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsTypographyScope \.billAddLineButton \{[\s\S]*background: var\(--button-secondary-bg\);[\s\S]*color: var\(--button-secondary-text\);/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsTypographyScope \.logisticsLineDeleteButton:disabled[\s\S]*background: var\(--button-disabled-bg\);[\s\S]*color: var\(--button-disabled-text\);/,
  );
  assert.match(
    workspaceStyles,
    /\.inlineAmountEditor input[\s\S]*width: 100px/,
  );
  assert.match(workspaceStyles, /th:nth-child\(3\)[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /th:nth-child\(6\)[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /th:nth-child\(7\)[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /th:nth-child\(8\)[\s\S]*text-align: center/);
  assert.match(workspaceStyles, /\.inlineQuantityInput[\s\S]*width: 90px/);
  assert.match(workspaceStyles, /\.inlineQuantityInput[\s\S]*margin: 0 auto/);
  assert.match(
    workspaceStyles,
    /\.inlineQuantityInput[\s\S]*-moz-appearance: textfield/,
  );
  assert.match(
    workspaceStyles,
    /\.inlineQuantityInput[\s\S]*text-align: center/,
  );
  assert.match(
    workspaceStyles,
    /\.inlineQuantityInput::-webkit-outer-spin-button,[\s\S]*\.inlineQuantityInput::-webkit-inner-spin-button[\s\S]*-webkit-appearance: none;[\s\S]*margin: 0;/,
  );
  assert.match(workspaceStyles, /\.inlineRemarkInput[\s\S]*width: 140px/);
  assert.match(workspaceStyles, /\.inlineCostTypeSelect/);
  assert.doesNotMatch(workspaceStyles, /\.inlineBillingMethodSelect/);
  assert.match(workspaceStyles, /th:nth-child\(5\)[\s\S]*width: 170px/);
  assert.match(workspaceStyles, /th:nth-child\(6\)[\s\S]*width: 112px/);
  assert.match(workspaceStyles, /\.costSyncCell[\s\S]*flex-direction: column/);
  assert.match(workspaceStyles, /\.costSyncCell[\s\S]*align-items: center/);
  assert.match(
    workspaceStyles,
    /\.compactDetailActions[\s\S]*align-items: center/,
  );
  assert.match(workspaceStyles, /overflow-x: auto/);
  assert.match(workspaceStyles, /color: var\(--button-primary-text\)/);
  assert.match(logisticsExpenseBatchRoute, /export async function PATCH/);
  assert.match(logisticsExpenseBatchRoute, /batchUpdateLogisticsExpenses/);
  assert.match(backend, /export async function batchUpdateLogisticsExpenses/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_QUANTITY_INVALID/);
  assert.match(backend, /第 \$\{index \+ 1\} 行/);
});

test("logistics expense bills use compact table and drawer instead of nested table details", () => {
  assert.match(logisticsModule, /function LogisticsExpenseCompactRow/);
  assert.match(logisticsModule, /defaultLogisticsExpenseDetailTab/);
  assert.match(logisticsModule, /setActiveTab\(defaultTab\)/);
  assert.match(
    logisticsModule,
    /logisticsBillDefaultTab\(\{ auditStatus, invoiceStatus, paymentStatus \}\)/,
  );
  assert.match(
    logisticsBillStateMachine,
    /if \(auditStatus === "审核通过"\) return "invoice"/,
  );
  assert.match(
    logisticsModule,
    /<SideDetailDrawer[\s\S]*surfaceClassName=\{styles\.logisticsExpenseDrawer\}/,
  );
  assert.match(
    logisticsModule,
    /订单号 \/ Shipment[\s\S]*客户[\s\S]*CNY 合计[\s\S]*USD 合计[\s\S]*审核[\s\S]*发票[\s\S]*付款[\s\S]*操作/,
  );
  assert.match(
    logisticsModule,
    /formatOriginalCurrencyValue\(\s*"CNY",\s*logisticsCurrencyAmountByCode\(currencyTotals, "CNY"\),?\s*\)/,
  );
  assert.match(
    logisticsModule,
    /formatOriginalCurrencyValue\(\s*"USD",\s*logisticsCurrencyAmountByCode\(currencyTotals, "USD"\),?\s*\)/,
  );
  assert.match(
    logisticsModule,
    /tabs=\{\[[\s\S]*基础信息[\s\S]*费用明细[\s\S]*发票管理[\s\S]*操作记录/,
  );
  assert.match(logisticsModule, /LogisticsInvoiceGroupsPanel/);
  assert.match(
    logisticsModule,
    /<DetailField[\s\S]*?label="提单号"[\s\S]*?value=\{expense\.blNo \|\| expense\.billOfLadingNo \|\| "-"\}/,
  );
  assert.match(
    logisticsModule,
    /<DetailField[\s\S]*?label="船名航次"[\s\S]*?value=\{expense\.order\?\.vesselVoyage \|\| expense\.vesselVoyage \|\| "-"\}/,
  );
  assert.doesNotMatch(
    logisticsModule,
    /LogisticsBillContainerInfo summary=\{containerSummary\} expense=\{expense\}/,
  );
  assert.doesNotMatch(logisticsModule, /装货港：/);
  assert.doesNotMatch(logisticsModule, /className=\{styles\.detailRow\}/);
  assert.doesNotMatch(logisticsModule, /<tr className=\{styles\.detailRow\}>/);
  assert.match(workspaceStyles, /\.logisticsCompactTable/);
  assert.match(
    workspaceStyles,
    /\.logisticsCompactTable tbody td[\s\S]*height: 44px/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsCompactTable thead th[\s\S]*position: sticky/,
  );
  assert.match(
    workspaceStyles,
    /\.logisticsExpenseDrawer[\s\S]*width: min\(1200px, 94vw\)/,
  );
  assert.match(workspaceStyles, /\.logisticsDrawerSection/);
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
  assert.match(saveBillDetailsSource, /savingBillId === expense\.id/);
  assert.match(
    saveBillDetailsSource,
    /reconcileLogisticsExpenseMutationRows\(currentRows,\s*\{\s*bill: result\.bill,\s*\}\)/,
  );
  assert.doesNotMatch(saveBillDetailsSource, /loadStatement\(statementMonth\)/);
  assert.match(logisticsExpenseBatchSaveRoute, /export async function PATCH/);
  assert.match(logisticsExpenseBatchSaveRoute, /batchSaveLogisticsExpenses/);
  assert.match(logisticsExpenseBatchSaveRoute, /message: "✓ 已保存"/);
  assert.match(backend, /export async function batchSaveLogisticsExpenses/);
  assert.match(backend, /const updates = Array\.isArray\(input\.updates\)/);
  assert.match(backend, /const creates = Array\.isArray\(input\.creates\)/);
  assert.match(backend, /const deletes = Array\.isArray\(input\.deletes\)/);
  assert.match(backend, /batchSaveLogisticsExpenseBillIdentifier/);
  assert.match(
    backend,
    /loadLogisticsExpenseBillRowsForAction\(identifier, actor\)/,
  );
  assert.match(backend, /prisma\.\$transaction\(transactionOperations\)/);
  assert.match(backend, /prisma\.logisticsExpense\.createMany/);
  assert.match(backend, /prisma\.logisticsExpense\.updateMany/);
  assert.match(backend, /details: serializedItems/);
  assert.doesNotMatch(
    backend.match(
      /export async function batchSaveLogisticsExpenses[\s\S]*?\nexport async function deleteLogisticsExpense/,
    )?.[0] || "",
    /await loadStatement|notifyLogisticsSupplierInvoice|createOrUpdateCostFromLogisticsExpense|OCR|recognize/,
  );
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_REQUIRED/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_CREATE_COST_TYPE_REQUIRED/);
  assert.match(backend, /parseLogisticsExpenseGroupKey/);
  assert.doesNotMatch(
    logisticsModule,
    /window\.location|location\.href|router\.refresh|reload\(/,
  );
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
  assert.match(
    logisticsModule,
    /\/api\/logistics-expenses\/\$\{encodeURIComponent\(expense\.id\)\}/,
  );
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
  assert.doesNotMatch(
    logisticsModule,
    /window\.location|location\.href|router\.refresh|reload\(/,
  );
  assert.match(logisticsModule, /费用明细/);
  assert.match(logisticsModule, /账单合计/);
  assert.match(logisticsModule, /function MonthlySummaryComponent/);
  assert.match(
    logisticsModule,
    /const monthlySummary = buildMonthlySummary\(rows\)/,
  );
  assert.match(monthlySummaryComponentSource, /\{currency\} 合计/);
  assert.match(logisticsModule, /function SupplierSectionComponent/);
  assert.match(logisticsModule, /function LogisticsExpenseBillTable/);
  assert.match(logisticsFeesBillTable, /<th className=\{styles\.orderNoColumn\}>订单号 \/ Shipment<\/th>/);
  assert.match(logisticsFeesBillTable, /<th className=\{styles\.blNoColumn\}>提单号 \/ B\/L No\.<\/th>/);
  assert.match(logisticsFeesBillTable, /<th className=\{styles\.customerColumn\}>客户简称<\/th>/);
  assert.ok(logisticsFeesBillTable.indexOf("订单号 / Shipment") < logisticsFeesBillTable.indexOf("提单号 / B/L No."));
  assert.ok(logisticsFeesBillTable.indexOf("提单号 / B/L No.") < logisticsFeesBillTable.indexOf("客户简称"));
  assert.match(logisticsFeesBillTable, /<td className=\{styles\.blNoColumn\}>\s*\{expense\.blNo \|\| expense\.billOfLadingNo \|\| "-"\}\s*<\/td>/);
  assert.match(backend, /\{ billOfLadingNo: keyword \}/);
  assert.match(backend, /\{ order: \{ is: \{ blNo: keyword \} \} \}/);
  assert.doesNotMatch(
    supplierSectionComponentSource,
    /LogisticsCurrencyAmountList|合计：|statementRowSummary/,
  );
  assert.doesNotMatch(
    billTableComponentSource,
    /statementRowSummary|buildMonthlySummary|合计：/,
  );
  assert.doesNotMatch(logisticsModule, /折人民币总合计/);
  assert.match(logisticsModule, /approvedCurrencyTotals/);
  assert.match(logisticsModule, /pendingPaymentCurrencyTotals/);
  assert.match(logisticsModule, /{ key: "pendingPayment", label: "待付款" }/);
  assert.doesNotMatch(logisticsModule, /{ key: "invoiced", label: "已开票" }/);
  assert.match(logisticsModule, /logisticsExpenseCurrencySummaryFromItems/);
  assert.match(logisticsModule, /logisticsExpenseFormCurrencySummary/);
  assert.match(backend, /approvedCurrencyTotals/);
  assert.match(backend, /logisticsPaymentLedgerRow/);
  assert.match(backend, /groupLogisticsStatementRowsByShipment/);
  assert.match(
    logisticsSupplierStatementSource,
    /const shipmentRows = groupLogisticsStatementRowsByShipment\(rows\)/,
  );
  assert.match(
    backend,
    /subtractCurrencyTotals\(approvedCurrencyTotals, paidCurrencyTotals\)/,
  );
  assert.match(backend, /summarizeCurrencyTotals/);
  assert.match(
    logisticsSupplierStatementSource,
    /const paidRow = logisticsPaymentLedgerRow\(row\)/,
  );
  assert.doesNotMatch(
    logisticsSupplierStatementSource,
    /row\.paymentStatus|row\.invoiceStatus/,
  );
  assert.match(logisticsExpenseQueries, /!cost\.paymentDate/);
  assert.match(workspaceStyles, /\.logisticsCurrencySummary/);
  assert.match(logisticsModule, /logisticsLineDeleteButton/);
  assert.match(workspaceStyles, /\.logisticsLineDeleteButton/);
  assert.match(workspaceStyles, /border: 1px solid #fecaca/);
  assert.match(workspaceStyles, /th:nth-child\(9\)[\s\S]*width: 120px/);
});

test("logistics paid button is locked by bill state machine", () => {
  assert.match(
    logisticsBillStateMachine,
    /LOGISTICS_BILL_PAY_BUTTON_RULE = \{[\s\S]*审核通过 \+ 已上传发票 \+ 未付款[\s\S]*草稿[\s\S]*待审核[\s\S]*未上传发票[\s\S]*已付款/,
  );
  assert.match(
    logisticsModule,
    /const PAY_BUTTON_RULE = LOGISTICS_BILL_PAY_BUTTON_RULE/,
  );
  assert.match(
    logisticsModule,
    /const PAY_BUTTON_DISABLED_TOOLTIP = LOGISTICS_BILL_PAY_DISABLED_TOOLTIP/,
  );
  assert.match(logisticsModule, /inputType: "date"/);
  assert.match(logisticsModule, /paymentDate: confirmationResult\.inputValue/);
  assert.match(
    logisticsModule,
    /<DetailField[\s\S]*?label="付款时间"[\s\S]*?value=\{formatDate\(expense\.paymentDate\)\}/,
  );
  assert.match(logisticsModule, /function logisticsExpensePayButtonState/);
  assert.match(
    logisticsModule,
    /logisticsBillPayState\(\{ auditStatus, invoiceStatus, paymentStatus \}\)/,
  );
  assert.match(
    logisticsBillStateMachine,
    /export function canMarkLogisticsBillPaid/,
  );
  assert.match(
    logisticsBillStateMachine,
    /normalizeLogisticsBillAuditStatus\(input\.auditStatus\) === "审核通过"[\s\S]*normalizeLogisticsBillInvoiceStatus\(input\.invoiceStatus\) === "已上传发票"[\s\S]*normalizeLogisticsBillPaymentStatus\(input\.paymentStatus\) !== "已付款"/,
  );
  assert.match(logisticsModule, /if \(!payState\.canMarkPaid\) return/);
  assert.match(logisticsModule, /className=\{styles\.billPayButton\}/);
  assert.match(
    workspaceStyles,
    /\.billPayButton:disabled,[\s\S]*background: #d9d9d9;[\s\S]*cursor: not-allowed/,
  );
  assert.match(
    updateLogisticsExpensePaymentStatusSource,
    /loadLogisticsExpenseBillRowsForAction\(id, actor\)/,
  );
  assert.match(
    updateLogisticsExpensePaymentStatusSource,
    /canMarkLogisticsBillPaid\(\{/,
  );
  assert.match(
    updateLogisticsExpensePaymentStatusSource,
    /LOGISTICS_PAYMENT_STATE_INVALID/,
  );
  assert.match(
    updateLogisticsExpensePaymentStatusSource,
    /LOGISTICS_PAYMENT_DATE_REQUIRED/,
  );
  assert.match(updateLogisticsExpensePaymentStatusSource, /paymentDate/);
  assert.match(
    updateLogisticsExpensePaymentStatusSource,
    /orderCost\.updateMany/,
  );
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
  assert.match(settingsModule, /PermissionSelectItem/);
  assert.match(settingsModule, /从FOB中扣减物流费用/);
  assert.match(settingsModule, /<UiSwitch[\s\S]*label="提成基数负数归零"/);
  assert.match(settingsModule, /toggleDeduction\(item\.value\)/);
  assert.match(profitModule, /提成基数/);
  assert.doesNotMatch(
    backend,
    /const estimatedCommissionBaseCny = Math\.max\(expectedGrossProfit, 0\);/,
  );
  assert.doesNotMatch(
    backend,
    /const settleableCommissionBaseCny = Math\.max\(expectedGrossProfit, 0\);/,
  );
});

test("checkbox controls use modern custom selection styling", () => {
  assert.match(settingsModule, /commissionDeductionGrid/);
  assert.match(settingsModule, /PermissionSelectItem/);
  assert.match(reportsModule, /variant="table"/);
  assert.match(workspaceStyles, /\.uiChoiceCardChecked/);
  assert.match(workspaceStyles, /border-color: #3b82f6/);
  assert.match(workspaceStyles, /background: rgba\(59, 130, 246, 0\.08\)/);
  assert.match(workspaceStyles, /\.checkboxPanel label:has\(input:checked\)/);
  assert.match(workspaceStyles, /\.permissionOptionCard \.uiChoiceCheck/);
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
