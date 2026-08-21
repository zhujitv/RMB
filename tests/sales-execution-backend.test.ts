import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import {
  factoryPurchaseOrderNumber,
} from "../lib/platform/sales-execution-number.ts";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  assertSalesExecutionCreationCredentials,
  nullableDecimalSubtotal,
  nullableSalesExecutionDecimal,
  serializeSalesExecution,
} = await jiti.import<
  typeof import("../lib/platform/sales-execution-values.ts")
>("../lib/platform/sales-execution-values.ts");
const { independentShipmentEvidence, shipmentRegistrationDecision } = await jiti.import<
  typeof import("../lib/platform/sales-execution-quantity-correction-receivable.ts")
>("../lib/platform/sales-execution-quantity-correction-receivable.ts");

const schema = readPrismaSchemaSource();
const migration = readFileSync(
  "prisma/migrations/20260810010000_sales_execution_drafts/migration.sql",
  "utf8",
);
const requiredFieldsMigration = readFileSync(
  "prisma/migrations/20260810013000_required_sales_execution_order_fields/migration.sql",
  "utf8",
);
const weightsAndNullablePricesMigration = readFileSync(
  "prisma/migrations/20260810022000_sales_execution_weights_nullable_purchase_prices/migration.sql",
  "utf8",
);
const dispatchMigration = readFileSync(
  "prisma/migrations/20260810023000_factory_purchase_dispatch/migration.sql",
  "utf8",
);
const responseGuardMigration = readFileSync(
  "prisma/migrations/20260810024000_factory_purchase_response_guard/migration.sql",
  "utf8",
);
const immutabilityHardeningMigration = readFileSync(
  "prisma/migrations/20260810025000_dispatch_immutability_hardening/migration.sql",
  "utf8",
);
const dispatchConcurrencyMigration = readFileSync(
  "prisma/migrations/20260810030000_dispatch_lock_concurrency/migration.sql",
  "utf8",
);
const dispatchQueueMigration = readFileSync(
  "prisma/migrations/20260810031000_dispatch_queue_serialization/migration.sql",
  "utf8",
);
const supplierConfirmationMigration = readFileSync(
  "prisma/migrations/20260810032000_supplier_purchase_confirmations/migration.sql",
  "utf8",
);
const directCreate = readFileSync("lib/platform/sales-execution-create-direct.ts", "utf8");
const directItemsService = readFileSync("lib/platform/sales-execution-direct-items.ts", "utf8");
const quoteCreate = readFileSync("lib/platform/sales-execution-create-quotation.ts", "utf8");
const mutationService = readFileSync("lib/platform/sales-execution-service.ts", "utf8");
const quantityCorrectionService = readFileSync("lib/platform/sales-execution-quantity-correction.ts", "utf8");
const quantityCorrectionReceivableService = readFileSync(
  "lib/platform/sales-execution-quantity-correction-receivable.ts",
  "utf8",
);
const quantityCorrectionRoute = readFileSync("app/api/sales-executions/[id]/quantity-correction/route.ts", "utf8");
const quantityCorrectionMigration = readFileSync(
  "prisma/migrations/20260821152000_dispatched_quantity_correction/migration.sql",
  "utf8",
);
const quantityCorrectionShippingResetMigration = readFileSync(
  "prisma/migrations/20260821173000_quantity_correction_shipping_reset/migration.sql",
  "utf8",
);
const quantityCorrectionSupplierPriceMigration = readFileSync(
  "prisma/migrations/20260821180500_quantity_correction_supplier_price/migration.sql",
  "utf8",
);
const voidNotificationService = readFileSync(
  "lib/platform/sales-execution-void-notifications.ts",
  "utf8",
);
const itemWeightsService = readFileSync("lib/platform/sales-execution-item-weights.ts", "utf8");
const purchaseService = readFileSync("lib/platform/sales-execution-purchase-orders.ts", "utf8");
const dispatchService = readFileSync("lib/platform/sales-execution-dispatch.ts", "utf8");
const dispatchOutbox = readFileSync("lib/platform/factory-purchase-order-dispatch-outbox.ts", "utf8");
const dispatchRecipients = readFileSync("lib/platform/factory-purchase-order-dispatch-recipients.ts", "utf8");
const { canOperateFactoryPurchaseOrderPortal } = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-dispatch-recipients.ts")
>("../lib/platform/factory-purchase-order-dispatch-recipients.ts");
const dispatchNotifications = [
  "lib/platform/factory-purchase-order-dispatch-notifications.ts",
  "lib/platform/factory-purchase-order-dispatch-notification-status.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const dispatchRetry = readFileSync("lib/platform/factory-purchase-order-dispatch-retry.ts", "utf8");
const notificationSend = readFileSync("lib/platform/notification-send.ts", "utf8");
const factoryNotificationDefinition = readFileSync(
  "lib/platform/notification-factory-purchase-order-definition.ts",
  "utf8",
);
const notificationCronRoute = readFileSync("app/api/cron/notification-outbox/route.ts", "utf8");
const queryService = readFileSync("lib/platform/sales-execution-query-service.ts", "utf8");
const valuesService = readFileSync("lib/platform/sales-execution-values.ts", "utf8");
const serializationService = readFileSync("lib/platform/sales-execution-serialization.ts", "utf8");
const accessService = readFileSync("lib/platform/sales-execution-access.ts", "utf8");
const customerProducts = readFileSync("lib/platform/quotation-customer-products.ts", "utf8");
const customerProductValues = readFileSync("lib/platform/quotation-values.ts", "utf8");
const listRoute = readFileSync("app/api/sales-executions/route.ts", "utf8");
const detailRoute = readFileSync("app/api/sales-executions/[id]/route.ts", "utf8");
const purchaseRoute = readFileSync("app/api/sales-executions/[id]/purchase-orders/route.ts", "utf8");
const dispatchRoute = readFileSync("app/api/sales-executions/[id]/dispatch/route.ts", "utf8");
const dispatchRetryRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/dispatch-email/retry/route.ts",
  "utf8",
);

