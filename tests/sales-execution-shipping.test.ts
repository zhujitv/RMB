import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const { salesExecutionShippingReadiness } = await jiti.import<
  typeof import("../app/modules/sales-execution/shipping-readiness.ts")
>("../app/modules/sales-execution/shipping-readiness.ts");

const schema = readPrismaSchemaSource();
const migration = readFileSync("prisma/migrations/20260810040000_sales_execution_shipping_handoff/migration.sql", "utf8");
const hardeningMigration = readFileSync("prisma/migrations/20260810041000_sales_execution_shipping_handoff_hardening/migration.sql", "utf8");
const service = readFileSync("lib/platform/sales-execution-shipping-handoff.ts", "utf8");
const lifecycleGuards = readFileSync("lib/platform/sales-execution-lifecycle-guards.ts", "utf8");
const route = readFileSync("app/api/sales-executions/[id]/enter-shipping/route.ts", "utf8");
const hook = readFileSync("app/modules/sales-execution/use-sales-execution-shipping.ts", "utf8");
const detail = readFileSync("app/modules/sales-execution/execution-detail-drawer.tsx", "utf8");
const purchaseList = readFileSync("app/modules/sales-execution/purchase-order-draft-list.tsx", "utf8");
const moduleSource = readFileSync("app/modules/SalesExecutionModule.tsx", "utf8");
const workspace = readFileSync("app/WorkspaceModuleContent.tsx", "utf8");
const orderMutations = readFileSync("lib/platform/orders-module-mutations.ts", "utf8");
const orderSourceGuards = readFileSync("lib/platform/order-sales-execution-source-guards.ts", "utf8");
const orderModel = readFileSync("app/modules/orders/model.ts", "utf8");
const orderPanel = readFileSync("app/modules/orders/quick-order-panel.tsx", "utf8");
const orderPayload = readFileSync("app/modules/orders/quick-order-payload.ts", "utf8");

function purchaseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    status: "ACCEPTED",
    productionStatus: "COMPLETED",
    productionCompletedAt: "2026-08-09T08:00:00.000Z",
    actualDeliveryDate: "2026-08-10",
    items: [{ id: "po-item-1", executionItemId: "item-1", allocatedQuantity: "10", actualDeliveredQuantity: null }],
    ...overrides,
  };
}

