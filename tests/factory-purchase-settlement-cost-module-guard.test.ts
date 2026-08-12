import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  assertCostCanBeManagedInCostModule,
  isFactoryPurchaseSettlementCost,
} = await jiti.import<typeof import("../lib/platform/cost-records-module-guard.ts")>(
  "../lib/platform/cost-records-module-guard.ts",
);

const guardSource = readFileSync("lib/platform/cost-records-module-guard.ts", "utf8");
const supplierMutations = readFileSync("lib/platform/cost-records-supplier-mutations.ts", "utf8");
const deleteMutation = readFileSync("lib/platform/cost-records-delete-mutation.ts", "utf8");
const restoreMutations = readFileSync("lib/platform/cost-records-restore-mutations.ts", "utf8");
const costTypeMutation = readFileSync("lib/platform/cost-records-mutation-cost-type.ts", "utf8");
const paymentMutations = readFileSync("lib/platform/cost-records-payment-mutations.ts", "utf8");
const paymentShared = readFileSync("lib/platform/cost-records-mutation-shared.ts", "utf8");
const orderDocumentUpload = readFileSync("lib/platform/order-documents-upload.ts", "utf8");
const orderDocumentFiles = readFileSync("lib/platform/order-documents-files.ts", "utf8");
const serialization = readFileSync("lib/platform/shared-serialization-costs.ts", "utf8");
const costUi = [
  "app/modules/costs/helpers.ts",
  "app/modules/costs/cost-detail-drawer.tsx",
  "app/modules/costs/cost-table.tsx",
  "app/modules/costs/invoice-actions.tsx",
  "app/modules/costs/cost-documents-panel.tsx",
  "app/modules/costs/cost-order-summary-drawer.tsx",
].map((file) => readFileSync(file, "utf8")).join("\n");
const paymentUi = readFileSync("app/modules/costs/cost-document-actions-panel.tsx", "utf8");

test("factory purchase settlement costs have a distinct cost-module business guard", () => {
  assert.equal(isFactoryPurchaseSettlementCost({ sourceType: "FACTORY_PURCHASE_SETTLEMENT" }), true);
  assert.equal(isFactoryPurchaseSettlementCost({ sourceType: "MANUAL" }), false);
  assert.throws(
    () => assertCostCanBeManagedInCostModule({ sourceType: "FACTORY_PURCHASE_SETTLEMENT" }, "修改"),
    (error: unknown) => {
      const typed = error as { status?: number; code?: string; message?: string };
      return typed.status === 400
        && typed.code === "FACTORY_PURCHASE_SETTLEMENT_COST_MANAGED_BY_PURCHASE"
        && typed.message === "采购结算生成的成本不能在成本管理修改，请到采购执行模块的结算与付款中操作。";
    },
  );
  assert.doesNotThrow(() => assertCostCanBeManagedInCostModule({ sourceType: "MANUAL" }, "修改"));
  assert.throws(
    () => assertCostCanBeManagedInCostModule({ sourceType: "LOGISTICS_FEE" }, "修改"),
    (error: unknown) => (error as { code?: string }).code === "LOGISTICS_COST_MANAGED_BY_LOGISTICS",
  );
});

test("all legacy cost mutation paths block settlement-owned fields before writing", () => {
  assert.match(supplierMutations, /assertCostCanBeManagedInCostModule\(before, "修改"\)/);
  assert.match(deleteMutation, /assertCostCanBeManagedInCostModule\(before, "删除或作废"\)/);
  assert.match(restoreMutations, /assertCostCanBeManagedInCostModule\(before, "恢复"\)/);
  assert.match(restoreMutations, /isFactoryPurchaseSettlementCost\(row\)[\s\S]{0,180}采购结算生成成本/);
  assert.match(costTypeMutation, /assertFactoryPurchaseSettlementCostCanBeManagedInCostModule\(before, "修改成本类型"\)/);
  assert.match(paymentMutations, /loadCostForPayment\(currentActor, id, "修改付款状态"\)/);
  assert.match(paymentMutations, /loadCostForPaymentVoucher\(currentActor, id\)/);
  assert.ok(
    paymentMutations.indexOf("loadCostForPaymentVoucher(currentActor, id)")
      < paymentMutations.indexOf("readManagedUploadFile(file"),
    "voucher authorization must run before a voucher is parsed or uploaded",
  );
  assert.match(paymentShared, /if \(mutationAction\) assertFactoryPurchaseSettlementCostCanBeManagedInCostModule\(cost, mutationAction\)/);
  assert.match(paymentShared, /loadCostForPaymentVoucher[\s\S]*const cost = await loadCostForPayment\(actor, id\)/);
  assert.match(paymentShared, /isFactoryPurchaseSettlementCost\(cost\) && cost\.paymentStatus !== "已支付"/);
  assert.match(paymentShared, /FACTORY_PURCHASE_SETTLEMENT_NOT_FULLY_PAID/);
  assert.match(paymentMutations, /resolveProductSupplierCostPaymentVoucher[\s\S]*loadCostForPayment\(currentActor, id\)/);
});

