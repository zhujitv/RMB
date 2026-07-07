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

test("logistics expense bill details can add create and delete rows through one local batch save", () => {
  assert.match(logisticsModule, /editingExpenseRows/);
  assert.match(logisticsModule, /newExpenseRows/);
  assert.match(logisticsModule, /deletedExpenseIds/);
  assert.match(logisticsModule, /\+ 新增费用明细/);
  assert.match(logisticsModule, /createTemporaryLogisticsExpenseRow/);
  assert.match(logisticsModule, /logisticsExpenseDraftCreatePayload/);
  assert.match(logisticsFeesShared, /const currency = normalizeCurrencyCode\(safeDraft\.currency \|\| expense\.currency\)/);
  assert.match(logisticsModule, /currencyTouched/);
  assert.match(logisticsModule, /建议币种为 \{recommendedCurrency\}/);
  assert.match(logisticsExpenseDetailLineSource, /aria-label="物流费用币种"[\s\S]*CURRENCIES\.map/);
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
  assert.match(backend, /item\.currency \|\| logisticsCostTypeDefaultCurrency\(costType\)/);
  assert.match(backend, /resolveLogisticsExpenseBatchExchange\(\s*costType,\s*item,\s*baseExpense,\s*actor,\s*currency,\s*index,?\s*\)/);
  assert.match(backend, /LOGISTICS_EXPENSE_CURRENCIES\.includes\(currency\)/);
  assert.doesNotMatch(backend, /logisticsCostTypeDefaultCurrency\(costType\) === "USD"[\s\S]*\? "USD"/);
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
  assert.match(backend, /LOGISTICS_EXPENSE_CONFIRMED_INVOICE_DELETE_BLOCKED/);
  assert.match(backend, /LOGISTICS_EXPENSE_INVOICED_DELETE_BLOCKED/);
  assert.match(backend, /LOGISTICS_EXPENSE_PAID_DELETE_BLOCKED/);
  assert.match(backend, /deletedAt: new Date\(\)/);
  assert.match(backend, /deletedItems: preparedDeletes\.map/);
  assert.match(logisticsExpenseDeleteRoute, /\.\.\.result/);
  assert.match(logisticsExpenseDeleteRoute, /message: "已删除"/);
  assert.match(
    logisticsModule,
    /\/api\/logistics-expenses\/\$\{encodeURIComponent\(expense\.id\)\}/,
  );
  assert.match(logisticsModule, /删除物流费用明细/);
  assert.match(logisticsModule, /确定删除这条费用明细吗？删除后不可恢复，账单金额将自动重新计算。/);
  assert.match(logisticsModule, /const \[deletingId, setDeletingId\]/);
  assert.match(logisticsModule, /删除中\.\.\./);
  assert.match(logisticsModule, /event\.stopPropagation\(\)/);
  assert.match(deleteExpenseSource, /setRows/);
  assert.match(logisticsModule, /removeLogisticsExpenseFromRows/);
  assert.match(logisticsModule, /replaceLogisticsExpenseBillsInRows/);
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
  assert.match(logisticsModule, /status\.includes\("部分"\)[\s\S]*return "未上传发票"[\s\S]*status\.includes\("已上传发票"\)/);
  assert.match(
    logisticsModule,
    /logisticsBillPayState\(\{ auditStatus, invoiceStatus, paymentStatus \}\)/,
  );
  assert.match(backend, /LOGISTICS_PAYMENT_NOT_READY_INVOICE_STATUSES/);
  assert.match(backend, /payment === "待付款"[\s\S]*LOGISTICS_PAYMENT_NOT_READY_INVOICE_STATUSES\.has\(invoice\)[\s\S]*return "待开票"/);
  assert.match(logisticsFeesShared, /paymentStatus === "待付款"[\s\S]*"部分已通知"[\s\S]*"部分上传发票"[\s\S]*return "待开票"/);
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
