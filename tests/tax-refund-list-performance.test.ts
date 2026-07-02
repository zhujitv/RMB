import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260702161000_tax_refund_list_performance/migration.sql", "utf8");
const service = readFileSync("lib/platform/tax-refunds.ts", "utf8");
const sync = readFileSync("lib/platform/shared-tax-sync.ts", "utf8");
const controller = readFileSync("app/modules/tax-refund/use-tax-refund-controller.ts", "utf8");
const detail = readFileSync("app/modules/tax-refund/detail-components.tsx", "utf8");
const row = readFileSync("app/modules/tax-refund/table-row.tsx", "utf8");
const list = readFileSync("app/modules/tax-refund/list-panel.tsx", "utf8");

test("tax refund list endpoint is lightweight and paginated", () => {
  assert.equal(existsSync("app/api/tax-refund/list/route.ts"), true);
  assert.match(service, /const taxRefundLightListSelect = Prisma\.validator<Prisma\.ReceivableOrderSelect>/);
  assert.match(service, /select: taxRefundLightListSelect/);
  assert.match(service, /skip,\s*\n\s*take: filters\.pageSize/);
  assert.doesNotMatch(
    service.match(/export async function listTaxRefundOrders[\s\S]*?\n}\n\nexport async function getTaxRefundOrderDetail/)?.[0] || "",
    /includeOrderRelations\(\)|scheduleTaxRefundCompletenessRefreshBatch|documents:\s*\{|costs:\s*\{|customsDeclarationItems:\s*\{|exportTaxRefundCalculations:\s*\{/,
  );
  assert.match(controller, /`\/api\/tax-refund\/list\?\$\{params\}`/);
});

test("tax refund detail is split by lazy-loaded tabs", () => {
  for (const segment of ["basic", "calculation", "export-documents", "customs-documents", "factory-documents", "logistics-documents"]) {
    assert.equal(existsSync(`app/api/tax-refund/[orderId]/${segment}/route.ts`), true);
    assert.match(service, new RegExp(`"${segment}"`));
  }
  assert.match(controller, /detailActiveTab/);
  assert.match(controller, /fetchDetailSection/);
  assert.match(controller, /`\/api\/tax-refund\/\$\{encodeURIComponent\(orderId\)\}\/\$\{detailSectionPath\(section\)\}`/);
  assert.match(detail, /role="tablist"/);
  assert.match(detail, /activeTab === "calculation"/);
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

test("tax refund detail uses a large verification workspace for calculation review", () => {
  assert.match(detail, /const calculationFormId = `tax-refund-calculation-form-\$\{row\.id\}`/);
  assert.match(detail, /重新识别/);
  assert.match(detail, /type="submit" form=\{calculationFormId\}/);
  assert.match(detail, /报关商品/);
  assert.match(detail, /发票匹配/);
  assert.match(detail, /退税结果/);
  assert.match(detail, /const displayRows = \[/);
  assert.match(detail, /const \[activeCalculationSubTab, setActiveCalculationSubTab\] = useState<TaxCalculationSubTab>\("refund"\)/);
  assert.match(detail, /计算状态/);
  assert.match(detail, /异常数量/);
  assert.match(detail, /理论退税额/);
  assert.match(detail, /暂无退税计算数据，请先上传并确认报关单。/);
  assert.match(detail, /发票金额/);
  assert.match(detail, /amountText\(row\?\.estimatedRefundAmount\)/);
  assert.match(detail, /function TablePanel/);
  assert.match(detail, /function TaxCalculationStatCard/);
  assert.equal(detail.match(/<TablePanel/g)?.length, 3);
  assert.ok((detail.match(/styles\.taxCalculationDataTable/g)?.length || 0) >= 3);
  assert.doesNotMatch(detail, /taxWideTableWrap|taxWideDataTable|taxDeclarationItemsTable|taxInvoiceMatchTable|taxRefundResultTable/);
  assert.match(detail, /taxCalculationSubTabs/);
  assert.match(detail, /activeCalculationSubTab === "refund"/);
  assert.match(detail, /activeCalculationSubTab === "invoice"/);
  assert.match(detail, /activeCalculationSubTab === "declaration"/);
  assert.match(detail, /商品名称/);
  assert.match(detail, /<th>数量<\/th>/);
  assert.match(detail, /<th>单位<\/th>/);
  assert.match(detail, /总金额/);
  assert.match(detail, /FOB金额/);
  assert.match(detail, /发票数量/);
  assert.match(detail, /差异/);
  assert.doesNotMatch(detail, /数量\/单位|<th>FOB币种<\/th>|<th>增值税率<\/th>/);
  assert.doesNotMatch(detail, /<TablePanel[\s\S]*<TablePanel[\s\S]*<TablePanel[\s\S]*<\/TablePanel>[\s\S]*<\/TablePanel>[\s\S]*<\/TablePanel>/);
  assert.match(detail, /role="tablist"/);
  assert.match(detail, /activeTab === "calculation"/);
  assert.match(detail, /更多操作/);
  assert.match(detail, /提交归档/);
  const styles = readFileSync("app/WorkspaceShell.module.css", "utf8");
  assert.match(styles, /width: min\(96vw, 1680px\);[\s\S]*height: min\(92vh, 960px\);/);
  assert.match(styles, /\.taxCalculationKpiBar \{[\s\S]*grid-template-columns: 140px 180px 180px 110px minmax\(180px, 1fr\);/);
  assert.match(styles, /\.taxCalculationSubTabs \{/);
  assert.match(styles, /\.taxCalculationEmptyPanel \{/);
  assert.match(styles, /\.taxCalculationTablePanel \{[\s\S]*width: 100%;[\s\S]*min-width: 100%;/);
  assert.match(styles, /\.taxCalculationTableContainer \{[\s\S]*width: 100%;[\s\S]*min-width: 100%;[\s\S]*overflow: visible;/);
  assert.match(styles, /\.taxCalculationDataTable \{[\s\S]*width: 100%;[\s\S]*min-width: 100%;[\s\S]*table-layout: fixed;/);
  assert.match(styles, /\.taxCalculationDataTable th \{[\s\S]*position: sticky;[\s\S]*top: 0;[\s\S]*z-index: 2;/);
  assert.match(styles, /\.taxCalculationDataTable \.numericCell,[\s\S]*\.taxCalculationDataTable \.numericCell input \{[\s\S]*text-align: right;/);
  assert.match(styles, /text-overflow: ellipsis;/);
  assert.match(styles, /\.taxRefundResultFocusTable th:nth-child\(2\),[\s\S]*width: 110px;/);
  assert.match(styles, /\.taxRefundMoreActionMenu \{/);
});