test("settlement costs keep financial fields locked while allowing payment evidence upload", () => {
  assert.match(paymentMutations, /updateProductSupplierCostPayment[\s\S]*loadCostForPayment\(currentActor, id, "修改付款状态"\)/);
  assert.match(paymentMutations, /uploadProductSupplierCostPaymentVoucher[\s\S]*loadCostForPaymentVoucher\(currentActor, id\)/);
  assert.match(paymentMutations, /invalidateWorkbenchTodosCache\(\)/);
  assert.doesNotMatch(paymentMutations, /previousFileId: previousStorageKey|nextFileId: storedFile\.storageKey/);
  assert.match(costUi, /canManagePayment=\{canManageFactoryPayments && !factorySettlementGenerated && !voided\}/);
  assert.match(costUi, /canUploadVoucher=\{canManageFactoryPayments && voucherEvidenceEnabled && !voided\}/);
  assert.match(costUi, /function isPaymentVoucherEvidenceEnabled[\s\S]*paymentStatus === "已支付"/);
  assert.match(paymentUi, /canManagePayment \|\| canUploadVoucher/);
  assert.match(paymentUi, /\{canManagePayment \? \(/);
  assert.match(paymentUi, /\{canUploadVoucher \? \(/);
});

test("generic order-document APIs cannot mutate purchase-settlement cost documents", () => {
  assert.match(
    orderDocumentUpload,
    /assertFactoryPurchaseSettlementCostCanBeManagedInCostModule\(cost, "上传或替换资料"\)/,
  );
  assert.ok(
    orderDocumentUpload.lastIndexOf("assertFactoryPurchaseSettlementCostCanBeManagedInCostModule")
      < orderDocumentUpload.indexOf("readManagedUploadFile(file"),
    "the settlement guard must run before an upload is read or persisted",
  );
  assert.match(
    orderDocumentFiles,
    /assertFactoryPurchaseSettlementCostCanBeManagedInCostModule\(before\.cost, "删除资料"\)/,
  );
  assert.ok(
    orderDocumentFiles.indexOf("assertCanDeleteOrderDocumentFile(actor, before)")
      < orderDocumentFiles.lastIndexOf("assertFactoryPurchaseSettlementCostCanBeManagedInCostModule(before.cost"),
    "object-level authorization must run before source-specific errors are exposed",
  );
  assert.ok(
    orderDocumentFiles.lastIndexOf("assertFactoryPurchaseSettlementCostCanBeManagedInCostModule(before.cost")
      < orderDocumentFiles.indexOf("const deletedAt = new Date()"),
    "the settlement guard must run before a document or file asset is deleted",
  );
});

test("settlement costs serialize and render as read-only while keeping document viewing", () => {
  assert.match(serialization, /sourceLabel: cost\.sourceType === FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE \? "采购结算生成"/);
  assert.match(serialization, /采购结算生成成本由采购执行模块管理/);
  assert.match(costUi, /function isFactoryPurchaseSettlementCost/);
  assert.match(costUi, /const manualCost = !systemManagedCost/);
  assert.match(costUi, /!logisticsGenerated && !factorySettlementGenerated/);
  assert.match(costUi, /const canEditCostType = canManageCostType && !factorySettlementGenerated && !voided/);
  assert.match(costUi, /const settlementCost = isFactoryPurchaseSettlementCost\(cost\)/);
  assert.match(costUi, /systemManagedCost \? "查看资料" : "资料维护"/);
  assert.match(costUi, /全额结清后可上传最终付款凭证/);
});

test("touched TypeScript modules stay within the 300-line quality gate", () => {
  for (const file of [
    "app/modules/costs/helpers.ts",
    "app/modules/costs/cost-detail-drawer.tsx",
    "app/modules/costs/cost-table.tsx",
    "lib/platform/cost-records-module-guard.ts",
    "lib/platform/cost-records-mutation-shared.ts",
    "lib/platform/shared-serialization-costs.ts",
  ]) {
    assert.ok(readFileSync(file, "utf8").trimEnd().split("\n").length <= 300, `${file} exceeds 300 lines`);
  }
});
