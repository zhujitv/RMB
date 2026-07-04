import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readTaxRefundModuleSource } from "./source-helpers.ts";

const workbenchRules = await import("../lib/platform/workbench-todo-rules.ts");
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");
const workspaceLayout = readFileSync("app/WorkspaceLayout.tsx", "utf8");
const welcomePanel = readFileSync("app/WelcomePanel.tsx", "utf8");
const profitModule = readFileSync("app/modules/ProfitModule.tsx", "utf8");
const taxRefundModule = readTaxRefundModuleSource();
const controlTower = readFileSync("app/modules/domestic-logistics/control-tower.tsx", "utf8");
const route = readFileSync("app/api/workbench/todos/route.ts", "utf8");
const overdueRoute = readFileSync("app/api/cron/workbench-overdue-todos/route.ts", "utf8");
const workbenchSource = [
  "lib/platform/workbench-todos.ts",
  "lib/platform/workbench-todos-core.ts",
  "lib/platform/workbench-todos-sources.ts",
  "lib/platform/workbench-todos-completed.ts",
].map((path) => readFileSync(path, "utf8")).join("\n");
const missingTaxRefundTodosSource = workbenchSource.match(/function missingTaxRefundTodos[\s\S]*?function normalizedMissingLabels/)?.[0] || "";
const reminderSource = readFileSync("lib/platform/workbench-todo-reminders.ts", "utf8");
const notificationEngineSource = readFileSync("lib/platform/notification-engine.ts", "utf8");
const sharedConstantsSource = readFileSync("lib/platform/shared-constants.ts", "utf8");
const sharedExchangeSource = readFileSync("lib/platform/shared-exchange.ts", "utf8");
const settingsHelpersSource = readFileSync("app/modules/settings/helpers.ts", "utf8");
const settingsCardsSource = readFileSync("app/modules/settings/settings-cards.tsx", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");
const styles = readFileSync("app/styles/workspace-shell/workbench.module.css", "utf8");

test("workbench todo priority follows due date rules", () => {
  const now = new Date("2026-07-01T04:00:00.000Z");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-06-30T15:59:59.000Z", now), "urgent");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-07-01T15:59:59.000Z", now), "urgent");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-07-03T15:59:59.000Z", now), "important");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-07-08T15:59:59.000Z", now), "normal");
  assert.equal(workbenchRules.todoPriorityFromDueAt(null, now), "normal");
});

test("workbench todo summary counts pending, today due, overdue and completed", () => {
  const now = new Date("2026-07-01T04:00:00.000Z");
  const base = {
    module: "物流费用",
    orderId: "order-1",
    orderNo: "NW-1",
    customerShortName: "ABC",
    ownerName: "张三",
    action: { label: "处理", href: "/logistics-fees?keyword=NW-1" },
  };
  const summary = workbenchRules.summarizeWorkbenchTodos([
    { ...base, id: "overdue", type: "A", title: "逾期", priority: "urgent", status: "pending", dueAt: "2026-06-30T15:59:59.000Z" },
    { ...base, id: "today", type: "B", title: "今日", priority: "urgent", status: "pending", dueAt: "2026-07-01T15:59:59.000Z" },
    { ...base, id: "normal", type: "C", title: "普通", priority: "normal", status: "pending", dueAt: null },
  ], 5, now);
  assert.deepEqual(summary, {
    pending: 3,
    todayDue: 1,
    overdue: 1,
    completed: 5,
    total: 3,
    urgent: 2,
  });
});

