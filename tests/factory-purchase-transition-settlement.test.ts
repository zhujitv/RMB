import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const model = readFileSync("prisma/models/factory-purchase-execution.prisma", "utf8");
const orderCostModel = readFileSync("prisma/models/shipping-payments-costs.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260819100000_factory_purchase_transition_settlement/migration.sql", "utf8");
const reversalMigration = readFileSync("prisma/migrations/20260821190000_factory_purchase_transition_settlement_reversal/migration.sql", "utf8");
const service = ["lib/platform/supplier-transition-settlement.ts", "lib/platform/supplier-transition-settlement-context.ts", "lib/platform/supplier-transition-settlement-reversal.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
const workflow = ["lib/platform/supplier-tax-contract-workflow.ts", "lib/platform/supplier-tax-contract-request-create.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
const route = readFileSync("app/api/supplier-document-requests/transition-preview/route.ts", "utf8");
const requestRoute = readFileSync("app/api/supplier-document-requests/[id]/route.ts", "utf8");
const dialog = ["app/modules/supplier-documents/create-request-dialog.tsx", "app/modules/supplier-documents/transition-settlement-panel.tsx", "app/modules/supplier-documents/use-transition-settlement-form.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
const review = readFileSync("app/modules/supplier-documents/tax-contract-review-panel.tsx", "utf8");

test("transition settlement is an explicit immutable audit record", () => {
  assert.match(model, /model FactoryPurchaseTransitionSettlement/);
  assert.match(model, /costId\s+String\s+@map\("cost_id"\)/);
  assert.match(model, /revokedAt\s+DateTime\?\s+@map\("revoked_at"\)/);
  assert.match(model, /revokedById\s+String\?\s+@map\("revoked_by"\)/);
  assert.match(model, /revocationReason\s+String\?\s+@map\("revocation_reason"\)/);
  assert.match(orderCostModel, /transitionSettlements\s+FactoryPurchaseTransitionSettlement\[\]/);
  assert.match(model, /goodsAmountWithTax\s+Decimal/);
  assert.match(model, /itemSnapshot\s+Json/);
  assert.match(model, /reason\s+String\s+@db\.Text/);
  assert.match(migration, /FACTORY_PURCHASE_TRANSITION_SETTLEMENT/);
  assert.match(migration, /factory_transition_amounts_check/);
  assert.match(migration, /confirmed factory transition settlement is immutable/);
  assert.match(migration, /factory transition settlement cost financial fields are immutable/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "order_costs"/);
  assert.match(reversalMigration, /factory_purchase_transition_settlements_active_cost_key/);
  assert.match(reversalMigration, /WHERE "revoked_at" IS NULL/);
  assert.match(reversalMigration, /NEW\."revoked_at" IS NOT NULL/);
  assert.match(reversalMigration, /factory transition settlement cost source is immutable/);
});

test("only confirmed unarchived CNY manual factory costs can enter transition settlement", () => {
  assert.match(service, /FACTORY_SUPPLIER_COST_TYPES\.includes\(cost\.costType\)/);
  assert.match(service, /if \(!cost\.costConfirmed\)/);
  assert.match(service, /assertBusinessNotArchived/);
  assert.match(service, /cost\.order\.customsDeclarationNo/);
  assert.match(service, /cost\.currency !== "CNY"/);
  assert.match(service, /cost\.exchangeRate\.eq\(1\)/);
  assert.match(service, /FACTORY_TRANSITION_AMOUNT_MISMATCH/);
  assert.match(service, /FACTORY_TRANSITION_ORDER_QUANTITY_EXCEEDS_CUSTOMS/);
});

test("transition confirmation and request creation are atomic and auditable", () => {
  assert.match(route, /requireApiActor/);
  assert.match(route, /previewFactoryPurchaseTransitionSettlement/);
  assert.match(workflow, /prepareFactoryPurchaseTransitionSettlement/);
  assert.match(workflow, /prisma\.\$transaction/);
  assert.match(workflow, /assertBusinessOrderWritableInTransaction[\s\S]*assertFactoryPurchaseTransitionAllocationAvailable/);
  assert.match(workflow, /factoryPurchaseTransitionSettlement\.create/);
  assert.match(workflow, /sourceType: FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE/);
  assert.match(workflow, /确认历史过渡结算/);
  assert.match(workflow, /SUPPLIER_TAX_CONTRACT_TRANSITION_CHANGED/);
  assert.match(workflow, /transitionSettlement\.revokedAt/);
});

test("supplier return UI separates normal settlement from historical transition", () => {
  assert.match(dialog, /需过渡结算/);
  assert.match(dialog, /读取品名、数量和单位/);
  assert.doesNotMatch(dialog, /报关项号|form\.updateItem\(index, \{ unitPriceWithTax/);
  assert.match(dialog, /确认过渡结算并生成草稿/);
  assert.match(dialog, /transitionIncreaseAmount/);
  assert.match(dialog, /transitionDecreaseAmount/);
  assert.match(dialog, /transitionConfirmed/);
  assert.match(review, /FACTORY_PURCHASE_TRANSITION_SETTLEMENT/);
  assert.match(review, /未补造历史采购和生产记录/);
});

test("admins can revoke an erroneous transition settlement without losing audit history", () => {
  assert.match(requestRoute, /action === "revokeTransitionSettlement"/);
  assert.match(requestRoute, /revokeSupplierDocumentTransitionSettlement\(request, actor, id, body\)/);
  assert.match(service, /export async function revokeSupplierDocumentTransitionSettlement/);
  assert.match(service, /只有管理员可以撤销过渡结算凭证/);
  assert.match(service, /assertWrite\(actor, "supplierDocuments"\)/);
  assert.match(service, /请填写至少5个字的撤销原因/);
  assert.match(service, /supplierDocumentRequestOrderLocked\(row\.order\)/);
  assert.match(service, /供应商发票已人工确认/);
  assert.match(service, /revokedAt: now/);
  assert.match(service, /revokedById/);
  assert.match(service, /revocationReason: reason/);
  assert.match(service, /sourceType: "MANUAL"/);
  assert.match(service, /sourceId: null/);
  assert.match(service, /contractStatus: "LEGACY"/);
  assert.match(service, /sendStatus: "transition_revoked"/);
  assert.match(service, /softDeleteFileAssetBySource/);
  assert.match(service, /scheduleTaxRefundCompletenessRefresh\(row\.orderId, "过渡结算撤销后退税完整度刷新"\)/);
  assert.match(service, /writeAudit\([\s\S]*"撤销历史过渡结算"[\s\S]*"factory_purchase_transition_settlements"/);
  assert.doesNotMatch(service, /factoryPurchaseTransitionSettlement\.delete/);
  assert.match(review, /撤销过渡结算/);
  assert.match(review, /task\.canRevokeTransitionSettlement/);
  assert.match(review, /revokeTransitionSettlement/);
});
