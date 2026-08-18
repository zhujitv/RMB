import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  normalizeActualDeliveryInput,
  normalizeDeliveryProposalDecisionInput,
} = await jiti.import<typeof import("../lib/platform/factory-purchase-order-delivery.ts")>("../lib/platform/factory-purchase-order-delivery.ts");

const serviceSource = readFileSync("lib/platform/factory-purchase-order-delivery.ts", "utf8");
const actualDeliverySource = readFileSync("lib/platform/factory-purchase-order-actual-delivery.ts", "utf8");
const loadingCoreSource = readFileSync("lib/platform/factory-purchase-order-loading-result-core.ts", "utf8");
const loadingWorkflowSource = readFileSync("lib/platform/factory-purchase-order-loading-result-workflow.ts", "utf8");
const containerLifecycleSource = readFileSync("lib/platform/sales-execution-container-load-lifecycle.ts", "utf8");
const containerShippingSource = readFileSync("lib/platform/sales-execution-container-shipping.ts", "utf8");
const shippingHandoffSource = readFileSync("lib/platform/sales-execution-shipping-handoff.ts", "utf8");
const containerLocksSource = readFileSync("lib/platform/container-loading-locks.ts", "utf8");
const decisionRouteSource = readFileSync("app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/delivery-proposal-decision/route.ts", "utf8");
const actualRouteSource = readFileSync("app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/actual-delivery/route.ts", "utf8");

test("delivery proposal decisions normalize ACCEPT and require a rejection remark", () => {
  assert.deepEqual(normalizeDeliveryProposalDecisionInput({ decision: "ACCEPT", expectedRevision: 4 }), {
    decision: "ACCEPTED",
    remark: "",
    expectedRevision: 4,
  });
  assert.deepEqual(normalizeDeliveryProposalDecisionInput({ action: "REJECT", expectedRevision: 5, remark: "产能计划无法接受" }), {
    decision: "REJECTED",
    remark: "产能计划无法接受",
    expectedRevision: 5,
  });
  assert.throws(
    () => normalizeDeliveryProposalDecisionInput({ decision: "REJECT", expectedRevision: 5 }),
    (error: unknown) => (error as { code?: string }).code === "FACTORY_DELIVERY_DECISION_REMARK_REQUIRED",
  );
});

test("actual delivery input requires an exact date and optimistic revision", () => {
  assert.equal(normalizeActualDeliveryInput({ actualDeliveryDate: "2026-08-10", expectedRevision: 7 }).text, "2026-08-10");
  assert.throws(
    () => normalizeActualDeliveryInput({ actualDeliveryDate: "2026-02-30", expectedRevision: 7 }),
    (error: unknown) => (error as { code?: string }).code === "FACTORY_ACTUAL_DELIVERY_DATE_INVALID",
  );
  assert.throws(
    () => normalizeActualDeliveryInput({ actualDeliveryDate: "2026-08-10", expectedRevision: "7" }),
    (error: unknown) => (error as { code?: string }).code === "FACTORY_PURCHASE_ORDER_REVISION_INVALID",
  );
});

test("only the latest undecided delivery proposal can be accepted or rejected with CAS", () => {
  assert.match(serviceSource, /before\.status !== "DELIVERY_PROPOSED"/);
  assert.match(serviceSource, /proposal\.action !== "DELIVERY_PROPOSED"/);
  assert.match(serviceSource, /proposal\.responseSequence !== before\.supplierResponseSequence/);
  assert.match(serviceSource, /proposal\.internalDecision/);
  assert.match(serviceSource, /internalDecision: input\.decision/);
  assert.match(serviceSource, /internalDecidedAt: decidedAt/);
  assert.match(serviceSource, /internalDecidedById: actorId/);
  assert.match(serviceSource, /productionStatus === "COMPLETED" \|\| before\.actualDeliveryDate \|\| before\.execution\.shippingStartedAt/);
  assert.match(serviceSource, /revision: input\.expectedRevision/);
  assert.match(serviceSource, /TransactionIsolationLevel\.Serializable/);
});

