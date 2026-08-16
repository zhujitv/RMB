import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { Prisma } = jiti("../lib/generated/prisma/client.js") as typeof import(
  "../lib/generated/prisma/client.js"
);
const {
  buildLoadingSnapshot,
  validateFactoryPurchaseLoadingDate,
} = jiti("../lib/platform/factory-purchase-order-loading-result-core.ts") as typeof import(
  "../lib/platform/factory-purchase-order-loading-result-core"
);
const {
  normalizeFactoryPurchaseLoadingSubmissionInput,
  normalizeFactoryPurchaseLoadingDecisionInput,
} = jiti("../lib/platform/factory-purchase-order-loading-result-inputs.ts") as typeof import(
  "../lib/platform/factory-purchase-order-loading-result-inputs"
);
const { serializeSupplierFactoryPurchaseLoadingResult } = jiti(
  "../lib/platform/factory-purchase-order-loading-result-serialization.ts",
) as typeof import("../lib/platform/factory-purchase-order-loading-result-serialization");
const { releasedContainerMaterialization } = jiti(
  "../lib/platform/sales-execution-container-shipping.ts",
) as typeof import("../lib/platform/sales-execution-container-shipping");

const workflow = readFileSync("lib/platform/factory-purchase-order-loading-result-workflow.ts", "utf8");
const containerCore = readFileSync("lib/platform/sales-execution-container-load-core.ts", "utf8");
const containerDrafts = readFileSync("lib/platform/sales-execution-container-load-drafts.ts", "utf8");
const containerLifecycle = readFileSync("lib/platform/sales-execution-container-load-lifecycle.ts", "utf8");
const containerLocks = readFileSync("lib/platform/container-loading-locks.ts", "utf8");
const actualDelivery = readFileSync("lib/platform/factory-purchase-order-actual-delivery.ts", "utf8");
const shipping = readFileSync("lib/platform/sales-execution-shipping-handoff.ts", "utf8");
const supplierQuery = readFileSync("lib/platform/supplier-purchase-orders-query.ts", "utf8");

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1", executionId: "execution-1", supplierId: "supplier-1", revision: 7,
    status: "ACCEPTED", productionStatus: "COMPLETED",
    productionCompletedAt: new Date("2026-08-15T02:00:00.000Z"),
    actualDeliveryDate: null, actualDeliveryRecordedAt: null,
    actualDeliveryRecordedById: null, settlement: null,
    execution: { shippingStartedAt: null },
    items: [
      { id: "line-a", executionItemId: "sale-a", allocatedQuantity: new Prisma.Decimal("10"), actualDeliveredQuantity: null },
      { id: "line-b", executionItemId: "sale-b", allocatedQuantity: new Prisma.Decimal("5"), actualDeliveredQuantity: null },
    ],
    deliveryQuantityVariances: [],
    productionProgressReports: [{ sequenceNo: 2, items: [
      { purchaseOrderItemId: "line-a", completedQuantity: new Prisma.Decimal("12") },
      { purchaseOrderItemId: "line-b", completedQuantity: new Prisma.Decimal("5") },
    ] }],
    loadingResults: [],
    ...overrides,
  } as never;
}

function container(overrides: Record<string, unknown> = {}) {
  return {
    id: "container-1", executionId: "execution-1", sequenceNo: 1,
    status: "OPEN", containerNo: "TCLU1234567", containerType: "40HQ", sealNo: null,
    loadingDate: new Date("2026-08-16T00:00:00.000Z"), revision: 3,
    releasedAt: null, releasedById: null, releaseRemark: null,
    voidedAt: null, voidedById: null, voidReason: null, legacyBackfill: false,
    allocations: [
      { id: "allocation-a", containerLoadId: "container-1", executionId: "execution-1", purchaseOrderId: "po-1", purchaseOrderItemId: "line-a", plannedQuantity: new Prisma.Decimal("10") },
      { id: "allocation-b", containerLoadId: "container-1", executionId: "execution-1", purchaseOrderId: "po-1", purchaseOrderItemId: "line-b", plannedQuantity: new Prisma.Decimal("5") },
    ],
    loadingResults: [],
    ...overrides,
  } as never;
}

