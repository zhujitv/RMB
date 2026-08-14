import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { ORDER_COST_STATUS_VOID, codedError, deriveOrderCollectionBalance, deriveOrderCollectionStatus,
  logServerError, nonEmpty, paymentAmountForOrderCurrency, permissionError, profitMarginEligible, requireText } from "./shared";
import { assertOrderCanReceivePayment, canAccessOrder } from "./order-access";
import type { ActorLike, PaymentInput } from "./payments-types";

const MAX_ATTEMPTS = 3;
const CURRENCY_MISMATCH_REASON = "PAYMENT_CURRENCY_MISMATCH";
const paymentAccessOrderInclude = Prisma.validator<Prisma.ReceivableOrderInclude>()({
  customer: true,
  costs: { where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } },
    select: { createdById: true, status: true, deletedAt: true } },
});
const paymentAccessInclude = Prisma.validator<Prisma.PaymentInclude>()({ order: { include: paymentAccessOrderInclude } });
export const paymentResponseInclude = Prisma.validator<Prisma.PaymentInclude>()({
  order: { include: { customer: true, businessEntity: true, salesperson: true } }, createdBy: true, updatedBy: true,
});

export function actorId(actor: ActorLike) { return requireText(actor?.id, "当前用户"); }
export function actorRole(actor: ActorLike) { return String(actor?.role || ""); }

export async function syncOrderStatusInPaymentTransaction(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.receivableOrder.findUnique({ where: { id: orderId }, select: {
    id: true, status: true, actualShipmentAmount: true, actualShipmentDate: true,
    taxArchived: true, taxRefundStatus: true, taxRefundArchivedAt: true, taxSubmittedAt: true,
    currency: true, exchangeRate: true, finalReceivableAmount: true,
  } });
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return { order, skippedReason: null } as const;
  const groups = await tx.payment.groupBy({ by: ["currency"], where: { orderId, status: "已到账", deletedAt: null },
    _sum: { amount: true, amountCny: true } });
  const orderCurrency = String(order.currency || "CNY").toUpperCase();
  if (groups.some((group) => String(group.currency || "").toUpperCase() !== orderCurrency)) {
    return { order, skippedReason: CURRENCY_MISMATCH_REASON } as const;
  }
  const receivedAmount = groups.reduce((sum, group) => sum + paymentAmountForOrderCurrency({
    currency: group.currency, amount: group._sum.amount, amountCny: group._sum.amountCny,
  }, order.currency, order.exchangeRate), 0);
  const collection = deriveOrderCollectionBalance({ receivableAmount: order.finalReceivableAmount, receivedAmount,
    receivedAmountCny: groups.reduce((sum, group) => sum + Number(group._sum.amountCny || 0), 0), orderExchangeRate: order.exchangeRate });
  const status = deriveOrderCollectionStatus({ currentStatus: order.status, actualShipmentAmount: order.actualShipmentAmount,
    shipmentCompleted: profitMarginEligible(order),
    receivedAmount, outstandingAmount: collection.outstandingAmount, overpaidAmount: collection.overpaidAmount });
  if (status === order.status) return { order, skippedReason: null } as const;
  const updated = await tx.receivableOrder.update({ where: { id: orderId }, data: { status }, select: { id: true, status: true } });
  return { order: updated, skippedReason: null } as const;
}

export type PaymentStatusSyncResult = Awaited<ReturnType<typeof syncOrderStatusInPaymentTransaction>>;
export function logSkippedPaymentStatusSyncs(results: PaymentStatusSyncResult[]) {
  results.filter((result) => result?.skippedReason === CURRENCY_MISMATCH_REASON).forEach((result) => {
    logServerError("订单收款状态同步已跳过", new Error("存在与订单币种不一致的历史到账记录"),
      { orderId: result.order?.id || "", reason: result.skippedReason });
  });
}

export function paymentWriteSerializationConflict() {
  return Object.assign(new Error("收款记录在写入期间发生变化，请重试"), { code: "P2034" });
}
export function expectedPaymentUpdatedAt(input: PaymentInput, before: { updatedAt?: Date | null } | null) {
  const expectedText = nonEmpty(input.expectedUpdatedAt || input.updatedAt);
  if (!expectedText) return before?.updatedAt || null;
  const expected = new Date(expectedText);
  if (Number.isNaN(expected.getTime())) throw codedError("收款记录版本无效，请刷新后重试。", 400, "PAYMENT_UPDATE_VERSION_INVALID");
  return expected;
}
export function assertCurrentPaymentVersion(current: { updatedAt: Date } | null, expected: Date | null) {
  if (current && expected && current.updatedAt.getTime() !== expected.getTime()) {
    throw codedError("收款记录已被其他人更新，请刷新后重试。", 409, "PAYMENT_UPDATE_CONFLICT");
  }
}

export async function runPaymentWriteTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try { return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 15000 }); }
    catch (error: unknown) {
      if (String((error as { code?: string })?.code || "") !== "P2034") throw error;
      if (attempt === MAX_ATTEMPTS) throw codedError("收款记录刚刚被其他操作更新，请刷新后重试。", 409, "PAYMENT_UPDATE_CONFLICT");
    }
  }
  throw codedError("收款记录刚刚被其他操作更新，请刷新后重试。", 409, "PAYMENT_UPDATE_CONFLICT");
}

export async function loadCurrentPaymentInTransaction(tx: Prisma.TransactionClient, id: string, actor: ActorLike, operation: "update" | "delete") {
  const payment = await tx.payment.findUnique({ where: { id }, include: paymentAccessInclude });
  if (!payment || payment.deletedAt) {
    if (operation === "update") throw codedError("收款记录不存在或已删除", 404, "PAYMENT_NOT_FOUND");
    throw permissionError("收款记录不存在或已删除", 404);
  }
  if (!canAccessOrder(actor, payment.order)) throw permissionError(operation === "update" ? "无权限更新该收款记录" : "无权限删除该收款记录");
  return payment;
}

export async function loadTargetOrderInPaymentTransaction(tx: Prisma.TransactionClient, orderId: string, actor: ActorLike) {
  const order = await tx.receivableOrder.findFirst({ where: { id: orderId, deletedAt: null }, include: paymentAccessOrderInclude });
  if (!order) throw codedError("请选择有效应收订单", 400, "ORDER_REQUIRED");
  if (!canAccessOrder(actor, order)) throw codedError("无权限访问该应收订单", 403, "ORDER_PERMISSION_DENIED");
  if (["已关闭", "已取消"].includes(order.status) && actorRole(actor) !== "管理员") {
    throw codedError("已关闭或已取消订单不能继续新增收款或成本", 400, "ORDER_CLOSED");
  }
  return order;
}

export async function updatePaymentWithCas(tx: Prisma.TransactionClient,
  current: Awaited<ReturnType<typeof loadCurrentPaymentInTransaction>>, data: Prisma.PaymentUncheckedCreateInput) {
  const update = await tx.payment.updateMany({ where: { id: current.id, orderId: current.orderId, deletedAt: null,
    updatedAt: current.updatedAt }, data: data as Prisma.PaymentUncheckedUpdateManyInput });
  if (update.count !== 1) throw paymentWriteSerializationConflict();
  const saved = await tx.payment.findUnique({ where: { id: current.id }, include: paymentResponseInclude });
  if (!saved || saved.deletedAt) throw paymentWriteSerializationConflict();
  return saved;
}
