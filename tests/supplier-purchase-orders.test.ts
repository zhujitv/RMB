import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import type { SupplierPurchaseOrderPublicRow } from "../lib/platform/supplier-purchase-orders-values.ts";

const jiti = createJiti(import.meta.url);
const { createWorkspaceTabFocus, hasWorkspaceTabFocus } = await jiti.import<typeof import("../app/workspace/workspace-tabs.ts")>("../app/workspace/workspace-tabs.ts");
const {
  normalizeSupplierPurchaseOrderPrices,
  normalizeSupplierPurchaseOrderResponse,
  serializeSupplierPurchaseOrder,
} = await jiti.import<typeof import("../lib/platform/supplier-purchase-orders-values.ts")>("../lib/platform/supplier-purchase-orders-values.ts");
const { formatPrice } = await jiti.import<typeof import("../app/modules/supplier-purchase-orders/presentation.ts")>("../app/modules/supplier-purchase-orders/presentation.ts");

function purchaseOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-id-1",
    revision: 4,
    poNo: "PO-2026-00001",
    execution: { customerOrderNo: "CUSTOMER-ORDER-001", shippingStartedAt: null },
    dispatchedAt: new Date("2026-08-09T08:00:00.000Z"),
    purchaseCurrency: "CNY",
    requestedDeliveryDate: new Date("2026-09-01T00:00:00.000Z"),
    paymentTerm: "月结 30 天",
    remark: "请按外箱要求包装",
    status: "DISPATCHED",
    supplierDeliveryDate: null,
    supplierResponseRemark: null,
    supplierResponseSequence: 0,
    respondedAt: null,
    supplierResponses: [],
    customer: { name: "绝不能返回的客户" },
    customerOrderNo: "CUSTOMER-SECRET",
    supplierId: "supplier-secret",
    businessEntityId: "entity-secret",
    salespersonUserId: "user-secret",
    subtotal: 999,
    items: [{
      id: "purchase-order-item-1",
      productNameSnapshot: "复合板",
      specificationSnapshot: "2000×1000×20mm",
      unitSnapshot: "张",
      allocatedQuantity: { toString: () => "120.5000" },
      remark: "蓝色标签",
      executionId: "execution-secret",
      executionItemId: "execution-item-secret",
      purchaseUnitPrice: 88,
      amount: 10_604,
      supplierPrice: null,
      salesUnitPrice: 120,
      salesAmount: 14_460,
    }],
    ...overrides,
  } as unknown as SupplierPurchaseOrderPublicRow;
}

test("supplier purchase order DTO is rebuilt from an explicit non-sales whitelist", () => {
  const dto = serializeSupplierPurchaseOrder(purchaseOrderRow());
  assert.deepEqual(Object.keys(dto).sort(), [
    "dispatchedAt",
    "customerOrderNo",
    "delayGraceDays",
    "delayPenaltyCapRatio",
    "delayPenaltyRatePerDay",
    "deliveryFrozen",
    "deliveryQuantityToleranceRatio",
    "deliveryQuantityVariances",
    "actualDeliveryDate",
    "actualDeliveryRecordedAt",
    "confirmedSupplierDeliveryDate",
    "containerLoads",
    "id",
    "initialSupplierDeliveryDate",
    "items",
    "loadingResults",
    "paidPrepaymentAmount",
    "paymentTerm",
    "penaltyBaseAmount",
    "poNo",
    "prepaymentRatio",
    "prepaymentRequiredAmount",
    "prepaymentRequiredBeforeProduction",
    "productionCompletedAt",
    "productionCompletionChannel",
    "productionCompletionContact",
    "productionCompletionRecordedAt",
    "productionCompletionRemark",
    "productionCompletionSource",
    "productionProgress",
    "productionStartedAt",
    "productionStatus",
    "purchaseCurrency",
    "purchaseRemark",
    "requestedDeliveryDate",
    "respondedAt",
    "revision",
    "status",
    "supplierDeliveryDate",
    "supplierResponseRemark",
    "supplierResponseSequence",
    "responseHistory",
  ].sort());
  assert.deepEqual(Object.keys(dto.items[0] || {}).sort(), [
    "productDescription",
    "id",
    "unitPrice",
    "amount",
    "actualDeliveredQuantity",
    "priceRequired",
    "supplierFilledPrice",
    "quantity",
    "remark",
    "unit",
  ].sort());
  assert.equal(dto.items[0]?.productDescription, "复合板 (2000×1000×20mm)");
  assert.equal(dto.items[0]?.quantity, "120.5000");
  assert.equal(dto.customerOrderNo, "CUSTOMER-ORDER-001");
  assert.equal(dto.items[0]?.unitPrice, "88");
  assert.equal(dto.items[0]?.priceRequired, false);
  assert.equal(dto.deliveryFrozen, false);
  const serialized = JSON.stringify(dto);
  for (const forbidden of [
    "customer",
    "supplierId",
    "businessEntityId",
    "salespersonUserId",
    "salesUnitPrice",
    "salesAmount",
    "executionId",
    "executionItemId",
    "subtotal",
    "productName",
    "specification",
  ]) assert.equal(serialized.includes(`"${forbidden}":`), false, forbidden);
});