function containerLoad(overrides: Record<string, unknown> = {}) {
  return {
    id: "container-1",
    status: "RELEASED",
    allocations: [{ id: "allocation-1", purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1", plannedQuantity: "10" }],
    loadingResults: [{ id: "loading-1", status: "APPROVED", purchaseOrderId: "po-1", items: [{ purchaseOrderItemId: "po-item-1", loadedQuantity: "10" }] }],
    ...overrides,
  };
}

function execution(overrides: Record<string, unknown> = {}) {
  return {
    id: "execution-1",
    status: "DISPATCHED",
    items: [{ id: "item-1", quantity: "10" }],
    purchaseOrders: [purchaseOrder()],
    containerLoads: [containerLoad()],
    ...overrides,
  };
}

test("shipping handoff has one immutable sales-execution to receivable-order lineage", () => {
  assert.match(schema, /sourceSalesExecutionId\s+String\?\s+@unique/);
  assert.match(schema, /sourceSalesExecution\s+SalesExecution\?[\s\S]*onDelete: Restrict/);
  assert.match(schema, /shippingStartedAt\s+DateTime\?/);
  assert.match(schema, /shippingStartedBy\s+User\?/);
  assert.match(schema, /receivableOrder\s+ReceivableOrder\?/);
  assert.match(migration, /receivable_orders_source_sales_execution_id_key/);
  assert.match(migration, /sales execution shipping handoff is immutable/);
  assert.match(migration, /sales execution generated receivable orders cannot be deleted/);
  assert.match(migration, /sales execution generated receivable orders cannot be soft deleted/);
  assert.match(hardeningMigration, /NEW\."source_sales_execution_id" IS DISTINCT FROM OLD\."source_sales_execution_id"/);
  assert.match(hardeningMigration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(hardeningMigration, /receivable order sales execution lineage is inconsistent/);
});

test("backend handoff is locked, permissioned, idempotent and atomic", () => {
  assert.match(service, /assertWrite\(actor, "salesExecution"\)/);
  assert.match(service, /assertWrite\(actor, "orders"\)/);
  assert.match(service, /lockAllExecutionContainerLoading\(tx, executionId\)[\s\S]*loadSalesExecution\(executionId, actor, tx\)/);
  assert.match(service, /if \(before\.receivableOrder\)/);
  assert.match(service, /assertExpectedSalesExecutionRevision\(input, before\.revision\)/);
  assert.match(service, /status: "DISPATCHED"/);
  assert.match(service, /!\["REJECTED", "VOIDED"\]\.includes\(order\.status\)/);
  assert.match(service, /productionStatus !== "COMPLETED"/);
  assert.match(service, /releasedContainerMaterialization\(execution\)/);
  assert.match(service, /materializeReleasedContainerActuals\(tx, before, materialization/);
  assert.match(service, /sourceSalesExecutionId: before\.id/);
  assert.match(service, /status: "草稿"/);
  assert.match(service, /actualShipmentAmount: null/);
  assert.match(service, /actualShipmentDate: null/);
  assert.match(service, /before\.totalAmount\.mul\(exchangeRate\)\.toDecimalPlaces\(2\)/);
  assert.match(service, /shippingStartedAt: now/);
  assert.match(service, /appendSalesExecutionVersion/);
  assert.match(service, /writeAudit/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(lifecycleGuards, /SALES_EXECUTION_SHIPPING_STARTED/);
  assert.match(lifecycleGuards, /已进入发货并关联应收订单/);
});

test("shipping readiness requires exact active allocation, acceptance, completion and released container results", () => {
  assert.equal(salesExecutionShippingReadiness(null).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ status: "DRAFT" }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [] }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [purchaseOrder({ status: "DISPATCHED" })] }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [purchaseOrder({ status: "VOIDED" })] }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [purchaseOrder({ productionStatus: "IN_PRODUCTION" })] }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ containerLoads: [containerLoad({ status: "OPEN", loadingResults: [{ id: "loading-pending", status: "PENDING", purchaseOrderId: "po-1", items: [] }] })] }) as never).reason, "还有 1 条本柜实装差异待审批");
  assert.equal(salesExecutionShippingReadiness(execution({ containerLoads: [containerLoad({ status: "OPEN", loadingResults: [] })] }) as never).reason, "还有 1 个集装箱未最终放行");
  assert.equal(salesExecutionShippingReadiness(execution({ containerLoads: [] }) as never).reason, "尚未创建集装箱柜总单");
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [purchaseOrder({ actualDeliveryDate: null })] }) as never).ready, true);
  assert.equal(salesExecutionShippingReadiness(execution({ containerLoads: [containerLoad({ loadingResults: [{ id: "loading-1", status: "APPROVED", purchaseOrderId: "po-1", items: [{ purchaseOrderItemId: "po-item-1", loadedQuantity: "9.9999" }] }] })] }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [purchaseOrder({ items: [{ executionItemId: "item-1", allocatedQuantity: "9" }] })] }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [
    purchaseOrder({ items: [{ executionItemId: "item-1", allocatedQuantity: "5" }] }),
    purchaseOrder({ id: "po-2", status: "DELIVERY_PROPOSED", items: [{ executionItemId: "item-1", allocatedQuantity: "5" }] }),
  ] }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [
    purchaseOrder(),
    purchaseOrder({ id: "po-old", status: "VOIDED", items: [{ executionItemId: "item-1", allocatedQuantity: "10" }] }),
  ] }) as never).ready, true);
  assert.equal(salesExecutionShippingReadiness(execution({ purchaseOrders: [
    purchaseOrder(),
    purchaseOrder({ id: "po-rejected", status: "REJECTED", items: [{ executionItemId: "item-1", allocatedQuantity: "10" }] }),
  ] }) as never).ready, true);
  assert.equal(salesExecutionShippingReadiness(execution({
    purchaseOrders: [purchaseOrder(), purchaseOrder({ id: "po-rejected", status: "REJECTED" })],
    containerLoads: [containerLoad({ loadingResults: [
      { id: "loading-1", status: "APPROVED", purchaseOrderId: "po-1", items: [{ purchaseOrderItemId: "po-item-1", loadedQuantity: "10" }] },
      { id: "loading-old", status: "APPROVED", purchaseOrderId: "po-rejected", items: [{ purchaseOrderItemId: "po-old-item", loadedQuantity: "10" }] },
    ] })],
  }) as never).ready, true);
  assert.equal(salesExecutionShippingReadiness(execution({
    purchaseOrders: [purchaseOrder(), purchaseOrder({ id: "po-rejected", status: "REJECTED" })],
    containerLoads: [containerLoad(), containerLoad({
      id: "container-old",
      status: "OPEN",
      allocations: [{ id: "allocation-old", purchaseOrderId: "po-rejected", purchaseOrderItemId: "po-old-item", plannedQuantity: "10" }],
      loadingResults: [{ id: "loading-old", status: "PENDING", purchaseOrderId: "po-rejected", items: [] }],
    })],
  }) as never).ready, true);
  assert.equal(salesExecutionShippingReadiness(execution({
    purchaseOrders: [purchaseOrder(), purchaseOrder({ id: "po-rejected", status: "REJECTED" })],
    containerLoads: [containerLoad({
      allocations: [
        { id: "allocation-1", purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1", plannedQuantity: "10" },
        { id: "allocation-old", purchaseOrderId: "po-rejected", purchaseOrderItemId: "po-old-item", plannedQuantity: "1" },
      ],
    })],
  }) as never).reason, "有集装箱同时包含有效及已拒绝、已作废或不存在的采购单，请先修正或作废该柜");
  assert.equal(salesExecutionShippingReadiness(execution({
    containerLoads: [containerLoad({ allocations: [
      { id: "allocation-1", purchaseOrderId: "po-1", purchaseOrderItemId: "po-item-1", plannedQuantity: "10" },
      { id: "allocation-missing", purchaseOrderId: "missing-po", purchaseOrderItemId: "missing-item", plannedQuantity: "1" },
    ] })],
  }) as never).ready, false);
  assert.equal(salesExecutionShippingReadiness(execution({ receivableOrder: { id: "order-1" } }) as never).ready, false);
});

