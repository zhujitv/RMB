import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import {
  readCostRecordsMutationsSource,
  readDomesticLogisticsApiSource,
  readLogisticsExpenseWorkflowSource,
  readOrderDocumentsSource,
  readReportServiceSource,
  readSharedConstantsSource,
  readSharedTaxCompletenessSource,
  readTaxRefundModuleSource,
  readTaxRefundsSource,
} from "./source-helpers.ts";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
const jiti = createJiti(import.meta.url);
const { createTrailingRefreshCoordinator } = jiti("../lib/platform/shared-tax-sync.ts") as typeof import("../lib/platform/shared-tax-sync.ts");

const completeness = readSharedTaxCompletenessSource();
const constants = readSharedConstantsSource();
const reportService = readReportServiceSource();
const packageJson = readFileSync("package.json", "utf8");
const refreshScript = readFileSync("scripts/refresh-tax-refund-completeness.mjs", "utf8");
const orderRelations = readFileSync("lib/platform/shared-order-relations.ts", "utf8");
const taxSync = readFileSync("lib/platform/shared-tax-sync.ts", "utf8");
const taxRefundService = readTaxRefundsSource();
const taxRefundListService = readFileSync("lib/platform/tax-refunds-list.ts", "utf8");
const taxRefundRoute = readFileSync("app/api/tax-refunds/[orderId]/route.ts", "utf8");
const taxRefundController = readTaxRefundModuleSource();
const taxRefundDetailComponents = readTaxRefundModuleSource();
const taxRefundHelpers = readTaxRefundModuleSource();
const orderDocuments = readOrderDocumentsSource();
const costMutations = readCostRecordsMutationsSource();
const domesticLogisticsApi = readDomesticLogisticsApiSource();
const logisticsExpenseMutations = readLogisticsExpenseWorkflowSource();
const taxRefundModule = readTaxRefundModuleSource();

