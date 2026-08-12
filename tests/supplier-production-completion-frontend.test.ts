import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supplierModuleSource = readFileSync("app/modules/SupplierPurchaseOrdersModule.tsx", "utf8");
const supplierDetailSource = readFileSync("app/modules/supplier-purchase-orders/purchase-order-detail.tsx", "utf8");
const completionCardSource = readFileSync("app/modules/supplier-purchase-orders/supplier-production-completion-card.tsx", "utf8");
const workspaceContentSource = readFileSync("app/WorkspaceModuleContent.tsx", "utf8");
const executionPanelSource = readFileSync("app/modules/sales-execution/purchase-order-execution-panel.tsx", "utf8");
const executionPropsSource = [
  executionPanelSource,
  readFileSync("app/modules/sales-execution/purchase-order-draft-list.tsx", "utf8"),
  readFileSync("app/modules/sales-execution/execution-detail-drawer.tsx", "utf8"),
  readFileSync("app/modules/sales-execution/sales-execution-module-view.tsx", "utf8"),
].join("\n");

test("supplier completion requires a reusable confirmation dialog and is only actionable during production", () => {
  assert.match(completionCardSource, /useConfirmationDialog\(\)/);
  assert.match(completionCardSource, /<ConfirmationDialog/);
  assert.match(completionCardSource, /productionStatus !== "IN_PRODUCTION" && productionStatus !== "COMPLETED"/);
  assert.match(completionCardSource, /productionStatus === "IN_PRODUCTION"[\s\S]*确认生产完成/);
  assert.match(completionCardSource, /disabled=\{busy\}/);
  assert.match(completionCardSource, /确认时间：/);
  assert.match(supplierDetailSource, /<SupplierProductionCompletionCard[\s\S]*productionCompletedAt=\{detail\.productionCompletedAt\}/);
  assert.match(supplierDetailSource, /deliveryFrozen \? "生产完成，交期已冻结"/);
  assert.match(supplierModuleSource, /detail\.deliveryFrozen/);
});

test("supplier completion posts the optimistic revision and refreshes current detail and list rows", () => {
  assert.match(supplierModuleSource, /\/production-completion`/);
  assert.match(supplierModuleSource, /JSON\.stringify\(\{ expectedRevision: detail\.revision \}\)/);
  assert.match(supplierModuleSource, /productionCompletionBusyRef\.current/);
  assert.match(supplierModuleSource, /setDetail\(saved\)/);
  assert.match(supplierModuleSource, /setRows\(\(current\) => current\.map/);
  assert.match(supplierModuleSource, /setNotice\(result\.message \|\| "生产完成已确认"\)/);
  assert.match(supplierModuleSource, /void loadRows\(page, submittedKeyword, status\)/);
});

test("custom read-only supplier permission keeps purchase orders visible without mutation controls", () => {
  assert.match(workspaceContentSource, /<SupplierPurchaseOrdersModule canWrite=\{canWritePermission\(payload\.user, payload\.permissions, "supplierPurchaseOrders"/);
  assert.match(supplierModuleSource, /if \(!canWrite \|\| !detail \|\| !canSubmit \|\| responseBusyRef\.current\) return/);
  assert.match(supplierModuleSource, /if \(!canWrite \|\| !detail \|\| detail\.status !== "ACCEPTED"/);
  assert.match(supplierDetailSource, /<SupplierProductionCompletionCard canWrite=\{canWrite\}/);
  assert.match(supplierDetailSource, /\{!canWrite \? null : rejected \|\| proposalPending \|\| deliveryFrozen \? \(/);
  assert.match(completionCardSource, /if \(!canWrite \|\| busy\) return/);
  assert.match(completionCardSource, /productionStatus === "IN_PRODUCTION" && canWrite \? \(/);
});

test("supplier-facing purchase order UI never renders internal decision notes or operators", () => {
  assert.doesNotMatch(supplierDetailSource, /internalDecisionRemark|internalDecidedBy/);
  assert.match(supplierDetailSource, /entry\.internalDecision/);
});

test("supplier response rejects same-tick duplicate submissions", () => {
  assert.match(supplierModuleSource, /responseBusyRef\.current/);
  assert.match(supplierModuleSource, /!canSubmit \|\| responseBusyRef\.current/);
});

test("internal execution can start production but waits read-only for supplier completion", () => {
  assert.match(executionPanelSource, /body: JSON\.stringify\(\{ action: "START" \}\)/);
  assert.match(executionPanelSource, />开始生产<\/button>/);
  assert.match(executionPanelSource, /等待供应商确认生产完成/);
  assert.doesNotMatch(executionPanelSource, /action: "COMPLETE"|标记生产完成|updateProduction/);
  assert.match(executionPropsSource, /canStartProduction/);
  assert.doesNotMatch(executionPropsSource, /canManageProduction|canManageFactoryExecution/);
});

test("touched supplier completion components stay within the component size boundary", () => {
  for (const source of [supplierModuleSource, supplierDetailSource, completionCardSource, executionPanelSource]) {
    assert.ok(source.split("\n").length <= 301);
  }
});
