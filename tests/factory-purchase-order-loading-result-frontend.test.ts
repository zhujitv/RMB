import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  containerAllocationReservedQuantity,
  containerQuantitiesEqual,
  containerQuantityRemaining,
  containerQuantitySum,
  containerQuantityTotalPositive,
  containerQuantityWithin,
} = await jiti.import<typeof import("../app/modules/container-load.ts")>("../app/modules/container-load.ts");

const executionDetail = readFileSync("app/modules/sales-execution/execution-detail-drawer.tsx", "utf8");
const internalPanel = readFileSync("app/modules/sales-execution/container-loads-panel.tsx", "utf8");
const editor = readFileSync("app/modules/sales-execution/container-load-editor.tsx", "utf8");
const internalCard = readFileSync("app/modules/sales-execution/container-load-card.tsx", "utf8");
const offlineResult = readFileSync("app/modules/sales-execution/container-load-offline-result.tsx", "utf8");
const purchaseOrderPanel = readFileSync("app/modules/sales-execution/purchase-order-execution-panel.tsx", "utf8");
const supplierDetail = readFileSync("app/modules/supplier-purchase-orders/purchase-order-detail.tsx", "utf8");
const supplierCard = readFileSync("app/modules/supplier-purchase-orders/supplier-container-loads-card.tsx", "utf8");
const supplierHook = readFileSync("app/modules/supplier-purchase-orders/use-supplier-container-loading.ts", "utf8");
const shippingReadiness = readFileSync("app/modules/sales-execution/shipping-readiness.ts", "utf8");

function load(status: string, planned: string, approved?: string) {
  const allocation = { id: "a1", purchaseOrderId: "po1", purchaseOrderItemId: "i1", plannedQuantity: planned };
  return {
    allocation,
    load: {
      id: "c1", sequenceNo: 1, status, containerNo: "C1", containerType: null, sealNo: null,
      loadingDate: "2026-08-16", revision: 1, allocations: [allocation],
      loadingResults: approved === undefined ? [] : [{ id: "r1", containerLoadId: "c1", purchaseOrderId: "po1", sequenceNo: 1, status: "APPROVED", reason: "OTHER", reasonDetail: "", source: "SUPPLIER_PORTAL", channel: "PORTAL", supplierContact: "supplier", loadingDate: "2026-08-16", requestedAt: null, decidedAt: null, legacyBackfill: false, items: [{ purchaseOrderItemId: "i1", plannedQuantity: planned, deliveryTargetQuantity: "100", completedQuantity: "100", previouslyApprovedLoadedQuantity: "0", loadedQuantity: approved, cumulativeApprovedLoadedQuantity: approved, warehouseRetainedQuantity: String(100 - Number(approved)) }] }],
    },
  };
}

test("container quantities use exact four-decimal fixed-point arithmetic", () => {
  assert.equal(containerQuantitiesEqual("99999999999999.0001", "99999999999999.0001"), true);
  assert.equal(containerQuantitiesEqual("0.1", "0.1000"), true);
  assert.equal(containerQuantitySum(["0.0001", "0.0002"]), "0.0003");
  assert.equal(containerQuantityRemaining("100", ["40", "55"]), "5");
  assert.equal(containerQuantityWithin("0", "5", true), true);
  assert.equal(containerQuantityWithin("5.0001", "5"), false);
  assert.equal(containerQuantityTotalPositive(["0", "0"]), false);
  assert.equal(containerQuantityTotalPositive(["0", "0.0001"]), true);
});

test("released short-loading frees retained stock for the next container plan", () => {
  const planned = load("DRAFT", "100");
  const open = load("OPEN", "100", "95");
  const released = load("RELEASED", "100", "95");
  const voided = load("VOIDED", "100", "100");
  assert.equal(containerAllocationReservedQuantity(planned.load as never, planned.allocation), "100");
  assert.equal(containerAllocationReservedQuantity(open.load as never, open.allocation), "95");
  assert.equal(containerAllocationReservedQuantity(released.load as never, released.allocation), "95");
  assert.equal(containerAllocationReservedQuantity(voided.load as never, voided.allocation), "0");
  assert.equal(containerQuantityRemaining("100", [containerAllocationReservedQuantity(released.load as never, released.allocation)]), "5");
  assert.match(editor, /containerAllocationReservedQuantity/);
});

