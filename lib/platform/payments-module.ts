import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  PAYMENT_STATUSES,
  PAYMENT_INPUT_SCHEMA,
  PAYMENT_TYPES,
  ORDER_COST_STATUS_VOID,
  amountCny,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  codedError,
  dateFromInput,
  dateToInput,
  deriveOrderCollectionBalance,
  deriveOrderCollectionStatus,
  effectivePermissions,
  inputHasOwn,
  logServerError,
  nonEmpty,
  optional,
  pageParams,
  pageResult,
  paymentAmountForOrderCurrency,
  permissionError,
  requirePositive,
  requireText,
  resolveExchangeRateSnapshot,
  serializePayment,
  type PaymentDto,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { assertRead } from "./shared-auth";
import {
  assertOrderCanReceivePayment,
  assertOrderOpen,
  canAccessOrder,
  orderAccessWhere,
} from "./order-access";
import { summarizeCurrencyTotals } from "./currency-totals";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import type { ActorLike, PaymentInput } from "./payments-types";
import {
  actorId,
  actorRole,
  assertCurrentPaymentVersion,
  expectedPaymentUpdatedAt,
  loadCurrentPaymentInTransaction,
  loadTargetOrderInPaymentTransaction,
  logSkippedPaymentStatusSyncs,
  paymentResponseInclude,
  paymentWriteSerializationConflict,
  runPaymentWriteTransaction,
  syncOrderStatusInPaymentTransaction,
  updatePaymentWithCas,
  type PaymentStatusSyncResult,
} from "./payment-write-transaction";

export { listPayments } from "./payments-list";
export type { PaymentListRow } from "./payments-list";

type AuditRequestLike = Parameters<typeof writeAudit>[0];

const FOREIGN_PAYMENT_CURRENCIES = new Set(["USD", "EUR", "GBP", "HKD"]);
const FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE = "该订单尚无历史收款，不能登记尾款，请选择预付款、分批款或全款。";
function assertPaymentInputRequiredFields(input: PaymentInput) {
  if (!nonEmpty(input.orderId)) throw codedError("请选择关联订单", 400, "PAYMENT_ORDER_REQUIRED");
  if (!nonEmpty(input.paymentDate)) throw codedError("请选择收款日期", 400, "PAYMENT_DATE_REQUIRED");
  if (!dateFromInput(input.paymentDate)) throw codedError("请选择收款日期", 400, "PAYMENT_DATE_REQUIRED");
  if (!nonEmpty(input.paymentType)) throw codedError("请选择收款类型", 400, "PAYMENT_TYPE_REQUIRED");
  if (!nonEmpty(input.amount)) throw codedError("请输入收款金额", 400, "PAYMENT_AMOUNT_REQUIRED");
  if (!(Number(input.amount) > 0)) throw codedError("收款金额必须大于 0", 400, "PAYMENT_AMOUNT_POSITIVE_REQUIRED");
  if (!nonEmpty(input.currency)) throw codedError("请选择币种", 400, "PAYMENT_CURRENCY_REQUIRED");
}

function assertPaymentExchangeInput(input: PaymentInput, currency: string) {
  if (currency === "CNY") return;
  if (FOREIGN_PAYMENT_CURRENCIES.has(currency) && !nonEmpty(input.exchangeRate)) {
    throw codedError("汇率不能为空", 400, "PAYMENT_EXCHANGE_RATE_REQUIRED");
  }
  if (FOREIGN_PAYMENT_CURRENCIES.has(currency) && !(Number(input.exchangeRate) > 0)) {
    throw codedError("汇率必须大于 0", 400, "PAYMENT_EXCHANGE_RATE_POSITIVE_REQUIRED");
  }
}

async function assertFinalPaymentHasHistory(
  orderId: string,
  paymentType: string,
  currentPaymentId: string | null,
  tx: Prisma.TransactionClient | null = null,
) {
  if (paymentType !== "尾款") return;
  const query = {
    where: {
      orderId,
      status: "已到账",
      deletedAt: null,
      ...(currentPaymentId ? { NOT: { id: currentPaymentId } } : {}),
    },
    _sum: { amountCny: true },
  } satisfies Prisma.PaymentAggregateArgs;
  const historicalArrived = tx
    ? await tx.payment.aggregate(query)
    : await prisma.payment.aggregate(query);
  if (Number(historicalArrived._sum.amountCny || 0) <= 0) {
    throw codedError(FIRST_RECEIPT_FINAL_PAYMENT_MESSAGE, 400, "PAYMENT_FINAL_REQUIRES_HISTORY");
  }
}

