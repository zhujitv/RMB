import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const components = readFileSync("app/components.tsx", "utf8");
const workspaceStyles = readFileSync("app/WorkspaceShell.module.css", "utf8");
const ordersModule = readFileSync("app/modules/OrdersModule.tsx", "utf8");
const paymentsModule = readFileSync("app/modules/PaymentsModule.tsx", "utf8");
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const profitModule = readFileSync("app/modules/ProfitModule.tsx", "utf8");
const logisticsFeesModule = readFileSync("app/modules/LogisticsFeesModule.tsx", "utf8");

test("money amount component renders foreign currency on two lines and CNY on one line", () => {
  assert.match(components, /export function MoneyAmount/);
  assert.match(components, /normalizedCurrency !== "CNY"/);
  assert.match(components, /<div className=\{styles\.currencyAmount\}>\{prefix\}\{normalizedCurrency\}：\{formatCurrencyAmount\(normalizedCurrency, primaryAmount\)\}<\/div>/);
  assert.match(components, /<div className=\{styles\.cnyAmount\}>≈ \{formatCny\(cnyAmount\)\}<\/div>/);
  assert.match(components, /styles\.amountCellSingle/);
  assert.match(components, /CurrencyTotalsDisplay/);
});

test("amount table styles use fixed readable widths and numeric alignment", () => {
  assert.match(workspaceStyles, /\.dataTable th\.orderNoColumn,[\s\S]*width: 180px/);
  assert.match(workspaceStyles, /\.dataTable th\.customerColumn,[\s\S]*width: 140px/);
  assert.match(workspaceStyles, /\.dataTable th\.blNoColumn,[\s\S]*width: 180px/);
  assert.match(workspaceStyles, /\.dataTable th\.amountColumn,[\s\S]*width: 160px/);
  assert.match(workspaceStyles, /\.dataTable th\.amountColumn,[\s\S]*text-align: right/);
  assert.match(workspaceStyles, /\.currencyAmount[\s\S]*font-size: 14px[\s\S]*font-weight: 600/);
  assert.match(workspaceStyles, /\.cnyAmount[\s\S]*color: #94a3b8[\s\S]*font-size: 12px/);
  assert.match(workspaceStyles, /line-height: 1\.3/);
});

test("business tables use compact money amount cells instead of long money text", () => {
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{order\.finalReceivableAmount\} amountCny=\{order\.finalReceivableAmountCny\}/);
  assert.match(paymentsModule, /<MoneyAmount currency=\{payment\.currency\} amount=\{payment\.amount\} amountCny=\{payment\.amountCny\}/);
  assert.match(costsModule, /<MoneyAmount currency=\{cost\.currency\} amount=\{cost\.amount\} amountCny=\{cost\.amountCny\}/);
  assert.match(profitModule, /<MoneyAmount amountCny=\{summary\.expectedGrossProfit\}/);
  assert.match(logisticsFeesModule, /formatCnyAccounting\(expense\.amountCny \|\| 0\)/);

  for (const source of [ordersModule, paymentsModule, costsModule, logisticsFeesModule]) {
    assert.doesNotMatch(source, /<td>\{moneyText\(/);
  }
});
