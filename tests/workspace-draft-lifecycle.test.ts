import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readAccountSettingsSource,
  readCostsModuleSource,
  readCustomerCommunicationModuleSource,
  readLogisticsFeesModuleSource,
  readOrdersModuleSource,
  readPaymentsModuleSource,
  readSupplierDocumentsModuleSource,
} from "./source-helpers.ts";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("order business-entity transfer participates in draft and busy protection", () => {
  const drawer = source("app/modules/orders/detail-drawer.tsx");
  const module = source("app/modules/OrdersModule.tsx");
  const orderActions = source("app/modules/orders/use-order-edit-actions.ts");
  const panel = source("app/modules/orders/quick-order-panel.tsx");

  assert.match(drawer, /useWorkspaceTabDirty\(transferDirty\)/);
  assert.match(drawer, /useWorkspaceTabBusy\(transferring\)/);
  assert.match(drawer, /onBeforeBusinessEntityTransfer && !onBeforeBusinessEntityTransfer\(order\.id\)/);
  assert.match(module, /function confirmBeforeBusinessEntityTransfer\(orderId: string\)/);
  assert.match(module, /if \(workspaceTab\?\.busy\) \{\s*window\.alert\("当前订单操作正在进行，请完成后再转移业务主体。"\);\s*return false;\s*\}\s*if \(!orderEditDirty/);
  assert.match(module, /if \(!orderEditDirty \|\| editOrder\?\.id !== orderId\) return true/);
  assert.match(module, /setEditOrder\(null\)/);
  assert.match(module, /if \(editOrder\?\.id && editOrder\.id === order\?\.id\) \{\s*openEditOrder\(editOrder, options\);\s*return;/);
  assert.match(orderActions, /setEditOrder\(\(current\) => current && current\.id === orderId \? \{ \.\.\.current, \.\.\.patch \} : current\)/);
  assert.match(panel, /onDirtyChange\?\.\(controller\.dirty\)/);
});

test("order and payment conflicts preserve the attempted editor draft", () => {
  const orderController = source("app/modules/orders/quick-order-panel-controller.ts");
  const orderActions = source("app/modules/orders/use-order-edit-actions.ts");
  const payments = source("app/modules/PaymentsModule.tsx");
  const paymentActions = source("app/modules/payments/use-payment-record-actions.ts");
  const paymentDrawer = source("app/modules/payments/payment-detail-drawer.tsx");
  const paymentConflict = payments.slice(
    payments.indexOf("onConflict={async"),
    payments.indexOf("onSaved=", payments.indexOf("onConflict={async")),
  );

  assert.doesNotMatch(orderController, /if \(latestOrder\) \{\s*loadOrderSnapshot\(latestOrder\)/);
  assert.match(orderController, /本次未保存内容已保留/);
  assert.match(orderActions, /preserveEditDraft: true/);
  assert.doesNotMatch(paymentConflict, /setEditPayment\(null\)/);
  assert.match(paymentConflict, /本次未保存内容仍保留在编辑区/);
  assert.match(payments, /if \(editPayment\?\.id === detailPayment\.id\) \{\s*setCreateOpen\(false\);\s*setEditPayment\(editPayment\);\s*return;/);
  assert.match(payments, /if \(!createOpen && editPayment\?\.id !== paymentId\) return true/);
  assert.match(payments, /function ensurePaymentTabIdle\(\) \{\s*if \(!workspaceBusyRef\.current\) return true/);
  assert.match(payments, /function confirmDiscardPaymentDraftBeforeMutation\(paymentId: string\) \{\s*if \(!ensurePaymentTabIdle\(\)\) return false/);
  assert.match(payments, /busy=\{Boolean\(workspaceTab\?\.busy\)\}/);
  assert.match(payments, /beforeMutation: \(\) => confirmDiscardPaymentDraftBeforeMutation\(paymentId\)/);
  assert.match(paymentActions, /if \(!result\.confirmed\) return;\s*if \(!options\.beforeMutation\(\)\) return;\s*options\.setDeletingId/);
  assert.match(paymentActions, /if \(!result\.confirmed\) return;\s*if \(!options\.beforeMutation\(\)\) return;\s*options\.setConfirmingId/);
  assert.match(paymentDrawer, /disabled=\{busy \|\| confirming\}/);
  assert.match(paymentDrawer, /disabled=\{busy\} onClick=\{onEdit\}/);
  assert.match(paymentDrawer, /disabled=\{busy \|\| deleting\}/);
});

test("settings force-delete guards dirty editors and only clears the deleted user", () => {
  const panels = source("app/modules/settings/module-edit-panels.tsx");
  const actions = source("app/modules/settings/use-settings-controller-actions.ts");

  assert.match(panels, /onForceDeleteRejectedUser=\{\(user: UserRow\) => \{\s*if \(!confirmDiscardCurrentSettings\(\)\) return/);
  assert.match(actions, /setUserForm\(\(current\) => current\?\.id === user\.id \? null : current\)/);
  assert.match(actions, /setSelectedUserId\(\(current\) => current === user\.id \? "" : current\)/);
});

test("control-tower sync busy state survives the view component and blocks navigation", () => {
  const module = source("app/modules/DomesticLogisticsModule.tsx");
  const view = source("app/modules/domestic-logistics/module-view.tsx");
  const controlTower = source("app/modules/domestic-logistics/control-tower.tsx");

  assert.match(module, /controlTowerSyncingId \|\| archiving/);
  assert.match(view, /disabled=\{Boolean\(controlTowerSyncingId\)\}/);
  assert.match(view, /syncingId=\{controlTowerSyncingId\}/);
  assert.match(controlTower, /onSyncingChange\(row\.id\)/);
  assert.match(controlTower, /onSyncingChange\(""\)/);
  assert.doesNotMatch(controlTower, /useState\(""\).*syncingId/);
});

test("busy forms become inert until their async mutation settles", () => {
  const expected = [
    ["orders", readOrdersModuleSource(), /inert=\{controller\.saving\}/],
    ["payments", readPaymentsModuleSource(), /inert=\{saving\}/],
    ["costs", readCostsModuleSource(), /inert=\{controller\.saving\}/],
    ["logistics fees", readLogisticsFeesModuleSource(), /inert=\{saving\}/],
    ["logistics fee details", readLogisticsFeesModuleSource(), /inert=\{saving\}/],
    ["account", readAccountSettingsSource(), /inert=\{busy\}/],
    ["supplier documents", readSupplierDocumentsModuleSource(), /inert=\{saving\}/],
    ["customer communication", readCustomerCommunicationModuleSource(), /inert=\{sending\}/],
  ] as const;

  for (const [label, moduleSource, pattern] of expected) assert.match(moduleSource, pattern, label);
});

test("customer communication protects authored content before changing templates", () => {
  const communication = readCustomerCommunicationModuleSource();

  assert.match(communication, /const hasManualContent = mailForm\.emailSubject !== currentTemplate\.emailSubject/);
  assert.match(communication, /切换语言将替换当前邮件标题和正文/);
  assert.match(communication, /busy=\{Boolean\(manualMarkBusyId\)\}/);
  assert.match(communication, /inert=\{busy\}/);
});