export async function savePayment(request: AuditRequestLike, actor: ActorLike, input: unknown, id: string | null = null) {
  assertWrite(actor, "payments");
  const currentActorId = actorId(actor);
  const currentActor = { ...(actor || {}), id: currentActorId, role: actorRole(actor) };
  const jsonInput = assertJsonObject(input);
  assertPaymentInputRequiredFields(jsonInput);
  const inputData = assertInputSchema(jsonInput, PAYMENT_INPUT_SCHEMA) as PaymentInput;
  const before = id ? await prisma.payment.findFirst({
    where: { id, deletedAt: null },
    include: {
      order: {
        include: {
          customer: true,
          costs: { where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } }, select: { createdById: true, status: true, deletedAt: true } },
        },
      },
    },
  }) : null;
  if (id && !before) throw codedError("收款记录不存在或已删除", 404, "PAYMENT_NOT_FOUND");
  if (before && !canAccessOrder(actor, before.order)) {
    throw permissionError("无权限更新该收款记录");
  }
  const expectedUpdatedAt = id ? expectedPaymentUpdatedAt(inputData, before) : null;
  const order = await assertOrderOpen(requireText(inputData.orderId, "关联订单"), actor);
  if (!id || before?.orderId !== order.id) {
    await assertOrderCanReceivePayment(order);
  }
  const amount = requirePositive(inputData.amount, "收款金额");
  const paymentDate = dateFromInput(inputData.paymentDate);
  if (!paymentDate) throw codedError("请选择收款日期", 400, "PAYMENT_DATE_REQUIRED");
  const paymentType = requireText(inputData.paymentType, "收款类型");
  const orderCurrency = requireText(order.currency, "订单币种").toUpperCase();
  const requestedCurrency = requireText(inputData.currency, "币种").toUpperCase();
  if (requestedCurrency !== orderCurrency) {
    throw codedError("收款币种必须与订单币种一致。", 400, "PAYMENT_CURRENCY_MISMATCH");
  }
  assertPaymentExchangeInput(inputData, orderCurrency);
  await assertFinalPaymentHasHistory(order.id, paymentType, id);
  const exchangeInput: PaymentInput = orderCurrency === "CNY"
    ? {
      ...inputData,
      currency: orderCurrency,
      exchangeRate: 1,
      exchangeRateDate: dateToInput(paymentDate),
      exchangeRateSource: "系统",
      exchangeRateType: "人民币",
    }
    : { ...inputData, currency: orderCurrency };
  if (before) {
    if (!inputHasOwn(exchangeInput, "exchangeRateDate") && !inputHasOwn(exchangeInput, "rateDate") && before.exchangeRateDate) {
      exchangeInput.exchangeRateDate = dateToInput(before.exchangeRateDate);
    }
    if (!inputHasOwn(exchangeInput, "exchangeRateSource") && before.exchangeRateSource) {
      exchangeInput.exchangeRateSource = before.exchangeRateSource;
    }
    if (!inputHasOwn(exchangeInput, "exchangeRateType") && before.exchangeRateType) {
      exchangeInput.exchangeRateType = before.exchangeRateType;
    }
  }
  const exchange = await resolveExchangeRateSnapshot(exchangeInput, currentActor, {
    currency: orderCurrency,
    defaultDate: paymentDate,
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const requestedStatus = PAYMENT_STATUSES.includes(String(inputData.status || "")) ? String(inputData.status) : "待确认";
  const data: Prisma.PaymentUncheckedCreateInput = {
    orderId: order.id,
    paymentDate,
    currency: exchange.currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchangeRate),
    paymentType: PAYMENT_TYPES.includes(paymentType) ? paymentType : "",
    status: requestedStatus,
    bankReference: optional(inputData.bankReference),
    remark: optional(inputData.remark),
    updatedById: currentActorId,
    ...(id ? {} : { createdById: currentActorId }),
  };
  const transactionResult = await runPaymentWriteTransaction(async (tx) => {
    const transactionBefore = id
      ? await loadCurrentPaymentInTransaction(tx, id, actor, "update")
      : null;
    assertCurrentPaymentVersion(transactionBefore, expectedUpdatedAt);
    const transactionOrder = await loadTargetOrderInPaymentTransaction(tx, order.id, actor);
    if (!id || transactionBefore?.orderId !== transactionOrder.id) {
      await assertOrderCanReceivePayment(transactionOrder);
    }
    const transactionOrderCurrency = requireText(transactionOrder.currency, "订单币种").toUpperCase();
    if (requestedCurrency !== transactionOrderCurrency || exchange.currency !== transactionOrderCurrency) {
      throw codedError("收款币种必须与订单币种一致。", 400, "PAYMENT_CURRENCY_MISMATCH");
    }
    const affectedOrderIds = [...new Set(
      [transactionOrder.id, transactionBefore?.orderId]
        .filter((value): value is string => Boolean(value)),
    )].sort();
    for (const affectedOrderId of affectedOrderIds) {
      await assertCommissionOrderWritableInTransaction(tx, affectedOrderId);
    }
    await assertFinalPaymentHasHistory(transactionOrder.id, paymentType, id, tx);

    const saved = transactionBefore
      ? await updatePaymentWithCas(tx, transactionBefore, data)
      : await tx.payment.create({ data, include: paymentResponseInclude });
    const statusSyncResults: PaymentStatusSyncResult[] = [];
    for (const affectedOrderId of affectedOrderIds) {
      statusSyncResults.push(await syncOrderStatusInPaymentTransaction(tx, affectedOrderId));
    }
    const auditAction = id && transactionBefore?.status !== requestedStatus
      ? `修改收款状态：${transactionBefore?.status || ""}→${requestedStatus}`
      : (id ? "更新收款" : "新增收款");
    await writeAudit(request, actor, auditAction, "payments", saved.id, transactionBefore, saved, tx);
    return { payment: saved, transactionBefore, statusSyncResults };
  });
  logSkippedPaymentStatusSyncs(transactionResult.statusSyncResults);
  return serializePayment(transactionResult.payment);
}

