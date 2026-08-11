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
  reviewLogisticsExpenseBillsFunctionSource,
  logisticsInvoiceNotificationOutboxSource,
  approveLogisticsExpenseBillRowsSource,
  updateLogisticsExpensePaymentStatusSource,
  logisticsCostRoute,
  logisticsInvoiceRoute,
  logisticsReviewRoute,
  logisticsNotificationOutboxCronRoute,
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
  logisticsSupplierStatementSource,
  vercelConfigSource,
} from "./logistics-expense-workflow-context.ts";

test("approved logistics expenses notify supplier contacts without coupling email delivery to approval", () => {
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
  assert.match(backend, /供应商联系人邮箱[\s\S]*supplier\.email/);
  assert.doesNotMatch(backend, /field: "supplier\.(?:contactEmail|financeEmail)"/);
  assert.match(backend, /物流供应商未配置有效邮箱(?:，已检查|（已检查：)/);
  assert.match(backend, /物流费用审核通过，请上传发票/);
  assert.match(backend, /recipientEmails: resolved\.emails/);
  assert.match(backend, /role: "管理员"/);
  assert.match(backend, /applyLogisticsExpenseInvoiceNotificationResults/);
  assert.match(backend, /重新发送物流费用开票通知/);
	assert.doesNotMatch(backend, /invoiceStatus: nextInvoiceStatus/);
	assert.match(backend, /invoiceNotifiedAt: result\.sent \? now : row\.invoiceNotifiedAt/);
  assert.match(
    backend,
    /invoiceNotificationError: result\.sent \|\| result\.skipped \? null/,
  );
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /const approval = await approveLogisticsExpenseBillsInTransaction[\s\S]*const outboxIntents = approval\?\.outboxIntents \|\| \[\]/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /costIdByExpenseId\.set\(link\.expenseId, link\.costId\)/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /notificationOutboxKeys\.push\(\.\.\.outboxIntents\.map/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /const processDurableSideEffects = async \(\) =>/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /processLogisticsInvoiceNotificationOutbox\(\{[\s\S]*idempotencyKeys: notificationOutboxKeys/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /refreshTaxRefundCompletenessBatch\(orderIds\)/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /invalidateWorkbenchTodosCache\(\)/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /options\.deferSideEffects\(async \(\) => \{[\s\S]*await processDurableSideEffects\(\);[\s\S]*\}\)/);
	assert.doesNotMatch(reviewLogisticsExpenseBillsFunctionSource, /notifyLogisticsSupplierInvoiceBills|scheduleLogisticsExpenseReviewSideEffects/);
	assert.match(approveLogisticsExpenseBillRowsSource, /createLogisticsInvoiceApprovalOutboxIntents\(tx, rows, actorId\(actor\), now\)/);
	assert.match(approveLogisticsExpenseBillRowsSource, /const auditEntries: LogisticsExpenseApprovalAuditEntry\[\][\s\S]*notificationOutboxId:/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /approvalAuditEntries\.push\(\.\.\.\(approval\?\.auditEntries \|\| \[\]\)\)[\s\S]*runNonCriticalTask\([\s\S]*"物流费用审核日志写入"[\s\S]*writeAudit\(request, actor, "审核通过物流费用账单"/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX = "logistics-invoice-approval:"/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /return `\$\{LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX\}\$\{nonEmpty\(billId\)\}:\$\{approvedAtIso\}`/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /tx\.notificationOutbox\.createMany\(\{ data: intents, skipDuplicates: true \}\)/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /persisted\.length !== keys\.length[\s\S]*LOGISTICS_INVOICE_OUTBOX_INCOMPLETE/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /const claimed = await prisma\.notificationOutbox\.updateMany\([\s\S]*status: \{ in: \["pending", "failed"\] \}[\s\S]*status: "sending", updatedAt: \{ lte: staleBefore \}[\s\S]*attempts: \{ increment: 1 \}/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /relatedEntityType: "logistics_bills"[\s\S]*idempotencyKey: \{ startsWith: LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX \}/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /where: \{ id: outbox\.id, status: "sending", attempts: outbox\.attempts \}/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /currentReviewedAt !== nonEmpty\(context\.approvedAt\)/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /nonEmpty\(currentBill\?\.invoiceStatus\) !== "待开票"/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /if \(options\.idempotencyKeys && !keys\.length\)[\s\S]*scanned: 0/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /persistLogisticsInvoiceDeliverySuccess[\s\S]*prisma\.\$transaction\(async \(tx\)[\s\S]*notificationOutbox\.updateMany[\s\S]*notificationDeliveryLog\.create[\s\S]*logisticsExpense\.updateMany[\s\S]*logisticsBill\.updateMany/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /persistLogisticsInvoiceDeliveryFailure[\s\S]*scheduledAt[\s\S]*status: "failed"/);
	assert.match(logisticsInvoiceNotificationOutboxSource, /for \(const candidate of candidates\) \{\s*results\.push\(await processLogisticsInvoiceNotificationOutboxRow\(candidate\.id\)\)/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /const successCount = approvedBillIds\.length/);
	assert.match(reviewLogisticsExpenseBillsSource, /costId: costIdByExpenseId\.get\(row\.id\) \|\| row\.costId/);
	assert.match(reviewLogisticsExpenseBillsFunctionSource, /notificationQueued,[\s\S]*开票通知已进入后台发送队列/);
	assert.match(logisticsReviewRoute, /费用已审核并同步成本，开票通知发送失败/);
	assert.match(logisticsReviewRoute, /物流费用已审核，已通知供应商上传发票/);
	assert.match(logisticsReviewRoute, /deferSideEffects: \(task\) => after\(task\)/);
	assert.match(logisticsReviewRoute, /maxDuration = 300/);
	assert.match(logisticsCostRoute, /deferSideEffects: \(task\) => after\(task\)/);
	assert.match(logisticsCostRoute, /maxDuration = 300/);
	assert.match(logisticsNotificationOutboxCronRoute, /assertCronSecret\(request\)/);
	assert.match(logisticsNotificationOutboxCronRoute, /processLogisticsInvoiceNotificationOutbox\(\{ limit: 8 \}\)/);
	assert.match(logisticsNotificationOutboxCronRoute, /maxDuration = 300/);
	assert.match(vercelConfigSource, /"path": "\/api\/cron\/notification-outbox"[\s\S]*"schedule": "\*\/5 \* \* \* \*"/);
	assert.match(backend, /isLegacyLogisticsTemplateFingerprint/);
	assert.match(backend, /signal: resendRequestSignal\(\)/);
	assert.match(backend, /await assertResendResponseOk\(response\)/);
	assert.match(backend, /createOutboundTimeoutSignal\(timeoutMs\)/);
	assert.match(backend, /RESEND_ERROR_RESPONSE_MAX_BYTES = 256 \* 1024/);
	assert.match(backend, /readResponseTextLimited\(response, RESEND_ERROR_RESPONSE_MAX_BYTES\)/);
	assert.match(backend, /if \(providerDelivered\)[\s\S]*sent: true[\s\S]*trackingError: message/);
});

test("backend displays logistics supplier upload access without offering email for disabled access", () => {
  assert.match(settingsModule, /label: "发票上传"/);
  assert.match(settingsModule, /row\.allowLogisticsInvoiceUpload \? "已开通" : "未开通"/);
  assert.doesNotMatch(settingsModule, /未开通 · 需邮件通知/);
  assert.doesNotMatch(logisticsFeesDetails, /suppliersWithoutInvoiceUpload|未开通后台发票上传权限|发送开票通知邮件/);
  assert.match(logisticsFeesDetails, /canReview && canNotifySupplier && hasInvoiceNoticeFailure/);
  assert.match(backend, /expense\.supplier\?\.allowLogisticsInvoiceUpload !== true\) return/);
  assert.match(backend, /group\.supplier\?\.allowLogisticsInvoiceUpload !== true/);
  assert.match(logisticsInvoiceNotificationOutboxSource, /未开通物流发票上传权限，不发送开票通知邮件/);
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
  assert.doesNotMatch(settingsModule, /发送测试邮件/);
  assert.doesNotMatch(settingsModule, /\/api\/settings\/notification-templates\/test/);
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