test("supplier purchase order DTO exposes only effective factory-facing price data", () => {
  const missing = serializeSupplierPurchaseOrder(purchaseOrderRow({
    items: [{
      id: "purchase-order-item-1",
      productNameSnapshot: "复合板",
      specificationSnapshot: null,
      unitSnapshot: "张",
      allocatedQuantity: { toString: () => "2" },
      purchaseUnitPrice: null,
      amount: null,
      supplierPrice: null,
      remark: null,
    }],
  }));
  assert.equal(missing.items[0]?.priceRequired, true);
  assert.equal(missing.items[0]?.unitPrice, null);

  const confirmed = serializeSupplierPurchaseOrder(purchaseOrderRow({
    items: [{
      id: "purchase-order-item-1",
      productNameSnapshot: "复合板",
      specificationSnapshot: null,
      unitSnapshot: "张",
      allocatedQuantity: { toString: () => "2" },
      purchaseUnitPrice: null,
      amount: null,
      supplierPrice: { unitPrice: 12.5, amount: 25, confirmedAt: new Date() },
      remark: null,
    }],
  }));
  assert.equal(confirmed.items[0]?.unitPrice, "12.5");
  assert.equal(confirmed.items[0]?.amount, "25");
  assert.equal(confirmed.items[0]?.supplierFilledPrice, true);
});

test("supplier portal displays supplier-filled unit prices with three decimals and amounts with two", () => {
  assert.equal(formatPrice("12.5", "CNY", 3), "CNY 12.500");
  assert.equal(formatPrice("25", "CNY"), "CNY 25.00");
});

test("supplier progress DTO never exposes an internal offline recorder", () => {
  const dto = serializeSupplierPurchaseOrder(purchaseOrderRow({
    productionProgressReports: [{
      id: "report-1",
      sequenceNo: 1,
      source: "INTERNAL_OFFLINE",
      channel: "PHONE",
      supplierContact: "供应商联系人",
      supplierReportedAt: new Date("2026-08-15T08:00:00.000Z"),
      reportedAt: new Date("2026-08-15T08:01:00.000Z"),
      remark: null,
      reportedBy: { id: "internal-user-secret", name: "内部员工姓名" },
      items: [{ purchaseOrderItemId: "purchase-order-item-1", completedQuantity: "10" }],
    }],
  }));
  assert.equal(dto.productionProgress.history[0]?.reportedBy.id, "");
  assert.equal(dto.productionProgress.history[0]?.reportedBy.name, "");
  assert.equal(JSON.stringify(dto).includes("内部员工姓名"), false);
  assert.equal(JSON.stringify(dto).includes("internal-user-secret"), false);
});

