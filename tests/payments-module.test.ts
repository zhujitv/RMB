import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readOrdersServiceSource,
  readPaymentsModuleSource,
  readSharedConstantsSource,
  readSharedSerializationSource,
} from "./source-helpers.ts";

const paymentsModule = readPaymentsModuleSource();
const paymentsService = readFileSync("lib/platform/payments-module.ts", "utf8");
const ordersService = readOrdersServiceSource();
const orderAccess = readFileSync("lib/platform/order-access.ts", "utf8");
const sharedConstants = readSharedConstantsSource();
const sharedSerialization = readSharedSerializationSource();
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("payments page keeps summary cards and avoids duplicate recent payment list", () => {
  assert.match(paymentsModule, /已到账金额/);
  assert.match(paymentsModule, /待确认金额/);
  assert.match(paymentsModule, /本月收款笔数/);
  assert.doesNotMatch(paymentsModule, /最近收款/);
  assert.doesNotMatch(paymentsModule, /PaymentMobileCard/);
  assert.doesNotMatch(paymentsModule, /mobileDataCard/);
  assert.doesNotMatch(paymentsModule, /mobileCardList/);
});

test("payments API returns paginated summary metrics", () => {
  assert.match(paymentsService, /arrivedAmountCny/);
  assert.match(paymentsService, /pendingAmountCny/);
  assert.match(paymentsService, /arrivedCurrencyTotals/);
  assert.match(paymentsService, /pendingCurrencyTotals/);
  assert.match(paymentsService, /summarizeCurrencyTotals/);
  assert.match(paymentsService, /currentMonthCount/);
  assert.match(paymentsService, /withPaymentWhere/);
});

test("payment registration keeps receipt currency aligned with the receivable order currency", () => {
  assert.match(paymentsModule, /currencyLocked/);
  assert.match(paymentsModule, /disabled=\{currencyLocked\}/);
  assert.match(paymentsModule, /收款币种必须与订单币种一致/);
  assert.match(paymentsService, /PAYMENT_CURRENCY_MISMATCH/);
  assert.match(paymentsService, /requestedCurrency !== orderCurrency/);
});

test("payment updates verify access to the original payment order before mutation", () => {
  assert.match(paymentsService, /const before = id \? await prisma\.payment\.findFirst\(\{\s*where: \{ id, deletedAt: null \},\s*include: \{\s*order: \{/);
  assert.match(paymentsService, /if \(before && !canAccessOrder\(actor, before\.order\)\) \{\s*throw permissionError\("无权限更新该收款记录"\)/);
  assert.match(paymentsService, /const order = await assertOrderOpen\(requireText\(inputData\.orderId, "关联订单"\), actor\)/);
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

test("payments list uses backend keyword fuzzy search and keeps detail-only expanded information", () => {
  assert.match(paymentsModule, /type PaymentFilters = \{\s*keyword: string;/);
  assert.match(paymentsModule, /value=\{filters\.keyword\}/);
  assert.match(paymentsModule, /setFilter\("keyword"/);
  assert.match(paymentsModule, /placeholder="搜索订单号 \/ 客户简称 \/ 客户全称 \/ 备注"/);
  assert.match(paymentsModule, /window\.setTimeout\(\(\) => \{/);
  assert.match(paymentsModule, /}, 300\)/);
  assert.match(paymentsService, /const keyword = nonEmpty\(query\?\.get\("keyword"\)\)/);
  assert.match(paymentsService, /bankReference: \{ contains: keyword/);
  assert.match(paymentsService, /remark: \{ contains: keyword/);
  assert.match(paymentsService, /paymentType: \{ contains: keyword/);
  assert.match(paymentsService, /orderNo: \{ contains: keyword/);
  assert.match(paymentsService, /customerNameSnapshot: \{ contains: keyword/);
  assert.match(paymentsService, /shortName: \{ contains: keyword/);
  assert.match(paymentsService, /name: \{ contains: keyword/);
  assert.doesNotMatch(paymentsService, /receiptNo: \{ contains: keyword/);
  assert.doesNotMatch(paymentsService, /voucherNo: \{ contains: keyword/);
  assert.match(paymentsModule, /<DetailField label="订单号"/);
  assert.match(paymentsModule, /<DetailField label="创建时间"/);
  assert.match(paymentsModule, /<DetailField label="更新时间"/);
});

test("payment types support phased receipts without defaulting to final payment", () => {
  assert.match(sharedConstants, /PAYMENT_TYPES = \["预付款", "中期款", "分批款", "尾款", "补差款", "退款", "其他"\]/);
  assert.match(paymentsModule, /const PAYMENT_TYPES = \["预付款", "中期款", "分批款", "尾款", "补差款", "退款", "其他"\]/);
  assert.match(paymentsModule, /paymentType: ""/);
  assert.match(paymentsModule, /<option value="">请选择收款类型<\/option>/);
  assert.match(paymentsService, /paymentType: PAYMENT_TYPES\.includes\(String\(inputData\.paymentType \|\| ""\)\) \? String\(inputData\.paymentType\) : ""/);
  assert.match(sharedSerialization, /paymentType: payment\.paymentType \|\| ""/);
  assert.match(schema, /paymentType\s+String\s+@default\(""\)\s+@map\("payment_type"\)/);
  assert.doesNotMatch(paymentsModule, /paymentType: "尾款"/);
  assert.doesNotMatch(paymentsService, /: "尾款"/);
});

test("payments list exposes payment type filter and row display", () => {
  assert.match(paymentsModule, /paymentType: string;/);
  assert.match(paymentsModule, /params\.set\(key, text\)/);
  assert.match(paymentsModule, /全部收款类型/);
  assert.match(paymentsModule, /setFilter\("paymentType"/);
  assert.match(paymentsModule, /<th>收款类型<\/th>/);
  assert.match(paymentsModule, /<td>\{payment\.paymentType \|\| "-"\}<\/td>/);
  assert.match(paymentsService, /paymentType: nonEmpty\(query\?\.get\("paymentType"\)\)/);
  assert.match(paymentsService, /if \(filters\.paymentType\) clauses\.push\(\{ paymentType: filters\.paymentType \}\)/);
});

test("payment completion is based on arrived amount, not payment type", () => {
  assert.match(ordersService, /if \(Number\(summary\.overpaidCny \|\| 0\) > 0\) status = "多收款"/);
  assert.match(ordersService, /else if \(Number\(summary\.outstandingCny \|\| 0\) <= 0\) status = "已收齐"/);
  assert.match(ordersService, /else if \(Number\(summary\.confirmedPaymentsCny \|\| 0\) > 0\) status = "部分收款"/);
  assert.match(orderAccess, /throw codedError\("已关闭或已取消订单不能新增收款"/);
  assert.doesNotMatch(orderAccess, /ORDER_FULLY_PAID/);
  assert.doesNotMatch(orderAccess, /订单已收齐，不能新增收款/);
  assert.match(ordersService, /return !\["已关闭", "已取消"\]\.includes\(order\.status\)/);
});
