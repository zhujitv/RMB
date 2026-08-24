import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  logisticsBillVoidMigration,
  logisticsReviewInvoicePaymentMigration,
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
  domesticLogisticsApiSource,
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

const logisticsFeeWorkflowColumnStyles = readFileSync(
  "app/styles/workspace-shell/logistics-bill-row-responsive.module.css",
  "utf8",
);

test("logistics invoice payment requires an active correctly scoped PDF and atomic bill transition", () => {
  assert.match(backend, /FOR UPDATE/);
  assert.match(backend, /function assertActiveLogisticsInvoiceDocuments/);
  assert.match(backend, /relatedModule: "SUPPLIER"/);
  assert.match(backend, /document\.orderId !== row\.orderId[\s\S]*document\.supplierId !== row\.supplierId/);
  assert.match(backend, /document\.mimeType[\s\S]*application\/pdf/);
  assert.match(backend, /document\.fileSize[\s\S]*document\.storageKey/);
  assert.match(backend, /assertLogisticsBillRowsMatchHeader/);
  assert.match(backend, /invoiceStatus: \{ in: \["已确认", "已确认发票"\] \}[\s\S]*paymentStatus: "待付款"/);
  assert.match(backend, /LOGISTICS_INVOICE_DELETE_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_INVOICE_DELETE_BILL_CHANGED/);
  assert.match(backend, /LOGISTICS_INVOICE_RECOGNITION_STATE_INVALID/);
  assert.match(backend, /LOGISTICS_INVOICE_VALIDATION_STATE_INVALID/);
  assert.match(backend, /LOGISTICS_INVOICE_DOCUMENT_REUSED_ACROSS_GROUPS/);
  assert.match(backend, /LOGISTICS_INVOICE_CONFIRMATION_INCOMPLETE/);
  assert.match(backend, /hasUngroupedItems/);
  assert.match(logisticsModule, /canManageInvoiceRecognition && group\.invoiceDocumentId && !confirmed/);
  assert.match(logisticsReviewInvoicePaymentMigration, /"invoice_document_id" = NULL/);
  assert.match(logisticsReviewInvoicePaymentMigration, /UPDATE "order_costs" AS cost[\s\S]*"invoice_status" = '未收到'[\s\S]*"source_type" IN \('LOGISTICS_FEE', 'LOGISTICS_EXPENSE'\)/);
  assert.match(logisticsReviewInvoicePaymentMigration, /document\."deleted_at" IS NULL/);
  assert.match(logisticsReviewInvoicePaymentMigration, /document\."order_id" = expense\."order_id"/);
  assert.match(logisticsReviewInvoicePaymentMigration, /document\."supplier_id" = expense\."supplier_id"/);
  assert.match(logisticsReviewInvoicePaymentMigration, /document\."mime_type"[\s\S]*application\/pdf/);
  assert.match(logisticsReviewInvoicePaymentMigration, /历史费用明细与账单订单或供应商不一致/);
  assert.match(logisticsReviewInvoicePaymentMigration, /expense\."invoice_confirmed_by" IS NULL OR expense\."invoice_confirmed_at" IS NULL/);
  assert.match(logisticsReviewInvoicePaymentMigration, /HAVING COUNT\(DISTINCT \("bill_id", "invoice_group"\)\) > 1/);
  assert.match(logisticsReviewInvoicePaymentMigration, /历史发票文件被不同发票分组或账单重复引用/);
  assert.match(backend, /assertLogisticsInvoiceDocumentNotReusedOutsideRows/);
  assert.match(backend, /assertNoSettledLogisticsCostConflict/);
  assert.match(backend, /LOGISTICS_COST_PAYMENT_STATE_CONFLICT/);
  assert.match(logisticsReviewInvoicePaymentMigration, /Isolate orphan bills/);
  assert.match(logisticsReviewInvoicePaymentMigration, /"audit_status" = '审核通过'[\s\S]*"invoice_status" = '已确认发票'[\s\S]*THEN '待付款'/);
});

