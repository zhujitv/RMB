import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const schema = readPrismaSchemaSource();
const correctionService = readFileSync("lib/platform/factory-purchase-order-price-correction.ts", "utf8");
const correctionValues = readFileSync("lib/platform/factory-purchase-order-price-correction-values.ts", "utf8");
const paymentService = readFileSync("lib/platform/factory-purchase-order-execution.ts", "utf8");
const settlementValues = readFileSync("lib/platform/factory-purchase-order-settlement-values.ts", "utf8");
const settlementService = readFileSync("lib/platform/factory-purchase-order-settlement.ts", "utf8");
const settlementCorrectionReconciliation = readFileSync(
  "lib/platform/factory-purchase-order-settlement-price-corrections.ts",
  "utf8",
);
const enumMigration = readFileSync(
  "prisma/migrations/20260822142500_factory_price_correction_refund_enums/migration.sql",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20260822143000_factory_price_correction_after_settlement/migration.sql",
  "utf8",
);
const correctionUi = readFileSync(
  "app/modules/sales-execution/purchase-order-price-correction.tsx",
  "utf8",
);
const executionUi = readFileSync(
  "app/modules/sales-execution/purchase-order-execution-panel.tsx",
  "utf8",
);
const settlementUi = readFileSync(
  "app/modules/sales-execution/purchase-order-settlement-card.tsx",
  "utf8",
);
const serializer = readFileSync("lib/platform/sales-execution-serialization.ts", "utf8");
const contractFinancials = readFileSync(
  "lib/platform/factory-purchase-price-correction-contract.ts",
  "utf8",
);
const contractDraft = readFileSync("lib/platform/supplier-tax-contract-draft.ts", "utf8");
const contractWorkflow = readFileSync("lib/platform/supplier-tax-contract-workflow.ts", "utf8");
const contractRequest = readFileSync("lib/platform/supplier-tax-contract-request-create.ts", "utf8");

