import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  backend,
  schema,
  menuFile,
  workspaceShell,
  supplierMasters,
  migration,
  containerCountMigration,
  invoiceNotificationMigration,
  invoiceGroupMigration,
  removeInvoiceManualFieldsMigration,
  logisticsBillMigration,
  logisticsInvoiceUsdGroupingMigration,
  logisticsBillConvergenceMigration,
  logisticsBillSupplierKeyMigration,
  logisticsBillStateMachine,
  logisticsFeesMain,
  logisticsFeesModel,
  logisticsFeesDetails,
  logisticsFeesForm,
  logisticsFeesInvoices,
  logisticsFeesShared,
  logisticsFeesBillTable,
  logisticsFeesMonthlySummary,
  logisticsModule,
  deleteExpenseSource,
  withdrawExpenseSource,
  saveBillDetailsSource,
  frontendAggregateStatusSource,
  logisticsExpenseDetailLineSource,
  logisticsExpenseFormSource,
  invoiceUploadFormSource,
  monthlySummaryComponentSource,
  supplierSectionComponentSource,
  billTableComponentSource,
  backendAggregateStatusSource,
  submitLogisticsExpenseBillSource,
  reviewLogisticsExpenseBillsSource,
  reviewLogisticsExpenseBillsFunctionSource,
  approveLogisticsExpenseBillRowsSource,
  updateLogisticsExpensePaymentStatusSource,
  logisticsCostRoute,
  logisticsInvoiceRoute,
  logisticsReviewRoute,
  notificationTemplateRoute,
  logisticsExpenseDeleteRoute,
  logisticsExpenseBatchRoute,
  logisticsExpenseBatchSaveRoute,
  profitModule,
  domesticLogisticsModule,
  settingsModule,
  settingsModuleMain,
  notificationTemplateCardSource,
  saveNotificationTemplateSource,
  notificationTemplateFormSource,
  costsModule,
  reportsModule,
  workspaceStyles,
  logisticsExpenseQueries,
  listLogisticsExpensesSource,
  logisticsSupplierStatementSource
} from "./logistics-expense-workflow-context.ts";

const logisticsInvoiceOcrCron = readFileSync("app/api/cron/logistics-invoice-ocr/route.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");

