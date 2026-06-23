import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const costsQueries = readFileSync("lib/platform/cost-records-queries.ts", "utf8");
const costsShared = readFileSync("lib/platform/cost-records-shared.ts", "utf8");

test("costs page renders only the table list and not duplicate cost cards", () => {
  assert.doesNotMatch(costsModule, /CostMobileCard/);
  assert.doesNotMatch(costsModule, /CostOrderMobileCard/);
  assert.doesNotMatch(costsModule, /mobileCardList/);
  assert.doesNotMatch(costsModule, /desktopOnly/);
  assert.match(costsModule, /<th className=\{styles\.orderNoColumn\}>订单号<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.customerColumn\}>客户简称<\/th>/);
  assert.match(costsModule, /<th>成本类型<\/th>/);
  assert.match(costsModule, /<th>供应商<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.amountColumn\}>成本金额<\/th>/);
  assert.match(costsModule, /<th>付款状态<\/th>/);
  assert.match(costsModule, /<th>发票状态<\/th>/);
  assert.match(costsModule, /<th>详情<\/th>/);
  assert.match(costsModule, /<MoneyAmount currency=\{cost\.currency\} amount=\{cost\.amount\} amountCny=\{cost\.amountCny\}/);
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

test("cost order summary switches to detail table through keyword filter", () => {
  assert.match(costsModule, /const nextFilters = \{ \.\.\.emptyCostFilters, keyword: order\.orderNo \|\| "" \}/);
  assert.match(costsModule, /const nextFilters = \{ \.\.\.emptyCostFilters, keyword: detailOrderSummary\.orderNo \|\| "" \}/);
  assert.doesNotMatch(costsModule, /\{ \.\.\.emptyCostFilters, orderNo:/);
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
