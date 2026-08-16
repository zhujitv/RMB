import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(
  "lib/platform/factory-purchase-order-reassignment.ts",
  "utf8",
);
const validation = readFileSync(
  "lib/platform/factory-purchase-order-reassignment-validation.ts",
  "utf8",
);
const notificationRetirement = readFileSync(
  "lib/platform/factory-purchase-order-reassignment-notifications.ts",
  "utf8",
);
const reassignmentDelivery = readFileSync(
  "lib/platform/factory-purchase-order-reassignment-delivery.ts",
  "utf8",
);
const route = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/reassign/route.ts",
  "utf8",
);
const dispatchHelpers = readFileSync(
  "lib/platform/factory-purchase-order-dispatch-notification-helpers.ts",
  "utf8",
);
const responseCore = readFileSync(
  "lib/platform/factory-purchase-order-response-core.ts",
  "utf8",
);
const auditHardeningMigration = readFileSync(
  "prisma/migrations/20260810046000_factory_purchase_audit_hardening/migration.sql",
  "utf8",
);

test("reassignment route authenticates writes and awaits dynamic route params", () => {
  assert.match(route, /requireApiWrite\(request, "salesExecution"\)/);
  assert.match(route, /params: Promise<\{ id: string; purchaseOrderId: string \}>/);
  assert.match(route, /const \{ id, purchaseOrderId \} = await params/);
  assert.match(route, /await parseJsonBody\(request\)/);
  assert.match(route, /reassignRejectedFactoryPurchaseOrder/);
  assert.match(route, /runtime = "nodejs"/);
});

test("reassignment locks the execution graph and enforces both revisions", () => {
  assert.match(service, /assertWrite\(actor, "salesExecution"\)/);
  assert.match(service, /lockSalesExecution\(tx, executionId\)[\s\S]*lockFactoryPurchaseOrders\(tx, executionId\)/);
  assert.match(service, /assertExpectedSalesExecutionRevision\(body, before\.revision\)/);
  assert.match(service, /rejectedOrder\.revision !== expectedOrderRevision/);
  assert.match(service, /status: "REJECTED",[\s\S]*revision: expectedOrderRevision/);
  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
});

test("only a rejected pre-shipping order can move to another active product factory", () => {
  const source = `${service}\n${validation}`;
  assert.match(service, /before\.status !== "DISPATCHED"/);
  assert.match(service, /before\.shippingStartedAt \|\| before\.receivableOrder/);
  assert.match(service, /rejectedOrder\.status !== "REJECTED"/);
  assert.match(service, /rejectedOrder\.supplierId === newSupplierId/);
  assert.match(source, /status: "启用"/);
  assert.match(source, /supplierType: \{ in: \[\.\.\.PRODUCT_SUPPLIER_TYPES\] \}/);
  assert.doesNotMatch(validation, /allowFactoryDocumentUpload|resolveFactoryPurchaseOrderDispatchRecipients|recipientEmails/);
  assert.match(service, /queueFactoryPurchaseOrderDispatchOutbox/);
  assert.match(service, /missingRecipient/);
});

test("reassignment preserves the rejected order and dispatches a linked price-free replacement", () => {
  assert.match(service, /status: "VOIDED",[\s\S]*voidedAt: now,[\s\S]*voidedById: actorId/);
  assert.match(service, /Math\.max\(maximum, order\.sequenceNo\)/);
  assert.match(service, /factoryPurchaseOrderNumber\(before\.executionNo, nextSequence\)/);
  assert.match(service, /replacementForId: rejectedOrder\.id/);
  assert.match(service, /status: "DRAFT"/);
  assert.match(service, /paymentTerm: supplier\.purchasePaymentTerm/);
  assert.match(service, /prepaymentRatio: supplier\.purchasePrepaymentRatio/);
  assert.match(service, /allocatedQuantity: item\.allocatedQuantity,[\s\S]*purchaseUnitPrice: null,[\s\S]*amount: null/);
  assert.match(service, /status: "DISPATCHED",[\s\S]*dispatchVersionNumber: nextRevision/);
});

test("reassignment advances history and queues only the replacement notification", () => {
  assert.match(service, /salesExecution\.updateMany\([\s\S]*revision: before\.revision/);
  assert.match(service, /dispatchedVersionNumber: nextRevision,[\s\S]*currentVersionNumber: nextRevision/);
  assert.match(service, /appendSalesExecutionVersion\(tx, before\.id, actor\)/);
  assert.match(service, /被拒工厂采购单重新选厂并单独下发/);
  assert.match(service, /purchaseOrderIds: \[replacement\.id\]/);
  const transaction = service.match(/transactionResult = await prisma\.\$transaction[\s\S]*?isolationLevel/)?.[0] || "";
  assert.match(transaction, /queueFactoryPurchaseOrderDispatchOutbox/);
  assert.doesNotMatch(transaction, /processFactoryPurchaseOrderDispatchOutbox/);
  assert.match(service, /processReplacementPurchaseOrderNotifications\(\{[\s\S]*purchaseOrderId: transactionResult\.replacementPurchaseOrderId/);
  assert.match(reassignmentDelivery, /processFactoryPurchaseOrderDispatchOutbox\(\{[\s\S]*purchaseOrderIds: \[input\.purchaseOrderId\]/);
});

test("reassignment cancels stale original notifications and blocks a currently sending email", () => {
  assert.match(service, /retireRejectedPurchaseOrderNotifications\(tx, rejectedOrder\.id, now\)/);
  assert.match(notificationRetirement, /status: "sending",[\s\S]*updatedAt: \{ gt: staleBefore \}/);
  assert.match(notificationRetirement, /FACTORY_PURCHASE_ORDER_REASSIGN_NOTIFICATION_SENDING/);
  assert.match(notificationRetirement, /status: \{ in: \["queued", "failed", "pending"\] \}/);
  assert.match(notificationRetirement, /status: "cancelled"/);
  assert.match(service, /dispatchEmailStatus: rejectedOrder\.dispatchEmailStatus === "SENT" \? "SENT" : "CANCELLED"/);
  assert.match(auditHardeningMigration, /'NOT_SENT', 'SENDING', 'SENT', 'FAILED', 'NO_RECIPIENT', 'CANCELLED'/);
});

test("portal or offline supplier rejection retires actionable notifications immediately", () => {
  assert.doesNotMatch(dispatchHelpers, /"REJECTED"/);
  assert.match(responseCore, /response\.action === "REJECTED"[\s\S]*notificationOutbox\.updateMany/);
  assert.match(responseCore, /status: \{ in: \["queued", "failed", "pending"\] \}/);
  assert.match(responseCore, /status: "cancelled"/);
  assert.match(responseCore, /dispatchEmailStatus: before\.dispatchEmailStatus === "SENT" \? "SENT" : "CANCELLED"/);
});

test("reassignment keeps unrelated active purchase-order email retries valid", () => {
  const retryService = readFileSync(
    "lib/platform/factory-purchase-order-dispatch-retry.ts",
    "utf8",
  );
  assert.match(retryService, /expectedDispatchVersion !== version/);
  assert.doesNotMatch(
    retryService,
    /version !== Number\(execution\.dispatchedVersionNumber \|\| 0\)/,
  );
  assert.match(retryService, /purchaseOrderIds: \[order\.id\]/);
});