test("supplier progress DTO hides its baseline row while preserving the first visible increment", () => {
  const productionProgressReports = Array.from({ length: 101 }, (_, index) => {
    const sequenceNo = index + 1;
    return {
      id: `report-${sequenceNo}`,
      sequenceNo,
      source: "INTERNAL_OFFLINE",
      channel: "PHONE",
      supplierContact: sequenceNo === 1 ? "hidden-baseline-contact" : "供应商联系人",
      supplierReportedAt: new Date(Date.UTC(2026, 7, 1, 0, sequenceNo)),
      reportedAt: new Date(Date.UTC(2026, 7, 1, 0, sequenceNo)),
      remark: sequenceNo === 1 ? "hidden-baseline-remark" : null,
      reportedBy: {
        id: sequenceNo === 1 ? "hidden-baseline-user" : `internal-${sequenceNo}`,
        name: sequenceNo === 1 ? "隐藏员工" : `员工 ${sequenceNo}`,
      },
      items: [{ purchaseOrderItemId: "purchase-order-item-1", completedQuantity: sequenceNo }],
    };
  });

  const dto = serializeSupplierPurchaseOrder(purchaseOrderRow({ productionProgressReports }));

  assert.equal(dto.productionProgress.history.length, 100);
  assert.equal(dto.productionProgress.history[0]?.sequence, 2);
  assert.equal(dto.productionProgress.history[0]?.items[0]?.incrementQuantity, "1");
  assert.equal(dto.productionProgress.latestSequence, 101);
  assert.equal(dto.productionProgress.history[0]?.reportedBy.id, "");
  assert.equal(dto.productionProgress.history[0]?.reportedBy.name, "");
  const serialized = JSON.stringify(dto);
  assert.equal(serialized.includes("hidden-baseline-contact"), false);
  assert.equal(serialized.includes("hidden-baseline-remark"), false);
  assert.equal(serialized.includes("hidden-baseline-user"), false);
  assert.equal(serialized.includes("隐藏员工"), false);
});

test("supplier response validation enforces the response field contract", () => {
  const requested = new Date("2026-09-01T00:00:00.000Z");
  const accepted = normalizeSupplierPurchaseOrderResponse({
    action: "ACCEPTED",
    expectedRevision: 4,
    deliveryDate: "2026-09-01",
  }, requested);
  assert.equal(accepted.action, "ACCEPTED");
  assert.equal(accepted.deliveryDateText, "2026-09-01");

  const proposed = normalizeSupplierPurchaseOrderResponse({
    action: "DELIVERY_PROPOSED",
    expectedRevision: 4,
    deliveryDate: "2026-09-08",
    remark: "原料到货延期",
  }, requested);
  assert.equal(proposed.deliveryDateText, "2026-09-08");
  assert.equal(proposed.remark, "原料到货延期");

  assert.throws(
    () => normalizeSupplierPurchaseOrderResponse({ action: "ACCEPTED", expectedRevision: 4 }, requested),
    (error: unknown) => (error as { code?: string }).code === "SUPPLIER_PURCHASE_ORDER_ACCEPT_DATE_REQUIRED",
  );
  assert.throws(
    () => normalizeSupplierPurchaseOrderResponse({ action: "DELIVERY_PROPOSED", expectedRevision: 4, deliveryDate: "2026-09-01", remark: "不变" }, requested),
    (error: unknown) => (error as { code?: string }).code === "SUPPLIER_PURCHASE_ORDER_PROPOSED_DATE_UNCHANGED",
  );
  assert.throws(
    () => normalizeSupplierPurchaseOrderResponse({ action: "REJECTED", expectedRevision: 4, remark: "" }, requested),
    (error: unknown) => (error as { code?: string }).code === "SUPPLIER_PURCHASE_ORDER_REJECT_REMARK_REQUIRED",
  );
});

test("supplier price normalization requires every and only missing purchase-order item", () => {
  const items = [
    { id: "missing-1", purchaseUnitPrice: null, supplierPrice: null },
    { id: "fixed-1", purchaseUnitPrice: 10, supplierPrice: null },
  ];
  assert.deepEqual(
    normalizeSupplierPurchaseOrderPrices({ itemPrices: [{ purchaseOrderItemId: "missing-1", unitPrice: "12.3456" }] }, items),
    [{ purchaseOrderItemId: "missing-1", unitPriceText: "12.3456" }],
  );
  assert.throws(
    () => normalizeSupplierPurchaseOrderPrices({ itemPrices: [] }, items),
    (error: unknown) => (error as { code?: string }).code === "SUPPLIER_PURCHASE_ORDER_PRICES_REQUIRED",
  );
  assert.throws(
    () => normalizeSupplierPurchaseOrderPrices({ itemPrices: [{ purchaseOrderItemId: "fixed-1", unitPrice: "9" }] }, items),
    (error: unknown) => (error as { code?: string }).code === "SUPPLIER_PURCHASE_ORDER_PRICE_FROZEN",
  );
  assert.deepEqual(
    normalizeSupplierPurchaseOrderPrices({ itemPrices: [
      { purchaseOrderItemId: "missing-1", unitPrice: "12.3456" },
      { purchaseOrderItemId: "fixed-1", unitPrice: "10.000000" },
    ] }, items),
    [{ purchaseOrderItemId: "missing-1", unitPriceText: "12.3456" }],
  );
  assert.throws(
    () => normalizeSupplierPurchaseOrderPrices({ itemPrices: [{ purchaseOrderItemId: "missing-1", unitPrice: "-1" }] }, items),
    (error: unknown) => (error as { code?: string }).code === "SUPPLIER_PURCHASE_ORDER_UNIT_PRICE_INVALID",
  );
});

