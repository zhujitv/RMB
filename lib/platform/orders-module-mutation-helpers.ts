import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  ORDER_STATUSES, TRADE_TERMS, addDays, amountCny, codedError, dateFromInput,
  depositRatioForPaymentTerm, deriveOrderCollectionStatus, getExchangeRateSettings,
  includeOrderRelations, inputHasOwn, normalizeInstallments, optional, requirePositive,
  resolveBusinessEntityForOrderInput, resolvePaymentTerm, summarizeOrder,
} from "./shared";
import { canAccessOrder } from "./order-access";
import { syncOrderLogisticsSuppliers } from "./masters-access";
import {
  MAX_ORDER_REMARK_LENGTH, actorRole, normalizeOrderLogisticsSupplierIds, normalizeReminderDaysInput,
  optionalLimitedText, paymentTermTypeValue, resolveSalespersonCommissionRate, type ActorLike, type OrderInput,
} from "./orders-module-shared";

const COLLECTION_STATUSES = ["部分收款", "已收齐", "多收款"];
const CURRENCY_LOCK_PAYMENT_STATUSES = ["待确认", "已到账"];

export function expectedOrderUpdatedAt(input: OrderInput, before: { updatedAt?: Date | null } | null) {
  const expectedText = optional(input.expectedUpdatedAt || input.updatedAt);
  if (!expectedText) return before?.updatedAt || null;
  const expected = new Date(expectedText);
  if (Number.isNaN(expected.getTime())) throw codedError("订单版本无效，请刷新后重试。", 400, "ORDER_UPDATE_VERSION_INVALID");
  return expected;
}

export function assertCurrentOrderWritable(current: Record<string, any> | null, id: string | null, actor: ActorLike, expectedUpdatedAt: Date | null) {
  if (!id) return;
  if (!current) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (!canAccessOrder(actor, current)) throw codedError("无权限修改该应收订单", 403, "ORDER_PERMISSION_DENIED");
  if (current.status === "已关闭" && actorRole(actor) !== "管理员") throw codedError("已关闭订单不能修改", 400, "ORDER_CLOSED");
  if (expectedUpdatedAt && current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw codedError("订单已被其他人或收款操作更新，请刷新后重试。", 409, "ORDER_UPDATE_CONFLICT");
  }
}

export function normalizedCurrency(value: unknown) {
  return String(value || "CNY").trim().toUpperCase();
}

export function hasCurrencyLockPayments(payments: Array<{ status?: string | null }> = []) {
  return payments.some((payment) => CURRENCY_LOCK_PAYMENT_STATUSES.includes(String(payment.status || "")));
}

export function withServerControlledCollectionStatus(data: Prisma.ReceivableOrderUncheckedCreateInput, current: { status?: string | null } | null) {
  if (!COLLECTION_STATUSES.includes(String(data.status || ""))) return data;
  return { ...data, status: String(current?.status || "") || (data.actualShipmentAmount == null ? "已确认" : "已发货") };
}

export async function assertNoUnfinishedOrderDocuments(id: string | null, client: Prisma.TransactionClient | typeof prisma = prisma) {
  if (!id) return;
  const count = await client.orderDocument.count({ where: { orderId: id, deletedAt: null, uploadStatus: { not: "SUCCESS" } } });
  if (count > 0) throw codedError("存在未完成上传的文件，请处理后再提交。", 400, "ORDER_DOCUMENT_UPLOAD_UNFINISHED");
}

export function resolveOrderAmounts(input: OrderInput) {
  const estimatedReceivableAmount = requirePositive(input.estimatedReceivableAmount ?? input.receivableAmount, "预计应收金额");
  const actualShipmentAmount = input.actualShipmentAmount === "" || input.actualShipmentAmount == null ? null : requirePositive(input.actualShipmentAmount, "实际发货金额");
  const finalReceivableAmount = input.finalReceivableAmount === "" || input.finalReceivableAmount == null
    ? actualShipmentAmount ?? estimatedReceivableAmount : requirePositive(input.finalReceivableAmount, "最终应收金额");
  return { estimatedReceivableAmount, actualShipmentAmount, finalReceivableAmount };
}

export function resolveOrderPaymentDates(input: OrderInput, before: Record<string, any> | null, finalAmount: number, exchangeRate: number) {
  const paymentTermInfo = resolvePaymentTerm(input, before);
  const paymentTermType = paymentTermInfo.type;
  const createdAt = before?.createdAt || new Date();
  const actualShipmentDate = dateFromInput(input.actualShipmentDate);
  const expectedArrivalDate = paymentTermType === "AFTER_ARRIVAL" ? dateFromInput(input.expectedArrivalDate || input.expectedPaymentDate)
    : (!paymentTermType && before ? before.expectedArrivalDate : null);
  const expectedShipmentDate = !paymentTermType && before ? before.expectedShipmentDate : null;
  const blDate = paymentTermType === "COPY_BL" ? dateFromInput(input.blDate) : (!paymentTermType && before ? before.blDate : null);
  const creditDays = ["OA", "AFTER_ARRIVAL"].includes(String(paymentTermType)) ? Number(input.creditDays) : (!paymentTermType && before ? before.creditDays : null);
  if (paymentTermType === "AFTER_ARRIVAL" && !expectedArrivalDate) throw codedError("到港后付款请填写预计到港日期", 400, "EXPECTED_ARRIVAL_DATE_REQUIRED");
  const dueDate = paymentTermType === "OA" ? addDays(dateFromInput(createdAt.toISOString().slice(0, 10)), creditDays)
    : paymentTermType === "AFTER_ARRIVAL" ? addDays(expectedArrivalDate, creditDays)
    : paymentTermType === "COPY_BL" ? (blDate || actualShipmentDate || dateFromInput(input.dueDate))
    : paymentTermType === "INSTALLMENT" ? dateFromInput(input.dueDate) : (dateFromInput(input.dueDate) || before?.dueDate || null);
  const expectedPaymentDate = paymentTermType === "AFTER_ARRIVAL" ? expectedArrivalDate
    : paymentTermType === "COPY_BL" ? (dateFromInput(input.expectedPaymentDate) || actualShipmentDate)
    : (!paymentTermType && before ? before.expectedPaymentDate : null);
  const paymentInstallments = paymentTermType === "INSTALLMENT" ? normalizeInstallments(input.paymentInstallments, finalAmount, exchangeRate)
    : (!paymentTermType && before ? before.paymentInstallments : null);
  return { paymentTermInfo, paymentTermType, paymentTerm: paymentTermInfo.label,
    depositRatio: depositRatioForPaymentTerm(paymentTermType, before), actualShipmentDate, expectedArrivalDate,
    expectedShipmentDate, blDate, creditDays, dueDate, expectedPaymentDate, paymentInstallments };
}

