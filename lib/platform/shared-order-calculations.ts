import { nonEmpty, normalizeEmail } from "./shared-base-utils";
import { calculateCommissionFormulaBase } from "./commission-formula";
import { COMMISSION_LOGISTICS_COST_TYPES, NON_PARTICIPATING_COST_TYPES, ORDER_COST_STATUS_VOID } from "./shared-constants";
import { taxDocumentCompleteness } from "./shared-tax-completeness";
import type { CostLike, NumericLike, OrderLike, OrderSummary, TaxLogisticsMissingItem } from "./shared-order-calculation-types";
import { calcReminderStatus } from "./shared-order-reminders";
import {
  confirmedPayment,
  deriveOrderCollectionBalance,
  hasArrivedPaymentCurrencyMismatch,
  paymentAmountForOrderCurrency,
  roundMoney,
} from "./shared-order-collections";

export type { OrderSummary, PaymentLike } from "./shared-order-calculation-types";
export {
  confirmedPayment,
  deriveOrderCollectionBalance,
  deriveOrderCollectionStatus,
  hasArrivedPaymentCurrencyMismatch,
  paymentAmountForOrderCurrency,
  roundMoney,
} from "./shared-order-collections";
export { calcReminderStatus } from "./shared-order-reminders";

export function validCost(cost: CostLike) {
  return cost.status !== ORDER_COST_STATUS_VOID
    && cost.paymentStatus !== "已取消"
    && !cost.deletedAt
    && !NON_PARTICIPATING_COST_TYPES.includes(cost.costType || "");
}

export function confirmedCost(cost: CostLike) {
  return validCost(cost) && cost.costConfirmed === true;
}

export function paidConfirmedCost(cost: CostLike) {
  return confirmedCost(cost) && cost.paymentStatus === "已支付";
}

export function commissionRateFromOrder(order: OrderLike) {
  return Math.max(0, Number(order.salespersonCommissionRate || 0));
}

export function profitMarginEligible(order: OrderLike) {
  return Boolean(order.actualShipmentDate) || order.actualShipmentAmount != null;
}

export function commissionLogisticsCosts(order: OrderLike) {
  return (order.costs || []).filter((cost) => validCost(cost) && COMMISSION_LOGISTICS_COST_TYPES.includes(cost.costType || ""));
}

export function logisticsCostsConfirmed(costs: CostLike[]) {
  return costs.length > 0 && costs.every((cost) => cost.costConfirmed === true);
}

export function allCostsConfirmed(costs: CostLike[] = []) {
  const validCosts = costs.filter(validCost);
  return validCosts.length > 0 && validCosts.every((cost) => cost.costConfirmed === true);
}

export function hasRealSalesperson(order: OrderLike) {
  if (!order.salespersonUserId || !order.salesperson) return false;
  const name = nonEmpty(order.salesperson.name);
  const email = normalizeEmail(order.salesperson.email);
  if (name === "默认管理员") return false;
  if (email === "admin@example.com") return false;
  return true;
}

export function derivedCommissionStatus(order: OrderLike, summary: OrderSummary) {
  if (["已结算", "SETTLED"].includes(order.commissionStatus || "")) return "已结算";
  if (summary.commissionRate <= 0) return "不可结算：提成比例未设置";
  if (!summary.realSalespersonSet) return "不可结算：未分配真实业务员";
  if (summary.hasArrivedPaymentCurrencyMismatch) return "不可结算：收款币种异常";
  if (["草稿", "已关闭", "已取消"].includes(order.status || "") || summary.arrivedOutstandingAmount > 0) return "不可结算：订单未收齐";
  if (!summary.taxLogisticsCostsComplete) return "不可结算：物流费用未完整";
  if (!summary.allCostsConfirmed) return "不可结算：成本未全部确认";
  if (!summary.logisticsCostConfirmed) return "不可结算：物流成本未确认";
  if (summary.settleableCommissionCny <= 0) return "不可结算：提成金额为0";
  return "可结算";
}

export function depositRatioForPaymentTerm(paymentTermType: string | null | undefined, before?: { depositRatio?: NumericLike | null } | null) {
  if (!paymentTermType && before) return before.depositRatio == null ? null : Number(before.depositRatio);
  return null;
}