test("tax refund completeness uses trade term logistics invoice requirements", () => {
  assert.match(constants, /TAX_REFUND_LOGISTICS_RULE_VERSION = "TRADE_TERM_LOGISTICS_INVOICES_20260709_EXW_NOT_APPLICABLE"/);
  assert.match(constants, /TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS = \["CUSTOMS", "TRUCKING", "PORT"\]/);
  assert.match(constants, /label: "拖车费发票"[\s\S]*"国内物流费"[\s\S]*"进港费"[\s\S]*"其他物流费用"/);
  assert.match(constants, /label: "港杂费发票"[\s\S]*missingCostLabel: "缺少港杂费发票"/);
  assert.match(constants, /label: "海运费发票"[\s\S]*missingCostLabel: "缺少海运费发票"/);
  assert.match(completeness, /export function normalizedTransportMode/);
  assert.match(completeness, /text\.includes\("LOOSE CARGO"\)/);
  assert.match(completeness, /text\.includes\("拼箱"\)/);
  assert.match(completeness, /text\.includes\("散货"\)/);
  assert.match(completeness, /text\.includes\("非整柜"\)/);
  assert.match(completeness, /\["FCL", "FULL_CONTAINER"[\s\S]*"TRUCK"[\s\S]*"MULTIMODAL"[\s\S]*"整柜"/);
  assert.match(completeness, /function normalizedTaxRefundTradeTerm/);
  assert.match(completeness, /text\.includes\("EXW"\)/);
  assert.match(completeness, /orderRecord\.declarationType/);
  assert.match(completeness, /orderRecord\.customsDeclarationType/);
  assert.match(completeness, /orderRecord\.tradeMode/);
  assert.match(completeness, /orderRecord\.modeOfTrade/);
  assert.match(completeness, /export function isNonFullContainerTaxRefundOrder/);
  assert.match(completeness, /orderTransportMode\(order\) === "LCL"/);
  assert.match(completeness, /value === "FOB" \|\| value === "CIF" \|\| value === "CFR" \|\| value === "EXW"/);
  assert.match(completeness, /\["FOB", "CIF", "CFR"\]\.includes\(tradeTerm\)/);
  assert.match(completeness, /TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS\.forEach\(\(key\) => tradeTermRequiredKeys\.add\(key\)\)/);
  assert.match(completeness, /tradeTermRequiredKeys\.delete\("PORT"\)/);
  assert.match(completeness, /actualRequirementKeys\.delete\("PORT"\)/);
  assert.match(completeness, /if \(isSeaFreightRequiredByTradeTerm\(order\)\)/);
  assert.match(completeness, /tradeTerm !== "FOB" && actualRequirementKeys\.has\(requirement\.key\)/);
  assert.match(completeness, /!\s*isPortChargesRequirement\(requirement\)/);
  assert.doesNotMatch(completeness, /hasSeaFreightCost/);
  assert.doesNotMatch(completeness, /nonFullContainer && \["CUSTOMS", "TRUCKING"\]\.includes/);
});

test("EXW tax refund completeness does not require logistics invoices", () => {
  assert.match(completeness, /export function isExwTaxRefundOrder/);
  assert.match(completeness, /normalizedTaxRefundTradeTerm\(order\) === "EXW"/);
  assert.match(completeness, /if \(isExwTaxRefundOrder\(order\)\) return \[\]/);
  assert.match(completeness, /key: "LOGISTICS_INVOICE"[\s\S]*label: "物流费用发票"[\s\S]*EXW 条款下不强制要求物流费用发票/);
  assert.match(completeness, /if \(isExwTaxRefundOrder\(order\) && cachedLogisticsRequirements\.length\) return true/);
  assert.match(completeness, /if \(isExwTaxRefundOrder\(order\) && Array\.isArray\(logistics\.missing\) && logistics\.missing\.length\) return true/);
});

test("tax refund completeness does not require port charges for LCL bulk or loose cargo", () => {
  assert.match(completeness, /text\.includes\("LCL"\)/);
  assert.match(completeness, /text\.includes\("BULK"\)/);
  assert.match(completeness, /text\.includes\("LOOSE CARGO"\)/);
  assert.match(completeness, /text\.includes\("LESS THAN CONTAINER"\)/);
  assert.match(completeness, /text\.includes\("拼箱"\)/);
  assert.match(completeness, /text\.includes\("散货"\)/);
  assert.match(completeness, /text\.includes\("非整柜"\)/);
  assert.match(completeness, /const nonFullContainer = isNonFullContainerTaxRefundOrder\(order\)/);
  assert.match(completeness, /if \(nonFullContainer\) \{[\s\S]*tradeTermRequiredKeys\.delete\("PORT"\);[\s\S]*actualRequirementKeys\.delete\("PORT"\);[\s\S]*\}/);
  assert.match(completeness, /\(!nonFullContainer \|\| !isPortChargesRequirement\(requirement\)\)/);
  assert.match(completeness, /function notApplicableLogisticsRequirementsForOrder/);
  assert.match(completeness, /if \(isExwTaxRefundOrder\(order\)\) \{/);
  assert.match(completeness, /if \(!isNonFullContainerTaxRefundOrder\(order\)\) return \[\]/);
  assert.match(completeness, /key: "PORT"[\s\S]*label: "港杂费"[\s\S]*拼箱散货\/非整柜出口不强制要求港杂费/);
  assert.match(completeness, /notApplicableRequirements: notApplicableLogisticsRequirements/);
  assert.match(completeness, /missingPortInvoices: logisticsMissing\.filter\(\(item\) => item\.missingBucket === "PORT"\)/);
  assert.match(completeness, /transportMode: orderTransportMode\(order\)/);
});

test("FCL logistics completeness still requires port charges", () => {
  assert.match(completeness, /TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS\.forEach\(\(key\) => tradeTermRequiredKeys\.add\(key\)\)/);
  assert.match(completeness, /\(!nonFullContainer \|\| !isPortChargesRequirement\(requirement\)\)/);
  assert.match(completeness, /\["FCL", "FULL_CONTAINER"[\s\S]*"FULL CONTAINER"[\s\S]*"TRUCK"[\s\S]*"MULTIMODAL"[\s\S]*"整柜"/);
});

test("old LCL completeness cache with port requirement is refreshed", () => {
  assert.match(completeness, /const hasCachedPortRequirement = cachedLogisticsRequirements\.some\(\(item\) => item\?\.key === "PORT"\)/);
  assert.match(completeness, /if \(isNonFullContainerTaxRefundOrder\(order\) && hasCachedPortRequirement\) return true/);
  assert.match(completeness, /if \(isNonFullContainerTaxRefundOrder\(order\) && Array\.isArray\(logistics\.missingPortInvoices\) && logistics\.missingPortInvoices\.length\) return true/);
});

test("tax refund logistics completeness reports required invoice gaps with exact labels", () => {
  assert.match(completeness, /function isActualApprovedLogisticsCost/);
  assert.match(completeness, /isLogisticsGeneratedCostSourceType\(cost\.sourceType\) \|\| cost\.costConfirmed === true/);
  assert.match(completeness, /positiveCostAmount\(cost\)/);
  assert.match(completeness, /function logisticsRequirementMissingLabel/);
  assert.match(completeness, /return "CIF订单缺少海运费发票"/);
  assert.match(completeness, /label: logisticsRequirementMissingLabel\(order, requirement\)/);
  assert.match(taxRefundHelpers, /label \|\| "缺少报关费发票"/);
  assert.match(taxRefundHelpers, /label \|\| "缺少拖车发票"/);
  assert.match(taxRefundHelpers, /label \|\| "缺少港杂费发票"/);
  assert.match(taxRefundHelpers, /label \|\| "缺少海运费发票"/);
  assert.match(completeness, /function logisticsInvoiceGroupCoverages/);
  assert.match(completeness, /logisticsInvoiceGroupForCost\(primaryCost\)/);
  assert.match(completeness, /includedFeeTypes: uniqueNormalizedCostTypes\(groupCosts\.length \? groupCosts : \[primaryCost\]\)/);
  assert.match(completeness, /function logisticsRequirementMatchesCoverage/);
  assert.match(completeness, /coverage\.includedFeeTypes\.some\(\(costType\) => requiredTypes\.has\(costType\)\)/);
  assert.match(completeness, /const matchedUploadedCoverages = matchedCoverages\.filter\(\(coverage\) => coverage\.uploadedFileUrl\)/);
  assert.match(completeness, /const completed = directCompleted \|\| matchedUploadedCoverages\.length > 0/);
  assert.match(completeness, /invoiceGroupId: coverage\.invoiceGroupId/);
  assert.match(completeness, /includedFeeTypes/);
  assert.match(completeness, /tax-refund-logistics-invoice-decision/);
  assert.match(completeness, /"拖车费": directTruckingCompleted \|\| truckingCoveredByGroup/);
  assert.doesNotMatch(completeness, /Number\(logistics\.total \|\| 0\) < 3/);
  assert.doesNotMatch(constants, /missingCostLabel: "未录入港杂费"/);
  assert.doesNotMatch(completeness, /label: "缺少已发生费用对应资料"/);
});

test("tax refund detail displays grouped logistics invoices by included fee types", () => {
  assert.match(orderRelations, /logisticsExpenseInvoices: \{\s*where: \{ deletedAt: null \}/);
  assert.match(completeness, /document\.logisticsExpenseInvoices/);
  assert.match(completeness, /logisticsExpenseInvoiceCostLike/);
  assert.match(completeness, /includedFeeTypes: uniqueNormalizedCostTypes\(groupCosts\.length \? groupCosts : \[primaryCost\]\)/);
  assert.match(completeness, /uploadedFileUrl: documentUploadedFileExists\(document\)/);
  assert.match(completeness, /return Boolean\(document\.fileUrl \|\| document\.storageKey\)/);
  assert.match(completeness, /taxRefundDocumentTypeMatched: completed/);
  assert.match(taxRefundService, /relatedModule: "SUPPLIER"[\s\S]*documentType: "SUPPLIER_INVOICE"[\s\S]*uploadStatus: "SUCCESS"/);
  assert.match(taxRefundService, /groupedInvoiceDocuments/);
  assert.match(taxRefundService, /uniqueTaxRefundDocuments\(\[[\s\S]*costs\.flatMap\(\(cost\) => cost\.documents \|\| \[\]\),[\s\S]*groupedInvoiceDocuments/);
  assert.match(taxRefundModule, /function logisticsInvoiceDocumentsForCost/);
  assert.match(taxRefundModule, /completeness\.logistics\?\.requirements/);
  assert.match(taxRefundDetailComponents, /function LogisticsInvoiceRequirementStatus/);
  assert.match(taxRefundDetailComponents, /completeness\.logistics\?\.requirements/);
  assert.match(taxRefundDetailComponents, /requirement\.completed \? "已完成" : "缺失"/);
  assert.match(taxRefundDetailComponents, /completeness\.logistics\?\.notApplicableRequirements/);
  assert.match(taxRefundDetailComponents, /不适用/);
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

test("tax refund completeness cache refresh is deduped batched and non-blocking for mutation side effects", () => {
  assert.match(taxSync, /createTrailingRefreshCoordinator<T>/);
  assert.match(taxSync, /pending\.dirty = true/);
  assert.match(taxSync, /pending\.nextTask = task/);
  assert.match(taxSync, /if \(!state\.dirty\) return result/);
  assert.match(taxSync, /currentTask = state\.nextTask \|\| task/);
  assert.match(taxSync, /export async function refreshTaxRefundCompletenessForOrder/);
  assert.match(taxSync, /export async function refreshTaxRefundCompletenessBatch/);
  assert.match(taxSync, /export function scheduleTaxRefundCompletenessRefresh/);
  assert.match(taxSync, /TAX_REFUND_COMPLETENESS_BATCH_CONCURRENCY = 3/);
  const listFunction = taxRefundListService.match(/export async function listTaxRefundOrders[\s\S]*?mode: filters\.mode,[\s\S]*?\n  \};\n}/)?.[0] || "";
  assert.match(listFunction, /select: taxRefundLightListSelect/);
  assert.doesNotMatch(listFunction, /scheduleTaxRefundCompletenessRefreshBatch|needsTaxRefundCompletenessRefresh|refreshTaxRefundCompletenessForOrder/);
  assert.match(taxSync, /taxRefundOverallCompleteness/);
  assert.match(taxSync, /taxRefundCompletenessIssuesSummary/);
  assert.match(taxSync, /TAX_REFUND_COMPLETENESS_PERSIST_MAX_ATTEMPTS = 3/);
  assert.match(taxSync, /receivableOrder\.updateMany\(\{/);
  assert.match(taxSync, /updatedAt: order\.updatedAt,[\s\S]*taxRefundCompletenessUpdatedAt: order\.taxRefundCompletenessUpdatedAt/);
  assert.match(taxSync, /Math\.max\(Date\.now\(\), currentTime \+ 1\)/);
  assert.match(taxSync, /taxRefundCompletenessUpdatedAt: completenessVersion/);
  assert.match(taxSync, /updatedAt: order\.updatedAt/);
  assert.match(taxSync, /computeAndPersistTaxRefundCompleteness\(latestOrder, attempt \+ 1\)/);
  assert.match(taxRefundService, /refreshTaxRefundCompletenessForOrder\(orderWithLogistics\)/);
  assert.doesNotMatch(taxRefundService, /Promise\.all\(staleCompletenessOrderIds\.map/);
  assert.match(orderDocuments, /documentType === "EXPORT_INVOICE"[\s\S]*invalidatePersistedTaxRefundCompleteness\(tx, order\.id\)/);
  assert.match(orderDocuments, /before\.documentType === "EXPORT_INVOICE"[\s\S]*invalidatePersistedTaxRefundCompleteness\(tx, before\.orderId\)/);
  assert.match(orderDocuments, /documentType !== "EXPORT_INVOICE"[\s\S]*scheduleTaxRefundCompletenessRefresh\(order\.id\)/);
  assert.match(orderDocuments, /before\.documentType !== "EXPORT_INVOICE"[\s\S]*scheduleTaxRefundCompletenessRefresh\(before\.orderId\)/);
  assert.match(orderDocuments, /runNonCriticalTask\("出口发票上传后退税完整度重算"[\s\S]*refreshTaxRefundCompleteness\(order\.id\)/);
  assert.match(orderDocuments, /runNonCriticalTask\("出口发票删除后退税完整度重算"[\s\S]*refreshTaxRefundCompleteness\(before\.orderId\)/);
  assert.match(costMutations, /scheduleTaxRefundCompletenessRefresh\(cost\.orderId\)/);
  assert.match(domesticLogisticsApi, /scheduleTaxRefundCompletenessRefresh\(order\.id\)/);
  assert.match(logisticsExpenseMutations, /scheduleTaxRefundCompletenessRefresh\(orderId\)/);
  assert.match(taxRefundService, /export async function refreshTaxRefundCompletenessNow/);
  assert.match(taxRefundService, /"手动重算退税完整度"/);
  assert.match(taxRefundRoute, /body\.action === "refreshCompleteness"/);
  assert.match(taxRefundController, /async function refreshCompleteness/);
  assert.match(taxRefundController, /setRefreshingCompletenessId/);
  assert.match(taxRefundDetailComponents, /重新计算完整度/);
  assert.match(taxRefundDetailComponents, /canRefreshCompleteness/);
  assert.doesNotMatch(orderDocuments, /runNonCriticalTask\("退税资料完整度刷新", \(\) => refreshTaxRefundCompleteness/);
  assert.doesNotMatch(costMutations, /runNonCriticalTask\("退税资料完整度刷新", \(\) => refreshTaxRefundCompleteness/);
  assert.doesNotMatch(domesticLogisticsApi, /runNonCriticalTask\("退税资料完整度刷新", \(\) => refreshTaxRefundCompleteness/);
});

test("overlapping completeness refreshes run one trailing recalculation and share its result", async () => {
  const runRefresh = createTrailingRefreshCoordinator<number>();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = runRefresh("order-1", async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return 1;
  });
  await Promise.resolve();
  const overlapping = runRefresh("order-1", async () => {
    events.push("trailing");
    return 2;
  });

  assert.strictEqual(overlapping, first);
  releaseFirst();
  assert.equal(await first, 2);
  assert.deepEqual(events, ["first:start", "first:end", "trailing"]);
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