test("workbench todos api uses backend aggregation and current actor", () => {
  assert.match(route, /requireApiActor\(request\)/);
  assert.match(route, /listWorkbenchTodos\(actor\)/);
  assert.match(workbenchSource, /orderAccessWhere\(actor\)/);
  assert.match(workbenchSource, /supplierId: actorSupplierId\(actor\) \|\| "__no_supplier_bound__"/);
  assert.match(workbenchSource, /status: \{ notIn: PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE \}/);
  assert.match(workbenchSource, /refreshTaxRefundCompletenessBatch/);
  assert.match(workbenchSource, /canActivateTodo/);
  assert.match(workbenchSource, /\.filter\(canActivateTodo\)/);
  assert.match(workbenchSource, /flowStage: activationRule\.flowStage/);
  assert.match(workbenchSource, /prerequisiteStage: activationRule\.prerequisiteStage \|\| null/);
  assert.match(workbenchSource, /activationCondition: activationRule\.activationCondition/);
  assert.match(workbenchSource, /status: input\.status \|\| "ACTIVE"/);
  assert.match(workbenchRules.WORKBENCH_TODO_ACTIVATION_RULES.LOGISTICS_INVOICE_UPLOAD.activationCondition, /invoice notification has been sent/);
  assert.equal(workbenchRules.canActivateTodo({ status: "ACTIVE" }), true);
  assert.equal(workbenchRules.canActivateTodo({ status: "BLOCKED" }), false);
  assert.equal(workbenchRules.canActivateTodo({ status: "DRAFT" }), false);
  for (const completedType of [
    "CUSTOMER_PAYMENT_CONFIRMED",
    "FACTORY_PAYMENT_COMPLETED",
    "SUPPLIER_DOCUMENT_RETURN_COMPLETED",
    "LOGISTICS_FEE_REVIEW_COMPLETED",
    "LOGISTICS_INVOICE_UPLOAD_COMPLETED",
    "LOGISTICS_PAYMENT_REGISTER_COMPLETED",
    "TAX_REFUND_ARCHIVED",
    "COMMISSION_SETTLED",
    "CONTAINER_TRACKING_SYNCED",
  ]) {
    assert.notEqual(
      workbenchRules.todoActivationRuleForType(completedType).activationCondition,
      "source-specific active business condition",
    );
  }
  assert.match(workbenchSource, /listCustomerPaymentTodos\(context\)/);
  assert.match(workbenchSource, /listFactoryPaymentTodos\(context\)/);
  assert.match(workbenchSource, /listProfitTodos\(context\)/);
  assert.match(workbenchSource, /listOceanTrackingTodos\(context\)/);
  assert.match(workbenchSource, /supplierDocumentRequestHasFactoryCost/);
  assert.match(workbenchSource, /rows\.filter\(supplierDocumentRequestHasFactoryCost\)\.map/);
  assert.match(workbenchSource, /completedTodayTodos\(context\)/);
  assert.match(workbenchSource, /completedTodos/);
  assert.match(workbenchSource, /CUSTOMER_PAYMENT_CONFIRMATION/);
  assert.match(workbenchSource, /PAYMENT_VOUCHER_UPLOAD/);
  assert.match(sharedConstantsSource, /PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE = "2026-06-30"/);
  assert.match(sharedConstantsSource, /paymentVoucherReminderStartDate: PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE/);
  assert.match(sharedExchangeSource, /paymentVoucherReminderStartDate: normalizeSettingsDate/);
  assert.match(settingsHelpersSource, /paymentVoucherReminderStartDate: stringSetting\(settings, "paymentVoucherReminderStartDate", "2026-06-30"\)/);
  assert.match(settingsCardsSource, /付款凭证提醒启用日期/);
  assert.match(workbenchSource, /paymentVoucherReminderStartDateFromSettings/);
  assert.match(workbenchSource, /getExchangeRateSettings\(\)/);
  assert.match(workbenchSource, /paymentVoucherReminderStartDate: paymentVoucherReminderStartDateFromSettings\(exchangeRateSettings\)/);
  assert.match(workbenchSource, /\{ paid: true \}[\s\S]*\{ paymentDate: \{ gte: context\.paymentVoucherReminderStartDate \} \}[\s\S]*\{ paymentVoucherStorageKey: null \}/);
  assert.match(workbenchSource, /handledCostIds/);
  assert.match(workbenchSource, /shouldCreateProfitCostIncompleteTodo/);
  assert.match(workbenchSource, /PROFIT_COST_REVIEW_STATUSES/);
  assert.match(workbenchSource, /doneSupplierDocumentRequests\(workflowOrder\)/);
  assert.match(workbenchSource, /supplierDocumentRequestsForFactoryCosts/);
  assert.match(workbenchSource, /if \(nonEmpty\(row\.costId\)\) return isActiveFactorySupplierCostRef\(row\.cost, supplierId\)/);
  assert.match(workbenchSource, /if \(!costs\.length\) return false/);
  assert.match(workbenchSource, /cost\.sourceType !== "LOGISTICS_EXPENSE"/);
  assert.match(workbenchSource, /return requestsDone && supplierDocumentsUploadedForFactoryCosts\(order\)/);
  assert.match(workbenchSource, /supplierDocumentRequestMatchesCost/);
  assert.match(workbenchSource, /supplierDocumentRequests = \(\(cost\.order as WorkbenchWorkflowOrder\)\.supplierDocumentRequests \|\| \[\]\)[\s\S]*supplierDocumentRequestMatchesCost/);
  assert.match(workbenchSource, /orderEnteredLogisticsStage\(workflowOrder\)/);
  assert.match(workbenchSource, /logisticsSupplierAssigned\(workflowOrder\)/);
  assert.match(workbenchSource, /function logisticsBillReviewAccessWhere/);
  assert.match(workbenchSource, /isAdmin\(actor\) \|\| isFinance\(actor\) \|\| isSalesperson\(actor\)/);
  assert.match(workbenchSource, /reviewAccessWhere/);
  assert.match(workbenchSource, /invoiceNotifiedAt: \{ not: null \}/);
  assert.match(workbenchSource, /LOGISTICS_PAYMENT_READY_INVOICE_STATUSES = \["已确认", "已确认发票"\]/);
  assert.match(workbenchSource, /type: "TAX_CUSTOMS_DECLARATION_MISSING"[\s\S]*title: "报关资料待上传"[\s\S]*module: "物流信息"/);
  assert.match(workbenchSource, /documents: \{[\s\S]*some: \{[\s\S]*documentType: "CUSTOMS_ENTRY_FORM"[\s\S]*uploadStatus: "SUCCESS"/);
  assert.match(workbenchSource, /customsDeclarationUploaded\(workflowOrder\)/);
  assert.doesNotMatch(missingTaxRefundTodosSource, /TAX_CUSTOMS_DECLARATION_MISSING/);
  assert.match(workbenchSource, /supplierDocumentBlockedOrderIds\.has\(order\.id\)/);
  assert.match(workbenchSource, /supplierDocumentBlockedOrderIds\.has\(order\.id\) \|\| !doneSupplierDocumentRequests\(workflowOrder\)/);
  assert.match(workbenchSource, /summary\.commissionCanSettle && taxFinalized/);
  assert.match(workbenchSource, /hasProfitException && summary\.allCostsConfirmed && summary\.logisticsCostConfirmed && taxFinalized/);
  assert.match(workbenchSource, /listShipsgoControlTowerTrackings\(new URLSearchParams\(\), actor\)/);
  assert.match(workbenchSource, /summarizeOrder\(order, commissionFormulaSettings\)/);
  assert.match(workbenchSource, /sourceTypes:[\s\S]*"payments"[\s\S]*"factoryPayments"[\s\S]*"profit"[\s\S]*"oceanTracking"/);
});

test("workbench todos distinguish ownership from visibility", () => {
  assert.match(workbenchSource, /ownerUserId\?: string \| null/);
  assert.match(workbenchSource, /ownerUserIds\?: string\[\]/);
  assert.match(workbenchSource, /ownerRole\?: WorkbenchTodoOwnerRole/);
  assert.match(workbenchSource, /visibleToUserIds: string\[\]/);
  assert.match(workbenchSource, /isMine: boolean/);
  assert.match(workbenchSource, /function logisticsOwnerForOrder\(context: WorkbenchTodoContext, order: TodoOrder\)/);
  assert.match(workbenchSource, /supplierOwner\(context, assigned\.supplier, "LOGISTICS_SUPPLIER", "物流供应商"\)/);
  assert.match(workbenchSource, /owner: logisticsOwner/);
  assert.match(workbenchSource, /owner: bill\.supplier \? supplierOwner\(context, bill\.supplier, "LOGISTICS_SUPPLIER", "物流供应商"\) : logisticsOwnerForOrder\(context, bill\.order\)/);
  assert.match(workbenchSource, /function taxRefundArchiveOwner\(context: WorkbenchTodoContext, order\?: TodoOrder\): TodoOwner/);
  assert.match(workbenchSource, /function taxRefundArchiveCompanyKeysForOrder\(context: WorkbenchTodoContext, order: TodoOrder\)/);
  assert.match(workbenchSource, /taxRefundArchiveCompanyOwnerUsersByKey: Map<string, TodoUser\[\]>/);
  assert.match(workbenchSource, /taxRefundArchiveFinanceUsers = users\.filter\(\(user\) => user\.role === "财务" && canWrite\(user, "taxRefund"\)\)/);
  assert.match(workbenchSource, /taxRefundArchiveConfiguredOwnerUsers/);
  assert.match(workbenchSource, /taxRefundArchiveCompanyOwnerEntriesFromSetting/);
  assert.match(workbenchSource, /systemCompanyKeysFromProfile\(companyProfileSetting\?\.value\)/);
  assert.match(workbenchSource, /owner: taxRefundArchiveOwner\(context, orderWithCompleteness\)/);
  assert.match(workbenchSource, /owner: taxRefundArchiveOwner\(context, order\)/);
  assert.match(workbenchSource, /type: "TAX_REFUND_READY_NOT_ARCHIVED"[\s\S]*title: "已满足退税条件但未归档"[\s\S]*module: "退税资料"/);
  assert.match(workbenchSource, /dueAt: order\.taxRefundCompletenessUpdatedAt \|\| order\.updatedAt/);
  assert.match(workbenchSource, /status: "READY"[\s\S]*action: "submitTaxArchive"/);
  assert.match(workbenchSource, /isMine: Boolean\(actorUserId && \(owner\.ownerUserId === actorUserId \|\| \(owner\.ownerUserIds \|\| \[\]\)\.includes\(actorUserId\)\)\)/);
});

test("workbench overdue reminder cron sends one email per owner per day", () => {
  assert.match(schema, /model TodoReminderLog/);
  assert.match(schema, /@@unique\(\[todoId, ownerUserId, reminderDate\]/);
  assert.match(overdueRoute, /assertCronSecret\(request\)/);
  assert.match(overdueRoute, /sendOverdueWorkbenchTodoReminders\(actor\)/);
  assert.match(reminderSource, /listWorkbenchTodos\(actor\)/);
  assert.match(reminderSource, /todo\.status === "ACTIVE"/);
  assert.match(reminderSource, /overdueDays > OVERDUE_REMINDER_DAYS/);
  assert.match(reminderSource, /MULTI_OWNER_REMINDER_TODO_TYPES = new Set\(\["TAX_REFUND_READY_NOT_ARCHIVED"\]\)/);
  assert.match(reminderSource, /function reminderOwnerUserIds\(todo: WorkbenchTodo\)/);
  assert.match(reminderSource, /reminderOwnerUserIds\(todo\)\.map\(\(ownerUserId\) => \(\{ todo, overdueDays, ownerUserId \}\)\)/);
  assert.match(reminderSource, /todoId_ownerUserId_reminderDate/);
  assert.match(reminderSource, /sendNotificationEmail/);
  assert.match(reminderSource, /WORKBENCH_TODO_OVERDUE/);
  assert.match(reminderSource, /emailStatus: "SKIPPED"/);
  assert.match(notificationEngineSource, /【NEXTWOOD ERP】待办事项已逾期超过 5 天/);
  assert.match(vercelConfig, /\/api\/cron\/workbench-overdue-todos/);
});

test("workbench home and topbar consume unified todo DTO without opening new windows", () => {
  assert.match(workspaceShell, /apiJson<Partial<WorkbenchTodosState>>\("\/api\/workbench\/todos"/);
  assert.match(workspaceShell, /completedTodos: Array\.isArray\(result\.completedTodos\) \? result\.completedTodos : \[\]/);
  assert.match(workspaceShell, /function openWorkbenchTodo\(todo: WorkbenchTodo\)/);
  assert.match(workspaceShell, /setActiveMenu\("logisticsFees"\)/);
  assert.match(workspaceShell, /setActiveMenu\("profit"\)/);
  assert.match(workspaceShell, /setActiveMenu\("oceanControlTower"\)/);
  assert.match(workspaceShell, /setActiveMenu\("supplierDocuments"\)/);
  assert.match(workspaceShell, /path === "ocean-control-tower"/);
  assert.match(workspaceShell, /setTaxRefundFocus\(\{ keyword, action: parsed\.searchParams\.get\("action"\) \|\| "", token \}\)/);
  assert.match(workspaceShell, /initialAction=\{taxRefundFocus\.action\}/);
  assert.match(workspaceShell, /setTaxRefundFocus\(\{ keyword: value, action: "", token: Date\.now\(\) \}\)/);
  assert.match(taxRefundModule, /initialAction = ""/);
  assert.match(taxRefundModule, /initialAction === "submitTaxArchive" \? "READY" : statusFilter/);
  assert.match(taxRefundModule, /if \(initialAction === "submitTaxArchive"\) setStatusFilter\("READY"\)/);
  assert.match(taxRefundModule, /const matched = nextRows\.find\(\(row\) => row\.orderNo === value\) \|\| nextRows\[0\]/);
  assert.match(profitModule, /initialKeyword = ""/);
  assert.match(profitModule, /setDetailRow\(matched\)/);
  assert.match(controlTower, /initialKeyword = ""/);
  assert.match(controlTower, /orderNo: value/);
  assert.match(workspaceLayout, /待办 \{pendingCount\}/);
  assert.match(workspaceLayout, /topTodos = workbenchTodos\.todos\.slice\(0, 10\)/);
  assert.match(workspaceLayout, /onClick=\{\(\) => handleOpenTodo\(todo\)\}/);
  assert.doesNotMatch(workspaceLayout, /target="_blank"/);
  assert.match(welcomePanel, /待处理/);
  assert.match(welcomePanel, /今日到期/);
  assert.match(welcomePanel, /已逾期/);
  assert.match(welcomePanel, /已完成/);
  assert.match(welcomePanel, /workScope === "mine" && !todo\.isMine/);
  assert.match(welcomePanel, /\(todosState\.completedTodos \|\| \[\]\)\.filter\(\(todo\) => todoMatchesFilters\(todo, filters\)\)/);
  assert.match(welcomePanel, /completed: filteredCompletedTodos\.length/);
  assert.match(welcomePanel, /负责人角色/);
  assert.match(welcomePanel, /当前筛选 \$\{summary\.pending\} 条待处理事项/);
  assert.match(styles, /overflow: hidden;/);
  assert.match(styles, /table-layout: fixed;/);
  assert.match(styles, /\.workbenchFilters/);
});
