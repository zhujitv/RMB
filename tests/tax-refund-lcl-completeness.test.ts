import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readTaxRefundModuleSource } from "./source-helpers.ts";

const completeness = readFileSync("lib/platform/shared-tax-completeness.ts", "utf8");
const constants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const reportService = readFileSync("lib/report-service.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const refreshScript = readFileSync("scripts/refresh-tax-refund-completeness.mjs", "utf8");
const orderRelations = readFileSync("lib/platform/shared-order-relations.ts", "utf8");
const taxRefundModule = readTaxRefundModuleSource();

test("tax refund completeness adapts FOB LCL logistics invoice requirements to actual costs", () => {
  assert.match(constants, /TAX_REFUND_LOGISTICS_RULE_VERSION = "GROUPED_INVOICE_INCLUDED_FEES_20260630"/);
  assert.match(constants, /label: "物流费资料"[\s\S]*"国内物流费"[\s\S]*"进港费"[\s\S]*"其他物流费用"/);
  assert.match(completeness, /export function normalizedTransportMode/);
  assert.match(completeness, /\["LCL", "BULK_WAREHOUSE"[\s\S]*"拼箱"[\s\S]*"散货进舱"\]\.includes\(text\)\) return "LCL"/);
  assert.match(completeness, /\["FCL", "FULL_CONTAINER"[\s\S]*"TRUCK"[\s\S]*"MULTIMODAL"[\s\S]*"整柜"/);
  assert.match(completeness, /function isFobLclOrder/);
  assert.match(completeness, /normalizedTradeTerm\(order\.tradeTerm \|\| ""\) === "FOB" && orderTransportMode\(order\) === "LCL"/);
  assert.match(completeness, /requirement\.key === "CUSTOMS" && fobLcl/);
  assert.match(completeness, /isLclGeneralLogisticsRequirement\(requirement\) && fobLcl/);
});

test("tax refund logistics completeness is based on occurred approved costs instead of fixed port requirement", () => {
  assert.match(completeness, /function isActualApprovedLogisticsCost/);
  assert.match(completeness, /sourceType === "LOGISTICS_EXPENSE" \|\| cost\.costConfirmed === true/);
  assert.match(completeness, /positiveCostAmount\(cost\)/);
  assert.match(completeness, /actualRequirementKeys\.has\(requirement\.key\)/);
  assert.match(completeness, /label: "缺少已发生费用对应资料"/);
  assert.match(completeness, /function logisticsInvoiceGroupCoverages/);
  assert.match(completeness, /logisticsInvoiceGroupForCost\(primaryCost\)/);
  assert.match(completeness, /includedFeeTypes: uniqueNormalizedCostTypes\(groupCosts\.length \? groupCosts : \[primaryCost\]\)/);
  assert.match(completeness, /function logisticsRequirementMatchesCoverage/);
  assert.match(completeness, /coverage\.includedFeeTypes\.some\(\(costType\) => requiredTypes\.has\(costType\)\)/);
  assert.match(completeness, /const completed = directCompleted \|\| matchedCoverages\.length > 0/);
  assert.match(completeness, /invoiceGroupId: coverage\.invoiceGroupId/);
  assert.match(completeness, /includedFeeTypes/);
  assert.match(completeness, /tax-refund-logistics-invoice-decision/);
  assert.match(completeness, /"拖车费": directTruckingCompleted \|\| truckingCoveredByGroup/);
  assert.doesNotMatch(completeness, /Number\(logistics\.total \|\| 0\) < 3/);
  assert.doesNotMatch(constants, /missingCostLabel: "未录入港杂费"/);
  assert.match(constants, /missingCostLabel: "缺少已发生费用对应资料"/);
});

test("tax refund detail displays grouped logistics invoices by included fee types", () => {
  assert.match(orderRelations, /logisticsExpenseInvoices: \{\s*where: \{ deletedAt: null \}/);
  assert.match(completeness, /document\.logisticsExpenseInvoices/);
  assert.match(completeness, /logisticsExpenseInvoiceCostLike/);
  assert.match(completeness, /includedFeeTypes: uniqueNormalizedCostTypes\(groupCosts\.length \? groupCosts : \[primaryCost\]\)/);
  assert.match(completeness, /uploadedFileUrl: documentUploadedFileExists\(document\)/);
  assert.match(completeness, /taxRefundDocumentTypeMatched: completed/);
  assert.match(taxRefundModule, /function logisticsInvoiceDocumentsForCost/);
  assert.match(taxRefundModule, /completeness\.logistics\?\.requirements/);
  assert.match(taxRefundModule, /group\.documentId/);
  assert.match(taxRefundModule, /group\.includedFeeTypes/);
  assert.match(taxRefundModule, /group\.feeTypes/);
  assert.match(taxRefundModule, /group\.costTypes/);
});

test("historical tax refund completeness refresh and report wording use the shared rule", () => {
  assert.match(packageJson, /"refresh:tax-refund-completeness"/);
  assert.match(refreshScript, /refreshTaxRefundCompleteness\(order\.id\)/);
  assert.match(refreshScript, /receivableOrder\.findMany/);
  assert.match(reportService, /缺失已发生费用资料明细/);
  assert.doesNotMatch(reportService, /缺失港杂费发票明细/);
});

test("factory tax refund documents are calculated per cost slot", () => {
  assert.match(completeness, /function factoryDocumentMatchesCost/);
  assert.match(completeness, /if \(document\.costId\) return document\.costId === cost\.id/);
  assert.match(completeness, /allowLegacySupplierFallback && document\.supplierId === cost\.supplierId/);
  assert.match(completeness, /const supplierEntries: SupplierEntry\[\] = factoryCosts\.map/);
  assert.match(completeness, /costId: entry\.costId/);
  assert.match(completeness, /tax-refund-factory-document-match/);
  assert.doesNotMatch(completeness, /doc\.supplierId === entry\.supplierId \|\| entry\.costIds\.includes/);
});
