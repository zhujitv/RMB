import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");

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

test("cost order summary switches to detail table through keyword filter", () => {
  assert.match(costsModule, /const nextFilters = \{ \.\.\.emptyCostFilters, keyword: order\.orderNo \|\| "" \}/);
  assert.match(costsModule, /const nextFilters = \{ \.\.\.emptyCostFilters, keyword: detailOrderSummary\.orderNo \|\| "" \}/);
  assert.doesNotMatch(costsModule, /\{ \.\.\.emptyCostFilters, orderNo:/);
});
