import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { productionQuantityMaximum, productionQuantityUnits } from "../app/modules/production-progress-quantity.ts";

const supplierModule = readFileSync("app/modules/SupplierPurchaseOrdersModule.tsx", "utf8");
const supplierDetail = readFileSync("app/modules/supplier-purchase-orders/purchase-order-detail.tsx", "utf8");
const supplierCard = readFileSync("app/modules/supplier-purchase-orders/production-progress-card.tsx", "utf8");
const supplierHook = readFileSync("app/modules/supplier-purchase-orders/use-supplier-production-progress.ts", "utf8");
const completionCard = readFileSync("app/modules/supplier-purchase-orders/supplier-production-completion-card.tsx", "utf8");
const executionPanel = readFileSync("app/modules/sales-execution/purchase-order-execution-panel.tsx", "utf8");
const internalSummary = readFileSync("app/modules/sales-execution/purchase-order-production-progress-summary.tsx", "utf8");
const offlineForm = readFileSync("app/modules/sales-execution/purchase-order-offline-production-progress.tsx", "utf8");
const presentation = readFileSync("app/modules/sales-execution/production-progress-presentation.ts", "utf8");

test("supplier portal submits every cumulative quantity and refreshes its current order", () => {
  assert.match(supplierDetail, /<ProductionProgressCard[\s\S]*detail=\{detail\}/);
  assert.match(supplierModule, /onProductionProgressSaved=\{\(saved, message\)/);
  assert.match(supplierHook, /\/production-progress`/);
  assert.match(supplierHook, /expectedRevision: detail\.revision/);
  assert.match(supplierHook, /detail\.items\.map\(\(item\) => \(\{/);
  assert.match(supplierHook, /purchaseOrderItemId: item\.id/);
  assert.match(supplierHook, /completedQuantity:/);
  assert.match(supplierHook, /累计完成数量不能小于上次填报数量/);
  assert.match(supplierHook, /累计完成数量不能超过当前允许上限/);
  assert.match(supplierHook, /productionQuantityMaximum/);
  assert.match(supplierHook, /progressItem\?\.targetQuantity \|\| item\.quantity/);
  assert.match(supplierHook, /setValues\(Object\.fromEntries\(detail\.items\.map/);
  assert.match(supplierModule, /setDetail\(saved\)/);
  assert.match(supplierModule, /setRows\(\(current\) => current\.map/);
});

test("browser quantity guards keep four-decimal changes exact at large quantities", () => {
  assert.equal(productionQuantityUnits("99999999999999.0001"), BigInt("999999999999990001"));
  assert.notEqual(
    productionQuantityUnits("99999999999999.0001"),
    productionQuantityUnits("99999999999999.0002"),
  );
  assert.equal(productionQuantityUnits("1.00001"), null);
  assert.equal(productionQuantityMaximum("95", "99"), "99");
  assert.equal(productionQuantityMaximum("105", "99"), "105");
});

test("supplier progress UI shows each line, overall progress, remarks, and attributed history", () => {
  assert.match(supplierCard, /逐项填报累计完成数量/);
  assert.match(supplierCard, /<progress[\s\S]*value=\{progress\.percent\}/);
  assert.match(supplierCard, /本次进度说明（选填）/);
  assert.match(supplierCard, /progress\.history/);
  assert.match(supplierCard, /report\.source === "INTERNAL_OFFLINE"/);
  assert.match(supplierCard, /report\.supplierContact/);
  assert.match(supplierCard, /内部代录/);
  assert.match(supplierCard, /当前允许上限/);
});

test("production completion remains disabled until every purchase line reaches 100 percent", () => {
  assert.match(supplierDetail, /allCompleted=\{detail\.productionProgress\.allCompleted\}/);
  assert.match(completionCard, /disabled=\{busy \|\| !allCompleted \|\| quantityVariancePending\}/);
  assert.match(completionCard, /所有产品达到 100% 后才能确认整单完成/);
  assert.match(completionCard, /交付数量差异申请待审批，审批后才能确认完工/);
});

test("internal execution shows progress, delivery timing, stale follow-up, and full attribution", () => {
  assert.match(executionPanel, /<PurchaseOrderProductionProgressSummary order=\{order\}/);
  assert.match(internalSummary, /累计完成/);
  assert.match(internalSummary, /生产目标/);
  assert.match(internalSummary, /targetQuantity/);
  assert.match(internalSummary, /progress\.history/);
  assert.match(internalSummary, /supplierContact/);
  assert.match(internalSummary, /supplierReportedAt/);
  assert.match(internalSummary, /recordedAt/);
  assert.match(internalSummary, /reportedBy\.name/);
  assert.match(internalSummary, /daysWithoutUpdate > 7/);
  assert.match(internalSummary, /需跟进/);
  assert.match(presentation, /距确认交期/);
  assert.match(presentation, /已超过确认交期/);
});

test("internal staff can record an attributed offline progress snapshot and refresh execution detail", () => {
  assert.match(executionPanel, /<PurchaseOrderOfflineProductionProgress[\s\S]*canManage=\{canStartProduction\}/);
  assert.match(offlineForm, /order\.status === "ACCEPTED"/);
  assert.match(offlineForm, /order\.productionStatus === "IN_PRODUCTION"/);
  assert.match(offlineForm, /!order\.productionProgress\?\.allCompleted/);
  assert.match(offlineForm, /\/offline-production-progress`/);
  assert.match(offlineForm, /expectedRevision: Number\(order\.revision \|\| 1\)/);
  assert.match(offlineForm, /supplierReportedAt: shanghaiDateTimeIso\(supplierReportedAt\)/);
  assert.match(offlineForm, /supplierContact: supplierContact\.trim\(\)/);
  assert.match(offlineForm, /items: items\.map/);
  assert.match(offlineForm, /initialQuantities\(order\)/);
  assert.match(offlineForm, /targetQuantity/);
  assert.match(offlineForm, /productionQuantityMaximum/);
  assert.match(offlineForm, /累计完成数量不能超过当前允许上限/);
  assert.match(offlineForm, /生产目标 \/ 当前允许上限/);
  assert.match(offlineForm, /await onChanged\(\)/);
});

test("production progress front-end files remain within the component size boundary", () => {
  for (const source of [supplierModule, supplierDetail, supplierCard, supplierHook, completionCard, executionPanel, internalSummary, offlineForm, presentation]) {
    assert.ok(source.split("\n").length <= 301);
  }
});