test("本柜无差异按计划自动识别，并保留累计留仓快照", () => {
  const snapshot = buildLoadingSnapshot(order(), container(), [
    { purchaseOrderItemId: "line-a", loadedQuantity: "10" },
    { purchaseOrderItemId: "line-b", loadedQuantity: "5" },
  ], null, "");
  assert.equal(snapshot.reason, "EXACT");
  assert.equal(snapshot.hasPlannedDifference, false);
  assert.equal(snapshot.items[0]?.warehouseRetainedQuantitySnapshot.toString(), "2");
  assert.equal(snapshot.items[0]?.cumulativeApprovedLoadedQuantitySnapshot.toString(), "10");
});

test("本柜实装与计划不同时必须填写差异原因和说明", () => {
  const loaded = [
    { purchaseOrderItemId: "line-a", loadedQuantity: "9" },
    { purchaseOrderItemId: "line-b", loadedQuantity: "5" },
  ];
  assert.throws(() => buildLoadingSnapshot(order(), container(), loaded, null, ""), /请选择限重、限容或其它原因/);
  assert.throws(() => buildLoadingSnapshot(order(), container(), loaded, "WEIGHT_LIMIT", ""), /必须填写说明/);
  const snapshot = buildLoadingSnapshot(order(), container(), loaded, "WEIGHT_LIMIT", "限重少装");
  assert.equal(snapshot.reason, "WEIGHT_LIMIT");
  assert.equal(snapshot.items[0]?.loadedQuantity.toString(), "9");
});

test("填报和审批输入都强制携带集装箱及其版本", () => {
  const input = normalizeFactoryPurchaseLoadingSubmissionInput({
    containerLoadId: "container-1", expectedRevision: 3, loadingDate: "2026-08-16",
    items: [{ purchaseOrderItemId: "line-a", loadedQuantity: "0" }],
  });
  assert.equal(input.containerLoadId, "container-1");
  assert.throws(() => normalizeFactoryPurchaseLoadingSubmissionInput({
    expectedRevision: 3, loadingDate: "2026-08-16",
    items: [{ purchaseOrderItemId: "line-a", loadedQuantity: "0" }],
  }), /请选择需要填报的集装箱/);
  assert.throws(() => normalizeFactoryPurchaseLoadingDecisionInput({
    containerLoadId: "container-1", expectedRevision: 3,
    loadingResultId: "result-1", decision: "REJECTED",
  }), /必须填写原因/);
});

test("供应商结果序列化是白名单，不泄露内部审批人员和备注", () => {
  const serialized = serializeSupplierFactoryPurchaseLoadingResult({
    id: "result-1", containerLoadId: "container-1", executionId: "execution-1",
    purchaseOrderId: "po-1", sequenceNo: 1, status: "REJECTED",
    reason: "OTHER", reasonDetail: "包装破损", source: "INTERNAL_OFFLINE", channel: "PHONE",
    supplierContact: "王师傅", containerLoad: { loadingDate: new Date("2026-08-16T00:00:00.000Z") },
    requestedAt: new Date(), requestedById: "internal-a", requestedBy: { id: "internal-a", name: "内部人员" },
    decidedAt: new Date(), decidedById: "internal-b", decidedBy: { id: "internal-b", name: "审批人" },
    decisionRemark: "内部风控备注", legacyBackfill: false,
    items: [{
      purchaseOrderItemId: "line-a", plannedQuantitySnapshot: "10",
      deliveryTargetQuantitySnapshot: "10", completedQuantitySnapshot: "12",
      previouslyApprovedLoadedQuantitySnapshot: "0", loadedQuantity: "9",
      cumulativeApprovedLoadedQuantitySnapshot: "9", warehouseRetainedQuantitySnapshot: "3",
    }],
  });
  assert.equal("requestedBy" in serialized, false);
  assert.equal("decidedBy" in serialized, false);
  assert.equal("decisionRemark" in serialized, false);
  assert.equal(serialized.items[0]?.warehouseRetainedQuantity, "3");
});

