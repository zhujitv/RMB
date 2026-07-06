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
  assert.match(logisticsModule, /LogisticsExpenseBillActions/);
  assert.match(logisticsModule, /onSubmitDraft=\{\(item\) => void submitDraftExpenseBill\(item\)\}/);
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
  assert.match(backend, /账单\$\{billStatus \|\| "当前状态"\}，不能保存明细，请先撤回为草稿。/);
  assert.match(backend, /不能修改明细，请先撤回为草稿。/);
  assert.match(backend, /不能删除明细，请先撤回为草稿。/);
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
    /提交审核|撤回账单|审核通过|驳回/,
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
  assert.match(logisticsExpenseBatchRoute, /LOGISTICS_EXPENSE_BATCH_UPDATE_DEPRECATED/);
  assert.doesNotMatch(logisticsExpenseBatchRoute, /batchUpdateLogisticsExpenses/);
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