export function summarizeOrder(order: OrderLike, commissionFormulaSettings?: Record<string, unknown> | null): OrderSummary {
  const estimatedAmount = Number(order.estimatedReceivableAmount ?? order.receivableAmount);
  const estimatedCny = Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny);
  const actualAmount = order.actualShipmentAmount == null ? null : Number(order.actualShipmentAmount);
  const actualCny = order.actualShipmentAmountCny == null ? null : Number(order.actualShipmentAmountCny);
  const finalAmount = Number(order.finalReceivableAmount ?? (actualAmount ?? estimatedAmount));
  const finalCny = Number(order.finalReceivableAmountCny ?? (actualCny ?? estimatedCny));
  const receivableCny = finalCny;
  const receivableAmount = finalAmount;
  const exchangeRate = Number(order.exchangeRate) || 1;
  const orderCurrency = String(order.currency || "CNY").toUpperCase();
  const hasArrivedPaymentCurrencyMismatchValue = hasArrivedPaymentCurrencyMismatch(order);
  const confirmedPaymentsCny = (order.payments || [])
    .filter(confirmedPayment)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const confirmedPaymentsAmount = (order.payments || [])
    .filter(confirmedPayment)
    .reduce((sum, payment) => sum + paymentAmountForOrderCurrency(payment, orderCurrency, exchangeRate), 0);
  const arrivedPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const arrivedPaymentsAmount = (order.payments || [])
    .filter((payment) => payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + paymentAmountForOrderCurrency(payment, orderCurrency, exchangeRate), 0);
  const receivedDepositCny = (order.payments || [])
    .filter((payment) => payment.paymentType === "预付款" && payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const receivedDepositAmount = (order.payments || [])
    .filter((payment) => payment.paymentType === "预付款" && payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + paymentAmountForOrderCurrency(payment, orderCurrency, exchangeRate), 0);
  const pendingPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "待确认" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const pendingPaymentsAmount = (order.payments || [])
    .filter((payment) => payment.status === "待确认" && !payment.deletedAt)
    .reduce((sum, payment) => sum + paymentAmountForOrderCurrency(payment, orderCurrency, exchangeRate), 0);
  const totalCostCny = (order.costs || [])
    .filter(validCost)
    .reduce((sum, cost) => sum + Number(cost.amountCny), 0);
  const confirmedTotalCostCny = (order.costs || [])
    .filter(confirmedCost)
    .reduce((sum, cost) => sum + Number(cost.amountCny), 0);
  const paidConfirmedCostCny = (order.costs || [])
    .filter(paidConfirmedCost)
    .reduce((sum, cost) => sum + Number(cost.amountCny), 0);
  const logisticsCosts = commissionLogisticsCosts(order);
  const logisticsCostCny = logisticsCosts.reduce((sum, cost) => sum + Number(cost.amountCny), 0);
  const taxCompleteness = taxDocumentCompleteness(order);
  const taxLogisticsMissing = (taxCompleteness.logistics?.missing || []) as TaxLogisticsMissingItem[];
  const taxLogisticsCostsComplete = taxLogisticsMissing.length === 0;
  const arrivedCollection = deriveOrderCollectionBalance({
    receivableAmount,
    receivedAmount: arrivedPaymentsAmount,
    receivedAmountCny: arrivedPaymentsCny,
    orderExchangeRate: exchangeRate,
  });
  const confirmedCollection = deriveOrderCollectionBalance({
    receivableAmount,
    receivedAmount: confirmedPaymentsAmount,
    receivedAmountCny: confirmedPaymentsCny,
    orderExchangeRate: exchangeRate,
  });
  const arrivedBalanceAmount = arrivedCollection.balanceAmount;
  const arrivedBalanceCny = arrivedCollection.balanceCny;
  const arrivedOutstandingAmount = arrivedCollection.outstandingAmount;
  const arrivedOutstandingCny = arrivedCollection.outstandingCny;
  const balanceCny = confirmedCollection.balanceCny;
  const balanceAmount = confirmedCollection.balanceAmount;
  const outstandingCny = confirmedCollection.outstandingCny;
  const outstandingAmount = confirmedCollection.outstandingAmount;
  const overpaidCny = confirmedCollection.overpaidCny;
  const overpaidAmount = confirmedCollection.overpaidAmount;
  const exchangeDifferenceCny = confirmedCollection.exchangeDifferenceCny;
  const depositRatio = order.depositRatio == null ? null : Number(order.depositRatio);
  const requiredDepositOriginalAmount = depositRatio == null ? 0 : roundMoney(receivableAmount * depositRatio);
  const requiredDepositAmount = roundMoney(requiredDepositOriginalAmount * exchangeRate);
  const depositGapCny = roundMoney(Math.max(requiredDepositOriginalAmount - receivedDepositAmount, 0) * exchangeRate);
  const depositOverpaidCny = roundMoney(Math.max(receivedDepositAmount - requiredDepositOriginalAmount, 0) * exchangeRate);
  const expectedTaxRefundIncomeCny = 0;
  const expectedGrossProfit = receivableCny - confirmedTotalCostCny + expectedTaxRefundIncomeCny;
  const marginEligible = profitMarginEligible(order);
  const expectedGrossMargin = marginEligible && receivableCny > 0 ? expectedGrossProfit / receivableCny : null;
  const revenueRecognized = marginEligible && receivableAmount > 0 && arrivedOutstandingAmount <= 0;
  const realizedGrossProfit = revenueRecognized ? expectedGrossProfit : null;
  const realizedGrossMargin = realizedGrossProfit != null && receivableCny > 0 ? realizedGrossProfit / receivableCny : null;
  const netCashFlowCny = arrivedPaymentsCny - paidConfirmedCostCny;
  const commissionRate = commissionRateFromOrder(order);
  const realSalespersonSet = hasRealSalesperson(order);
  const allCostsAreConfirmed = allCostsConfirmed(order.costs || []);
  const logisticsCostConfirmed = logisticsCostsConfirmed(logisticsCosts);
  const commissionFormula = calculateCommissionFormulaBase({
    receivableCny,
    arrivedPaymentsCny,
    totalCostCny,
    confirmedTotalCostCny,
    paidConfirmedCostCny,
    logisticsCostCny,
    expectedGrossProfit,
    realizedGrossProfit,
  }, commissionFormulaSettings);
  const estimatedCommissionBaseCny = commissionFormula.baseCny;
  const estimatedCommissionCny = roundMoney((estimatedCommissionBaseCny * commissionRate) / 100);
  const settleableCommissionBaseCny = commissionFormula.baseCny;
  const settleableCommissionCny = roundMoney((settleableCommissionBaseCny * commissionRate) / 100);
  const reminder = calcReminderStatus({
    outstandingCny,
    dueDate: order.dueDate,
    reminderDays: order.reminderDays,
  });

  const summary: OrderSummary = {
    receivableCny,
    receivableAmount,
    estimatedReceivableAmount: estimatedAmount,
    estimatedReceivableAmountCny: estimatedCny,
    actualShipmentAmount: actualAmount,
    actualShipmentAmountCny: actualCny,
    finalReceivableAmount: finalAmount,
    finalReceivableAmountCny: finalCny,
    confirmedPaymentsCny,
    confirmedPaymentsAmount,
    arrivedPaymentsCny,
    arrivedPaymentsAmount,
    prepaidAmountCny: receivedDepositCny,
    receivedDepositCny,
    receivedDepositAmount,
    requiredDepositAmount,
    requiredDepositAmountCny: requiredDepositAmount,
    depositGapCny,
    depositOverpaidCny,
    depositRatio,
    pendingPaymentsCny,
    pendingPaymentsAmount,
    arrivedBalanceAmount,
    arrivedBalanceCny,
    arrivedOutstandingAmount,
    arrivedOutstandingCny,
    balanceCny,
    balanceAmount,
    outstandingCny,
    outstandingAmount,
    overpaidCny,
    overpaidAmount,
    exchangeDifferenceCny,
    hasArrivedPaymentCurrencyMismatch: hasArrivedPaymentCurrencyMismatchValue,
    isOverpaid: overpaidAmount > 0,
    isUnderpaid: outstandingAmount > 0,
    totalCostCny,
    confirmedTotalCostCny,
    paidConfirmedCostCny,
    logisticsCostCny,
    confirmedLogisticsCostCny: logisticsCostConfirmed ? logisticsCostCny : 0,
    expectedTaxRefundIncomeCny,
    taxLogisticsCostsComplete,
    taxLogisticsMissing,
    taxLogisticsMissingLabels: taxLogisticsMissing.map((item) => item.label || item.invoiceLabel || item.missingCostLabel || item.costType || "物流费用").filter(Boolean),
    allCostsConfirmed: allCostsAreConfirmed,
    logisticsCostConfirmed,
    realSalespersonSet,
    commissionRate,
    commissionFormulaMode: commissionFormula.mode,
    commissionFormulaLabel: commissionFormula.label,
    commissionFormulaDescription: commissionFormula.description,
    commissionFormulaSource: commissionFormula.source,
    commissionFormulaDeductions: commissionFormula.deductions,
    commissionFormulaFloorAtZero: commissionFormula.floorAtZero,
    commissionBaseCny: estimatedCommissionBaseCny,
    estimatedCommissionBaseCny,
    estimatedCommissionCny,
    settleableCommissionBaseCny,
    settleableCommissionCny,
    expectedGrossProfit,
    profitMarginEligible: marginEligible,
    expectedGrossMargin,
    realizedGrossProfit,
    realizedGrossMargin,
    actualGrossProfit: realizedGrossProfit,
    netCashFlowCny,
    grossMargin: expectedGrossMargin,
    reminderStatus: reminder.status,
    overdueDays: reminder.overdueDays,
  };
  summary.commissionStatus = derivedCommissionStatus(order, summary);
  summary.commissionCanSettle = summary.commissionStatus === "可结算";
  summary.commissionAmountCny = summary.commissionStatus === "已结算" || summary.commissionCanSettle
    ? settleableCommissionCny
    : estimatedCommissionCny;
  return summary;
}