test("批准与放行不提前写采购实装，只有发货交接统一物化", () => {
  assert.doesNotMatch(workflow, /actualDeliveredQuantity|actualDeliveryDate/);
  assert.match(actualDelivery, /FACTORY_ACTUAL_DELIVERY_CONTAINER_LEDGER_REQUIRED/);
  assert.match(shipping, /materializeReleasedContainerActuals/);
  assert.equal((shipping.match(/materializeReleasedContainerActuals\(/g) || []).length, 1);
  assert.equal((shipping.match(/receivableOrder\.create\(/g) || []).length, 1);
  assert.match(workflow, /source === "INTERNAL_OFFLINE" && result\.requestedById === actorId/);
});

test("草稿换采购单时仍按 execution、container、全部PO、results 顺序加锁", () => {
  const update = containerDrafts.slice(containerDrafts.indexOf("export async function updateSalesExecutionContainerLoad"));
  assert.match(update, /preflightTargets[\s\S]*lockContainerLoadingScope[\s\S]*visible\.allocations[\s\S]*preflightTargets/);
  assert.doesNotMatch(update, /lockContainerPurchaseOrders/);
  assert.match(containerLocks, /currentAllocations[\s\S]*purchaseOrderIds[\s\S]*currentAllocations\.map/);
});

test("供应商查询边界不选择内部审批字段", () => {
  const publicLoadingSelect = supplierQuery.match(/loadingResults:[\s\S]*?\n  payments:/)?.[0] || "";
  assert.doesNotMatch(publicLoadingSelect, /requestedBy(?:Id)?: true/);
  assert.doesNotMatch(publicLoadingSelect, /decidedBy(?:Id)?: true/);
  assert.doesNotMatch(publicLoadingSelect, /decisionRemark: true/);
});

test("装柜总账及三个填报审批 API 均存在", () => {
  for (const file of [
    "app/api/supplier-purchase-orders/[id]/loading-result/route.ts",
    "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/offline-loading-result/route.ts",
    "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/loading-result-decision/route.ts",
    "app/api/sales-executions/[id]/container-loads/route.ts",
    "app/api/sales-executions/[id]/container-loads/[containerLoadId]/open/route.ts",
    "app/api/sales-executions/[id]/container-loads/[containerLoadId]/release/route.ts",
    "app/api/sales-executions/[id]/container-loads/[containerLoadId]/void/route.ts",
  ]) assert.match(readFileSync(file, "utf8"), /export async function (POST|PUT)/);
});

function releasedResult(containerLoadId: string, purchaseOrderId: string, itemId: string, quantity: string) {
  return {
    id: `${containerLoadId}-${purchaseOrderId}`, containerLoadId, purchaseOrderId,
    status: "APPROVED", items: [{ purchaseOrderItemId: itemId, loadedQuantity: new Prisma.Decimal(quantity) }],
  };
}

test("一个柜可以汇总多家供应商且不会合并采购单", () => {
  const materialized = releasedContainerMaterialization({
    id: "execution-1",
    items: [{ id: "sale-a", quantity: new Prisma.Decimal("100") }],
    purchaseOrders: [
      { id: "po-1", status: "ACCEPTED", items: [{ id: "po-item-1", executionItemId: "sale-a" }] },
      { id: "po-2", status: "ACCEPTED", items: [{ id: "po-item-2", executionItemId: "sale-a" }] },
      { id: "old-po", status: "REJECTED", items: [{ id: "old-item", executionItemId: "sale-a" }] },
    ],
    containerLoads: [{
      id: "container-1", status: "RELEASED", loadingDate: new Date("2026-08-16T00:00:00.000Z"),
      allocations: [
        { purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1" },
        { purchaseOrderId: "po-2", purchaseOrderItemId: "po-item-2" },
      ],
      loadingResults: [
        releasedResult("container-1", "po-1", "po-item-1", "60"),
        releasedResult("container-1", "po-2", "po-item-2", "40"),
      ],
    }],
  } as never);
  assert.equal(materialized.loadedByPurchaseOrderItem.get("po-item-1")?.toString(), "60");
  assert.equal(materialized.loadedByPurchaseOrderItem.get("po-item-2")?.toString(), "40");
  assert.equal(materialized.actualDeliveryDateByPurchaseOrder.size, 2);
});

test("一张采购单可跨两个柜，首柜实装95后第二柜可补5", () => {
  const execution = {
    id: "execution-1",
    items: [{ id: "sale-a", quantity: new Prisma.Decimal("100") }],
    purchaseOrders: [{
      id: "po-1", status: "ACCEPTED", items: [{ id: "po-item-1", executionItemId: "sale-a" }],
    }],
    containerLoads: [
      { id: "container-1", status: "RELEASED", loadingDate: new Date("2026-08-15T00:00:00.000Z"), allocations: [{ purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1" }], loadingResults: [releasedResult("container-1", "po-1", "po-item-1", "95")] },
      { id: "container-2", status: "RELEASED", loadingDate: new Date("2026-08-16T00:00:00.000Z"), allocations: [{ purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1" }], loadingResults: [releasedResult("container-2", "po-1", "po-item-1", "5")] },
    ],
  } as never;
  const materialized = releasedContainerMaterialization(execution);
  assert.equal(materialized.loadedByPurchaseOrderItem.get("po-item-1")?.toString(), "100");
  assert.equal(materialized.actualDeliveryDateByPurchaseOrder.get("po-1")?.toISOString().slice(0, 10), "2026-08-16");
  assert.match(containerCore, /approved\?\.loadedQuantity \?\? row\.plannedQuantity/);
});

test("重新选厂后只属于已拒绝旧采购单的草稿柜不阻断发货", () => {
  const execution = {
    id: "execution-1", items: [{ id: "sale-a", quantity: new Prisma.Decimal("100") }],
    purchaseOrders: [
      { id: "old-po", status: "REJECTED", items: [{ id: "old-item", executionItemId: "sale-a" }] },
      { id: "po-1", status: "ACCEPTED", items: [{ id: "po-item-1", executionItemId: "sale-a" }] },
    ],
    containerLoads: [
      { id: "old-draft", status: "DRAFT", loadingDate: null, allocations: [{ purchaseOrderId: "old-po", purchaseOrderItemId: "old-item" }], loadingResults: [] },
      { id: "container-1", status: "RELEASED", loadingDate: new Date("2026-08-16T00:00:00.000Z"), allocations: [{ purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1" }], loadingResults: [releasedResult("container-1", "po-1", "po-item-1", "100")] },
    ],
  } as never;
  assert.equal(
    releasedContainerMaterialization(execution).loadedByPurchaseOrderItem.get("po-item-1")?.toString(),
    "100",
  );
});

test("短装、未放行柜和未来装柜日期均在后端阻断", () => {
  const base = {
    id: "execution-1", items: [{ id: "sale-a", quantity: new Prisma.Decimal("100") }],
    purchaseOrders: [{ id: "po-1", status: "ACCEPTED", items: [{ id: "po-item-1", executionItemId: "sale-a" }] }],
    containerLoads: [{ id: "container-1", status: "RELEASED", loadingDate: new Date(), allocations: [{ purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1" }], loadingResults: [releasedResult("container-1", "po-1", "po-item-1", "99")] }],
  };
  assert.throws(() => releasedContainerMaterialization(base as never), /少于客户销售数量/);
  assert.throws(() => releasedContainerMaterialization({
    ...base, containerLoads: [{ ...base.containerLoads[0], status: "OPEN" }],
  } as never), /仍有集装箱未放行/);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.throws(() => validateFactoryPurchaseLoadingDate(
    order({ productionCompletedAt: new Date(Date.now() - 86_400_000) }),
    container({ loadingDate: new Date(`${tomorrow}T00:00:00.000Z`) }),
    tomorrow,
  ), /不能晚于今天/);
  assert.match(containerLifecycle, /CONTAINER_LOAD_DATE_IN_FUTURE/);
});
