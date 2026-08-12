import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { Prisma } from "../lib/generated/prisma/client.js";

const jiti = createJiti(import.meta.url);
const {
  amountCnyDecimal,
  normalizeInstallments,
  requirePositiveDecimal,
} = jiti("../lib/platform/shared-base-input.ts") as typeof import("../lib/platform/shared-base-input.ts");

const orderMutationHelpers = readFileSync("lib/platform/orders-module-mutation-helpers.ts", "utf8");

test("order amounts preserve the Decimal(18, 2) upper boundary without Number coercion", () => {
  const amount = requirePositiveDecimal("9999999999999999.99", "预计应收金额", 2);

  assert.ok(Prisma.Decimal.isDecimal(amount));
  assert.equal(amount.toFixed(2), "9999999999999999.99");
});

test("CNY conversion keeps a large amount exact with a six-decimal exchange rate", () => {
  const converted = amountCnyDecimal("99999999999999.99", "7.234567");

  assert.ok(Prisma.Decimal.isDecimal(converted));
  assert.equal(converted.toFixed(2), "723456699999999.93");
});

test("order money rounds half up at two decimal places", () => {
  assert.equal(requirePositiveDecimal("2.675", "预计应收金额", 2).toFixed(2), "2.68");
  assert.equal(amountCnyDecimal("1.005", "1").toFixed(2), "1.01");
  assert.equal(amountCnyDecimal("1.004", "1").toFixed(2), "1.00");
});

test("installment calculations use Decimal internally but keep JSON number fields", () => {
  const installments = normalizeInstallments(
    [
      { ratio: "33.33", condition: "首款" },
      { ratio: "66.67", condition: "尾款" },
    ],
    new Prisma.Decimal("100.05"),
    "7.234567",
  );

  assert.deepEqual(installments.map((item) => item.amount), [33.35, 66.7]);
  assert.deepEqual(installments.map((item) => item.amountCny), [241.27, 482.55]);
  assert.equal(typeof installments[0]?.amount, "number");
  assert.equal(typeof installments[0]?.amountCny, "number");
});

test("receivable-order writes use Decimal parsing and conversion helpers", () => {
  const resolveAmountsStart = orderMutationHelpers.indexOf("export function resolveOrderAmounts");
  const resolveAmountsEnd = orderMutationHelpers.indexOf("export function resolveOrderPaymentDates", resolveAmountsStart);
  const resolveAmounts = orderMutationHelpers.slice(resolveAmountsStart, resolveAmountsEnd);
  const buildDataStart = orderMutationHelpers.indexOf("export function buildReceivableOrderData");
  const buildDataEnd = orderMutationHelpers.indexOf("export async function maybeSyncOrderLogisticsSuppliersInTransaction", buildDataStart);
  const buildData = orderMutationHelpers.slice(buildDataStart, buildDataEnd);

  assert.match(resolveAmounts, /requirePositiveDecimal/);
  assert.doesNotMatch(resolveAmounts, /requirePositive\(/);
  assert.match(buildData, /new Prisma\.Decimal\(String\(exchange\.exchangeRate\)\)/);
  assert.match(buildData, /amountCnyDecimal/);
  assert.doesNotMatch(buildData, /\bamountCny\(/);
});
