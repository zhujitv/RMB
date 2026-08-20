import { readPrismaSchemaSource } from "./prisma-schema-source.ts";
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
const schema = readPrismaSchemaSource();
const paymentRecordActions = readFileSync("app/modules/payments/use-payment-record-actions.ts", "utf8");
const paymentDetailRoute = readFileSync("app/api/payments/[id]/route.ts", "utf8");
const quickPaymentPanel = paymentsModule;
const paymentsModuleController = readFileSync("app/modules/PaymentsModule.tsx", "utf8");

test("payments page keeps summary cards and avoids duplicate recent payment list", () => {
  assert.match(paymentsModule, /已到账金额/);
  assert.match(paymentsModule, /待确认金额/);
  assert.match(paymentsModule, /本月收款笔数/);
  assert.doesNotMatch(paymentsModule, /最近收款/);
  assert.doesNotMatch(paymentsModule, /PaymentMobileCard/);
  assert.doesNotMatch(paymentsModule, /mobileDataCard/);
  assert.doesNotMatch(paymentsModule, /mobileCardList/);
});

test("payments write actions follow the effective permission snapshot", () => {
  assert.match(paymentsModuleController, /permissions\?: PermissionSnapshot/);
  assert.match(paymentsModuleController, /const canConfirmPayments = canWritePermission\(currentUser, permissions, "payments", \["管理员", "财务"\]\)/);
  assert.match(paymentsModuleController, /const canRegisterPayments = canConfirmPayments \|\| currentUser\.role === "业务员"/);
  assert.match(paymentsModuleController, /canConfirmArrived=\{canConfirmPayments\}/);
  assert.match(paymentsModuleController, /canManage=\{canConfirmPayments\}/);
  assert.match(paymentsService, /function assertCustomerPaymentWrite\(actor: ActorLike\)/);
  assert.match(paymentsService, /canWrite\(actor, "payments"\) \|\| actorRole\(actor\) === "业务员"/);
  assert.match(paymentsService, /export async function savePayment[\s\S]*assertCustomerPaymentWrite\(actor\)/);
  assert.match(paymentsService, /export async function deletePayment[\s\S]*assertWrite\(actor, "payments"\)/);
});

test("payments API returns paginated summary metrics", () => {
  assert.match(paymentsService, /arrivedAmountCny/);
  assert.match(paymentsService, /pendingAmountCny/);
  assert.match(paymentsService, /arrivedCurrencyTotals/);
  assert.match(paymentsService, /pendingCurrencyTotals/);
  assert.match(paymentsService, /summarizeCurrencyTotals/);
  assert.match(paymentsService, /currentMonthCount/);
  assert.match(paymentsService, /function withWhere/);
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
  assert.match(paymentsModule, /form\.paymentType === "尾款"[\s\S]*numericValue\(order\.receivedAmountCny, order\.summary\?\.confirmedPaymentsCny\) <= 0[\s\S]*errors\.paymentType = FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE/);
  assert.match(paymentsModule, /errors\.amount = "请输入收款金额"/);
  assert.match(paymentsModule, /errors\.amount = "收款金额必须大于 0"/);
  assert.match(paymentsModule, /errors\.exchangeRate = "汇率不能为空"/);
  assert.match(paymentsModule, /errors\.exchangeRate = "汇率必须大于 0"/);
  assert.match(paymentsModule, /<form className=\{styles\.quickCreatePanel\} onSubmit=\{onSubmit\} noValidate inert=\{saving\} aria-busy=\{saving\}>/);
  assert.match(paymentsModule, /<QuickPaymentFormView[\s\S]*onSubmit=\{submitQuickPayment\}/);
  assert.match(paymentsModule, /\{fieldErrors\.paymentDate \? <small className=\{styles\.inlineError\}>\{fieldErrors\.paymentDate\}<\/small> : null\}/);
  assert.match(paymentsModule, /\{fieldErrors\.amount \? <small className=\{styles\.inlineError\}>\{fieldErrors\.amount\}<\/small> : null\}/);
  assert.match(paymentsModule, /setMessage\(errors\.paymentType \|\| "请完善收款信息"\)/);
});

