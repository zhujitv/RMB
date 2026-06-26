import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const costsQueries = readFileSync("lib/platform/cost-records-queries.ts", "utf8");
const costsShared = readFileSync("lib/platform/cost-records-shared.ts", "utf8");
const workspaceStyles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("costs page renders only the table list and not duplicate cost cards", () => {
  assert.doesNotMatch(costsModule, /CostMobileCard/);
  assert.doesNotMatch(costsModule, /CostOrderMobileCard/);
  assert.doesNotMatch(costsModule, /mobileCardList/);
  assert.doesNotMatch(costsModule, /desktopOnly/);
  assert.match(costsModule, /useState<"details" \| "orders">\("orders"\)/);
  assert.match(costsModule, /按订单 \/ Shipment 汇总/);
  assert.doesNotMatch(costsModule, />成本明细<\/button>/);
  assert.match(costsModule, /<th className=\{styles\.orderNoColumn\}>订单号 \/ Shipment<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.customerColumn\}>客户简称<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.amountColumn\}>CNY 合计<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.amountColumn\}>USD 合计<\/th>/);
  assert.match(costsModule, /function CostOrderItemsTable/);
  assert.match(costsModule, /<th>详情<\/th>/);
  assert.match(costsModule, /<PaginationBar total=\{total\} page=\{page\} totalPages=\{totalPages\} loading=\{loading\} onPage=\{gotoPage\} \/>/);
});

test("cost payable summaries keep original currency totals separate from CNY analysis totals", () => {
  assert.match(costsModule, /应付汇总/);
  assert.match(costsModule, /人民币实际应付/);
  assert.match(costsModule, /折人民币应付总额/);
  assert.match(costsModule, /CurrencyTotalsDisplay/);
  assert.match(costsQueries, /summary: summarizeCurrencyTotals/);
  assert.match(costsShared, /currencyTotals/);
});

test("cost order summary separates factory logistics and other cost totals", () => {
  assert.match(costsShared, /export function costSummaryCategory/);
  assert.match(costsShared, /FACTORY_SUMMARY_COST_TYPES = \[\.\.\.FACTORY_SUPPLIER_COST_TYPES, "样品费"\]/);
  assert.match(costsShared, /LOGISTICS_SUMMARY_COST_TYPES = \[/);
  assert.match(costsShared, /hasInvalidFactoryCurrency/);
  assert.match(costsShared, /cost-summary-invalid-factory-currency/);
  assert.match(costsShared, /const summaryCosts = summaryDisplayCosts\(costs\)/);
  assert.match(costsShared, /const currencyTotals = summarizeCurrencyTotals\(summaryCosts\)/);
  assert.match(costsShared, /costConfirmProgress: costConfirmedProgress\(summaryCosts\)/);
  assert.match(costsShared, /costs: summaryCosts\.map\(safeSerializeCost\)/);
  assert.match(costsShared, /totalCostCny = Number\(\(factoryTotals\.totalCny \+ logisticsTotals\.totalCny \+ otherTotals\.totalCny\)\.toFixed\(2\)\)/);
  assert.match(costsShared, /costBreakdown:\s*\{[\s\S]*factory: factoryTotals[\s\S]*logistics: logisticsTotals[\s\S]*other: otherTotals/);
  assert.match(costsModule, /COST_BREAKDOWN_ROWS/);
  assert.match(costsModule, /Factory Cost/);
  assert.match(costsModule, /Logistics Cost/);
  assert.match(costsModule, /Other Cost/);
  assert.match(costsModule, /function CostOrderAmountCell/);
  assert.match(costsModule, /function CostBreakdownTable/);
  assert.doesNotMatch(costsModule, /label="港杂成本"/);
});

test("factory cost labels stay on one line in cost summary UI", () => {
  assert.match(costsModule, /className=\{styles\.costBreakdownLabelText\}>\{row\.cnLabel\}/);
  assert.match(workspaceStyles, /\.costBreakdownLabelText\s*\{[\s\S]*white-space: nowrap/);
  assert.match(workspaceStyles, /\.costBreakdownLabelText\s*\{[\s\S]*word-break: keep-all/);
  assert.match(workspaceStyles, /\.costBreakdownLabelText\s*\{[\s\S]*overflow-wrap: normal/);
  assert.match(workspaceStyles, /\.costBreakdownLabelText\s*\{[\s\S]*display: inline-flex/);
});

test("cost order summary keeps cost items inside shipment detail drawer", () => {
  assert.match(costsModule, /void loadCosts\(1, nextFilters, archiveScope, "orders"\)/);
  assert.match(costsShared, /costs: summaryCosts\.map\(safeSerializeCost\)/);
  assert.match(costsModule, /<CostOrderItemsTable costs=\{order\.costs \|\| \[\]\} \/>/);
  assert.match(costsModule, /formatCurrencyAmount\(cost\.currency \|\| "CNY", cost\.amount \?\? cost\.amountCny \?\? 0\)/);
  assert.doesNotMatch(costsModule, /\{ \.\.\.emptyCostFilters, orderNo:/);
  assert.doesNotMatch(costsModule, /setCostView\("details"\)/);
});

test("cost create and edit interactions use right side drawers instead of inline panels", () => {
  assert.match(costsModule, /type CostFormDrawerState = \{/);
  assert.match(costsModule, /function CostFormDrawer\(/);
  assert.match(costsModule, /<SideDetailDrawer[\s\S]*ariaLabel=\{editMode \? "编辑成本" : "登记成本"\}/);
  assert.match(costsModule, /<QuickCreateCostPanel[\s\S]*drawerMode/);
  assert.match(costsModule, /onClick=\{openCreateCostDrawer\}/);
  assert.match(costsModule, /onEdit=\{\(\) => openEditCostDrawer\(detailCost\)\}/);
  assert.doesNotMatch(costsModule, /createOpen/);
  assert.doesNotMatch(costsModule, /editCost/);
  assert.doesNotMatch(costsModule, /收起登记/);
});

test("cost detail drawer is tabbed and edit refreshes the current row", () => {
  assert.match(costsModule, /import \{[^}]*UiTabs/);
  assert.match(costsModule, /label: "基本信息"/);
  assert.match(costsModule, /label: "付款信息"/);
  assert.match(costsModule, /label: "发票信息"/);
  assert.match(costsModule, /label: "操作记录"/);
  assert.match(costsModule, /await fetchCostDetail\(savedDrawer\.cost\.id\)/);
  assert.match(costsModule, /await loadCosts\(page, submittedFilters, archiveScope, costView\)/);
  assert.doesNotMatch(costsModule, /void loadCosts\(1, submittedFilters, archiveScope, costView\)/);
});
