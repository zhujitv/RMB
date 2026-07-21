import { dateToInput } from "./shared-base-utils";
import {
  customerFullName,
  customerShortName,
  serializeSupplier,
} from "./shared-serialization";
import { serializeUser } from "./shared-users";
import { paymentTermLabel } from "./shared-utils";
import { summarizeOrder } from "./shared-order-calculations";
import { summarizeOrderWithCommissionSnapshot } from "./shared-commission-summary";
import { businessEntityFieldsFromOrder } from "./business-entities";
import {
  asShippingOrder,
  type OrderPaymentInstallmentLike,
} from "./shared-order-serialization-types";

export function serializeOrderListSummary(
  summary: ReturnType<typeof summarizeOrder> | ReturnType<typeof summarizeOrderWithCommissionSnapshot>,
) {
  return {
    receivableCny: summary.receivableCny,
    receivableAmount: summary.receivableAmount,
    estimatedReceivableAmount: summary.estimatedReceivableAmount,
    estimatedReceivableAmountCny: summary.estimatedReceivableAmountCny,
    actualShipmentAmount: summary.actualShipmentAmount,
    actualShipmentAmountCny: summary.actualShipmentAmountCny,
    finalReceivableAmount: summary.finalReceivableAmount,
    finalReceivableAmountCny: summary.finalReceivableAmountCny,
    confirmedPaymentsCny: summary.confirmedPaymentsCny,
    confirmedPaymentsAmount: summary.confirmedPaymentsAmount,
    arrivedPaymentsCny: summary.arrivedPaymentsCny,
    arrivedPaymentsAmount: summary.arrivedPaymentsAmount,
    prepaidAmountCny: summary.prepaidAmountCny,
    receivedDepositCny: summary.receivedDepositCny,
    receivedDepositAmount: summary.receivedDepositAmount,
    requiredDepositAmount: summary.requiredDepositAmount,
    requiredDepositAmountCny: summary.requiredDepositAmountCny,
    depositGapCny: summary.depositGapCny,
    depositOverpaidCny: summary.depositOverpaidCny,
    depositRatio: summary.depositRatio,
    pendingPaymentsCny: summary.pendingPaymentsCny,
    pendingPaymentsAmount: summary.pendingPaymentsAmount,
    arrivedBalanceAmount: summary.arrivedBalanceAmount,
    arrivedBalanceCny: summary.arrivedBalanceCny,
    arrivedOutstandingAmount: summary.arrivedOutstandingAmount,
    arrivedOutstandingCny: summary.arrivedOutstandingCny,
    balanceCny: summary.balanceCny,
    balanceAmount: summary.balanceAmount,
    outstandingCny: summary.outstandingCny,
    outstandingAmount: summary.outstandingAmount,
    overpaidCny: summary.overpaidCny,
    overpaidAmount: summary.overpaidAmount,
    exchangeDifferenceCny: summary.exchangeDifferenceCny,
    isOverpaid: summary.isOverpaid,
    isUnderpaid: summary.isUnderpaid,
    reminderStatus: summary.reminderStatus,
    overdueDays: summary.overdueDays,
  };
}

function hasCurrencyLockPayments(payments: unknown) {
  return Array.isArray(payments) && payments.some((payment) => {
    if (!payment || typeof payment !== "object") return false;
    const row = payment as { deletedAt?: unknown; status?: unknown };
    return !row.deletedAt && ["待确认", "已到账"].includes(String(row.status || ""));
  });
}

export function serializeOrderListRow(
  orderInput: unknown,
  commissionFormulaSettings?: Record<string, unknown> | null,
) {
  const order = asShippingOrder(orderInput);
  const summary = summarizeOrderWithCommissionSnapshot(
    order as Parameters<typeof summarizeOrderWithCommissionSnapshot>[0],
    commissionFormulaSettings,
  );
  const paymentInstallments = Array.isArray(order.paymentInstallments) ? order.paymentInstallments as OrderPaymentInstallmentLike[] : [];
  const paymentTermDisplay = paymentTermLabel(order.paymentTermType || undefined, order.paymentTerm || undefined);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  const logisticsSupplierRows = Array.isArray(order.logisticsSuppliers) ? order.logisticsSuppliers : [];
  return {
    id: order.id,
    hasCurrencyLockPayments: hasCurrencyLockPayments(order.payments),
    orderNo: order.orderNo,
    blNo: order.blNo || order.billOfLadingNo || "",
    billOfLadingNo: order.blNo || order.billOfLadingNo || "",
    customerId: order.customerId,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    customerNameSnapshot: fullCustomerName,
    ...businessEntityFieldsFromOrder(order),
    salespersonId: order.salespersonUserId || "",
    salespersonUserId: order.salespersonUserId || "",
    salespersonName: order.salesperson?.name || "",
    salespersonCommissionRate: Number(order.salespersonCommissionRate || 0),
    commissionRate: Number(order.salespersonCommissionRate || 0),
    commissionStatus: order.commissionStatus || "未结算",
    commissionStatusRaw: order.commissionStatus || "未结算",
    commissionSettledById: order.commissionSettledById || "",
    commissionSettledByName: order.commissionSettledBy?.name || "",
    commissionSettledAt: order.commissionSettledAt || null,
    commissionSettlementRemark: order.commissionSettlementRemark || "",
    country: order.customer?.country || order.country || "",
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate ?? 0),
    exchangeRateDate: dateToInput(order.exchangeRateDate),
    exchangeRateSource: order.exchangeRateSource || "",
    exchangeRateType: order.exchangeRateType || "",
    estimatedReceivableAmount: Number(order.estimatedReceivableAmount ?? order.receivableAmount),
    estimatedReceivableAmountCny: Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny),
    actualShipmentAmount: order.actualShipmentAmount == null ? "" : Number(order.actualShipmentAmount),
    actualShipmentAmountCny: order.actualShipmentAmountCny == null ? "" : Number(order.actualShipmentAmountCny),
    actualShipmentDate: dateToInput(order.actualShipmentDate),
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    receivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    tradeTerm: order.tradeTerm,
    paymentTerm: paymentTermDisplay,
    paymentTermRaw: order.paymentTerm || "",
    paymentTermType: order.paymentTermType || "",
    paymentTermDisplay,
    depositRatio: order.depositRatio == null ? "" : Number(order.depositRatio) * 100,
    expectedPaymentDate: dateToInput(order.expectedPaymentDate),
    expectedArrivalDate: dateToInput(order.expectedArrivalDate),
    expectedShipmentDate: dateToInput(order.expectedShipmentDate),
    blDate: dateToInput(order.blDate),
    paymentInstallments,
    paymentInstallmentText: paymentInstallments.map((item) => (
      `${item.condition || "-"}：${Number(item.ratio || 0)}% / ${Number(item.amount || 0).toFixed(2)}`
    )).join("；"),
    logisticsSupplierIds: logisticsSupplierRows.map((row) => row.supplierId).filter((supplierId): supplierId is string => Boolean(supplierId)),
    logisticsSuppliers: logisticsSupplierRows.map((row) => serializeSupplier(row.supplier)).filter((item) => item.id),
    creditDays: order.creditDays ?? "",
    dueDate: dateToInput(order.dueDate),
    reminderDays: order.reminderDays,
    status: order.status,
    remark: order.remark || "",
    createdBy: serializeUser(order.createdBy),
    updatedBy: serializeUser(order.updatedBy),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary: serializeOrderListSummary(summary),
  };
}

export type SerializedOrderListRowDto = ReturnType<typeof serializeOrderListRow>;
