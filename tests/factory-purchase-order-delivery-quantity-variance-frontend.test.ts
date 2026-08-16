import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  formatDifferenceRate, formatSignedDifference, formatTolerancePercent,
  quantitiesEqual, quantityToleranceRange, quantityWithinTolerance,
} = await jiti.import<typeof import("../app/modules/delivery-quantity-variance.ts")>(
  "../app/modules/delivery-quantity-variance.ts",
);

const supplierDetail = readFileSync("app/modules/supplier-purchase-orders/purchase-order-detail.tsx", "utf8");
const supplierCard = readFileSync("app/modules/supplier-purchase-orders/delivery-quantity-variance-card.tsx", "utf8");
const supplierHook = readFileSync("app/modules/supplier-purchase-orders/use-delivery-quantity-variance.ts", "utf8");
const supplierList = readFileSync("app/modules/supplier-purchase-orders/purchase-order-list.tsx", "utf8");
const supplierPublicDto = readFileSync("lib/platform/supplier-purchase-orders-values.ts", "utf8");
const executionPanel = readFileSync("app/modules/sales-execution/purchase-order-execution-panel.tsx", "utf8");
const decisionCard = readFileSync("app/modules/sales-execution/purchase-order-delivery-quantity-variance.tsx", "utf8");
const offlineForm = readFileSync("app/modules/sales-execution/purchase-order-offline-quantity-variance.tsx", "utf8");
const deliveryForm = readFileSync("app/modules/sales-execution/purchase-order-delivery-actions.tsx", "utf8");
const settlementCard = readFileSync("app/modules/sales-execution/purchase-order-settlement-card.tsx", "utf8");
const internalList = readFileSync("app/modules/sales-execution/purchase-order-draft-list.tsx", "utf8");
const supplierSettings = readFileSync("app/modules/settings/supplier-purchase-settings-fields.tsx", "utf8");
const supplierSave = readFileSync("app/modules/settings/use-settings-entity-save-actions.ts", "utf8");

test("browser variance math remains exact for large four-decimal quantities", () => {
  assert.equal(quantitiesEqual("99999999999999.0001", "99999999999999.0001"), true);
  assert.equal(quantitiesEqual("99999999999999.0001", "99999999999999.0002"), false);
  assert.equal(quantityWithinTolerance("100", "95", "0.05"), true);
  assert.equal(quantityWithinTolerance("100", "94.9999", "0.05"), false);
  assert.deepEqual(quantityToleranceRange("100", "0.05"), { minimum: "95", maximum: "105" });
  assert.equal(formatTolerancePercent("0.025"), "2.5");
  assert.equal(formatSignedDifference("100", "95.5"), "-4.5");
  assert.equal(formatDifferenceRate("100", "95.5"), "-4.5%");
});

test("supplier portal has a full-line variance request, frozen tolerance, and safe history", () => {
  assert.match(supplierDetail, /<DeliveryQuantityVarianceCard/);
  assert.match(supplierDetail, /交付数量公差/);
  assert.match(supplierHook, /status === "ACCEPTED"/);
  assert.match(supplierHook, /productionStatus === "IN_PRODUCTION"/);
  assert.match(supplierHook, /!detail\.actualDeliveryDate/);
  assert.match(supplierHook, /status === "PENDING" \|\| entry\.status === "APPROVED"/);
  assert.match(supplierHook, /\/quantity-variance`/);
  assert.match(supplierHook, /items: detail\.items\.map/);
  assert.match(supplierHook, /reason: reason\.trim\(\)/);
  assert.match(supplierCard, /差额 \/ 差异率/);
  assert.match(supplierCard, /实际申请/);
  assert.match(supplierCard, /系统记录/);
  assert.doesNotMatch(supplierCard, /decisionRemark|decidedBy/);
  assert.doesNotMatch(supplierPublicDto, /decisionRemark/);
});

test("internal execution supports approval, attributed offline entry, and pending badges", () => {
  assert.match(executionPanel, /<PurchaseOrderDeliveryQuantityVariance/);
  assert.match(executionPanel, /<PurchaseOrderOfflineQuantityVariance/);
  assert.match(decisionCard, /quantity-variance-decision/);
  assert.match(decisionCard, /decision === "REJECTED" && !remark\.trim\(\)/);
  assert.match(decisionCard, /supplierContact/);
  assert.match(decisionCard, /supplierRequestedAt/);
  assert.match(decisionCard, /requestedAt/);
  assert.match(decisionCard, /requestedBy\?\.name/);
  assert.match(decisionCard, /decisionRemark/);
  assert.match(offlineForm, /offline-quantity-variance/);
  assert.match(offlineForm, /supplierRequestedAt: shanghaiDateTimeIso/);
  assert.match(offlineForm, /items: items\.map/);
  assert.match(supplierList, /数量差异待审批/);
  assert.match(internalList, /交付数量差异待审批/);
});

test("legacy actual-delivery entry is replaced by the final loading-result workflow", () => {
  assert.doesNotMatch(deliveryForm, /\/actual-delivery/);
  assert.doesNotMatch(deliveryForm, /actualDeliveredQuantity/);
  assert.match(deliveryForm, /最终装柜结果/);
  assert.match(deliveryForm, /旧实际交付入口已停用/);
});

test("settlement labels actual delivery value without changing the contractual penalty base", () => {
  assert.match(settlementCard, /<span>实际交付货款<\/span>/);
  assert.doesNotMatch(settlementCard, /<span>采购基数<\/span>/);
  assert.match(settlementCard, /结算货款按逐行批准的实际装柜数量计算/);
  assert.match(settlementCard, /留仓不计供应商货款/);
  assert.match(settlementCard, /延误违约金仍按原合同采购基数计算/);
});

test("product supplier settings persist a capped tolerance percent and clear non-product values", () => {
  assert.match(supplierSettings, /交付数量公差（%）/);
  assert.match(supplierSettings, /max="5"/);
  assert.match(supplierSave, /purchaseQuantityTolerancePercent/);
  assert.match(supplierSave, /PRODUCT_SUPPLIER_TYPES\.includes/);
  assert.match(supplierSave, /: "0"/);
});

test("variance front-end components stay within the component size boundary", () => {
  for (const source of [supplierDetail, supplierCard, supplierHook, executionPanel, decisionCard, offlineForm, deliveryForm]) {
    assert.ok(source.split("\n").length <= 301);
  }
});
