import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sortReceivableRowsByShipmentDate } from "../lib/platform/order-receivable-sort.ts";

const ordersModule = readFileSync("app/modules/OrdersModule.tsx", "utf8");
const ordersService = readFileSync("lib/platform/orders-module.ts", "utf8");
const orderSerialization = readFileSync("lib/platform/shared-order-serialization-impl.ts", "utf8");
const inputSchemas = readFileSync("lib/platform/input-schemas.ts", "utf8");
const prismaSchema = readFileSync("prisma/schema.prisma", "utf8");

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

test("orders api sorts receivable orders by shipment date", () => {
  const sorted = sortReceivableRowsByShipmentDate([
    { orderNo: "PV260", actualShipmentDate: "2026-06-03", expectedShipmentDate: "2026-06-01", createdAt: "2026-06-20T00:00:00.000Z" },
    { orderNo: "MG40", expectedShipmentDate: "2026-06-12", createdAt: "2026-06-19T00:00:00.000Z" },
    { orderNo: "PV263", actualShipmentDate: "2026-06-18", createdAt: "2026-06-18T00:00:00.000Z" },
    { orderNo: "PV252", blDate: "2026-06-08", createdAt: "2026-06-17T00:00:00.000Z" },
    { orderNo: "DM22 23", createdAt: "2026-06-16T00:00:00.000Z" },
  ]);

  assert.deepEqual(sorted.map((row) => row.orderNo), ["PV263", "MG40", "PV252", "PV260", "DM22 23"]);
  assert.match(ordersService, /sortReceivableRowsByShipmentDate/);
  assert.match(ordersService, /pageResult\(sortedRows\.slice\(start, start \+ pageSize\), sortedRows\.length, page, pageSize\)/);
});

test("orders create form submits system exchange rate metadata", () => {
  assert.match(ordersModule, /exchangeRateDate: string;/);
  assert.match(ordersModule, /exchangeRateSource: string;/);
  assert.match(ordersModule, /exchangeRateType: string;/);
  assert.match(ordersModule, /exchangeRateDate: result\.rate\?\.rateDate \|\| ""/);
  assert.match(ordersModule, /exchangeRateSource: result\.rate\?\.source \|\| ""/);
  assert.match(ordersModule, /exchangeRateType: result\.rate\?\.rateType \|\| ""/);
  assert.match(ordersModule, /exchangeRateDate: form\.exchangeRateDate \|\| undefined/);
  assert.match(ordersModule, /exchangeRateSource: form\.exchangeRateSource \|\| undefined/);
  assert.match(ordersModule, /exchangeRateType: form\.exchangeRateType \|\| undefined/);
  assert.match(ordersModule, /exchangeRateSource: "手动"/);
});

test("orders create form supports actual shipment date", () => {
  assert.match(prismaSchema, /actualShipmentDate\s+DateTime\?\s+@map\("actual_shipment_date"\) @db\.Date/);
  assert.match(inputSchemas, /actualShipmentDate: \{ label: "实际发货日期", kind: "date" \}/);
  assert.match(ordersService, /const actualShipmentDate = dateFromInput\(input\.actualShipmentDate\)/);
  assert.match(ordersService, /actualShipmentDate,/);
  assert.match(orderSerialization, /actualShipmentDate: dateToInput\(order\.actualShipmentDate\)/);
  assert.match(ordersModule, /actualShipmentDate\?: string;/);
  assert.match(ordersModule, /actualShipmentDate: form\.actualShipmentDate \|\| undefined/);
  assert.match(ordersModule, /实际发货日期/);
  assert.match(ordersModule, /<DetailField label="实际发货" value=\{order\.actualShipmentDate \|\| "-"\} \/>/);
});