test("route and UI expose one explicit manual handoff with linked-order navigation", () => {
  assert.match(route, /params: Promise<\{ id: string \}>/);
  assert.match(route, /enterSalesExecutionShipping/);
  assert.match(route, /receivableOrder: result\.receivableOrder/);
  assert.match(hook, /\/enter-shipping/);
  assert.match(hook, /expectedRevision: Number\(execution\.revision \|\| 1\)/);
  assert.match(hook, /不会自动填写实际发货日期或实际发货金额/);
  assert.match(detail, /shippingStarting \? "处理中\.\.\." : "进入发货"/);
  assert.doesNotMatch(detail, /disabled=\{[^}]*!shippingReadiness\.ready/);
  assert.match(detail, /title=\{shippingReadiness\.ready \? undefined : shippingReadiness\.reason\}/);
  assert.match(detail, /打开应收订单/);
  assert.doesNotMatch(purchaseList, /onEnterShipping/);
  assert.match(moduleSource, /canWrite && canWriteOrders/);
  assert.match(moduleSource, /canReadOrders/);
  assert.match(workspace, /onOpenReceivableOrder[\s\S]*openWorkspaceMenu\("orders", \{ keyword: orderNo \}/);
});

test("generated orders remain editable with existing order rules", () => {
  assert.match(orderModel, /"FCA"/);
  assert.match(orderModel, /\{ value: "CUSTOM", label: "其他付款约定" \}/);
  assert.match(orderPanel, /form\.paymentTermType === "CUSTOM"/);
  assert.match(orderPayload, /form\.paymentTermType === "CUSTOM" \? form\.paymentTerm\.trim\(\)/);
  assert.match(orderMutations, /historicalRateAllowed/);
  assert.match(orderMutations, /before\.sourceSalesExecutionId/);
  assert.match(orderMutations, /不能删除；如需终止，请保留记录并将状态改为已取消/);
  assert.match(orderMutations, /assertLinkedOrderIdentityUnchanged/);
  assert.match(orderSourceGuards, /ORDER_SALES_EXECUTION_IDENTITY_LOCKED/);
});