test("sales execution keeps immutable versions and only links the downstream receivable order", () => {
  assert.match(schema, /model SalesExecution\b[\s\S]*sourceType\s+SalesExecutionSourceType/);
  assert.match(schema, /model SalesExecutionVersion[\s\S]*snapshot\s+Json/);
  assert.match(schema, /@@unique\(\[executionId, versionNumber\]\)/);
  assert.match(schema, /model FactoryPurchaseOrder\b[\s\S]*purchaseCurrency\s+String/);
  const executionModel = schema.match(/model SalesExecution\b[\s\S]*?\n\}/)?.[0] || "";
  assert.match(executionModel, /receivableOrder\s+ReceivableOrder\?/);
  assert.doesNotMatch(executionModel, /OrderCost/);
  assert.match(migration, /sales_execution_versions_immutable/);
  assert.match(migration, /sales execution version snapshots are immutable/);
});

test("formal dispatch freezes a version and keeps supplier responses on factory purchase orders", () => {
  const executionModel = schema.match(/model SalesExecution\b[\s\S]*?\n\}/)?.[0] || "";
  const purchaseOrderModel = schema.match(/model FactoryPurchaseOrder\b[\s\S]*?\n\}/)?.[0] || "";
  assert.match(schema, /enum SalesExecutionStatus \{[\s\S]*DISPATCHED/);
  assert.match(schema, /enum FactoryPurchaseOrderStatus \{[\s\S]*ACCEPTED[\s\S]*DELIVERY_PROPOSED[\s\S]*REJECTED/);
  assert.match(executionModel, /dispatchedVersionNumber\s+Int\?/);
  assert.match(purchaseOrderModel, /dispatchVersionNumber\s+Int\?/);
  assert.match(purchaseOrderModel, /supplierDeliveryDate\s+DateTime\?/);
  assert.match(purchaseOrderModel, /supplierResponseRemark\s+String\?/);
  assert.match(purchaseOrderModel, /respondedById\s+String\?/);
  assert.doesNotMatch(purchaseOrderModel, /ReceivableOrder|OrderCost/);

  assert.match(dispatchMigration, /sales_execution_items_dispatch_lock/);
  assert.match(dispatchMigration, /factory_purchase_order_items_dispatch_lock/);
  assert.match(dispatchMigration, /factory_purchase_orders_dispatch_lock/);
  assert.match(dispatchMigration, /dispatched sales execution core fields are immutable/);
  assert.match(dispatchMigration, /dispatched factory purchase order core fields are immutable/);
  assert.match(dispatchMigration, /supplier_response_remark/);
  assert.match(responseGuardMigration, /supplier response is immutable/);
  assert.match(responseGuardMigration, /supplier response fields are immutable/);
  assert.match(responseGuardMigration, /voided factory purchase order cannot be restored/);
  assert.match(immutabilityHardeningMigration, /old_parent_status/);
  assert.match(immutabilityHardeningMigration, /new_parent_status/);
  assert.match(immutabilityHardeningMigration, /factory_purchase_orders_execution_parent_guard/);
  assert.match(immutabilityHardeningMigration, /voided sales execution cannot be restored/);
  assert.match(immutabilityHardeningMigration, /sales execution void audit fields are immutable/);
  assert.match(dispatchConcurrencyMigration, /FOR KEY SHARE/);
  assert.match(dispatchConcurrencyMigration, /NOT FOUND AND TG_OP = 'DELETE'/);
  assert.match(dispatchConcurrencyMigration, /'ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED', 'VOIDED'/);
  assert.match(dispatchQueueMigration, /FOR SHARE/);
  assert.doesNotMatch(dispatchQueueMigration, /\n\s+FOR KEY SHARE;/);
  assert.match(dispatchQueueMigration, /factory purchase orders must start as drafts/);
  assert.match(dispatchQueueMigration, /'NOT_SENT', 'SENDING', 'SENT', 'FAILED', 'NO_RECIPIENT'/);
});

