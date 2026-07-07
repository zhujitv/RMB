import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readOrdersServiceSource,
  readPaymentsModuleSource,
  readPaymentsServiceSource,
  readSharedConstantsSource,
  readSharedSerializationSource,
} from "./source-helpers.ts";

const paymentsModule = readPaymentsModuleSource();
const paymentsService = readPaymentsServiceSource();
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

test("quick payment registration validates required fields before submit", () => {
  assert.match(paymentsModule, /type PaymentFieldErrors = Partial<Record<keyof QuickPaymentForm, string>>/);
  assert.match(paymentsModule, /FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE = "该订单尚无历史收款，不能登记尾款，请选择预付款、分批款或全款。"/);
  assert.match(paymentsModule, /function validateQuickPaymentForm/);
  assert.match(paymentsModule, /errors\.orderId = "请选择关联订单"/);
  assert.match(paymentsModule, /errors\.paymentDate = "请选择收款日期"/);
  assert.match(paymentsModule, /errors\.paymentType = "请选择收款类型"/);
  assert.match(paymentsModule, /nextForm\.paymentType === "尾款"[\s\S]*orderReceivedCny\(selectedOrder\) <= 0[\s\S]*errors\.paymentType = FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE/);
  assert.match(paymentsModule, /errors\.amount = "请输入收款金额"/);
  assert.match(paymentsModule, /errors\.amount = "收款金额必须大于 0"/);
  assert.match(paymentsModule, /errors\.exchangeRate = "汇率不能为空"/);
  assert.match(paymentsModule, /errors\.exchangeRate = "汇率必须大于 0"/);
  assert.match(paymentsModule, /<form className=\{styles\.quickCreatePanel\} onSubmit=\{submitQuickPayment\} noValidate>/);
  assert.match(paymentsModule, /\{fieldErrors\.paymentDate \? <small className=\{styles\.inlineError\}>\{fieldErrors\.paymentDate\}<\/small> : null\}/);
  assert.match(paymentsModule, /\{fieldErrors\.amount \? <small className=\{styles\.inlineError\}>\{fieldErrors\.amount\}<\/small> : null\}/);
  assert.match(paymentsModule, /setMessage\(errors\.paymentType \|\| "请完善收款信息"\)/);
});

test("CNY payment saves with automatic exchange rate while foreign currency requires a positive rate", () => {
  assert.match(paymentsModule, /normalizedCurrency === "CNY"[\s\S]*exchangeRate: "1\.0000"/);
  assert.match(paymentsModule, /exchangeRateDate: form\.exchangeRateDate \|\| form\.paymentDate/);
  assert.match(paymentsService, /function assertPaymentExchangeInput/);
  assert.match(paymentsService, /if \(currency === "CNY"\) return/);
  assert.match(paymentsService, /throw codedError\("汇率不能为空", 400, "PAYMENT_EXCHANGE_RATE_REQUIRED"\)/);
  assert.match(paymentsService, /throw codedError\("汇率必须大于 0", 400, "PAYMENT_EXCHANGE_RATE_POSITIVE_REQUIRED"\)/);
  assert.match(paymentsService, /orderCurrency === "CNY"[\s\S]*exchangeRate: 1[\s\S]*exchangeRateSource: "系统"[\s\S]*exchangeRateType: "人民币"/);
  assert.match(paymentsService, /amountCny\(amount, exchangeRate\)/);
});

test("payment save synchronizes order receipt status with a lightweight transaction query", () => {
  const syncStatusBlock = paymentsService.match(/async function syncOrderStatusInPaymentTransaction[\s\S]*?\n}\n\ntype PageResult/);
  assert.ok(syncStatusBlock, "syncOrderStatusInPaymentTransaction block should exist");
  assert.match(syncStatusBlock[0], /select: \{\s*id: true,\s*status: true,/);
  assert.match(syncStatusBlock[0], /tx\.payment\.aggregate\(\{/);
  assert.match(syncStatusBlock[0], /_sum: \{ amountCny: true \}/);
  assert.match(syncStatusBlock[0], /select: \{ id: true, status: true \}/);
  assert.doesNotMatch(syncStatusBlock[0], /includeOrderRelations\(\)|summarizeOrder\(/);
});

test("payment save refreshes only the payments list and summary after success", () => {
  assert.match(paymentsModule, /onSaved=\{\(payment\) => \{[\s\S]*void loadPayments\(page, submittedFilters\);[\s\S]*\}\}/);
  assert.doesNotMatch(paymentsModule, /window\.location|location\.href|router\.refresh|reload\(/);
});

test("payments backend rejects missing required save fields with explicit messages", () => {
  assert.match(paymentsService, /function assertPaymentInputRequiredFields/);
  assert.match(paymentsService, /FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE = "该订单尚无历史收款，不能登记尾款，请选择预付款、分批款或全款。"/);
  assert.match(paymentsService, /throw codedError\("请选择关联订单", 400, "PAYMENT_ORDER_REQUIRED"\)/);
  assert.match(paymentsService, /throw codedError\("请选择收款日期", 400, "PAYMENT_DATE_REQUIRED"\)/);
  assert.match(paymentsService, /throw codedError\("请选择收款类型", 400, "PAYMENT_TYPE_REQUIRED"\)/);
  assert.match(paymentsService, /throw codedError\("请输入收款金额", 400, "PAYMENT_AMOUNT_REQUIRED"\)/);
  assert.match(paymentsService, /throw codedError\("收款金额必须大于 0", 400, "PAYMENT_AMOUNT_POSITIVE_REQUIRED"\)/);
  assert.match(paymentsService, /throw codedError\("请选择币种", 400, "PAYMENT_CURRENCY_REQUIRED"\)/);
  assert.match(paymentsService, /function assertFinalPaymentHasHistory/);
  assert.match(paymentsService, /status: "已到账"[\s\S]*deletedAt: null[\s\S]*throw codedError\(FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE, 400, "PAYMENT_FINAL_REQUIRES_HISTORY"\)/);
  assert.doesNotMatch(paymentsService, /dateFromInput\(inputData\.paymentDate\) \|\| dateFromInput\(todayInputInChina\(\)\)/);
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
  assert.match(paymentsModule, /(?:setFilter|onFilterChange)\("keyword"/);
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
  assert.match(sharedConstants, /PAYMENT_TYPES = \["预付款", "中期款", "分批款", "全款", "尾款", "补差款", "退款", "其他"\]/);
  assert.match(paymentsModule, /const PAYMENT_TYPES = \["预付款", "中期款", "分批款", "全款", "尾款", "补差款", "退款", "其他"\]/);
  assert.match(paymentsModule, /paymentType: ""/);
  assert.match(paymentsModule, /<option value="">请选择收款类型<\/option>/);
  assert.match(paymentsService, /paymentType: PAYMENT_TYPES\.includes\(paymentType\) \? paymentType : ""/);
  assert.match(sharedSerialization, /paymentType: payment\.paymentType \|\| ""/);
  assert.match(schema, /paymentType\s+String\s+@default\(""\)\s+@map\("payment_type"\)/);
  assert.doesNotMatch(paymentsModule, /paymentType: "尾款"/);
  assert.doesNotMatch(paymentsService, /: "尾款"/);
});

test("payments list exposes payment type filter and row display", () => {
  assert.match(paymentsModule, /paymentType: string;/);
  assert.match(paymentsModule, /params\.set\(key, text\)/);
  assert.match(paymentsModule, /全部收款类型/);
  assert.match(paymentsModule, /(?:setFilter|onFilterChange)\("paymentType"/);
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