test("logistics bill submission review and detail writes share strict state guards", () => {
  assert.match(backend, /export async function lockLogisticsBillForWorkflow/);
  assert.match(backend, /LOGISTICS_EXPENSE_SUBMIT_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_EXPENSE_WITHDRAW_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_EXPENSE_REJECT_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_EXPENSE_REOPEN_STATE_INVALID/);
  assert.match(backend, /LOGISTICS_EXPENSE_UPDATE_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_EXPENSE_BATCH_SAVE_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_EXPENSE_DELETE_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_BILL_APPEND_STATE_BLOCKED/);
  assert.match(backend, /LOGISTICS_BILL_APPEND_STATE_CHANGED/);
  assert.match(backend, /该订单\/供应商已有进入审核、发票或付款流程的物流费用账单/);
  assert.match(backend, /export async function saveLogisticsExpenses[\s\S]*prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(backend, /LOGISTICS_COST_LINK_SCOPE_MISMATCH/);
  assert.match(backend, /existing\.sourceId === expense\.id/);
  assert.match(logisticsReviewInvoicePaymentMigration, /WITH repairable_cost_links AS/);
  assert.match(logisticsReviewInvoicePaymentMigration, /UPDATE "logistics_expenses" AS expense[\s\S]*SET "cost_id" = NULL/);
  assert.match(backend, /completed\.validationStatus === "FAILED"[\s\S]*result\.failed \+= 1/);
});
import { extractLogisticsForeignCurrencyAmount } from "../lib/platform/logistics-invoice-amount-parser.ts";

test("logistics fee bill list keeps all workflow columns visible on medium desktops", () => {
  assert.match(
    logisticsFeesBillTable,
    /<table className=\{`\$\{styles\.dataTable\} \$\{styles\.logisticsCompactTable\} \$\{styles\.logisticsFeesBillListTable\}`\}>/,
  );
  assert.match(
    logisticsFeesBillTable,
    /<colgroup>[\s\S]*?<col className=\{styles\.orderNoColumn\} \/>[\s\S]*?<col className=\{styles\.operationColumn\} \/>[\s\S]*?<\/colgroup>/,
  );
  assert.match(logisticsFeesBillTable, /className=\{styles\.logisticsBillRowActions\}/);
  assert.match(logisticsFeesBillTable, /onVoidBill\(expense\)/);
  assert.match(
    logisticsFeeWorkflowColumnStyles,
    /@media \(min-width: 861px\) and \(max-width: 1691px\) \{[\s\S]*?\.logisticsCompactTable\.logisticsFeesBillListTable \{[\s\S]*?min-width: 900px;/,
  );
  assert.match(
    logisticsFeeWorkflowColumnStyles,
    /\.logisticsCompactTable\.logisticsFeesBillListTable col\.operationColumn,[\s\S]*?width: 108px;[\s\S]*?min-width: 108px;/,
  );
  assert.match(
    logisticsFeeWorkflowColumnStyles,
    /\.logisticsCompactTable\.logisticsFeesBillListTable \.logisticsBillRowActions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(logisticsFeeWorkflowColumnStyles, /\/\* Keep every logistics-fee workflow column visible/);
  assert.doesNotMatch(logisticsFeeWorkflowColumnStyles, /display:\s*none/);
});

test("logistics expense list reads avoid transactions for count and pagination", () => {
  assert.match(listLogisticsExpensesSource, /prisma\.logisticsBill\.count/);
  assert.match(listLogisticsExpensesSource, /prisma\.logisticsBill\.findMany/);
  assert.match(listLogisticsExpensesSource, /take: Math\.max\(total, pageSize\)/);
  assert.doesNotMatch(listLogisticsExpensesSource, /LOGISTICS_EXPENSE_BILL_SORT_SCAN_LIMIT/);
  assert.doesNotMatch(listLogisticsExpensesSource, /prisma\.\$transaction/);
});

test("logistics fee bills support audited voiding without affecting active statistics", () => {
  assert.match(schema, /model LogisticsBill[\s\S]*status\s+String\s+@default\("normal"\)/);
  assert.match(schema, /model LogisticsBill[\s\S]*voidedById\s+String\?\s+@map\("voided_by"\)/);
  assert.match(schema, /model LogisticsBill[\s\S]*voidReason\s+String\?\s+@map\("void_reason"\) @db\.Text/);
  assert.match(schema, /voidedLogisticsBills\s+LogisticsBill\[\]\s+@relation\("LogisticsBillVoidedBy"\)/);
  assert.match(logisticsBillVoidMigration, /ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'normal'/);
  assert.match(logisticsBillVoidMigration, /ADD COLUMN IF NOT EXISTS "void_reason" TEXT/);
  assert.match(logisticsBillVoidMigration, /logistics_bills_void_status_idx/);
  assert.match(logisticsBillStateMachine, /isVoidedLogisticsBill/);
  assert.match(logisticsBillStateMachine, /if \(isVoidedLogisticsBill\(input\)\) return false/);
  assert.match(backend, /export async function voidLogisticsExpenseBill/);
  assert.match(backend, /只有管理员可以作废物流费用账单/);
  assert.match(backend, /作废原因不能为空/);
  assert.match(backend, /已付款账单不能直接作废，请先取消付款或走红冲流程/);
  assert.match(backend, /LOGISTICS_BILL_VOID_COST_LINK_INCOMPLETE/);
  assert.match(backend, /costUpdate\.count !== costIds\.length/);
  assert.match(backend, /LOGISTICS_BILL_VOID_COST_CHANGED/);
  assert.match(backend, /assertBusinessOrderWritableInTransaction/);
  assert.match(backend, /paymentStatus: \{ notIn: \["已付款", "部分付款", "部分已付款"\] \}/);
  assert.match(backend, /paidAt: null/);
  assert.match(backend, /ORDER_COST_STATUS_VOID/);
  assert.match(backend, /writeAudit\(request, actor, "作废物流费用账单"/);
  assert.match(logisticsCostRoute, /action \|\| ""\) === "voidBill"/);
  assert.match(logisticsCostRoute, /voidLogisticsExpenseBill\(request, actor, id, body\)/);
  assert.match(logisticsExpenseQueries, /billStatus: nonEmpty\(query\.get\("billStatus"\) \|\| query\.get\("voidStatus"\) \|\| "normal"\)/);
  assert.match(logisticsExpenseQueries, /if \(text === "voided"\) return \{ status: LOGISTICS_BILL_STATUS_VOIDED \}/);
  assert.match(logisticsExpenseQueries, /bill: \{ is: logisticsExpenseBillVoidStatusWhere\("normal"\) \}/);
  assert.match(backend, /status: \{ not: "voided" \}/);
  assert.match(domesticLogisticsApiSource, /COALESCE\(lb\.status, 'normal'\) <> 'voided'/);
  assert.match(domesticLogisticsApiSource, /COALESCE\(lb\.status, 'normal'\) = 'voided'/);
  assert.match(logisticsFeesModel, /BILL_STATUS_FILTERS/);
  assert.match(logisticsModule, /billStatus=\{billStatus\}/);
  assert.match(logisticsModule, /onBillStatusChange/);
  assert.match(logisticsModule, /作废物流费用账单/);
  assert.match(logisticsModule, /secondaryInputLabel: "备注"/);
  assert.match(logisticsFeesBillTable, /已作废/);
  assert.match(logisticsFeesBillTable, /onVoidBill\(expense\)/);
  assert.match(logisticsFeesShared, /isVoidedLogisticsExpenseBill/);
  assert.match(logisticsFeesShared, /logisticsExpenseBillCanVoid/);
  assert.match(logisticsFeesDetails, /该物流费用账单已作废，仅保留原始金额、附件、发票和操作日志。/);
  assert.match(logisticsFeesDetails, /作废原因/);
});

test("logistics expense approval does not require an invoice and triggers supplier notice", () => {
  assert.match(logisticsReviewRoute, /export async function PATCH/);
  assert.match(
    logisticsReviewRoute,
    /reviewLogisticsExpenseBills\(request, actor, body, \{/,
  );
	assert.match(logisticsReviewRoute, /已通知供应商上传发票/);
	assert.match(logisticsReviewRoute, /开票通知发送失败/);
	assert.match(backend, /export async function reviewLogisticsExpenseBills/);
	assert.match(backend, /normalizeLogisticsExpenseReviewIdentifiers/);
	assert.match(backend, /loadLogisticsExpenseBillRowsForAction/);
	assert.match(backend, /createLogisticsInvoiceApprovalOutboxIntents\(tx, rows, actorId\(actor\), now\)/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /const processDurableSideEffects = async \(\) =>[\s\S]*processLogisticsInvoiceNotificationOutbox/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /options\.deferSideEffects\(async \(\) => \{[\s\S]*await processDurableSideEffects\(\);[\s\S]*\}\)/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /物流费用审核后台任务执行失败/);
	assert.match(backend, /await syncApprovedLogisticsExpenseCosts\(tx, rows, actor, \{/);
	assert.match(backend, /createOrUpdateCostFromLogisticsExpense\(tx, row, actor, \{[\s\S]*settledCostMode,[\s\S]*commissionLockAlreadyHeld: true/);
	assert.match(backend, /linkLogisticsExpenseInvoiceDocumentsToCosts/);
	assert.match(backend, /LOGISTICS_FEE_COST_SOURCE_TYPE/);
	assert.match(backend, /NOTIFICATION_TEMPLATE_TYPES\.LOGISTICS_INVOICE_NOTICE/);
  assert.match(schema, /notification_outbox/);
  assert.match(schema, /notification_delivery_logs/);
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
	assert.match(
		approveLogisticsExpenseBillRowsSource,
		/data: \{[\s\S]*auditStatus: "审核通过"[\s\S]*paymentStatus: "待开票"[\s\S]*invoiceStatus: "待开票"/,
	);
	assert.doesNotMatch(approveLogisticsExpenseBillRowsSource, /invoiceDocumentId|未上传发票|发票.*不能审核通过/);
	assert.match(
		approveLogisticsExpenseBillRowsSource,
		/paymentStatus: \{ notIn: \["已付款", "部分付款", "部分已付款"\] \}/,
	);
	assert.doesNotMatch(backend, /logisticsInvoiceReviewBlockReason|未上传发票，不能审核通过/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /processLogisticsInvoiceNotificationOutbox\(\{[\s\S]*idempotencyKeys: notificationOutboxKeys/);
	assert.match(backend, /logisticsInvoiceApprovalOutboxKey\(billId, approvedAt\)/);
	assert.match(backend, /function paymentStatusUpdateAfterInvoiceProgress/);
	assert.match(backend, /billAuditStatus === "审核通过"/);
	assert.match(backend, /\["已确认", "已确认发票"\]\.includes\(billInvoiceStatus\)/);
	assert.match(backend, /\? \{ paymentStatus: "待付款" \}[\s\S]*: \{ paymentStatus: "待开票" \}/);
  assert.match(backend, /export async function uploadLogisticsExpenseInvoice[\s\S]*lockLogisticsBillForWorkflow\(tx, billId\)[\s\S]*invoiceStatus: aggregateLogisticsExpenseInvoiceStatus\(projectedRows\)[\s\S]*paymentStatusUpdateAfterInvoiceProgress\(projectedRows\)/);
  assert.match(backend, /const expenseUpdate = await tx\.logisticsExpense\.updateMany/);
  assert.match(backend, /expenseUpdate\.count !== targetIds\.length/);
  assert.match(backend, /LOGISTICS_INVOICE_GROUP_CHANGED/);
  assert.match(backend, /const costUpdate = await tx\.orderCost\.updateMany/);
  assert.match(backend, /costUpdate\.count !== costIds\.length/);
  assert.match(backend, /syncLogisticsExpenseCostInvoiceStatus/);
  assert.match(backend, /LOGISTICS_COST_INVOICE_STATE_CHANGED/);
  assert.match(backend, /LOGISTICS_COST_LINK_CHANGED/);
  assert.match(backend, /LOGISTICS_INVOICE_UPLOAD_BILL_CHANGED/);
  assert.match(backend, /export async function confirmLogisticsExpenseInvoice[\s\S]*lockLogisticsBillForWorkflow\(tx, billId\)[\s\S]*LOGISTICS_INVOICE_CONFIRM_BILL_CHANGED/);
  assert.match(
    backend,
    /export async function confirmLogisticsExpenseInvoice[\s\S]*select: \{[\s\S]*billId: true[\s\S]*costType: true[\s\S]*include: includeLogisticsExpenseListRelations\(\)/,
  );
  assert.match(backend, /confirmIds\.includes\(row\.id\)[\s\S]*invoiceStatus: "已确认"[\s\S]*invoiceConfirmedById: actorId\(actor\)[\s\S]*invoiceConfirmedAt: confirmedAt/);
  assert.match(backend, /reviewedById: actor\.id/);
  assert.match(backend, /reviewedAt: now/);
	assert.match(
	    backend,
	    /invoiceNotificationError: null/,
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
    /tx\.logisticsBill\.updateMany/,
  );
  assert.match(backend, /billUpdate\.count !== ids\.length/);
  assert.match(backend, /billUpdate\.count !== 1/);
  assert.match(backend, /LOGISTICS_BILL_STATUS_CHANGED/);
  assert.match(backend, /物流费用账单状态已变化，请刷新后重试。/);
  assert.doesNotMatch(
    approveLogisticsExpenseBillRowsSource,
    /tx\.logisticsExpense\.updateMany\(\{[\s\S]*auditStatus: "审核通过"/,
  );
	assert.match(approveLogisticsExpenseBillRowsSource, /syncApprovedLogisticsExpenseCosts\(tx, savedRows, actor, \{/);
  assert.match(
    approveLogisticsExpenseBillRowsSource,
    /tx\.logisticsExpense\.findMany/,
  );
  assert.match(
    backend,
    /tx\.logisticsBill\.updateMany\(\{[\s\S]*auditStatus: "审核通过"/,
  );
  assert.doesNotMatch(
    `${reviewLogisticsExpenseBillsSource}\n${approveLogisticsExpenseBillRowsSource}`,
    /prisma\.logisticsExpense\.updateMany\(\{[\s\S]*auditStatus: "审核通过"/,
  );
  assert.match(backend, /UPDATE "logistics_expenses"[\s\S]*CASE "id"/);
  assert.match(backend, /tx\.orderDocument\.updateMany/);
  assert.match(backend, /tx\.fileAsset\.updateMany/);
  assert.match(
    reviewLogisticsExpenseBillsSource,
    /await approveLogisticsExpenseBillRowsInTransaction\(request, bill\.rows, actor, reviewRemark, now\)/,
  );
  assert.match(
    reviewLogisticsExpenseBillsSource,
    /物流费用审核提交后重新读取历史账单[\s\S]*loadLogisticsExpenseBillRowsForAction\(bill\.billId, actor\)[\s\S]*logisticsExpenseRowsAfterCommittedApproval/,
  );
  assert.doesNotMatch(
    reviewLogisticsExpenseBillsFunctionSource,
    /notifyLogisticsSupplierInvoiceBills[\s\S]*prisma\.\$transaction/,
  );
  assert.doesNotMatch(
    approveLogisticsExpenseBillRowsSource,
    /tx\.logisticsExpense\.update\(/,
  );
  assert.match(
    approveLogisticsExpenseBillRowsSource,
    /include: includeLogisticsExpenseRelations/,
  );
  assert.match(logisticsReviewRoute, /maskLogisticsReviewTimeoutError/);
  assert.match(logisticsReviewRoute, /审核失败：系统处理超时，请稍后重试。/);
  assert.match(logisticsCostRoute, /maskLogisticsActionTimeoutError/);
  assert.match(logisticsCostRoute, /审核失败：系统处理超时，请稍后重试。/);
  assert.match(logisticsCostRoute, /付款冲销失败：系统处理超时，请稍后重试。/);
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
    /if \(field === "auditStatus"\)[\s\S]*?(?:return logisticsExpenseBillAuditStatus\(items\)|aggregateClientStatusValues\(rows\.map\(logisticsExpenseBillAuditStatusFromRow\), field\))/,
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
  assert.match(backend, /createLogisticsInvoiceRecognitionTask/);
  assert.match(backend, /runLogisticsInvoiceOcrTaskWithTimeout/);
  assert.match(backend, /logisticsInvoiceOcrApiResult/);
  assert.match(backend, /LOGISTICS_INVOICE_OCR_TIMEOUT_MESSAGE/);
  assert.doesNotMatch(backend, /void runNonCriticalTask\("物流发票后台识别"/);
  assert.doesNotMatch(backend, /OCR任务创建失败/);
  assert.match(backend, /id: \{ in: rowIds \}, invoiceDocumentId: task\.documentId/);
  assert.match(backend, /runPendingLogisticsInvoiceOcrTasks/);
  assert.match(backend, /LOGISTICS_INVOICE_GROUP_MIXED_CURRENCY/);
  assert.doesNotMatch(backend, /void runNonCriticalTask\("物流发票重新识别后台执行"/);
  assert.match(backend, /scheduleTaxRefundCompletenessRefresh\(String\(orderId\), "物流发票校验人工确认后退税完整度刷新"\)/);
  assert.match(backend, /recognizeAndValidateLogisticsInvoiceGroup/);
  assert.match(backend, /recognizeLogisticsInvoiceWithOcr/);
  assert.match(backend, /let latestProvider = "TENCENT_CLOUD"/);
  assert.match(backend, /recognized\.apiName \|\| recognized\.source \|\| "VatInvoiceOCR"/);
  assert.doesNotMatch(backend, /latestProvider = "ALIYUN"/);
  assert.match(backend, /LOGISTICS_INVOICE_OCR_MODULE = "LOGISTICS_INVOICE"/);
  assert.match(backend, /LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE = "LOGISTICS_INVOICE"/);
  assert.match(backend, /invoiceValidationStatusCanContinue/);
  assert.match(backend, /summarizeInvoiceValidationBlockReason/);
  assert.match(backend, /mergeValidationIssues\(validation\.issues, parserIssues\)/);
  assert.doesNotMatch(backend, /parserIssues\.length \? parserIssues : validation\.issues/);
  assert.doesNotMatch(backend, /recognizeLogisticsInvoicePdfBuffer|invoiceRecognitionStatus|invoiceRecognitionMessage|invoiceRecognizedAt/);
  assert.match(logisticsModule, /LogisticsInvoiceGroupsPanel/);
  assert.match(logisticsModule, /按费用类型分组上传，同一分组上传一次即可。/);
  assert.match(logisticsModule, /已上传文件列表/);
  assert.match(logisticsModule, /PdfPreviewButton/);
  assert.match(logisticsInvoiceRoute, /export async function DELETE/);
  assert.match(backend, /export async function deleteLogisticsExpenseInvoice/);
  assert.match(backend, /currentPaymentStatus = aggregateLogisticsExpenseStatus\(currentRows, "paymentStatus"\)/);
  assert.match(backend, /LOGISTICS_INVOICE_PAID_DELETE_BLOCKED/);
  assert.match(backend, /invoiceDocumentId: null/);
  assert.match(logisticsModule, /body\.set\("invoiceGroup", group\.key\)/);
  assert.match(invoiceUploadFormSource, /type="file"/);
  assert.match(invoiceUploadFormSource, /选择文件后自动上传/);
  assert.doesNotMatch(
    invoiceUploadFormSource,
    /body\.set\("invoiceNo"|body\.set\("invoiceDate"|body\.set\("invoiceAmount"|body\.set\("remark"/,
  );
  assert.match(logisticsModule, /发票校验/);
  assert.match(logisticsModule, /系统分组合计/);
	assert.match(logisticsModule, /识别发票金额/);
	assert.match(logisticsModule, /系统费用分组/);
	assert.match(logisticsModule, /识别品名/);
  assert.match(logisticsModule, /识别销售方/);
  assert.match(logisticsModule, /识别购买方/);
  assert.match(logisticsModule, /重新识别/);
  assert.match(logisticsModule, /action: "rerunInvoiceRecognition"/);
  assert.match(logisticsModule, /正在识别，请勿关闭页面/);
  assert.match(logisticsModule, /timeoutMs: 65_000/);
  assert.match(logisticsModule, /ButtonSpinnerText text="识别中\.\.\."/);
  assert.match(logisticsModule, /window\.setInterval/);
  assert.match(logisticsModule, /\["识别中", "已上传待识别"\]/);
  assert.match(logisticsModule, /\{ silent: true \}/);
  assert.match(logisticsModule, /人工确认通过/);
  assert.match(logisticsCostRoute, /rerunLogisticsExpenseInvoiceRecognition/);
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

test("logistics ocean freight invoice parser uses foreign currency amount from remark", () => {
  const text = `
    电子发票（增值税专用发票）
    发票号码：26332000005808236626
    价税合计（小写）¥6783.21
    销售方开户账号 USD:19533014040013697
    备注：美元汇率6.79，美金金额999，只接受美元付款。
  `;
  assert.equal(extractLogisticsForeignCurrencyAmount(text, "USD", 999), 999);
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
  assert.match(logisticsModule, /LogisticsExpenseBillActions/);
  assert.match(logisticsModule, /onWithdraw=\{\(item\) => void withdrawExpense\(item\)\}/);
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
	assert.doesNotMatch(logisticsModule, /同一供应商只发送一封邮件/);
	assert.doesNotMatch(logisticsModule, /审核通过并通知开票/);
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
  const rejectBackendSource = readFileSync(
    "lib/platform/logistics-expense-review-reject.ts",
    "utf8",
  );
  assert.match(backend, /export async function rejectLogisticsExpenseBill/);
  assert.match(backend, /loadLogisticsExpenseBillRowsForAction/);
  assert.match(backend, /驳回物流费用必须填写原因/);
  assert.match(backend, /未找到可驳回的物流费用账单/);
  assert.match(backend, /中存在非待审核费用，不能驳回/);
  assert.match(rejectBackendSource, /auditStatus: "已驳回"/);
  assert.match(rejectBackendSource, /FOR UPDATE/);
  assert.match(rejectBackendSource, /LOGISTICS_EXPENSE_REJECT_STATE_CHANGED/);
  assert.doesNotMatch(rejectBackendSource, /invoiceStatus: "待开票"/);
  assert.match(backend, /reviewedById: actor\.id/);
  assert.match(backend, /reviewedAt: now/);
  assert.match(backend, /rejectReason/);
  assert.match(logisticsCostRoute, /reviewAction === "reject"/);
  assert.match(logisticsCostRoute, /物流费用账单已驳回/);
  assert.match(logisticsModule, /title: "驳回物流费用账单"/);
  assert.match(logisticsModule, /inputRequiredMessage: "请填写驳回原因。"/);
  assert.match(logisticsModule, /className=\{styles\.billApproveButton\}/);
  assert.match(logisticsModule, /className=\{styles\.billRejectButton\}/);
	assert.doesNotMatch(logisticsModule, /审核通过并通知开票/);
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
