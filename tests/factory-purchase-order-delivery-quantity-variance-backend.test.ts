import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const { Prisma } = await jiti.import<typeof import("../lib/generated/prisma/client.js")>(
  "../lib/generated/prisma/client.js",
);
const { normalizeActualDeliveryInput } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-delivery-inputs.ts")
>("../lib/platform/factory-purchase-order-delivery-inputs.ts");
const { normalizeSupplierProductionProgressInput } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-production-progress-inputs.ts")
>("../lib/platform/factory-purchase-order-production-progress-inputs.ts");
const {
  effectiveFactoryPurchaseOrderDeliveredAmount,
} = await jiti.import<typeof import("../lib/platform/factory-purchase-order-financials.ts")>(
  "../lib/platform/factory-purchase-order-financials.ts",
);
const { calculateFactorySettlementAmounts } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-settlement-values.ts")
>("../lib/platform/factory-purchase-order-settlement-values.ts");
const { deliveryQuantityCoverageShortages } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-delivery-quantity-variance-coverage.ts")
>("../lib/platform/factory-purchase-order-delivery-quantity-variance-coverage.ts");

const targets = [
  { id: "line-a", allocatedQuantity: new Prisma.Decimal("10") },
  { id: "line-b", allocatedQuantity: new Prisma.Decimal("1") },
];
const approved = {
  status: "APPROVED",
  items: [
    { purchaseOrderItemId: "line-a", proposedQuantity: new Prisma.Decimal("10.5") },
    { purchaseOrderItemId: "line-b", proposedQuantity: new Prisma.Decimal("0.95") },
  ],
};

test("actual delivery requires every line and exactly matches the approved Decimal target", () => {
  const input = normalizeActualDeliveryInput({
    actualDeliveryDate: "2026-08-16",
    expectedRevision: 9,
    items: [
      { purchaseOrderItemId: "line-a", actualDeliveredQuantity: "10.5000" },
      { purchaseOrderItemId: "line-b", actualDeliveredQuantity: "0.95" },
    ],
  }, targets, approved);
  assert.deepEqual(
    input.items.map((item) => item.actualDeliveredQuantity.toString()),
    ["10.5", "0.95"],
  );
  assert.throws(
    () => normalizeActualDeliveryInput({
      actualDeliveryDate: "2026-08-16",
      expectedRevision: 9,
      items: [
        { purchaseOrderItemId: "line-a", actualDeliveredQuantity: "10" },
        { purchaseOrderItemId: "line-b", actualDeliveredQuantity: "0.95" },
      ],
    }, targets, approved),
    (error: unknown) => (error as { code?: string }).code === "FACTORY_ACTUAL_DELIVERY_QUANTITY_MISMATCH",
  );
});

test("approved overage becomes the production input ceiling", () => {
  const input = normalizeSupplierProductionProgressInput({
    expectedRevision: 10,
    items: [
      { purchaseOrderItemId: "line-a", completedQuantity: "10.5" },
      { purchaseOrderItemId: "line-b", completedQuantity: "0.95" },
    ],
  }, [
    { ...targets[0], targetQuantity: new Prisma.Decimal("10.5") },
    { ...targets[1], targetQuantity: new Prisma.Decimal("0.95") },
  ]);
  assert.equal(input.items[0].completedQuantity.toString(), "10.5");
});

test("a shortage can be approved only after another factory's approved overage covers it", () => {
  assert.deepEqual(deliveryQuantityCoverageShortages({
    items: [{ id: "sales-line", quantity: "100" }],
    purchaseOrders: [{
      id: "po-only",
      items: [{ id: "only-line", executionItemId: "sales-line", allocatedQuantity: "100" }],
      deliveryQuantityVariances: [],
    }],
  }, "po-only", [{ purchaseOrderItemId: "only-line", proposedQuantity: "95" }]), ["sales-line"]);
  const baseExecution = {
    items: [{ id: "sales-line", quantity: "200" }],
    purchaseOrders: [
      {
        id: "po-short",
        items: [{ id: "short-line", executionItemId: "sales-line", allocatedQuantity: "100" }],
        deliveryQuantityVariances: [],
      },
      {
        id: "po-cover",
        items: [{ id: "cover-line", executionItemId: "sales-line", allocatedQuantity: "100" }],
        deliveryQuantityVariances: [],
      },
    ],
  };
  assert.deepEqual(deliveryQuantityCoverageShortages(
    baseExecution,
    "po-short",
    [{ purchaseOrderItemId: "short-line", proposedQuantity: "95" }],
  ), ["sales-line"]);
  const coveredExecution = {
    ...baseExecution,
    purchaseOrders: [
      baseExecution.purchaseOrders[0],
      {
        ...baseExecution.purchaseOrders[1],
        deliveryQuantityVariances: [{
          items: [{ purchaseOrderItemId: "cover-line", proposedQuantity: "105" }],
        }],
      },
    ],
  };
  assert.deepEqual(deliveryQuantityCoverageShortages(
    coveredExecution,
    "po-short",
    [{ purchaseOrderItemId: "short-line", proposedQuantity: "95" }],
  ), []);
  assert.deepEqual(deliveryQuantityCoverageShortages({
    items: [{ id: "sales-line", quantity: "100" }],
    purchaseOrders: [
      {
        id: "po-rejected",
        status: "REJECTED",
        items: [{ id: "rejected-line", executionItemId: "sales-line", allocatedQuantity: "100" }],
        deliveryQuantityVariances: [],
      },
      {
        id: "po-replacement",
        status: "ACCEPTED",
        items: [{ id: "replacement-line", executionItemId: "sales-line", allocatedQuantity: "100" }],
        deliveryQuantityVariances: [],
      },
    ],
  }, "po-replacement", [{ purchaseOrderItemId: "replacement-line", proposedQuantity: "95" }]), ["sales-line"]);
});

