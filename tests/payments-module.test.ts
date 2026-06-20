import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paymentsModule = readFileSync("app/modules/PaymentsModule.tsx", "utf8");
const paymentsService = readFileSync("lib/platform/payments-module.ts", "utf8");
const ordersService = readFileSync("lib/platform/orders-module.ts", "utf8");

test("payments page keeps summary cards and avoids duplicate recent payment list", () => {
  assert.match(paymentsModule, /已到账金额/);
  assert.match(paymentsModule, /待确认金额/);
  assert.match(paymentsModule, /本月收款笔数/);
  assert.doesNotMatch(paymentsModule, /最近收款/);
});

test("payments API returns paginated summary metrics", () => {
  assert.match(paymentsService, /arrivedAmountCny/);
  assert.match(paymentsService, /pendingAmountCny/);
  assert.match(paymentsService, /currentMonthCount/);
  assert.match(paymentsService, /withPaymentWhere/);
});

test("payment order search supports receivable summaries without runtime permission reference errors", () => {
  assert.match(ordersService, /canWrite,/);
  assert.match(ordersService, /serializeReceivableSearchOrder/);
  assert.match(ordersService, /receivableOrderCanAcceptPayment/);
  assert.match(ordersService, /purpose === "payment"/);
  assert.match(paymentsModule, /purpose: "payment"/);
  assert.match(ordersService, /receivedAmountCny/);
  assert.match(ordersService, /outstandingCny/);
  assert.match(paymentsModule, /未找到应收订单/);
  assert.match(paymentsModule, /搜索应收订单失败/);
});