test("logistics expenses are stored outside official costs until approved", () => {
  const logisticsExpenseModel = schema.match(
    /model LogisticsExpense \{[\s\S]*?\n\}/,
  )?.[0] || "";

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
    logisticsExpenseModel,
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
  assert.match(backend, /sourceType: LOGISTICS_FEE_COST_SOURCE_TYPE/);
  assert.match(backend, /sourceId: expense\.id/);
  assert.match(backend, /costConfirmed: true/);
  assert.match(backend, /审核通过物流费用/);
  assert.match(backend, /reviewLogisticsExpenseBills/);
  assert.match(
    reviewLogisticsExpenseBillsFunctionSource,
    /options\.deferSideEffects\(async \(\) => \{[\s\S]*await processDurableSideEffects\(\);[\s\S]*\}\)/,
  );
  assert.match(backend, /createLogisticsInvoiceApprovalOutboxIntents/);
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

test("official logistics cost generation is source scoped instead of cost-type scoped", () => {
  assert.doesNotMatch(backend, /LOGISTICS_EXPENSE_DUPLICATE_COST/);
  assert.doesNotMatch(backend, /同一订单同一物流费用类型已存在正式成本/);
  assert.match(backend, /sourceType: LOGISTICS_FEE_COST_SOURCE_TYPE/);
  assert.match(backend, /sourceType: \{ in: LOGISTICS_GENERATED_COST_SOURCE_TYPES \}/);
  assert.match(backend, /sourceId: expense\.id/);
  assert.match(migration, /order_costs_source_unique/);
});

test("logistics bill supplier key does not reuse deleted or sampled legacy bills", () => {
  assert.match(backend, /findFirst\(\{\s*where: \{ billKey: legacyBillKey, deletedAt: null \}/);
  assert.match(backend, /distinct: \["supplierId"\]/);
  assert.match(backend, /take: 2/);
  assert.match(backend, /deletedAt: null,[\s\S]*updatedById: logisticsExpenseActorId\(actor\)/);
  assert.match(logisticsBillSupplierKeyMigration, /"deleted_at"\s*=\s*NULL/);
  assert.doesNotMatch(backend, /include: \{ expenses: \{ where: \{ deletedAt: null \}, select: \{ supplierId: true \}, take: 20 \} \}/);
});

test("logistics review pushes costs and notifies invoice upload after approval", () => {
  assert.doesNotMatch(backend, /costSyncFailures/);
  assert.match(backend, /await syncApprovedLogisticsExpenseCosts\(tx, rows, actor(?:, \{[\s\S]*?\})?\)/);
  assert.match(
    backend,
    /createOrUpdateCostFromLogisticsExpense\(tx, row, actor, \{[\s\S]*settledCostMode,[\s\S]*commissionLockAlreadyHeld: true,[\s\S]*\}\)/,
  );
  assert.match(backend, /await updateLogisticsExpenseCostIds\(tx, links\)/);
  assert.match(backend, /linkLogisticsExpenseInvoiceDocumentsToCosts/);
  assert.match(backend, /tx\.orderDocument\.updateMany/);
  assert.match(backend, /tx\.fileAsset\.updateMany/);
  assert.match(approveLogisticsExpenseBillRowsSource, /const outboxIntents = await createLogisticsInvoiceApprovalOutboxIntents\(tx, rows, actorId\(actor\), now\)/);
  assert.match(approveLogisticsExpenseBillRowsSource, /rows\.length !== expectedRowCount[\s\S]*rowsByBillId\.size !== ids\.length[\s\S]*LOGISTICS_BILL_ROWS_INCOMPLETE/);
  assert.match(approveLogisticsExpenseBillRowsSource, /outboxIntents\.length !== ids\.length[\s\S]*LOGISTICS_INVOICE_OUTBOX_INCOMPLETE/);
  assert.match(approveLogisticsExpenseBillRowsSource, /const auditEntries: LogisticsExpenseApprovalAuditEntry\[\][\s\S]*notificationOutboxId:/);
  assert.match(reviewLogisticsExpenseBillsFunctionSource, /approvalAuditEntries\.push\(\.\.\.\(approval\?\.auditEntries \|\| \[\]\)\)[\s\S]*"物流费用审核日志写入"[\s\S]*writeAudit\(request, actor, "审核通过物流费用账单"/);
  assert.match(
    approveLogisticsExpenseBillRowsSource,
    /const outboxIntents = await createLogisticsInvoiceApprovalOutboxIntents\(tx, savedRows, actorId\(actor\), now\)[\s\S]*const auditEntries: LogisticsExpenseApprovalAuditEntry\[\][\s\S]*notificationOutboxId: outboxIntents\[0\]\?\.id[\s\S]*return \{ outboxIntents, costLinks, auditEntries \}/,
  );
  assert.match(reviewLogisticsExpenseBillsFunctionSource, /notificationOutboxKeys\.push\(\.\.\.outboxIntents\.map/);
  assert.match(reviewLogisticsExpenseBillsFunctionSource, /processLogisticsInvoiceNotificationOutbox/);
  assert.match(reviewLogisticsExpenseBillsFunctionSource, /refreshTaxRefundCompletenessBatch\(orderIds\)/);
  assert.match(reviewLogisticsExpenseBillsFunctionSource, /invalidateWorkbenchTodosCache\(\)/);
  assert.match(
    reviewLogisticsExpenseBillsFunctionSource,
    /options\.deferSideEffects\(async \(\) => \{[\s\S]*await processDurableSideEffects\(\);[\s\S]*\}\)/,
  );
  assert.doesNotMatch(reviewLogisticsExpenseBillsFunctionSource, /scheduleLogisticsExpenseReviewSideEffects|notifyLogisticsSupplierInvoiceBills/);
  assert.doesNotMatch(
    approveLogisticsExpenseBillRowsSource,
    /logisticsInvoiceReviewBlockReason|未上传发票，不能审核通过/,
  );
  assert.match(
    approveLogisticsExpenseBillRowsSource,
    /auditStatus: "审核通过"[\s\S]*paymentStatus: "待开票"[\s\S]*invoiceStatus: "待开票"/,
  );
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

test("internal users can choose enabled temporary logistics fee suppliers", () => {
  assert.match(
    backend,
    /export function assertCanWriteLogisticsExpense\(actor: LogisticsActor\) \{\s*if \(logisticsExpenseActorRole\(actor\) === "业务员"\) return;/,
  );
  assert.match(
    backend,
    /const canSelectTemporarySupplier = role === "管理员" \|\| role === "业务员"/,
  );
  assert.match(
    backend,
    /if \(!canSelectTemporarySupplier\) \{[\s\S]*LOGISTICS_SUPPLIER_NOT_ASSIGNED/,
  );
  assert.match(
    backend,
    /else if \(role === "业务员" && !supplier\.allowLogisticsExpenseEntry\)/,
  );
  assert.match(
    logisticsFeesForm,
    /const canSelectTemporarySupplier = !isLockedSupplier && \["管理员", "业务员"\]\.includes\(currentUserRole\)/,
  );
  assert.match(
    logisticsFeesForm,
    /new URLSearchParams\(\{ type: "logistics-fee", status: "active" \}\)/,
  );
  assert.match(logisticsFeesForm, /选择订单绑定或临时物流供应商/);
  assert.match(logisticsFeesForm, /可选择订单绑定或临时物流供应商/);
});

test("supplier settings include logistics expense and invoice permissions", () => {
  assert.match(schema, /allowLogisticsExpenseEntry\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /allowedLogisticsCostTypes\s+Json\?/);
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
  assert.match(backend, /readManagedUploadFile\(file, "invoicePdf", "invoice\.pdf"\)/);
  assert.match(backend, /uploadManagedFileToStorage/);
  assert.doesNotMatch(
    backend,
    /LOGISTICS_INVOICE_AMOUNT_EXCEEDS_APPROVED|LOGISTICS_INVOICE_FORCE_REASON_REQUIRED/,
  );
  assert.match(logisticsModule, /invoiceStatus/);
  assert.match(logisticsModule, /已上传发票/);
  assert.match(logisticsModule, /已确认发票/);
});

test("USD ocean freight invoices use foreign currency amount from remarks instead of CNY tax total", () => {
  assert.match(backend, /export function extractLogisticsForeignCurrencyAmount/);
  assert.match(backend, /美金金额\|美元金额/);
  assert.match(backend, /\(\?!\[0-9\]\)/);
  assert.match(backend, /value > 0 && value < 10_000_000/);
  assert.match(backend, /OCEAN_FREIGHT_INVOICE_GROUP_KEY[\s\S]*cleanText\(input\.currency\)\.toUpperCase\(\) === "USD"/);
  assert.match(backend, /source: "FOREIGN_CURRENCY_REMARK"/);
  assert.match(backend, /source: "FOREIGN_CURRENCY_MISSING"/);
  assert.match(backend, /recognizedAmount: validation\.recognizedAmount/);
  assert.match(backend, /invoiceRecognizedAmount: input\.recognizedAmount \|\| null/);
  assert.match(backend, /taxInvoiceAmount: validation\.taxInvoiceAmount/);
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
    /value: "拖车费"[\s\S]*value: "报关费"[\s\S]*value: "港杂费"[\s\S]*value: "打单费"[\s\S]*value: "ENS", label: "ENS费"[\s\S]*value: "进港费"[\s\S]*value: "提箱费"[\s\S]*value: "落箱费"[\s\S]*value: "预提费"[\s\S]*value: "查验费"[\s\S]*value: "超重费"[\s\S]*value: "海运费"[\s\S]*value: "保险费"[\s\S]*value: "其他本地费用"[\s\S]*value: "其他国际费用"/,
  );
  assert.match(
    backend,
    /LOGISTICS_COST_TYPES = LOGISTICS_COST_TYPE_OPTIONS\.map/,
  );
  assert.match(
    backend,
    /LOGISTICS_USD_COST_TYPES = \["海运费", "ENS", "保险费", "其他国际费用"\]/,
  );
  assert.match(backend, /LOGISTICS_EXPENSE_CURRENCIES = \["CNY", "USD"\]/);
  assert.match(backend, /LOGISTICS_CNY_COST_TYPES = \[[\s\S]*"其他本地费用"/);
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
  assert.doesNotMatch(logisticsModule, /logisticsCostTypeLocksCurrency\(item\.costType\)/);
  assert.match(logisticsModule, /export const CURRENCIES = \["CNY", "USD"\]/);
  assert.match(logisticsModule, /CURRENCIES\.map\(\(currency\)/);
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
    /onKeyDown=\{preventEnterFormSubmit\}[\s\S]*?onClick=\{\(\) => onAddItem\(false\)\}/,
  );
  assert.match(
    logisticsModule,
    /onKeyDown=\{preventEnterFormSubmit\}[\s\S]*?onClick=\{\(\) => onAddItem\(true\)\}/,
  );
  assert.match(invoiceUploadFormSource, /onKeyDown=\{preventEnterFormSubmit\}/);
});

test("logistics invoice upload starts on file selection and shows upload progress", () => {
  assert.match(invoiceUploadFormSource, /onChange=\{handleFileChange\}/);
  assert.match(invoiceUploadFormSource, /uploadInvoice\(selectedFile\)/);
  assert.match(invoiceUploadFormSource, /uploadFormDataWithProgress/);
  assert.match(invoiceUploadFormSource, /validatePdfUploadFile/);
  assert.match(invoiceUploadFormSource, /上传中 \$\{nextProgress\}%/);
  assert.match(invoiceUploadFormSource, /上传成功，系统正在识别/);
  assert.doesNotMatch(invoiceUploadFormSource, /onRecognize/);
  assert.match(backend, /status: "QUEUED"[\s\S]*系统将自动识别/);
  assert.match(backend, /createLogisticsInvoiceRecognitionTask\([\s\S]*, tx\)/);
  assert.match(logisticsInvoiceOcrCron, /assertCronSecret\(request\)/);
  assert.match(logisticsInvoiceOcrCron, /runPendingLogisticsInvoiceOcrTasks\(5\)/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/logistics-invoice-ocr"[\s\S]*"schedule": "\*\/5 \* \* \* \*"/);
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