function prismaModel(name: string) {
  return schema.match(new RegExp(`model ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

test("settlement and payment ledgers represent post-settlement refund states", () => {
  const correction = prismaModel("FactoryPurchaseOrderPriceCorrection");
  const settlement = prismaModel("FactoryPurchaseOrderSettlement");

  assert.match(schema, /enum FactoryPurchasePaymentKind\s+\{[\s\S]*?REFUND/);
  assert.match(schema, /enum FactoryPurchaseSettlementStatus\s+\{[\s\S]*?PENDING_REFUND/);
  assert.match(settlement, /revision\s+Int\s+@default\(1\)/);
  assert.match(correction, /settlementFinalPayableBefore\s+Decimal\?/);
  assert.match(correction, /settlementFinalPayableAfter\s+Decimal\?/);
  assert.match(correction, /settlementStatusBefore\s+FactoryPurchaseSettlementStatus\?/);
  assert.match(correction, /settlementStatusAfter\s+FactoryPurchaseSettlementStatus\?/);
  assert.match(correction, /settlementRevisionBefore\s+Int\?/);
  assert.match(correction, /settlementRevisionAfter\s+Int\?/);
  assert.match(correction, /settlementSettledAtBefore\s+DateTime\?/);
  assert.match(correction, /settlementSettledByAfterId\s+String\?/);
});

test("database guards allow only audited price corrections after settlement", () => {
  assert.match(enumMigration, /ALTER TYPE "FactoryPurchasePaymentKind" ADD VALUE[^;]*'REFUND'/);
  assert.match(enumMigration, /ALTER TYPE "FactoryPurchaseSettlementStatus" ADD VALUE[^;]*'PENDING_REFUND'/);
  assert.doesNotMatch(migration, /ALTER TYPE/);
  assert.match(migration, /PURCHASE_PRICE_CORRECTION/);
  assert.match(migration, /CASE[\s\S]*?payment\."kind"\s*=\s*'REFUND'[\s\S]*?-payment\."amount"/);
  assert.match(migration, /PENDING_PAYMENT/);
  assert.match(migration, /PENDING_REFUND/);
  assert.match(migration, /factory purchase order adjustments are frozen after final settlement/);
  assert.match(migration, /factory purchase settlement financial snapshot is immutable/);
  assert.match(migration, /factory settlement cost payment state is out of sync/);
  assert.match(migration, /snapshots_present[\s\S]*?REJECTED[\s\S]*?snapshots_present/);
  assert.match(migration, /fpo_price_corrections_review_state_check/);
  assert.match(migration, /fpo_price_corrections_effective_change_check/);
  assert.match(migration, /new factory purchase price correction must start pending and unreviewed/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "factory_purchase_order_price_corrections"/);
  assert.match(migration, /closed factory settlement audit fields are immutable/);
  assert.match(migration, /factory settlement legacy ledger preflight failed/);
  assert.match(migration, /purchase price correction adjustment must commit an approved backlink/);
  assert.match(migration, /settlement financial revision requires an exact immutable correction snapshot/);
  assert.match(migration, /fpo_price_corrections_settlement_revision_key/);
  assert.doesNotMatch(
    migration,
    /linked_correction_adjustment\s+AND\s*\(\s*linked_correction\./,
    "an unassigned PL/pgSQL record must never be accessed through an assumed short-circuit expression",
  );
  assert.doesNotMatch(
    migration,
    /TG_TABLE_NAME\s*=\s*'factory_purchase_order_payments'\s+AND\s+TG_OP\s*=\s*'INSERT'\s+AND\s+NEW\."kind"\s*=\s*'REFUND'/,
    "a heterogeneous trigger must narrow the source table before reading a table-specific enum",
  );
});

test("approved correction uses the latest approved price and actual delivered quantity", () => {
  assert.match(correctionService, /status\s*===\s*"APPROVED"/);
  assert.match(correctionService, /newUnitPrice/);
  assert.match(correctionService, /actualDeliveredQuantity\s*\?\?/);
  assert.match(correctionService, /sourceType:\s*"PURCHASE_PRICE_CORRECTION"/);
  assert.match(correctionValues, /settlementFinalPayableBefore/);
  assert.match(correctionValues, /settlementFinalPayableAfter/);
  assert.match(correctionValues, /settlementRevisionBefore/);
  assert.match(correctionValues, /settlementSettledAtAfter/);
  assert.match(correctionService, /factoryPurchaseOrderSettlement\.update/);
  assert.match(correctionService, /orderCost\.update/);
  assert.doesNotMatch(correctionService, /factoryPurchaseOrderItem\.update|supplierPrice\.update/);
  assert.match(serializer, /latestApprovedCorrectionByItemId/);
});

test("net purchase payment subtracts supplier refunds and closes only at equality", () => {
  assert.match(settlementValues, /payment\.kind\s*===\s*"REFUND"/);
  assert.match(paymentService, /kind\s*===\s*"REFUND"/);
  assert.match(paymentService, /PENDING_REFUND/);
  assert.match(paymentService, /退款/);
  assert.match(paymentService, /FACTORY_SETTLEMENT_REFUND_EXCEEDS_REQUIRED|FACTORY_SETTLEMENT_REFUND/);
  assert.match(settlementValues, /assertFactoryPaymentRunningBalance/);
  assert.match(migration, /refund cannot precede or exceed confirmed payments by ledger date/);
});

test("UI exposes audited settlement correction, supplement, and supplier refund paths", () => {
  assert.match(correctionUi, /结算更正凭证/);
  assert.doesNotMatch(correctionUi, /已进入最终应付确认，不能申请采购价格更正/);
  assert.match(executionUi, /登记供应商退款/);
  assert.match(executionUi, /REFUND/);
  assert.match(settlementUi, /等待供应商退款/);
  assert.match(settlementUi, /结算更正凭证/);
});

test("price correction cannot leave an active tax contract or invoice chain on the old price", () => {
  assert.match(correctionService, /assertPriceCorrectionSupplierDocumentsWithdrawn\(tx, before\.id\)/);
  assert.match(contractFinancials, /sourceType: "FACTORY_PURCHASE_SETTLEMENT"/);
  assert.match(contractFinancials, /supplierDocumentRequestCostOccupancy\(cost, client\)/);
  assert.match(contractFinancials, /已有有效的退税合同\/发票资料回传任务/);
  assert.match(contractFinancials, /latestApprovedFactoryPrice/);
  assert.match(contractFinancials, /correctedFactoryGoodsAmount/);
  assert.match(contractFinancials, /status: \{ in: \["PENDING", "APPROVED"\] \}/);
  assert.match(contractFinancials, /SUPPLIER_TAX_CONTRACT_PRICE_CORRECTION_PENDING/);
  assert.match(contractFinancials, /quantity\.mul\(correction\.oldUnitPrice\)/);
  assert.match(contractFinancials, /quantity\.mul\(correction\.newUnitPrice\)/);
  assert.match(contractDraft, /latestApprovedFactoryPrice\(/);
  assert.match(contractDraft, /correctedFactoryGoodsAmount\(/);
  assert.match(contractDraft, /approvedPriceCorrections/);
  assert.doesNotMatch(contractDraft, /calculatedTotal\.eq\(purchaseOrder\.settlement\.baseAmount\)/);
});

test("pre-settlement price corrections reconcile to actual delivered quantity", () => {
  assert.match(settlementCorrectionReconciliation, /PURCHASE_PRICE_CORRECTION_QUANTITY_RECONCILIATION/);
  assert.match(settlementCorrectionReconciliation, /quantity\.mul\(correction\.oldUnitPrice\)/);
  assert.match(settlementCorrectionReconciliation, /quantity\.mul\(correction\.newUnitPrice\)/);
  assert.match(settlementCorrectionReconciliation, /actualDelta\.sub\(correction\.deltaAmount\)/);
  assert.match(settlementService, /reconcilePriceCorrectionsForFinalSettlement/);
  assert.match(settlementService, /settlementAdjustments = \[\.\.\.purchaseOrder\.adjustments, \.\.\.correctionReconciliations\]/);
});

test("tax contract creation and approval serialize against concurrent price corrections", () => {
  assert.match(contractRequest, /lockFactoryPurchaseOrder\(tx, draft\.purchaseOrderId\)[\s\S]*?assertBusinessOrderWritableInTransaction/);
  assert.match(contractRequest, /assertSupplierTaxContractFinancialsCurrent\(tx, draft\)/);
  assert.doesNotMatch(contractRequest, /\["P2002", "P2034"\]/);
  assert.match(contractRequest, /SUPPLIER_TAX_CONTRACT_CONCURRENT_UPDATE/);
  assert.match(contractWorkflow, /lockFactoryPurchaseOrder\(tx, draft\.purchaseOrderId\)/);
  assert.match(contractWorkflow, /assertSupplierTaxContractFinancialsCurrent\(tx, draft\)/);
  assert.match(contractWorkflow, /assertSupplierTaxContractFinancialsCurrent\(prisma, draft\)/);
});