export function buildReceivableOrderData(params: Record<string, any>): Prisma.ReceivableOrderUncheckedCreateInput {
  const { inputData, before, customer, businessEntity, orderNo, blNo, currentActorId, salespersonUserId, currency, exchange, orderAmounts, payment } = params;
  const rate = exchange.exchangeRate;
  return {
    orderNo, blNo, customerId: customer.id, customerNameSnapshot: before && before.customerId === customer.id ? before.customerNameSnapshot : customer.name,
    businessEntityId: businessEntity.id, businessEntityNameSnapshot: businessEntity.name, salespersonUserId,
    salespersonCommissionRate: resolveSalespersonCommissionRate(customer), country: optional(customer.country), currency,
    exchangeRate: rate, exchangeRateDate: exchange.exchangeRateDate, exchangeRateSource: exchange.exchangeRateSource, exchangeRateType: exchange.exchangeRateType,
    estimatedReceivableAmount: orderAmounts.estimatedReceivableAmount, estimatedReceivableAmountCny: amountCny(orderAmounts.estimatedReceivableAmount, rate),
    actualShipmentAmount: orderAmounts.actualShipmentAmount, actualShipmentAmountCny: orderAmounts.actualShipmentAmount == null ? null : amountCny(orderAmounts.actualShipmentAmount, rate),
    actualShipmentDate: payment.actualShipmentDate, finalReceivableAmount: orderAmounts.finalReceivableAmount,
    finalReceivableAmountCny: amountCny(orderAmounts.finalReceivableAmount, rate), receivableAmount: orderAmounts.finalReceivableAmount,
    receivableAmountCny: amountCny(orderAmounts.finalReceivableAmount, rate),
    tradeTerm: TRADE_TERMS.includes(String(inputData.tradeTerm || "")) ? String(inputData.tradeTerm) : "FOB",
    paymentTerm: payment.paymentTerm, paymentTermType: paymentTermTypeValue(payment.paymentTermType), depositRatio: payment.depositRatio,
    expectedPaymentDate: payment.expectedPaymentDate, expectedArrivalDate: payment.expectedArrivalDate, expectedShipmentDate: payment.expectedShipmentDate,
    blDate: payment.blDate, paymentInstallments: payment.paymentInstallments == null ? Prisma.DbNull : payment.paymentInstallments,
    creditDays: payment.creditDays, dueDate: payment.dueDate, reminderDays: normalizeReminderDaysInput(inputData.reminderDays ?? 7),
    status: ORDER_STATUSES.includes(String(inputData.status || "")) ? String(inputData.status) : "已确认",
    remark: optionalLimitedText(inputData.remark, "备注", MAX_ORDER_REMARK_LENGTH), updatedById: currentActorId,
    ...(before ? {} : { createdById: currentActorId }),
  };
}

export async function maybeSyncOrderLogisticsSuppliersInTransaction(tx: Prisma.TransactionClient, order: any, input: OrderInput, actor: ActorLike) {
  const hasInput = inputHasOwn(input, "logisticsSupplierIds") || inputHasOwn(input, "logisticsSuppliers");
  const settings = await getExchangeRateSettings();
  if (!hasInput && settings.allowMultipleOrderLogisticsSuppliers) return order;
  if (!hasInput && !settings.allowMultipleOrderLogisticsSuppliers) {
    const count = Array.isArray(order.logisticsSuppliers) ? order.logisticsSuppliers.length : await tx.orderLogisticsSupplier.count({ where: { orderId: order.id } });
    if (count > 0) return order;
  }
  const allowEmpty = String(input.tradeTerm ?? order.tradeTerm ?? "").trim().toUpperCase().includes("EXW");
  await syncOrderLogisticsSuppliers(order.id, normalizeOrderLogisticsSupplierIds(input), actor, { allowEmpty, client: tx });
  return await tx.receivableOrder.findUnique({ where: { id: order.id }, include: includeOrderRelations() }) || order;
}

export async function syncOrderStatusInTransaction(tx: Prisma.TransactionClient, order: any | null) {
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return order;
  const summary = summarizeOrder(order);
  if (summary.hasArrivedPaymentCurrencyMismatch) return order;
  const status = deriveOrderCollectionStatus({ currentStatus: order.status, actualShipmentAmount: order.actualShipmentAmount,
    receivedAmount: summary.confirmedPaymentsAmount, outstandingAmount: summary.outstandingAmount, overpaidAmount: summary.overpaidAmount });
  return status === order.status ? order : tx.receivableOrder.update({ where: { id: order.id }, data: { status }, include: includeOrderRelations() });
}