test("internal execution owns one multi-supplier container master workflow", () => {
  assert.match(executionDetail, /<ContainerLoadsPanel/);
  assert.match(internalPanel, /创建装运单/);
  assert.match(editor, /allocations: lines\.flatMap/);
  assert.match(editor, /purchaseOrderItemId/);
  assert.match(editor, /plannedQuantity/);
  assert.match(editor, /container-loads/);
  assert.match(internalCard, /action: "open" \| "release" \| "void"/);
  assert.match(internalCard, /supplierId \|\| id/);
  assert.match(internalCard, /loading-result-decision/);
  assert.match(internalCard, /containerLoadId: load\.id/);
  assert.match(offlineResult, /offline-loading-result/);
  assert.match(offlineResult, /expectedRevision: load\.revision/);
  assert.match(offlineResult, /containerLoadId: load\.id/);
});

test("bulk warehouse loading is explicit and does not require a container number", () => {
  assert.match(internalPanel, /散货进舱无需柜号/);
  assert.match(editor, /柜号等运输资料可在后续物流环节补充/);
  assert.match(editor, /未知或散货进舱请留空/);
  assert.match(editor, /预计装柜 \/ 进舱日期（可选）/);
  assert.doesNotMatch(internalCard, /!load\.containerNo \|\| !load\.loadingDate/);
  assert.doesNotMatch(internalCard, /!load\.loadingDate \|\| !load\.allocations\.length/);
  assert.doesNotMatch(supplierHook, /Boolean\(load\.loadingDate\)/);
  assert.doesNotMatch(supplierHook, /loadingDate: load\.loadingDate/);
  assert.match(internalCard, /待最终放行确认/);
  assert.match(supplierCard, /最终放行时记录/);
  assert.match(internalCard, /散货进舱（无柜号）/);
  assert.match(supplierCard, /散货进舱（无柜号）/);
});

test("supplier portal receives container-scoped tasks and exposes no other supplier or internal decision data", () => {
  assert.match(supplierDetail, /<SupplierContainerLoadsCard/);
  assert.match(supplierCard, /这里只包含贵司产品/);
  assert.match(supplierHook, /containerLoadId: load\.id/);
  assert.match(supplierHook, /expectedRevision: load\.revision/);
  assert.match(supplierHook, /const allocations = load\.allocations/);
  assert.match(supplierHook, /container\.status === "VOIDED"/);
  assert.match(supplierHook, /differs && reason === "EXACT"/);
  assert.doesNotMatch(supplierHook, /实装合计必须大于 0/);
  assert.doesNotMatch(offlineResult, /实装合计必须大于 0/);
  assert.doesNotMatch(supplierCard, /requestedBy|decidedBy|decisionRemark|releasedBy|voidedBy/);
});

test("old one-purchase-order one-loading-result UI is removed", () => {
  assert.doesNotMatch(purchaseOrderPanel, /PurchaseOrderLoadingResult|PurchaseOrderOfflineLoadingResult/);
  assert.equal(existsSync("app/modules/sales-execution/purchase-order-loading-result.tsx"), false);
  assert.equal(existsSync("app/modules/sales-execution/purchase-order-offline-loading-result.tsx"), false);
  assert.equal(existsSync("app/modules/supplier-purchase-orders/loading-result-card.tsx"), false);
  assert.equal(existsSync("app/modules/supplier-purchase-orders/use-loading-result.ts"), false);
});

test("shipping readiness requires released container masters and no pending slot result", () => {
  assert.match(shippingReadiness, /execution\.containerLoads/);
  assert.match(shippingReadiness, /status !== "RELEASED"/);
  assert.match(shippingReadiness, /本柜实装差异待审批/);
  assert.match(shippingReadiness, /集装箱未最终放行/);
});

test("container-load front-end components stay inside the 300-line boundary", () => {
  for (const source of [executionDetail, internalPanel, editor, internalCard, offlineResult, purchaseOrderPanel, supplierDetail, supplierCard, supplierHook]) {
    assert.ok(source.split("\n").length <= 301);
  }
});