test("supplier purchase order service scopes every read and response before serialization", () => {
  const service = readFileSync("lib/platform/supplier-purchase-orders.ts", "utf8");
  const responseCore = readFileSync("lib/platform/factory-purchase-order-response-core.ts", "utf8");
  const production = readFileSync("lib/platform/supplier-purchase-order-production.ts", "utf8");
  const query = readFileSync("lib/platform/supplier-purchase-orders-query.ts", "utf8");
  const values = readFileSync("lib/platform/supplier-purchase-orders-values.ts", "utf8");

  assert.match(service, /assertRead\(actor, "supplierPurchaseOrders"\)/);
  assert.match(service, /assertWrite\(actor, "supplierPurchaseOrders"\)/);
  assert.match(service, /assertActiveSupplierPurchaseOrderActor\(tx, actorId, supplierId\)/);
  assert.match(service, /supplierId,[\s\S]*role: \{ in: \[\.\.\.PRODUCT_SUPPLIER_OPERATOR_ROLES\] \}[\s\S]*isActive: true[\s\S]*approvalStatus: "APPROVED"[\s\S]*emailVerified: true[\s\S]*passwordPolicyPassed: true/);
  assert.match(service, /!validActor \|\| !canWrite\(validActor, "supplierPurchaseOrders"\)/);
  assert.match(service, /FROM "users" WHERE "id" = \$\{actorId\} FOR SHARE/);
  assert.match(service, /FROM "suppliers" WHERE "id" = \$\{supplierId\} FOR SHARE/);
  assert.match(service, /allowFactoryDocumentUpload: true/);
  assert.match(query, /supplierId,[\s\S]*dispatchedAt: \{ not: null \},[\s\S]*status: \{ in: \[\.\.\.SUPPLIER_PURCHASE_ORDER_VISIBLE_STATUSES\] \}/);
  assert.match(query, /supplier:[\s\S]*?deletedAt: null,[\s\S]*?status: "启用",[\s\S]*?supplierType: \{ in: \[\.\.\.PRODUCT_SUPPLIER_TYPES\] \}/);
  assert.match(service, /where: \{ id: nonEmpty\(id\), \.\.\.supplierPurchaseOrderScope\(actor\) \}/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /applyFactoryPurchaseOrderResponse\(/);
  assert.match(service, /source: "SUPPLIER_PORTAL"/);
  assert.match(service, /channel: "PORTAL"/);
  assert.match(responseCore, /factoryPurchaseOrderSupplierResponse\.create/);
  assert.match(responseCore, /factoryPurchaseOrderSupplierPrice\.create/);
  assert.match(responseCore, /supplierId,[\s\S]*status: before\.status,[\s\S]*revision: response\.expectedRevision/);
  assert.match(service, /writeAudit\([\s\S]*"factory_purchase_orders"[\s\S]*tx,/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(production, /assertActiveSupplierPurchaseOrderActor\(tx, actorId, supplierId\)/);
  assert.match(query, /execution: \{ select: \{ customerOrderNo: true, shippingStartedAt: true \} \}/);
  assert.match(query, /confirmedSupplierDeliveryDate: true/);
  assert.match(query, /actualDeliveryDate: true/);
  assert.match(query, /actualDeliveryRecordedAt: true/);
  assert.match(query, /internalDecision: true,[\s\S]*internalDecidedAt: true/);
  assert.doesNotMatch(query, /internalDecisionRemark: true/);
  assert.doesNotMatch(values, /internalDecisionRemark:/);
  assert.match(responseCore, /before\.status === "DELIVERY_PROPOSED"[\s\S]*?SUPPLIER_PURCHASE_ORDER_PROPOSAL_PENDING/);
  assert.match(responseCore, /before\.confirmedSupplierDeliveryDate \|\| before\.supplierDeliveryDate \|\| before\.requestedDeliveryDate/);
  assert.match(responseCore, /supplierDeliveryDate: response\.action === "ACCEPTED" \? response\.deliveryDate : before\.supplierDeliveryDate/);
  assert.match(responseCore, /const firstAcceptedResponse = response\.action === "ACCEPTED" && !before\.initialSupplierDeliveryDate/);
  for (const forbidden of ["customer", "businessEntityId", "salespersonUserId", "salesUnitPrice", "salesAmount", "executionItemId", "subtotal"]) {
    assert.equal(query.includes(forbidden + ": true"), false, forbidden);
  }
  assert.match(query, /executionId: true/);
  assert.doesNotMatch(values, /executionId: row\.executionId/);
});

test("supplier purchase order API, workspace module, and focused link are independently wired", () => {
  const listRoute = readFileSync("app/api/supplier-purchase-orders/route.ts", "utf8");
  const detailRoute = readFileSync("app/api/supplier-purchase-orders/[id]/route.ts", "utf8");
  const responseRoute = readFileSync("app/api/supplier-purchase-orders/[id]/response/route.ts", "utf8");
  const content = readFileSync("app/WorkspaceModuleContent.tsx", "utf8");
  const shell = readFileSync("app/WorkspaceShell.tsx", "utf8");

  assert.match(listRoute, /requireApiRead\(request, "supplierPurchaseOrders"\)/);
  assert.match(detailRoute, /requireApiRead\(request, "supplierPurchaseOrders"\)/);
  assert.match(responseRoute, /requireApiWrite\(request, "supplierPurchaseOrders"\)/);
  assert.match(content, /activeMenu === "supplierPurchaseOrders"[\s\S]*initialPurchaseOrderId=\{focus\.purchaseOrderId\}/);
  assert.match(shell, /path === "supplier-purchase-orders"[\s\S]*purchaseOrderId/);

  const focus = createWorkspaceTabFocus({ purchaseOrderId: " po-1 " });
  assert.equal(focus.purchaseOrderId, "po-1");
  assert.equal(hasWorkspaceTabFocus(focus), true);
});

test("purchase-order product name and specification are presented as one product description", () => {
  const supplierDetail = readFileSync("app/modules/supplier-purchase-orders/purchase-order-detail.tsx", "utf8");
  const internalPurchaseOrder = readFileSync("app/modules/sales-execution/purchase-order-draft-list.tsx", "utf8");

  assert.match(supplierDetail, /<th>产品描述<\/th>/);
  assert.doesNotMatch(supplierDetail, /<th>品名<\/th>|<th>规格<\/th>|item\.productName|item\.specification/);
  assert.match(supplierDetail, /item\.productDescription/);
  assert.match(internalPurchaseOrder, /<th>产品描述<\/th>/);
  assert.doesNotMatch(internalPurchaseOrder, /产品描述（含规格）/);
});

test("supplier purchase payment term is master data copied into each future purchase-order snapshot", () => {
  const schema = readFileSync("prisma/models/parties.prisma", "utf8");
  const supplierService = readFileSync("lib/platform/supplier-masters.ts", "utf8");
  const supplierSerializer = readFileSync("lib/platform/shared-serialization-parties.ts", "utf8");
  const supplierPanel = readFileSync("app/modules/settings/supplier-edit-panel.tsx", "utf8");
  const purchaseDraftService = readFileSync("lib/platform/sales-execution-purchase-orders.ts", "utf8");

  assert.match(schema, /purchasePaymentTerm\s+String\?\s+@map\("purchase_payment_term"\)/);
  assert.match(supplierService, /SUPPLIER_PURCHASE_PAYMENT_TERM_TOO_LONG/);
  assert.match(supplierService, /purchasePaymentTerm,/);
  assert.match(supplierSerializer, /purchasePaymentTerm: supplier\.purchasePaymentTerm \|\| ""/);
  assert.match(supplierPanel, /默认采购付款条款/);
  assert.match(purchaseDraftService, /paymentTerm: group\.rows\.find[\s\S]*supplier\.purchasePaymentTerm \|\| null/);
});