test("dispatch validates exact allocation and atomically queues recoverable per-recipient notifications", () => {
  assert.match(dispatchService, /assertWrite\(actor, "salesExecution"\)/);
  assert.match(dispatchService, /lockSalesExecution/);
  assert.match(dispatchService, /lockFactoryPurchaseOrders/);
  assert.match(dispatchService, /assertExpectedSalesExecutionRevision/);
  assert.match(dispatchService, /totals\.get\(item\.id\)[\s\S]*?\.eq\(item\.quantity\)/);
  assert.match(dispatchService, /status: "DISPATCHED"/);
  assert.match(dispatchService, /dispatchVersionNumber: nextRevision/);
  assert.match(dispatchService, /revision: \{ increment: 1 \}/);
  assert.match(dispatchService, /appendSalesExecutionVersion/);
  assert.match(dispatchService, /正式下发销售执行单及工厂采购单/);
  const transactionBlock = dispatchService.match(/transactionResult = await prisma\.\$transaction[\s\S]*?\n    \}, \{ isolationLevel/)?.[0] || "";
  assert.match(transactionBlock, /queueFactoryPurchaseOrderDispatchOutbox/);
  assert.doesNotMatch(transactionBlock, /sendNotificationEmail/);
  assert.match(dispatchOutbox, /status: "queued"/);
  assert.match(dispatchOutbox, /notificationOutbox\.createMany/);
  assert.match(dispatchOutbox, /factoryDispatchIdempotencyKey\(order\.id, dispatchVersionNumber, recipientEmail\)/);
  assert.match(dispatchOutbox, /recipientEmails: \[recipientEmail\]/);
  assert.match(dispatchOutbox, /const maxLength = 8000/);
  assert.match(dispatchOutbox, /其余采购明细请登录平台查看/);
  assert.match(dispatchOutbox, /productVisibleDescription\([\s\S]*item\.productNameSnapshot,[\s\S]*item\.specificationSnapshot/);
  assert.doesNotMatch(dispatchOutbox, /\[item\.productNameSnapshot, item\.specificationSnapshot\][\s\S]*\.join/);
  assert.match(dispatchOutbox, /resolveFactoryPurchaseOrderDispatchRecipients\(tx, order\.supplierId\)/);
  assert.match(dispatchRecipients, /allowFactoryDocumentUpload: true/);
  assert.match(dispatchRecipients, /role: \{ in: \[\.\.\.PRODUCT_SUPPLIER_OPERATOR_ROLES\] \}/);
  assert.match(dispatchRecipients, /isActive: true,[\s\S]*?deletedAt: null,[\s\S]*?approvalStatus: "APPROVED"/);
  assert.match(dispatchRecipients, /if \(!operatorEmails\.length\)/);
  assert.match(dispatchRecipients, /recipientEmails: operatorEmails/);
  assert.doesNotMatch(dispatchRecipients, /recipientEmails: uniqueEmails\(\[operatorEmails, supplier\.email\]\)/);
  assert.doesNotMatch(dispatchService, /resolveFactoryPurchaseOrderDispatchRecipients|PURCHASE_SUPPLIER_PORTAL_UNAVAILABLE/);
  assert.match(dispatchOutbox, /if \(!recipientEmails\.length\)[\s\S]*missingRecipient \+= 1/);
  assert.match(dispatchOutbox, /dispatchEmailStatus: "NO_RECIPIENT"/);
  assert.doesNotMatch(dispatchOutbox, /recipientEmails:\s*body\./);
  assert.match(dispatchService, /processFactoryPurchaseOrderDispatchOutbox/);
  assert.match(dispatchNotifications, /updateMany\(\{[\s\S]*status: "sending"[\s\S]*attempts: \{ increment: 1 \}/);
  assert.match(dispatchNotifications, /updatedAt: \{ lte: staleBefore \}/);
  assert.match(dispatchNotifications, /reconcilePurchaseOrderEmailStatuses/);
  assert.match(dispatchNotifications, /dispatchEmailStatus: "SENDING"/);
  assert.match(dispatchNotifications, /claimedOutboxAttempt: row\.attempts/);
  assert.match(notificationSend, /existing\.attempts === claimedOutboxAttempt/);
  assert.match(notificationSend, /status: "sending", attempts: claimedOutboxAttempt/);
  assert.ok(
    factoryNotificationDefinition.indexOf('"{actionUrl}"')
      < factoryNotificationDefinition.indexOf('"{itemLines}"'),
  );
  assert.match(dispatchService, /limit: 4/);
  assert.match(mutationService, /retireVoidedSalesExecutionNotifications/);
  assert.match(voidNotificationService, /FACTORY_PURCHASE_ORDER_EMAIL_SENDING/);
  assert.match(voidNotificationService, /status: \{ in: \["queued", "failed", "pending", "sending"\] \}/);
  assert.match(notificationCronRoute, /processFactoryPurchaseOrderDispatchOutbox/);
  assert.doesNotMatch(dispatchService, /ReceivableOrder|OrderCost|qualityInspection/);
});

test("dispatch requires active product suppliers without requiring portal capability or recipients", () => {
  assert.equal(canOperateFactoryPurchaseOrderPortal({ role: "产品供应商" }), true);
  assert.equal(canOperateFactoryPurchaseOrderPortal({
    role: "产品供应商",
    customPermissions: {
      mode: "CUSTOM",
      menus: ["supplierPurchaseOrders"],
      reads: ["supplierPurchaseOrders"],
      writes: [],
      dataScope: "OWN",
    },
  }), false);
  assert.equal(canOperateFactoryPurchaseOrderPortal({
    role: "产品供应商",
    customPermissions: {
      mode: "CUSTOM",
      menus: ["supplierPurchaseOrders"],
      reads: ["supplierPurchaseOrders"],
      writes: ["supplierPurchaseOrders"],
      dataScope: "OWN",
    },
  }), true);
  const supplierGuard = dispatchService.match(
    /async function assertActivePurchaseOrderSuppliers[\s\S]*?(?=\nexport async function dispatchSalesExecution)/,
  )?.[0] || "";
  assert.match(supplierGuard, /tx\.supplier\.count/);
  assert.match(supplierGuard, /id: \{ in: supplierIds \}/);
  assert.match(supplierGuard, /deletedAt: null/);
  assert.match(supplierGuard, /status: "启用"/);
  assert.match(supplierGuard, /supplierType: \{ in: \[\.\.\.PRODUCT_SUPPLIER_TYPES\] \}/);
  assert.match(supplierGuard, /activeSuppliers !== supplierIds\.length/);
  assert.match(supplierGuard, /"PURCHASE_SUPPLIER_INVALID"/);
  assert.doesNotMatch(
    supplierGuard,
    /allowFactoryDocumentUpload|recipientEmails|resolveFactoryPurchaseOrderDispatchRecipients|canOperateFactoryPurchaseOrderPortal/,
  );
  assert.match(
    dispatchService,
    /validateDispatchReadiness\(before\);\s+await assertActivePurchaseOrderSuppliers\(tx, before\);[\s\S]*?const dispatchedAt/,
  );
  assert.doesNotMatch(
    dispatchService,
    /canOperateFactoryPurchaseOrderPortal|resolveFactoryPurchaseOrderDispatchRecipients/,
  );
  assert.match(dispatchService, /queueFactoryPurchaseOrderDispatchOutbox/);
});

test("terminal factory-email failures have an audited recipient-snapshot retry path", () => {
  assert.match(dispatchRetry, /assertWrite\(actor, "salesExecution"\)/);
  assert.match(dispatchRetry, /lockSalesExecution\(tx, executionId\)[\s\S]*lockFactoryPurchaseOrders\(tx, executionId\)/);
  assert.match(dispatchRetry, /assertExpectedSalesExecutionRevision\(body, execution\.revision\)/);
  assert.match(dispatchRetry, /expectedDispatchVersion !== version/);
  assert.match(dispatchRetry, /status: "sending"[\s\S]*updatedAt: \{ gt: new Date\(Date\.now\(\) - LEASE_MS\) \}/);
  assert.match(dispatchRetry, /idempotencyKey: \{ startsWith: prefix, [\s\S]*notIn: currentKeys/);
  assert.match(dispatchRetry, /idempotencyKey: \{ in: currentKeys \}[\s\S]*status: \{ not: "sent" \}[\s\S]*attempts: 0/);
  assert.match(dispatchRetry, /dispatchRecipientEmails: recipients/);
  assert.match(dispatchRetry, /FACTORY_PURCHASE_ORDER_EMAIL_RECIPIENTS_UNAVAILABLE/);
  assert.match(dispatchRetry, /purchaseOrderIds: \[order\.id\]/);
  assert.match(dispatchRetry, /人工重试工厂采购单邮件/);
  assert.match(dispatchNotifications, /idempotencyKey: \{ in: currentKeys \}/);
  assert.match(dispatchNotifications, /OR: remainingStatusWhere\(\)/);
  assert.match(dispatchNotifications, /attempts: \{ lt: MAX_ATTEMPTS \}/);
  assert.match(dispatchNotifications, /邮件发送租约超时，已停止自动重试/);
  assert.match(dispatchNotifications, /terminalizedFinalAttempt/);
  assert.doesNotMatch(
    dispatchNotifications,
    /finalAttemptStaleSendingWhere\(staleBefore\)[\s\S]{0,500}data: \{ status: "sending"/,
  );
  assert.match(dispatchRetryRoute, /retryFactoryPurchaseOrderDispatchEmail/);
  assert.match(dispatchRetryRoute, /parseJsonBody\(request\)/);
});

test("database constraints prevent cross-execution purchase rows and mismatched quote sources", () => {
  assert.match(schema, /model FactoryPurchaseOrderItem[\s\S]*executionId\s+String/);
  assert.match(schema, /fields: \[purchaseOrderId, executionId\][\s\S]*references: \[id, executionId\]/);
  assert.match(schema, /fields: \[executionItemId, executionId\][\s\S]*references: \[id, executionId\]/);
  assert.match(schema, /@@unique\(\[purchaseOrderId, lineNumber\]\)/);
  assert.match(schema, /sourceQuotationVersionId\s+String\?/);
  assert.match(schema, /fields: \[sourceQuotationItemId, sourceQuotationVersionId\]/);
  assert.match(schema, /@@unique\(\[executionId, sourceQuotationItemId\]\)/);
  assert.match(migration, /sales_execution_items_source_guard/);
  assert.match(migration, /direct sales execution items cannot reference quotation snapshots/);
  assert.match(migration, /must match the execution source version/);
  assert.match(migration, /sales_executions_source_immutable/);
  assert.match(migration, /sales execution source is immutable/);
  assert.match(migration, /sales_executions_void_state_check/);
  assert.match(migration, /factory_purchase_orders_void_state_check/);
  assert.match(migration, /sales_executions_voided_by_fkey[\s\S]*ON DELETE RESTRICT/);
  assert.match(migration, /factory_purchase_orders_voided_by_fkey[\s\S]*ON DELETE RESTRICT/);
});

test("database requires customer order credentials before sales execution can continue", () => {
  const executionModel = schema.match(/model SalesExecution\b[\s\S]*?\n\}/)?.[0] || "";
  const purchaseOrderModel = schema.match(/model FactoryPurchaseOrder\b[\s\S]*?\n\}/)?.[0] || "";
  assert.match(executionModel, /customerOrderNo\s+String\s+@map\("customer_order_no"\)/);
  assert.match(executionModel, /requestedDeliveryDate\s+DateTime\s+@map\("requested_delivery_date"\) @db\.Date/);
  assert.match(executionModel, /@@index\(\[customerId, customerOrderNo\]\)/);
  assert.match(purchaseOrderModel, /requestedDeliveryDate\s+DateTime\s+@map\("requested_delivery_date"\) @db\.Date/);
  assert.match(requiredFieldsMigration, /historical rows must be completed first/);
  assert.match(requiredFieldsMigration, /ALTER COLUMN "customer_order_no" SET NOT NULL/);
  assert.match(requiredFieldsMigration, /ALTER COLUMN "requested_delivery_date" SET NOT NULL/);
  assert.match(requiredFieldsMigration, /sales_executions_customer_order_no_not_blank_check/);
  assert.match(requiredFieldsMigration, /CHECK \(btrim\("customer_order_no"\) <> ''\)/);
  assert.match(requiredFieldsMigration, /sales_executions_customer_id_customer_order_no_idx/);
});

test("sales execution weights and unknown purchase prices stay nullable end to end", () => {
  const executionItemModel = schema.match(/model SalesExecutionItem\b[\s\S]*?\n\}/)?.[0] || "";
  const purchaseOrderModel = schema.match(/model FactoryPurchaseOrder\b[\s\S]*?\n\}/)?.[0] || "";
  const purchaseItemModel = schema.match(/model FactoryPurchaseOrderItem\b[\s\S]*?\n\}/)?.[0] || "";
  assert.match(executionItemModel, /unitNetWeightKg\s+Decimal\?\s+@map\("unit_net_weight_kg"\) @db\.Decimal\(18, 6\)/);
  assert.match(purchaseOrderModel, /subtotal\s+Decimal\?\s+@db\.Decimal\(18, 2\)/);
  assert.match(purchaseItemModel, /purchaseUnitPrice\s+Decimal\?/);
  assert.match(purchaseItemModel, /amount\s+Decimal\?/);
  assert.match(weightsAndNullablePricesMigration, /ADD COLUMN "unit_net_weight_kg" DECIMAL\(18,6\)/);
  assert.match(weightsAndNullablePricesMigration, /unit_net_weight_kg" IS NULL OR "unit_net_weight_kg" > 0/);
  assert.match(weightsAndNullablePricesMigration, /ALTER COLUMN "purchase_unit_price" DROP NOT NULL/);
  assert.match(weightsAndNullablePricesMigration, /ALTER COLUMN "amount" DROP NOT NULL/);
  assert.match(weightsAndNullablePricesMigration, /ALTER COLUMN "subtotal" DROP NOT NULL/);
  assert.match(weightsAndNullablePricesMigration, /purchase_unit_price" IS NULL AND "amount" IS NULL/);

  assert.equal(nullableSalesExecutionDecimal(null, "采购单价", { scale: 6, integerDigits: 12 }), null);
  assert.equal(nullableSalesExecutionDecimal("  ", "采购单价", { scale: 6, integerDigits: 12 }), null);
  assert.throws(
    () => nullableSalesExecutionDecimal("-0.01", "采购单价", { scale: 6, integerDigits: 12 }),
    (error: unknown) => String((error as { code?: string }).code || "") === "QUOTATION_DECIMAL_RANGE",
  );
  for (const invalidWeight of ["-0.01", "0"]) {
    assert.throws(
      () => nullableSalesExecutionDecimal(
        invalidWeight,
        "单件/单套净重",
        { positive: true, scale: 6, integerDigits: 12 },
      ),
      (error: unknown) => String((error as { code?: string }).code || "") === "QUOTATION_DECIMAL_RANGE",
    );
  }
  const pricedAmount = nullableSalesExecutionDecimal("12.34", "采购金额", { scale: 2, integerDigits: 16 });
  assert.equal(nullableDecimalSubtotal([pricedAmount])?.toString(), "12.34");
  assert.equal(nullableDecimalSubtotal([pricedAmount, null]), null);

  const serialized = serializeSalesExecution({
    id: "execution-1",
    items: [{ id: "item-1", unitNetWeightKg: null }],
    purchaseOrders: [{
      id: "po-1",
      subtotal: null,
      items: [{ id: "po-item-1", purchaseUnitPrice: null, amount: null }],
    }],
  }, true);
  assert.equal(serialized.items?.[0]?.unitNetWeightKg, null);
  assert.equal(serialized.purchaseOrders?.[0]?.subtotal, null);
  assert.equal(serialized.purchaseOrders?.[0]?.items[0]?.purchaseUnitPrice, null);
  assert.equal(serialized.purchaseOrders?.[0]?.items[0]?.amount, null);
});

test("direct creation requires explicit entity and persists deduplicated customer products atomically", () => {
  assert.match(directCreate, /resolveQuotationBusinessEntity\(tx, body\.businessEntityId\)/);
  assert.match(directCreate, /buildDirectSalesExecutionItems\([\s\S]*tx/);
  const itemBuilder = readFileSync("lib/platform/sales-execution-direct-items.ts", "utf8");
  assert.match(itemBuilder, /productIdentityKey/);
  assert.match(itemBuilder, /productFingerprint/);
  assert.match(itemBuilder, /customerProduct\.upsert/);
  assert.match(itemBuilder, /销售执行单自动收录客户产品/);
  assert.match(directCreate, /creationKey/);
  assert.match(directCreate, /executionText\(value, "创建请求标识", 200, true\)/);
  assert.match(directCreate, /creationKey: idempotencyKey, \.\.\.salesExecutionAccessWhere\(actor\)/);
  assert.match(directCreate, /replaceFactoryPurchaseOrderRows/);
  assert.match(directCreate, /allocationsForExecutionLines/);
  assert.match(directCreate, /TransactionIsolationLevel\.Serializable/);
  assert.match(itemBuilder, /unitNetWeightKg/);
  assert.match(itemBuilder, /nullableSalesExecutionDecimal/);
  assert.match(itemBuilder, /positive: true, scale: 6, integerDigits: 12/);
});

test("direct execution validation uses the single product description field name", () => {
  assert.match(directItemsService, /第 \$\{index \+ 1\} 行产品描述/);
  assert.doesNotMatch(directItemsService, /第 \$\{index \+ 1\} 行品名|第 \$\{index \+ 1\} 行规格/);
});

test("direct, quotation and PATCH paths all require order number and customer delivery date", () => {
  assert.match(valuesService, /export function requiredCustomerOrderNo/);
  assert.match(valuesService, /export function requiredRequestedDeliveryDate/);
  assert.match(valuesService, /SALES_EXECUTION_CUSTOMER_ORDER_NO_REQUIRED/);
  assert.match(valuesService, /SALES_EXECUTION_REQUESTED_DELIVERY_DATE_REQUIRED/);
  assert.match(valuesService, /SALES_EXECUTION_REQUESTED_DELIVERY_DATE_INVALID/);
  assert.match(directCreate, /requiredCustomerOrderNo\(body\.customerOrderNo\)/);
  assert.match(directCreate, /requiredRequestedDeliveryDate\(body\.requestedDeliveryDate\)/);
  assert.match(directCreate, /customerOrderNo:\s*requiredCustomerOrderNo\(body\.customerOrderNo\)/);
  assert.match(directCreate, /requestedDeliveryDate:\s*requiredRequestedDeliveryDate\(body\.requestedDeliveryDate\)/);
  assert.match(quoteCreate, /requiredCustomerOrderNo\(body\.customerOrderNo\)/);
  assert.match(quoteCreate, /requiredRequestedDeliveryDate\(body\.requestedDeliveryDate\)/);
  assert.match(quoteCreate, /customerOrderNo:\s*requiredCustomerOrderNo\(body\.customerOrderNo\)/);
  assert.match(quoteCreate, /requestedDeliveryDate:\s*requiredRequestedDeliveryDate\(body\.requestedDeliveryDate\)/);
  assert.match(mutationService, /requiredCustomerOrderNo\([\s\S]*?body\.customerOrderNo[\s\S]*?before\.customerOrderNo/);
  assert.match(mutationService, /requiredRequestedDeliveryDate\([\s\S]*?body\.requestedDeliveryDate[\s\S]*?before\.requestedDeliveryDate/);
  assert.doesNotMatch(directCreate, /customerOrderNo:[^\n]*\|\| null/);
  assert.doesNotMatch(mutationService, /customerOrderNo:[^\n]*\|\| null/);
});

test("idempotent creation rejects a different customer order credential", () => {
  const requested = {
    customerOrderNo: "PO-20260809-A",
    requestedDeliveryDate: new Date("2026-09-15T00:00:00.000Z"),
  };
  assert.doesNotThrow(() => assertSalesExecutionCreationCredentials({
    customerOrderNo: " PO-20260809-A ",
    requestedDeliveryDate: "2026-09-15",
  }, requested));
  assert.throws(
    () => assertSalesExecutionCreationCredentials({
      customerOrderNo: "PO-20260809-B",
      requestedDeliveryDate: "2026-09-16",
    }, requested),
    (error: unknown) => {
      const conflict = error as { status?: number; code?: string; message?: string };
      assert.equal(conflict.status, 409);
      assert.equal(conflict.code, "SALES_EXECUTION_CREATION_CREDENTIAL_CONFLICT");
      assert.match(String(conflict.message), /客户订单号.*客户要求交货日期/);
      return true;
    },
  );
  assert.match(directCreate, /assertSalesExecutionCreationCredentials\(existingRequest, creationCredentials\)/);
  assert.match(directCreate, /assertSalesExecutionCreationCredentials\(existing, creationCredentials\)/);
  assert.match(quoteCreate, /assertSalesExecutionCreationCredentials\(existing, creationCredentials\)/);
});

test("quotation conversion is current-version accepted-only and idempotent", () => {
  assert.match(quoteCreate, /assertRead\(actor, "quotations"\)[\s\S]*assertWrite\(actor, "salesExecution"\)/);
  assert.match(quoteCreate, /FOR UPDATE/);
  assert.match(quoteCreate, /assertExpectedQuotationVersion/);
  assert.match(quoteCreate, /quotation\.status !== "ACCEPTED"/);
  assert.match(quoteCreate, /!current\.sealedAt/);
  assert.match(quoteCreate, /salesQuotationDecision\.findUnique/);
  assert.match(quoteCreate, /quotationVersionId: current\.id/);
  assert.match(quoteCreate, /acceptedDecision\.decision !== "ACCEPTED"/);
  assert.match(quoteCreate, /acceptedDecision\.channel === "SYSTEM_EMAIL"/);
  assert.match(quoteCreate, /QUOTATION_MANUAL_ACCEPTANCE_REQUIRED/);
  assert.doesNotMatch(quoteCreate, /responseStatus: "ACCEPTED"/);
  assert.match(quoteCreate, /sourceQuotationId: quotation\.id/);
  assert.match(quoteCreate, /sourceQuotationVersionId: current\.id/);
  assert.match(quoteCreate, /unitNetWeightKg: null/);
  assert.match(quoteCreate, /sourceQuotationItemId: item\.id/);
  assert.match(quoteCreate, /sourceQuotationVersionId: current\.id/);
  assert.match(schema, /sourceQuotationId\s+String\?\s+@unique/);
  assert.match(quoteCreate, /sourceQuotationId: quotation\.id, \.\.\.salesExecutionAccessWhere\(actor\)/);
});

test("quotation executions accept only a complete item-weight patch while sales fields stay locked", () => {
  assert.match(mutationService, /prepareSalesExecutionItemWeightUpdates/);
  assert.match(mutationService, /applySalesExecutionItemWeightUpdates/);
  assert.match(itemWeightsService, /"itemWeights"/);
  assert.match(itemWeightsService, /quotationItemWeightRows\(body\.itemWeights, items\)/);
  assert.match(itemWeightsService, /new Set\(\["executionItemId", "unitNetWeightKg"\]\)/);
  assert.match(itemWeightsService, /value\.length !== items\.length/);
  assert.match(itemWeightsService, /data: \{ unitNetWeightKg: item\.unitNetWeightKg \}/);
  assert.match(itemWeightsService, /positive: true, scale: 6, integerDigits: 12/);
  assert.match(itemWeightsService, /QUOTATION_EXECUTION_SALES_FIELDS_LOCKED/);
  assert.doesNotMatch(
    itemWeightsService.match(/const allowed = new Set\(\[[\s\S]*?\]\);/)?.[0] || "",
    /"items"/,
  );
});

test("purchase drafts require exact full allocation and active product suppliers", () => {
  assert.match(purchaseService, /allocated\.eq\(item\.quantity\)/);
  assert.match(purchaseService, /PURCHASE_ALLOCATION_NOT_EXACT/);
  assert.match(purchaseService, /supplierType: \{ in: \[\.\.\.PRODUCT_SUPPLIER_TYPES\] \}/);
  assert.match(purchaseService, /status: "启用"/);
  assert.match(purchaseService, /groupAllocations\(allocations\)/);
  assert.match(purchaseService, /purchaseUnitPrice/);
  assert.match(purchaseService, /purchaseUnitPrice === null[\s\S]*?\? null/);
  assert.match(purchaseService, /purchaseOrderSubtotal\(group\.rows\)/);
  assert.match(purchaseService, /executionId: execution\.id/);
  assert.match(purchaseService, /supplier\.purchasePaymentTerm \|\| null/);
  assert.doesNotMatch(purchaseService, /ReceivableOrder|receivableOrder|OrderCost|orderCost|sendEmail|qualityInspection/);
});

test("supplier confirmations preserve dispatch snapshots and append delivery and price history", () => {
  assert.match(schema, /purchasePaymentTerm\s+String\?\s+@map\("purchase_payment_term"\)/);
  assert.match(schema, /model FactoryPurchaseOrderSupplierResponse\b/);
  assert.match(schema, /model FactoryPurchaseOrderSupplierPrice\b/);
  assert.match(schema, /supplierResponseSequence\s+Int\s+@default\(0\)/);
  assert.match(schema, /supplierPrice\s+FactoryPurchaseOrderSupplierPrice\?/);
  assert.match(supplierConfirmationMigration, /supplier response history is immutable/);
  assert.match(supplierConfirmationMigration, /confirmed supplier price is immutable/);
  assert.match(supplierConfirmationMigration, /supplier price cannot replace the dispatched purchase unit price/);
  assert.match(supplierConfirmationMigration, /supplier price amount must equal quantity multiplied by unit price/);
  assert.match(supplierConfirmationMigration, /NEW\."supplier_response_sequence" <> OLD\."supplier_response_sequence" \+ 1/);
  assert.match(supplierConfirmationMigration, /later supplier delivery date must change/);
});

test("factory drafts inherit the customer requested date without rewriting the customer credential", () => {
  assert.match(purchaseService, /requestedDeliveryDate:\s*requestedDates\[0\] \|\| execution\.requestedDeliveryDate/);
  assert.doesNotMatch(
    purchaseService,
    /tx\.salesExecution\.(?:update|updateMany)\([\s\S]*?requestedDeliveryDate/,
  );
});

test("purchase order serialization never embeds customer or sales prices", () => {
  const purchaseSerializer = serializationService.match(
    /function serializePurchaseOrderItem[\s\S]*?(?=\nexport function serializeSalesExecution)/,
  )?.[0] || "";
  assert.match(purchaseSerializer, /productDescription:\s*productVisibleDescription/);
  assert.match(purchaseSerializer, /productNameSnapshot/);
  assert.match(purchaseSerializer, /specificationSnapshot/);
  assert.match(purchaseSerializer, /unitSnapshot/);
  assert.match(purchaseSerializer, /purchaseUnitPrice/);
  assert.doesNotMatch(purchaseSerializer, /customerName|salesUnitPrice|salesAmount/);
});

test("draft mutations use revision locks, append versions, audit, and soft void", () => {
  assert.match(mutationService, /assertExpectedSalesExecutionRevision/);
  assert.match(mutationService, /revision: nextRevision/);
  assert.match(mutationService, /appendSalesExecutionVersion/);
  assert.match(mutationService, /writeAudit/);
  assert.match(mutationService, /status: "VOIDED"/);
  assert.doesNotMatch(mutationService, /salesExecution\.delete/);
  assert.match(purchaseService, /assertExpectedSalesExecutionRevision/);
  assert.match(purchaseService, /appendSalesExecutionVersion/);
  assert.match(mutationService, /replaceFactoryPurchaseOrderRows/);
  assert.match(mutationService, /allocationsForExecutionLines/);
  assert.match(mutationService, /修改销售明细时必须同时提交完整工厂分配/);
});

test("dispatched direct-order quantity correction is an audited narrow channel", () => {
  assert.match(quantityCorrectionService, /assertWrite\(actor, "salesExecution"\)/);
  assert.match(quantityCorrectionService, /assertWrite\(actor, "orders"\)/);
  assert.match(quantityCorrectionService, /lockSalesExecution\(tx, executionId\)/);
  assert.match(quantityCorrectionService, /lockFactoryPurchaseOrders\(tx, executionId\)/);
  assert.match(quantityCorrectionService, /assertExpectedSalesExecutionRevision/);
  assert.match(quantityCorrectionService, /execution\.sourceType !== "DIRECT"/);
  assert.match(quantityCorrectionService, /item\.actualDeliveredQuantity !== null \|\| order\.actualDeliveryDate/);
  assert.match(quantityCorrectionService, /resetShippingStartedAt: Boolean\(execution\.shippingStartedAt\)/);
  assert.match(quantityCorrectionService, /shippingStartedAt: null/);
  assert.match(quantityCorrectionService, /shippingStartedMarkerReset/);
  assert.match(quantityCorrectionService, /classifiedQuantityCorrectionDatabaseError/);
  assert.match(quantityCorrectionService, /SALES_QUANTITY_CORRECTION_SHIPPING_ANCHOR_GUARD/);
  assert.match(quantityCorrectionService, /confirmed supplier price is immutable/);
  assert.match(quantityCorrectionService, /order\.settlement/);
  assert.match(quantityCorrectionReceivableService, /BLOCKING_PAYMENT_STATUSES = \["待确认", "已到账"\]/);
  assert.match(quantityCorrectionReceivableService, /assertBusinessOrderWritableInTransaction/);
  assert.match(quantityCorrectionReceivableService, /String\(status \|\| ""\)\.trim\(\) === "草稿"/);
  assert.match(quantityCorrectionReceivableService, /actualShipmentDate: null/);
  assert.match(quantityCorrectionReceivableService, /actualShipmentAmount: null/);
  assert.match(quantityCorrectionReceivableService, /actualShipmentAmountCny: null/);
  assert.match(quantityCorrectionReceivableService, /数量更正时撤销草稿应收订单发货登记/);
  assert.match(quantityCorrectionReceivableService, /国内物流起运记录/);
  assert.match(quantityCorrectionReceivableService, /customsDeclarationNo: true/);
  assert.match(quantityCorrectionReceivableService, /数量更正时同步应收订单金额/);
  assert.match(quantityCorrectionService, /app\.sales_quantity_correction/);
  assert.match(quantityCorrectionService, /salesExecutionItem\.updateMany/);
  assert.match(quantityCorrectionService, /factoryPurchaseOrderItem\.updateMany/);
  assert.match(quantityCorrectionService, /factoryPurchaseOrderSupplierPrice\.updateMany/);
  assert.match(quantityCorrectionReceivableService, /receivableOrder\.update/);
  assert.match(quantityCorrectionService, /factoryPurchaseOrderProductionReport\.create/);
  assert.match(quantityCorrectionService, /appendSalesExecutionVersion/);
  assert.match(quantityCorrectionService, /更正已下发订单数量/);
  assert.match(quantityCorrectionRoute, /requireApiWrite\(request, "salesExecution"\)/);
  assert.match(quantityCorrectionRoute, /correctSalesExecutionQuantity/);
});

test("draft receivables can reset stale shipment registration during quantity correction", () => {
  assert.deepEqual(shipmentRegistrationDecision("草稿", new Date("2026-08-21"), null, null), {
    registered: true,
    resetAllowed: true,
  });
  assert.deepEqual(shipmentRegistrationDecision("草稿", null, null, "100.00"), {
    registered: true,
    resetAllowed: true,
  });
  assert.deepEqual(shipmentRegistrationDecision("已发货", null, "100.00", null), {
    registered: true,
    resetAllowed: false,
  });
  assert.deepEqual(shipmentRegistrationDecision("草稿", null, null, null), {
    registered: false,
    resetAllowed: false,
  });
});

test("independent shipping evidence keeps draft receivables locked", () => {
  assert.deepEqual(independentShipmentEvidence({ blNo: "BL-1" }), ["提单信息"]);
  assert.deepEqual(independentShipmentEvidence({ customsDeclarationDate: new Date("2026-08-21") }), ["报关信息"]);
  assert.deepEqual(independentShipmentEvidence({
    domesticLogisticsInfos: [{
      transportType: "TRUCK",
      transportItems: [{ departureDate: "2026-08-21" }],
    }],
  }), ["国内物流起运记录"]);
  assert.deepEqual(independentShipmentEvidence({
    domesticLogisticsInfos: [{
      transportType: "OCEAN",
      transportItems: [{ departureDate: "2026-08-21" }],
    }],
  }), []);
  assert.deepEqual(independentShipmentEvidence({
    domesticLogisticsInfos: [{
      transportType: "EXPRESS",
      expressTrackingNo: "SF123456",
    }],
  }), ["快递单号"]);
});

test("database immutability allows only the explicit quantity-correction session", () => {
  assert.match(quantityCorrectionMigration, /current_setting\('app\.sales_quantity_correction', true\) = 'on'/);
  assert.match(quantityCorrectionMigration, /TO_JSONB\(NEW\) - 'quantity' - 'sales_amount'/);
  assert.match(quantityCorrectionMigration, /TO_JSONB\(NEW\) - 'allocated_quantity' - 'amount'/);
  assert.match(quantityCorrectionMigration, /quantity_correction IS NOT TRUE[\s\S]*NEW\."subtotal" IS DISTINCT FROM OLD\."subtotal"/);
  assert.match(quantityCorrectionMigration, /NEW\."penalty_base_amount" IS DISTINCT FROM OLD\."penalty_base_amount"[\s\S]*quantity_correction IS NOT TRUE/);
  assert.match(quantityCorrectionMigration, /NEW\."source" = 'INTERNAL_OFFLINE'[\s\S]*purchase_order_production_status = 'COMPLETED'/);
  assert.match(quantityCorrectionShippingResetMigration, /CREATE OR REPLACE FUNCTION "protect_sales_execution_shipping_anchor"/);
  assert.match(quantityCorrectionShippingResetMigration, /current_setting\('app\.sales_quantity_correction', true\) = 'on'/);
  assert.match(quantityCorrectionShippingResetMigration, /quantity_correction IS TRUE[\s\S]*NEW\."shipping_started_at" IS NULL[\s\S]*NEW\."shipping_started_by" IS NULL/);
  assert.match(quantityCorrectionShippingResetMigration, /RAISE EXCEPTION 'sales execution shipping handoff is immutable'/);
  assert.match(quantityCorrectionShippingResetMigration, /unreleased_active_container_count/);
  assert.match(quantityCorrectionShippingResetMigration, /purchase_order\."status" NOT IN \('REJECTED', 'VOIDED'\)/);
  assert.match(quantityCorrectionSupplierPriceMigration, /CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_supplier_price"/);
  assert.match(quantityCorrectionSupplierPriceMigration, /current_setting\('app\.sales_quantity_correction', true\) = 'on'/);
  assert.match(quantityCorrectionSupplierPriceMigration, /TO_JSONB\(NEW\) - 'amount'/);
  assert.match(quantityCorrectionSupplierPriceMigration, /NEW\."amount" <> ROUND\(allocated_quantity \* NEW\."unit_price", 2\)/);
  assert.match(quantityCorrectionSupplierPriceMigration, /RAISE EXCEPTION 'confirmed supplier price is immutable'/);
  assert.doesNotMatch(quantityCorrectionMigration, /DROP TRIGGER|DISABLE TRIGGER/);
  assert.doesNotMatch(quantityCorrectionShippingResetMigration, /DROP TRIGGER|DISABLE TRIGGER/);
  assert.doesNotMatch(quantityCorrectionSupplierPriceMigration, /DROP TRIGGER|DISABLE TRIGGER/);
});

test("customer product history considers latest same-currency sales execution price", () => {
  assert.match(customerProducts, /salesExecutionItems/);
  assert.match(customerProducts, /canRead\(actor, "salesExecution"\)/);
  assert.match(customerProducts, /execution: \{ status: \{ in: \["DRAFT", "DISPATCHED"\] \} \}/);
  assert.match(customerProducts, /currencySnapshot: currency/);
  assert.match(customerProductValues, /latestExecutionItem/);
  assert.match(customerProductValues, /salesUnitPrice \?\? latestPriceItem\.unitPrice/);
});

test("API routes expose paginated and detail compatibility fields", () => {
  assert.match(listRoute, /data, executions: data\.rows/);
  assert.match(listRoute, /status: 201/);
  assert.match(detailRoute, /data: execution,[\s\S]*execution/);
  assert.match(purchaseRoute, /replaceFactoryPurchaseOrderDrafts/);
  assert.match(purchaseRoute, /data: execution/);
  assert.match(dispatchRoute, /dispatchSalesExecution/);
  assert.match(dispatchRoute, /notificationSummary/);
  assert.match(queryService, /assertRead\(actor, "salesExecution"\)/);
  assert.match(serializationService, /purchaseOrders/);
});

test("access and numbering helpers are deterministic", () => {
  assert.match(accessService, /dataScope === "ALL"/);
  assert.match(accessService, /dataScope === "OWN"[\s\S]*salespersonUserId: actorId/);
  assert.match(accessService, /expected !== currentRevision/);
  assert.match(accessService, /SALES_EXECUTION_REVISION_CONFLICT/);
  assert.equal(factoryPurchaseOrderNumber("SE-20260809-A", 1), "PO-20260809-A-01");
  assert.equal(factoryPurchaseOrderNumber("SE-20260809-AA", 12), "PO-20260809-AA-12");
});