export async function deletePayment(
  request: AuditRequestLike,
  actor: ActorLike,
  id: string,
  expectedUpdatedAtInput: unknown = null,
) {
  assertWrite(actor, "payments");
  const currentActorId = actorId(actor);
  const before = await prisma.payment.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt) throw permissionError("收款记录不存在或已删除", 404);
  if (!canAccessOrder(actor, before.order)) throw permissionError("无权限删除该收款记录");
  const expectedUpdatedAt = expectedPaymentUpdatedAt({ expectedUpdatedAt: expectedUpdatedAtInput }, before);
  const transactionResult = await runPaymentWriteTransaction(async (tx) => {
    const transactionBefore = await loadCurrentPaymentInTransaction(tx, id, actor, "delete");
    assertCurrentPaymentVersion(transactionBefore, expectedUpdatedAt);
    await assertCommissionOrderWritableInTransaction(tx, transactionBefore.orderId);
    const update = await tx.payment.updateMany({
      where: {
        id,
        orderId: transactionBefore.orderId,
        deletedAt: null,
        updatedAt: transactionBefore.updatedAt,
      },
      data: { deletedAt: new Date(), updatedById: currentActorId },
    });
    if (update.count !== 1) throw paymentWriteSerializationConflict();
    const saved = await tx.payment.findUnique({ where: { id } });
    if (!saved?.deletedAt) throw paymentWriteSerializationConflict();
    const statusSyncResult = await syncOrderStatusInPaymentTransaction(tx, transactionBefore.orderId);
    await writeAudit(request, actor, "删除收款", "payments", id, transactionBefore, saved, tx);
    return { payment: saved, transactionBefore, statusSyncResults: [statusSyncResult] };
  });
  logSkippedPaymentStatusSyncs(transactionResult.statusSyncResults);
}
