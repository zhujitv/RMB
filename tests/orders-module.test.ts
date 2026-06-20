import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ordersModule = readFileSync("app/modules/OrdersModule.tsx", "utf8");

test("orders page renders only the table list and not duplicate order cards", () => {
  assert.doesNotMatch(ordersModule, /OrderMobileCard/);
  assert.doesNotMatch(ordersModule, /mobileCardList/);
  assert.doesNotMatch(ordersModule, /mobileDataCard/);
  assert.doesNotMatch(ordersModule, /desktopOnly/);
  assert.match(ordersModule, /<th className=\{styles\.orderNoColumn\}>订单号<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.customerColumn\}>客户简称<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.blNoColumn\}>提单号<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.amountColumn\}>最终应收<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.amountColumn\}>已收<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.amountColumn\}>未收<\/th>/);
  assert.match(ordersModule, /<th>状态<\/th>/);
  assert.match(ordersModule, /<th>详情<\/th>/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{order\.finalReceivableAmount\} amountCny=\{order\.finalReceivableAmountCny\}/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{orderCurrencyAmount\(order, receivedCny\)\} amountCny=\{receivedCny\}/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{displayedBalanceAmount\} amountCny=\{displayedBalanceCny\}/);
  assert.doesNotMatch(ordersModule, /function moneyCell/);
  assert.match(ordersModule, /<PaginationBar total=\{total\} page=\{page\} totalPages=\{totalPages\} onPage=\{gotoPage\} \/>/);
});