test("CNY payment saves with automatic exchange rate while foreign currency requires a positive rate", () => {
  assert.match(paymentsModule, /function normalizeQuickPaymentForm[\s\S]*currency !== "CNY"[\s\S]*exchangeRate: "1\.0000"/);
  assert.match(paymentsModule, /exchangeRateDate: form\.exchangeRateDate \|\| form\.paymentDate/);
  assert.match(paymentsService, /function assertPaymentExchangeInput/);
  assert.match(paymentsService, /if \(currency === "CNY"\) return/);
  assert.match(paymentsService, /throw codedError\("汇率不能为空", 400, "PAYMENT_EXCHANGE_RATE_REQUIRED"\)/);
  assert.match(paymentsService, /throw codedError\("汇率必须大于 0", 400, "PAYMENT_EXCHANGE_RATE_POSITIVE_REQUIRED"\)/);
  assert.match(paymentsService, /orderCurrency === "CNY"[\s\S]*exchangeRate: 1[\s\S]*exchangeRateSource: "系统"[\s\S]*exchangeRateType: "人民币"/);
  assert.match(paymentsService, /amountCny\(amount, exchangeRate\)/);
});

test("payment save synchronizes order receipt status with a lightweight transaction query", () => {
  const syncStatusBlock = paymentsService.match(/export async function syncOrderStatusInPaymentTransaction[\s\S]*?\n}\n\nexport type PaymentStatusSyncResult/);
  assert.ok(syncStatusBlock, "syncOrderStatusInPaymentTransaction block should exist");
  assert.match(syncStatusBlock[0], /select: \{\s*id: true,\s*status: true,/);
  assert.match(syncStatusBlock[0], /tx\.payment\.groupBy\(\{/);
  assert.match(syncStatusBlock[0], /_sum: \{ amount: true, amountCny: true \}/);
  assert.match(syncStatusBlock[0], /paymentAmountForOrderCurrency/);
  assert.match(syncStatusBlock[0], /deriveOrderCollectionBalance/);
  assert.match(syncStatusBlock[0], /deriveOrderCollectionStatus/);
  assert.match(syncStatusBlock[0], /select: \{ id: true, status: true \}/);
  assert.match(syncStatusBlock[0], /groups\.some\([\s\S]*CURRENCY_MISMATCH_REASON/);
  assert.ok(
    syncStatusBlock[0].indexOf("CURRENCY_MISMATCH_REASON")
      < syncStatusBlock[0].indexOf("deriveOrderCollectionBalance"),
    "historical currency mismatches must preserve the current status before recalculation",
  );
  assert.doesNotMatch(syncStatusBlock[0], /includeOrderRelations\(\)|summarizeOrder\(/);
});

test("payment writes serialize same-order status synchronization and retry concurrency conflicts", () => {
  const transactionRunner = paymentsService.match(/export async function runPaymentWriteTransaction[\s\S]*?\n}\n\nexport async function loadCurrentPaymentInTransaction/);
  assert.ok(transactionRunner, "payment transaction runner should exist");
  assert.match(transactionRunner[0], /!== "P2034"/);
  assert.match(paymentsService, /MAX_ATTEMPTS = 3/);
  assert.match(transactionRunner[0], /attempt <= MAX_ATTEMPTS/);
  assert.match(transactionRunner[0], /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(transactionRunner[0], /attempt === MAX_ATTEMPTS/);
  assert.match(transactionRunner[0], /codedError\("收款记录刚刚被其他操作更新，请刷新后重试。", 409, "PAYMENT_UPDATE_CONFLICT"\)/);
  assert.equal((paymentsService.match(/runPaymentWriteTransaction\(async \(tx\) => \{/g) || []).length, 2);
});

test("each payment retry reloads and revalidates the current payment and target order", () => {
  const transactionHelpers = paymentsService.slice(
    paymentsService.indexOf("async function loadCurrentPaymentInTransaction"),
    paymentsService.indexOf("type PageResult"),
  );
  assert.match(transactionHelpers, /tx\.payment\.findUnique\(\{[\s\S]*where: \{ id \}[\s\S]*include: paymentAccessInclude/);
  assert.match(transactionHelpers, /!payment \|\| payment\.deletedAt/);
  assert.match(transactionHelpers, /canAccessOrder\(actor, payment\.order\)/);
  assert.match(transactionHelpers, /tx\.receivableOrder\.findFirst\(\{[\s\S]*where: \{ id: orderId, deletedAt: null \}/);
  assert.match(transactionHelpers, /canAccessOrder\(actor, order\)/);
  assert.match(transactionHelpers, /\["已关闭", "已取消"\]\.includes\(order\.status\)/);
  assert.match(transactionHelpers, /tx\.payment\.updateMany\(\{[\s\S]*orderId: current\.orderId,[\s\S]*deletedAt: null,[\s\S]*updatedAt: current\.updatedAt/);
  assert.match(transactionHelpers, /if \(update\.count !== 1\) throw paymentWriteSerializationConflict\(\)/);

  const saveBlock = paymentsService.slice(
    paymentsService.indexOf("export async function savePayment"),
    paymentsService.indexOf("export async function deletePayment"),
  );
  const retryBlock = saveBlock.slice(
    saveBlock.indexOf("const transactionResult = await runPaymentWriteTransaction"),
    saveBlock.indexOf("logSkippedPaymentStatusSyncs"),
  );
  assert.match(retryBlock, /loadCurrentPaymentInTransaction\(tx, id, actor, "update"\)/);
  assert.match(retryBlock, /assertCurrentPaymentVersion\(transactionBefore, expectedUpdatedAt\)/);
  assert.match(retryBlock, /loadTargetOrderInPaymentTransaction\(tx, order\.id, actor\)/);
  assert.match(retryBlock, /assertOrderCanReceivePayment\(transactionOrder\)/);
  assert.match(retryBlock, /requestedCurrency !== transactionOrderCurrency \|\| exchange\.currency !== transactionOrderCurrency/);
  assert.match(retryBlock, /assertFinalPaymentHasHistory\(transactionOrder\.id, paymentType, id, tx\)/);
  assert.match(retryBlock, /\[transactionOrder\.id, transactionBefore\?\.orderId\][\s\S]*\.sort\(\)/);
  assert.match(retryBlock, /await writeAudit\(request, actor, auditAction, "payments", saved\.id, transactionBefore, saved, tx\)/);
  assert.doesNotMatch(retryBlock, /logServerError|runNonCriticalTask/);
  const afterCommitBlock = saveBlock.slice(saveBlock.indexOf("logSkippedPaymentStatusSyncs"));
  assert.doesNotMatch(afterCommitBlock, /writeAudit|runNonCriticalTask/);
});

test("payment edits reject a stale form version instead of overwriting a concurrent update", () => {
  assert.match(paymentsModule, /quickPaymentPayload\(normalizedForm, editingSnapshot\)/);
  assert.match(paymentsModule, /expectedUpdatedAt: editing\.updatedAt \|\| undefined/);
  assert.match(paymentRecordActions, /expectedUpdatedAt: payment\.updatedAt \|\| undefined/);
  assert.match(paymentRecordActions, /confirmError instanceof ApiRequestError && confirmError\.status === 409/);
  assert.match(paymentRecordActions, /await options\.loadPayments\(options\.page, options\.submittedFilters\)/);
  assert.match(paymentsService, /function expectedPaymentUpdatedAt/);
  assert.match(paymentsService, /input\.expectedUpdatedAt \|\| input\.updatedAt/);
  assert.match(paymentsService, /current\.updatedAt\.getTime\(\) !== expected\.getTime\(\)/);
  assert.match(paymentsService, /PAYMENT_UPDATE_VERSION_INVALID/);
  assert.match(paymentsService, /PAYMENT_UPDATE_CONFLICT/);
});

test("payment editor keeps its form and version on one opening snapshot and recovers conflicts safely", () => {
  assert.match(quickPaymentPanel, /const \[editingSnapshot\] = useState<PaymentRow \| null>\(\(\) => initialPayment \? \{ \.\.\.initialPayment \} : null\)/);
  assert.match(quickPaymentPanel, /paymentFormFromRow\(editingSnapshot\)/);
  assert.match(quickPaymentPanel, /initialOrder\?: PaymentOrderOption \| null/);
  assert.match(quickPaymentPanel, /const initialCreateOrder = !editingSnapshot && initialOrder\?\.id/);
  assert.match(quickPaymentPanel, /useState<PaymentOrderOption\[\]>\(\(\) => initialCreateOrder \? \[initialCreateOrder\] : \[\]\)/);
  assert.match(quickPaymentPanel, /quickPaymentPayload\(normalizedForm, editingSnapshot\)/);
  assert.match(quickPaymentPanel, /expectedUpdatedAt: editing\.updatedAt \|\| undefined/);
  assert.doesNotMatch(quickPaymentPanel, /expectedUpdatedAt: initialPayment\?\.updatedAt/);
  assert.match(quickPaymentPanel, /saveError instanceof ApiRequestError && saveError\.status === 409 && editingSnapshot\?\.id/);
  assert.match(quickPaymentPanel, /await onConflict\(editingSnapshot\.id\)/);
  assert.match(paymentsModuleController, /key=\{editPayment\?\.id \? `edit:\$\{editPayment\.id\}` : "create"\}/);
  assert.match(paymentsModuleController, /onConflict=\{async \(paymentId\) => \{[\s\S]*?await loadPayments\(page, submittedFilters\)[\s\S]*?setEditPayment\(null\)/);
  assert.match(paymentRecordActions, /async function refreshPaymentAfterConflict/);
  assert.match(paymentRecordActions, /const latestPayment = refreshedRows\.find\(\(row\) => row\.id === payment\.id\) \|\| null/);
  assert.match(paymentRecordActions, /options\.mergePaymentRow\(latestPayment, \{ shouldShow: true \}\)/);
  assert.match(paymentRecordActions, /options\.setDetailPayment\(null\)/);
});

test("payment deletion reloads authorization and uses a conditional soft-delete inside every retry", () => {
  const deleteBlock = paymentsService.slice(paymentsService.indexOf("export async function deletePayment"));
  const retryBlock = deleteBlock.slice(
    deleteBlock.indexOf("const transactionResult = await runPaymentWriteTransaction"),
    deleteBlock.indexOf("logSkippedPaymentStatusSyncs"),
  );
  assert.match(retryBlock, /loadCurrentPaymentInTransaction\(tx, id, actor, "delete"\)/);
  assert.match(retryBlock, /assertCurrentPaymentVersion\(transactionBefore, expectedUpdatedAt\)/);
  assert.match(retryBlock, /tx\.payment\.updateMany\(\{[\s\S]*id,[\s\S]*orderId: transactionBefore\.orderId,[\s\S]*deletedAt: null,[\s\S]*updatedAt: transactionBefore\.updatedAt/);
  assert.match(retryBlock, /if \(update\.count !== 1\) throw paymentWriteSerializationConflict\(\)/);
  assert.match(retryBlock, /syncOrderStatusInPaymentTransaction\(tx, transactionBefore\.orderId\)/);
  assert.match(retryBlock, /await writeAudit\(request, actor, "删除收款", "payments", id, transactionBefore, saved, tx\)/);
  assert.doesNotMatch(retryBlock, /logServerError|runNonCriticalTask/);
  const afterCommitBlock = deleteBlock.slice(deleteBlock.indexOf("logSkippedPaymentStatusSyncs"));
  assert.doesNotMatch(afterCommitBlock, /writeAudit|runNonCriticalTask/);
  assert.match(paymentRecordActions, /\?expectedUpdatedAt=\$\{encodeURIComponent\(payment\.updatedAt\)\}/);
  assert.match(paymentRecordActions, /deleteError instanceof ApiRequestError && deleteError\.status === 409/);
  assert.match(paymentDetailRoute, /searchParams\.get\("expectedUpdatedAt"\)/);
  assert.match(paymentDetailRoute, /deletePayment\(request, actor, id, expectedUpdatedAt\)/);
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
  assert.match(paymentsService, /keyword: nonEmpty\(query\.get\("keyword"\)\)/);
  assert.match(paymentsService, /bankReference: \{ contains: filters\.keyword/);
  assert.match(paymentsService, /remark: \{ contains: filters\.keyword/);
  assert.match(paymentsService, /paymentType: \{ contains: filters\.keyword/);
  assert.match(paymentsService, /orderNo: \{ contains: filters\.keyword/);
  assert.match(paymentsService, /customerNameSnapshot: \{ contains: filters\.keyword/);
  assert.match(paymentsService, /shortName: \{ contains: filters\.keyword/);
  assert.match(paymentsService, /name: \{ contains: filters\.keyword/);
  assert.doesNotMatch(paymentsService, /receiptNo: \{ contains: filters\.keyword/);
  assert.doesNotMatch(paymentsService, /voucherNo: \{ contains: filters\.keyword/);
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
  assert.match(paymentsService, /paymentType: nonEmpty\(query\.get\("paymentType"\)\)/);
  assert.match(paymentsService, /if \(filters\.paymentType\) clauses\.push\(\{ paymentType: filters\.paymentType \}\)/);
});

test("payment completion is based on arrived amount, not payment type", () => {
  assert.match(ordersService, /deriveOrderCollectionStatus\(\{/);
  assert.match(ordersService, /receivedAmount: summary\.confirmedPaymentsAmount/);
  assert.match(ordersService, /outstandingAmount: summary\.outstandingAmount/);
  assert.match(ordersService, /overpaidAmount: summary\.overpaidAmount/);
  assert.match(orderAccess, /throw codedError\("已关闭或已取消订单不能新增收款"/);
  assert.doesNotMatch(orderAccess, /ORDER_FULLY_PAID/);
  assert.doesNotMatch(orderAccess, /订单已收齐，不能新增收款/);
  assert.match(ordersService, /return !\["已关闭", "已取消"\]\.includes\(order\.status\)/);
});
