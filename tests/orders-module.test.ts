import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sortReceivableRowsByPaymentPriority } from "../lib/platform/order-receivable-sort.ts";

const ordersModule = readFileSync("app/modules/OrdersModule.tsx", "utf8");
const ordersService = readFileSync("lib/platform/orders-module.ts", "utf8");

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

test("orders api sorts unpaid orders before overpaid and fully paid orders", () => {
  const sorted = sortReceivableRowsByPaymentPriority([
    { orderNo: "PV260", summary: { balanceCny: 0 }, createdAt: "2026-06-20T00:00:00.000Z" },
    { orderNo: "MG40", summary: { balanceCny: -50 }, createdAt: "2026-06-19T00:00:00.000Z" },
    { orderNo: "PV263", summary: { balanceCny: 300 }, createdAt: "2026-06-18T00:00:00.000Z" },
    { orderNo: "PV252", summary: { balanceCny: 900 }, createdAt: "2026-06-17T00:00:00.000Z" },
    { orderNo: "DM22 23", summary: { balanceCny: 1200 }, createdAt: "2026-06-16T00:00:00.000Z" },
  ]);

  assert.deepEqual(sorted.map((row) => row.orderNo), ["DM22 23", "PV252", "PV263", "MG40", "PV260"]);
  assert.match(ordersService, /sortReceivableRowsByPaymentPriority/);
  assert.match(ordersService, /pageResult\(sortedRows\.slice\(start, start \+ pageSize\), sortedRows\.length, page, pageSize\)/);
});
