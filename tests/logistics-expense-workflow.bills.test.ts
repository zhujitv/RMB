import assert from "node:assert/strict";
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
    /sendNotificationEmail\(\{[\s\S]*recipientEmails: resolved\.emails/,
  );
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
    `${reviewLogisticsExpenseBillsSource}\n${approveLogisticsExpenseBillRowsSource}`,
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
