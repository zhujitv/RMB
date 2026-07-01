import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCostsModuleSource } from "./source-helpers.ts";
import test from "node:test";
import { readWorkspaceStylesSource } from "./source-helpers.ts";

const components = readFileSync("app/components.tsx", "utf8");
const workspaceStyles = readWorkspaceStylesSource();
const ordersModule = [
  "app/modules/OrdersModule.tsx",
  "app/modules/orders/model.ts",
  "app/modules/orders/quick-order-panel.tsx",
  "app/modules/orders/table.tsx",
  "app/modules/orders/detail-drawer.tsx",
  "app/modules/orders/utils.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const paymentsModule = readFileSync("app/modules/PaymentsModule.tsx", "utf8");
const costsModule = readCostsModuleSource();
const profitModule = readFileSync("app/modules/ProfitModule.tsx", "utf8");
const logisticsFeesModule = [
  "app/modules/LogisticsFeesModule.tsx",
  "app/modules/logistics-fees/details-drawer.tsx",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

test("money amount component renders foreign currency on two lines and CNY on one line", () => {
  assert.match(components, /export function MoneyAmount/);
  assert.match(components, /normalizedCurrency !== "CNY"/);
  assert.match(
    components,
    /<div className=\{styles\.currencyAmount\}>\{prefix\}\{normalizedCurrency\}：\{formatCurrencyAmount\(normalizedCurrency, primaryAmount\)\}<\/div>/,
  );
  assert.match(
    components,
    /<div className=\{styles\.cnyAmount\}>≈ \{formatCny\(cnyAmount\)\}<\/div>/,
  );
  assert.match(components, /styles\.amountCellSingle/);
  assert.match(components, /CurrencyTotalsDisplay/);
});

test("amount table styles use fixed readable widths and numeric alignment", () => {
  assert.match(
    workspaceStyles,
    /\.dataTable th\.orderNoColumn,[\s\S]*width: 180px/,
  );
  assert.match(
    workspaceStyles,
    /\.dataTable th\.customerColumn,[\s\S]*width: 140px/,
  );
  assert.match(
    workspaceStyles,
    /\.dataTable th\.blNoColumn,[\s\S]*width: 180px/,
  );
  assert.match(
    workspaceStyles,
    /\.dataTable th\.amountColumn,[\s\S]*width: 160px/,
  );
  assert.match(
    workspaceStyles,
    /\.dataTable th\.amountColumn,[\s\S]*text-align: right/,
  );
  assert.match(
    workspaceStyles,
    /\.currencyAmount[\s\S]*font-size: 14px[\s\S]*font-weight: 600/,
  );
  assert.match(
    workspaceStyles,
    /\.cnyAmount[\s\S]*color: #94a3b8[\s\S]*font-size: 12px/,
  );
  assert.match(workspaceStyles, /line-height: 1\.3/);
});

test("business tables use compact money amount cells instead of long money text", () => {
  assert.match(
    ordersModule,
    /<MoneyAmount currency=\{order\.currency\} amount=\{order\.finalReceivableAmount\} amountCny=\{order\.finalReceivableAmountCny\}/,
  );
  assert.match(
    paymentsModule,
    /<MoneyAmount currency=\{payment\.currency\} amount=\{payment\.amount\} amountCny=\{payment\.amountCny\}/,
  );
  assert.match(
    costsModule,
    /<MoneyAmount currency=\{cost\.currency\} amount=\{cost\.amount\} amountCny=\{cost\.amountCny\}/,
  );
  assert.match(
    profitModule,
    /<MoneyAmount amountCny=\{summary\.expectedGrossProfit\}/,
  );
  assert.match(
    logisticsFeesModule,
    /formatOriginalCurrencyAccounting\(\s*originalCurrency,\s*originalAmount,?\s*\)/,
  );
  assert.doesNotMatch(
    logisticsFeesModule,
    /<th className=\{styles\.numericCell\}>折人民币<\/th>/,
  );

  for (const source of [
    ordersModule,
    paymentsModule,
    costsModule,
    logisticsFeesModule,
  ]) {
    assert.doesNotMatch(source, /<td>\{moneyText\(/);
  }
});