test("settlement uses actual delivered goods amount while delay penalty keeps contract base", () => {
  const goodsAmount = effectiveFactoryPurchaseOrderDeliveredAmount([
    {
      actualDeliveredQuantity: new Prisma.Decimal("10.5"),
      purchaseUnitPrice: new Prisma.Decimal("20"),
    },
    {
      actualDeliveredQuantity: new Prisma.Decimal("0.95"),
      purchaseUnitPrice: new Prisma.Decimal("100"),
    },
  ]);
  assert.equal(goodsAmount?.toString(), "305");
  const amounts = calculateFactorySettlementAmounts({
    baseAmount: goodsAmount || 0,
    penaltyBaseAmount: new Prisma.Decimal("400"),
    initialDeliveryDate: "2026-08-01",
    actualDeliveryDate: "2026-08-13",
    adjustments: [],
    graceDays: 10,
    ratePerDay: new Prisma.Decimal("0.01"),
  });
  assert.equal(amounts.baseAmount.toString(), "305");
  assert.equal(amounts.delayPenaltyAmount.toString(), "8");
  assert.equal(amounts.finalPayableAmount.toString(), "297");
});

test("backend wiring blocks pending delivery and aggregate short shipment without leaking decisions", () => {
  const actualDelivery = readFileSync("lib/platform/factory-purchase-order-actual-delivery.ts", "utf8");
  const loadingWorkflow = readFileSync("lib/platform/factory-purchase-order-loading-result-workflow.ts", "utf8");
  const completion = readFileSync("lib/platform/factory-purchase-order-production-completion-core.ts", "utf8");
  const varianceDecision = readFileSync("lib/platform/factory-purchase-order-delivery-quantity-variance-decision.ts", "utf8");
  const varianceCoverage = readFileSync("lib/platform/factory-purchase-order-delivery-quantity-variance-coverage.ts", "utf8");
  const shipping = readFileSync("lib/platform/sales-execution-shipping-handoff.ts", "utf8");
  const containerShipping = readFileSync("lib/platform/sales-execution-container-shipping.ts", "utf8");
  const settlement = readFileSync("lib/platform/factory-purchase-order-settlement.ts", "utf8");
  const supplierSelect = readFileSync("lib/platform/supplier-purchase-orders-query.ts", "utf8");
  const supplierDto = readFileSync("lib/platform/supplier-delivery-quantity-variance-values.ts", "utf8");
  assert.match(actualDelivery, /FACTORY_ACTUAL_DELIVERY_CONTAINER_LEDGER_REQUIRED/);
  assert.match(completion, /FACTORY_PRODUCTION_COMPLETION_VARIANCE_PENDING/);
  assert.match(completion, /deliveryQuantityVariances: \{ none: \{ status: "PENDING" \} \}/);
  assert.doesNotMatch(loadingWorkflow, /actualDeliveredQuantity|actualDeliveryDate/);
  assert.match(shipping, /materializeReleasedContainerActuals/);
  assert.match(containerShipping, /deliveredByExecutionItem/);
  assert.match(containerShipping, /SHIPPING_ACTUAL_DELIVERY_QUANTITY_SHORT/);
  assert.match(settlement, /penaltyBaseAmount: purchaseOrder\.penaltyBaseAmount/);
  assert.doesNotMatch(varianceDecision, /BELOW_COMPLETED_PROGRESS|NotBelowReportedProgress/);
  assert.match(varianceDecision, /lockDeliveryQuantityVarianceApprovalScope[\s\S]*assertDeliveryQuantityApprovalPreservesSalesCoverage/);
  assert.match(varianceCoverage, /sales_executions[\s\S]*FOR UPDATE[\s\S]*factory_purchase_orders[\s\S]*ORDER BY "id"[\s\S]*FOR UPDATE/);
  assert.match(varianceCoverage, /status" NOT IN \('REJECTED', 'VOIDED'\)/);
  assert.match(varianceCoverage, /status: \{ notIn: \["REJECTED", "VOIDED"\] \}/);
  assert.match(varianceCoverage, /FACTORY_DELIVERY_QUANTITY_VARIANCE_EXECUTION_SHORT/);
  assert.doesNotMatch(supplierSelect, /decisionRemark/);
  assert.doesNotMatch(supplierSelect, /reportedBy:\s*\{\s*select/);
  assert.doesNotMatch(supplierDto, /decisionRemark|decidedBy/);
});
