import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260702161000_tax_refund_list_performance/migration.sql", "utf8");
const service = readFileSync("lib/platform/tax-refunds.ts", "utf8");
const sync = readFileSync("lib/platform/shared-tax-sync.ts", "utf8");
const completeness = readFileSync("lib/platform/shared-tax-completeness.ts", "utf8");
const controller = readFileSync("app/modules/tax-refund/use-tax-refund-controller.ts", "utf8");
const detail = readFileSync("app/modules/tax-refund/detail-components.tsx", "utf8");
const row = readFileSync("app/modules/tax-refund/table-row.tsx", "utf8");
const list = readFileSync("app/modules/tax-refund/list-panel.tsx", "utf8");

test("tax refund list endpoint is lightweight and paginated", () => {
  assert.equal(existsSync("app/api/tax-refund/list/route.ts"), true);
  assert.match(service, /const taxRefundLightListSelect = Prisma\.validator<Prisma\.ReceivableOrderSelect>/);
  assert.match(service, /const taxRefundCustomsDeclarationListSelect = Prisma\.validator<Prisma\.CustomsDeclarationSelect>/);
  assert.match(service, /select: taxRefundCustomsDeclarationListSelect/);
  assert.match(service, /skip,\s*\n\s*take: filters\.pageSize/);
  assert.doesNotMatch(
    service.match(/export async function listTaxRefundOrders[\s\S]*?\n}\n\nconst taxRefundRecordDeclarationSelect/)?.[0] || "",
    /includeOrderRelations\(\)|scheduleTaxRefundCompletenessRefreshBatch|documents:\s*\{|costs:\s*\{|customsDeclarationItems:\s*\{|exportTaxRefundCalculations:\s*\{/,
  );
  assert.match(controller, /`\/api\/tax-refund\/list\?\$\{params\}`/);
});

test("tax refund detail is split by lazy-loaded tabs", () => {
  for (const segment of ["basic", "export-documents", "customs-documents", "factory-documents", "logistics-documents"]) {
    assert.equal(existsSync(`app/api/tax-refund/[orderId]/${segment}/route.ts`), true);
    assert.match(service, new RegExp(`"${segment}"`));
  }
  assert.match(controller, /detailActiveTab/);
  assert.match(controller, /fetchDetailSection/);
  assert.match(controller, /`\/api\/tax-refund\/\$\{encodeURIComponent\(orderId\)\}\/\$\{detailSectionPath\(section\)\}`/);
  assert.match(detail, /role="tablist"/);
  assert.doesNotMatch(detail, /activeTab === "calculation"/);
  assert.match(detail, /activeTab === "factory-documents"/);
  assert.match(detail, /activeTab === "logistics-documents"/);
});

test("tax refund completeness is cached for list rendering", () => {
  assert.match(schema, /taxRefundOverallCompleteness\s+Int\?\s+@map\("tax_refund_overall_completeness"\)/);
  assert.match(schema, /taxRefundCompletenessIssuesSummary\s+String\?\s+@map\("tax_refund_completeness_issues_summary"\)/);
  assert.match(schema, /@@index\(\[taxRefundOverallCompleteness\]\)/);
  assert.match(migration, /tax_refund_overall_completeness/);
  assert.match(migration, /receivable_orders_tax_list_light_idx/);
  assert.match(sync, /taxRefundOverallCompletenessValue/);
  assert.match(sync, /taxRefundCompletenessIssuesSummary/);
  assert.match(row, /row\.overallCompleteness/);
  assert.match(row, /row\.completenessIssuesSummary/);
  assert.match(list, /tableSkeletonLine/);
});

test("tax refund list keeps lower completeness rows before completed rows", () => {
  const orderByHelper = service.match(/function taxRefundDeclarationListOrderBy[\s\S]*?\n}/)?.[0] || "";
  assert.match(orderByHelper, /taxRefundOverallCompleteness:\s*\{\s*sort:\s*"asc",\s*nulls:\s*"first"\s*\}/);
  assert.doesNotMatch(orderByHelper, /businessEntity|businessEntitySortDirection/);
  assert.match(
    orderByHelper,
    /taxRefundOverallCompleteness[\s\S]*declarationDate[\s\S]*updatedAt[\s\S]*createdAt/,
  );
});

test("tax refund list shows supplier names from declaration scope or legacy factory costs", () => {
  assert.match(service, /const taxRefundCustomsDeclarationOrderListSelect = Prisma\.validator<Prisma\.ReceivableOrderSelect>/);
  assert.match(service, /costType:\s*\{\s*in:\s*FACTORY_SUPPLIER_COST_TYPES\s*\}/);
  assert.match(service, /TAX_REFUND_SUPPLIER_TYPES/);
  assert.match(service, /function isTaxRefundListFallbackCost/);
  assert.match(service, /function declarationScopedSupplierNames/);
  assert.match(service, /function orderFactorySupplierNames/);
  assert.match(service, /supplierPendingAssignment/);
  assert.match(service, /scopedSupplierNames\.length \|\| supplierPendingAssignment \? \[\] : orderFactorySupplierIds\(row\)/);
  assert.match(service, /待归属：\$\{supplierNameText\}/);
  assert.match(service, /supplierOwnershipStatus:\s*supplierPendingAssignment \? "PENDING_ASSIGNMENT" : ""/);
  assert.match(service, /suppliers:\s*\{\s*some:\s*\{[\s\S]*supplierName:\s*\{\s*contains: keyword/);
  assert.match(service, /supplierId:\s*null[\s\S]*purchaseOrderId:\s*null[\s\S]*suppliers:\s*\{\s*none:\s*\{\s*deletedAt:\s*null\s*\}/);
  assert.match(service, /costs:\s*\{\s*some:\s*\{[\s\S]*FACTORY_SUPPLIER_COST_TYPES/);
});

test("tax refund completeness ignores removed customs detail confirmation state", () => {
  assert.match(completeness, /DISABLED_TAX_REFUND_COMPLETENESS_MARKERS = \[[\s\S]*"报关明细待确认"[\s\S]*"CUSTOMS_RECOGNIZED_PENDING_CONFIRM"/);
  assert.match(completeness, /hasDisabledTaxRefundCompletenessMarker\(cachedValue\)/);
  assert.match(completeness, /sanitizeTaxRefundCompletenessSummary\(cached as TaxRefundCompletenessSummary\)/);
  assert.match(service, /sanitizeTaxRefundCompletenessText\(fallback\)/);
  assert.match(sync, /sanitizeTaxRefundCompletenessText\(record\.text\)/);
});

test("tax refund detail does not render tax calculation review workspace", () => {
  assert.doesNotMatch(detail, /calculationFormId|TaxCalculationStatCard|taxCalculationSubTabs/);
  assert.doesNotMatch(detail, /退税结果|理论退税额|发票匹配|暂无退税计算数据/);
  assert.match(detail, /role="tablist"/);
  assert.match(detail, /更多操作/);
  assert.match(detail, /提交归档/);
});
