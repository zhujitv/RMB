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
  assert.match(backend, /resolveLogisticsSupplierInvoice(?:Email|Recipients)/);
  assert.match(backend, /logisticsInvoiceNotificationAdminEmails/);
  assert.match(backend, /logisticsInvoiceNotificationCcEmails/);
  assert.match(backend, /supplier\.operatorUsers\.email/);
  assert.match(backend, /supplier\.contactEmail/);
  assert.match(backend, /supplier\.financeEmail/);
  assert.match(backend, /物流供应商未配置有效邮箱(?:，已检查|（已检查：)/);
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
    /readNotificationCenterSettings\(actor\)/,
  );
  assert.match(
    notificationTemplateRoute,
    /saveNotificationCenterTemplate\(request, actor, body\)/,
  );
  assert.match(notificationTemplateRoute, /saveLogisticsInvoiceNotificationSettings\(request, actor, body\)/);
  assert.match(
    settingsModule,
    /type SettingsTabKey = "home"[\s\S]*"notificationTemplates"/,
  );
  assert.match(settingsModule, /label: "通知模板"/);
  assert.match(settingsModule, /\/api\/settings\/notification-templates/);
  assert.match(settingsModule, /NotificationTemplateSettingsCard/);
  assert.match(settingsModule, /邮件通知中心/);
  assert.match(settingsModule, /物流开票触发与收件人/);
  assert.match(settingsModule, /默认抄送管理员/);
  assert.match(settingsModule, /额外抄送邮箱/);
  assert.match(settingsModule, /recipientEmailFields/);
  assert.match(settingsModule, /ccAdminEmails/);
  assert.match(settingsModule, /ccEmails/);
  assert.match(settingsModule, /保存通知模板/);
  assert.match(settingsModule, /发送测试邮件/);
  assert.match(settingsModule, /最近发送记录/);
  assert.match(settingsModule, /可用变量/);
  assert.match(settingsModule, /模板预览/);
  assert.match(settingsModule, /审核通过后自动发送/);
});

test("notification template editor keeps formal fields editable and persists current state", () => {
  assert.match(
    notificationTemplateCardSource,
    /value=\{String\(extraConfig\.invoiceRequirements \|\| ""\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setExtraField\("invoiceRequirements", event\.target\.value\)\}/,
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
    /value=\{String\(extraConfig\.uploadUrl \|\| ""\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setExtraField\("uploadUrl", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{currentForm\.subjectTemplate\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setField\("subjectTemplate", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{String\(extraConfig\.batchSubjectTemplate \|\| ""\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setExtraField\("batchSubjectTemplate", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /value=\{String\(extraConfig\.signature \|\| ""\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /onChange=\{\(event\) => setExtraField\("signature", event\.target\.value\)\}/,
  );
  assert.match(
    notificationTemplateCardSource,
    /<textarea readOnly value=\{preview\}/,
  );
  assert.doesNotMatch(
    notificationTemplateCardSource,
    /value=\{currentForm\.(bodyTemplate|ccEmails|subjectTemplate)\}[\s\S]{0,120}disabled/,
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
    /notificationTemplateRows\(settings\)/,
  );
  assert.match(
    notificationTemplateFormSource,
    /notificationTemplateFormFromTemplate\(selected\)/,
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