test("accepting a first proposal freezes anchors and applies the prepayment gate", () => {
  assert.match(serviceSource, /firstConfirmation = input\.decision === "ACCEPTED" && !before\.confirmedSupplierDeliveryDate/);
  assert.match(serviceSource, /effectiveFactoryPurchaseOrderAmount\(before\.items\)/);
  assert.match(serviceSource, /confirmedSupplierDeliveryDate: proposal\.deliveryDate/);
  assert.match(serviceSource, /initialSupplierDeliveryDate: proposal\.deliveryDate/);
  assert.match(serviceSource, /penaltyBaseAmount,/);
  assert.match(serviceSource, /confirmedPrepaymentTotal\(before\)\.lt\(requiredPrepayment\)/);
  assert.match(serviceSource, /"WAITING_PREPAYMENT"[\s\S]*"READY"/);
});

test("rejecting a proposal restores the last confirmed state without overwriting the confirmed date", () => {
  assert.match(serviceSource, /before\.confirmedSupplierDeliveryDate \? "ACCEPTED" : "DISPATCHED"/);
  const rejectionUpdate = serviceSource.slice(
    serviceSource.indexOf("const nextStatus ="),
    serviceSource.indexOf("const changed = await tx.factoryPurchaseOrder.updateMany", serviceSource.indexOf("const nextStatus =")),
  );
  assert.doesNotMatch(rejectionUpdate, /confirmedSupplierDeliveryDate:/);
  assert.match(serviceSource, /supplierDeliveryDate: input\.decision === "ACCEPTED" \? proposal\.deliveryDate : before\.confirmedSupplierDeliveryDate/);
});

test("actual delivery is derived from released containers only at shipping handoff", () => {
  assert.match(loadingCoreSource, /order\.status !== "ACCEPTED" \|\| order\.productionStatus !== "COMPLETED"/);
  assert.doesNotMatch(loadingCoreSource, /validateFactoryPurchaseLoadingDate/);
  assert.match(containerLifecycleSource, /const loadingDate = new Date\(`\$\{shanghaiDateText\(now\)\}T00:00:00\.000Z`\)/);
  assert.match(containerLifecycleSource, /status: "RELEASED",[\s\S]*loadingDate,[\s\S]*releasedAt: now/);
  assert.match(actualDeliverySource, /FACTORY_ACTUAL_DELIVERY_CONTAINER_LEDGER_REQUIRED/);
  assert.match(containerShippingSource, /actualDeliveryDate: null/);
  assert.match(containerShippingSource, /actualDeliveryRecordedAt: recordedAt/);
  assert.match(containerShippingSource, /actualDeliveryRecordedById: actorId/);
  assert.match(shippingHandoffSource, /materializeReleasedContainerActuals[\s\S]*receivableOrder\.create/);
  assert.doesNotMatch(loadingWorkflowSource, /actualDeliveredQuantity|actualDeliveryDate/);
});

test("delivery routes require salesExecution write permission and return compatible payloads", () => {
  for (const source of [decisionRouteSource, actualRouteSource]) {
    assert.match(source, /requireApiWrite\(request, "salesExecution"\)/);
    assert.match(source, /await params/);
    assert.match(source, /await parseJsonBody\(request\)/);
    assert.match(source, /success: true/);
    assert.match(source, /purchaseOrder/);
    assert.match(source, /data:/);
  }
  assert.match(decisionRouteSource, /decideFactoryPurchaseOrderDeliveryProposal/);
  assert.match(actualRouteSource, /recordFactoryPurchaseOrderActualDelivery/);
});

test("delivery proposal uses CAS while container loading uses the global lock order", () => {
  assert.equal((serviceSource.match(/lockFactoryPurchaseOrder\(tx, purchaseOrderId\)/g) || []).length, 1);
  assert.match(serviceSource, /execution: \{ is: salesExecutionAccessWhere\(actor\) \}/);
  assert.match(serviceSource, /revision: input\.expectedRevision/);
  assert.match(serviceSource, /await writeAudit\(/);
  const executionLock = containerLocksSource.indexOf("lockSalesExecution");
  const containerLock = containerLocksSource.indexOf('FROM "sales_execution_container_loads"');
  const poLock = containerLocksSource.indexOf('FROM "factory_purchase_orders"');
  const resultLock = containerLocksSource.indexOf('FROM "factory_purchase_order_loading_results"');
  assert.ok(executionLock < containerLock && containerLock < poLock && poLock < resultLock);
});
