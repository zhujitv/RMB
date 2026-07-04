import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sortReceivableRowsByShipmentDate } from "../lib/platform/order-receivable-sort.ts";

const ordersModule = [
  "app/modules/OrdersModule.tsx",
  "app/modules/orders/model.ts",
  "app/modules/orders/quick-order-panel.tsx",
  "app/modules/orders/quick-order-panel-controller.ts",
  "app/modules/orders/table.tsx",
  "app/modules/orders/detail-drawer.tsx",
  "app/modules/orders/utils.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const ordersService = readFileSync("lib/platform/orders-module.ts", "utf8");
const ordersPaymentsService = readFileSync("lib/platform/orders-payments.ts", "utf8");
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
  assert.match(ordersModule, /应收汇总/);
  assert.match(ordersModule, /人民币实际应收/);
  assert.match(ordersModule, /CurrencyTotalsDisplay/);
  assert.match(ordersService, /summary: summarizeCurrencyTotals/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{order\.finalReceivableAmount\} amountCny=\{order\.finalReceivableAmountCny\}/);
  assert.match(ordersModule, /const receivedAmount = Number\(order\.summary\?\.arrivedPaymentsAmount \?\? order\.summary\?\.confirmedPaymentsAmount/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{receivedAmount\} amountCny=\{receivedCny\}/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{displayedBalanceAmount\} amountCny=\{displayedBalanceCny\}/);
  assert.doesNotMatch(ordersModule, /function moneyCell/);
  assert.match(ordersModule, /<PaginationBar total=\{total\} page=\{page\} totalPages=\{totalPages\} onPage=\{gotoPage\} \/>/);
});

test("orders api sorts receivable orders by shipment date", () => {
  const sorted = sortReceivableRowsByShipmentDate([
    { orderNo: "PV260", actualShipmentDate: "2026-06-03", createdAt: "2026-06-20T00:00:00.000Z" },
    { orderNo: "MG40", blDate: "2026-06-12", createdAt: "2026-06-19T00:00:00.000Z" },
    { orderNo: "PV263", actualShipmentDate: "2026-06-18", createdAt: "2026-06-18T00:00:00.000Z" },
    { orderNo: "PV252", blDate: "2026-06-08", createdAt: "2026-06-17T00:00:00.000Z" },
    { orderNo: "DM22 23", createdAt: "2026-06-16T00:00:00.000Z" },
  ]);

  assert.deepEqual(sorted.map((row) => row.orderNo), ["PV263", "MG40", "PV252", "PV260", "DM22 23"]);
  assert.match(ordersService, /sortReceivableRowsByShipmentDate/);
  assert.match(ordersService, /pageParams\(query, 20, 20\)/);
  assert.match(ordersService, /skip: \(page - 1\) \* pageSize/);
  assert.match(ordersService, /take: pageSize/);
  assert.doesNotMatch(ordersService, /sortedRows\.slice\(start, start \+ pageSize\)/);
});

test("orders module keeps legacy order service exports after split", () => {
  assert.match(ordersService, /export \{ searchReceivableOrders \} from "\.\/order-receivable-search"/);
  assert.match(ordersService, /export \{ repairMissingOrderSalespeople \} from "\.\/order-salesperson-repair"/);
  assert.match(ordersPaymentsService, /export \* from "\.\/orders-module"/);
  assert.doesNotMatch(ordersPaymentsService, /export \* from "\.\/order-receivable-search"/);
  assert.doesNotMatch(ordersPaymentsService, /export \* from "\.\/order-salesperson-repair"/);
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

test("order detail edit switches from drawer to edit form without silent failure", () => {
  assert.match(ordersModule, /const editPanelRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(ordersModule, /function openEditOrder\(order: OrderRow \| null, options: \{ returnToDetail\?: boolean \} = \{\}\)/);
  assert.match(ordersModule, /setError\("权限不足，不能编辑"\)/);
  assert.match(ordersModule, /setError\("数据加载失败，不能编辑"\)/);
  assert.match(ordersModule, /setReturnDetailOrder\(options\.returnToDetail \? order : null\)/);
  assert.match(ordersModule, /setDetailOrder\(null\);[\s\S]*scrollToEditPanel\(\)/);
  assert.match(ordersModule, /onEdit=\{\(\) => openEditOrder\(detailOrder, \{ returnToDetail: true \}\)\}/);
  assert.match(ordersModule, /if \(detailToRestore\) setDetailOrder\(detailToRestore\)/);
  assert.match(ordersModule, /nextRows\.find\(\(order\) => order\.id === savedOrder\.id\) \|\| detailToRestore/);
});

test("orders create form supports actual shipment date", () => {
  assert.match(prismaSchema, /actualShipmentDate\s+DateTime\?\s+@map\("actual_shipment_date"\) @db\.Date/);
  assert.match(inputSchemas, /actualShipmentDate: \{ label: "发货时间", kind: "date" \}/);
  assert.match(ordersService, /const actualShipmentDate = dateFromInput\(input(?:Data)?\.actualShipmentDate\)/);
  assert.match(ordersService, /actualShipmentDate,/);
  assert.match(orderSerialization, /actualShipmentDate: dateToInput\(order\.actualShipmentDate\)/);
  assert.match(ordersModule, /actualShipmentDate\?: string;/);
  assert.match(ordersModule, /actualShipmentDate: form\.actualShipmentDate \|\| undefined/);
  assert.match(ordersModule, /发货时间/);
  assert.match(ordersModule, /<DetailField label="发货时间" value=\{order\.actualShipmentDate \|\| "-"\} \/>/);
  assert.doesNotMatch(ordersModule, /预计发货日期/);
  assert.doesNotMatch(ordersModule, /expectedShipmentDate: form\.expectedShipmentDate/);
  assert.doesNotMatch(ordersModule, /form\.expectedShipmentDate/);
  assert.doesNotMatch(ordersModule, /<DetailField label="预计发货"/);
  assert.doesNotMatch(inputSchemas, /expectedShipmentDate/);
  assert.doesNotMatch(inputSchemas, /预计发货日期/);
});
