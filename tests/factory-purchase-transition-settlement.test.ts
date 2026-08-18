import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const model = readFileSync("prisma/models/factory-purchase-execution.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260819100000_factory_purchase_transition_settlement/migration.sql", "utf8");
const service = ["lib/platform/supplier-transition-settlement.ts", "lib/platform/supplier-transition-settlement-context.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
const workflow = ["lib/platform/supplier-tax-contract-workflow.ts", "lib/platform/supplier-tax-contract-request-create.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
const route = readFileSync("app/api/supplier-document-requests/transition-preview/route.ts", "utf8");
const dialog = ["app/modules/supplier-documents/create-request-dialog.tsx", "app/modules/supplier-documents/transition-settlement-panel.tsx", "app/modules/supplier-documents/use-transition-settlement-form.ts"].map((file) => readFileSync(file, "utf8")).join("\n");
const review = readFileSync("app/modules/supplier-documents/tax-contract-review-panel.tsx", "utf8");

test("transition settlement is an explicit immutable audit record", () => {
  assert.match(model, /model FactoryPurchaseTransitionSettlement/);
  assert.match(model, /costId\s+String\s+@unique/);
  assert.match(model, /goodsAmountWithTax\s+Decimal/);
  assert.match(model, /itemSnapshot\s+Json/);
  assert.match(model, /reason\s+String\s+@db\.Text/);
  assert.match(migration, /FACTORY_PURCHASE_TRANSITION_SETTLEMENT/);
  assert.match(migration, /factory_transition_amounts_check/);
  assert.match(migration, /confirmed factory transition settlement is immutable/);
  assert.match(migration, /factory transition settlement cost financial fields are immutable/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "order_costs"/);
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
