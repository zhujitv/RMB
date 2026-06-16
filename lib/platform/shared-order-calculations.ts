import { nonEmpty, normalizeEmail, num } from "./shared-base-utils";
import { COMMISSION_LOGISTICS_COST_TYPES, NON_PARTICIPATING_COST_TYPES } from "./shared-constants";

type PaymentLike = {
  status?: string | null;
  deletedAt?: Date | string | null;
  amountCny?: number | string | null;
  paymentType?: string | null;
};

type CostLike = {
  paymentStatus?: string | null;
  deletedAt?: Date | string | null;
  costType?: string | null;
  costConfirmed?: boolean | null;
  amountCny?: number | string | null;
  createdById?: string | null;
};

type SalespersonLike = {
  name?: string | null;
  email?: string | null;
};

type OrderLike = {
  salespersonUserId?: string | null;
  salesperson?: SalespersonLike | null;
  salespersonCommissionRate?: number | string | null;
  commissionStatus?: string | null;
  status?: string | null;
  receivableAmount?: number | string | null;
  receivableAmountCny?: number | string | null;
  estimatedReceivableAmount?: number | string | null;
  estimatedReceivableAmountCny?: number | string | null;
  actualShipmentAmount?: number | string | null;
  actualShipmentAmountCny?: number | string | null;
  finalReceivableAmount?: number | string | null;
  finalReceivableAmountCny?: number | string | null;
  exchangeRate?: number | string | null;
  depositRatio?: number | string | null;
  dueDate?: Date | null;
  reminderDays?: number | string | null;
  payments?: PaymentLike[] | null;
  costs?: CostLike[] | null;
};

type OrderSummary = {
  commissionRate: number;
  realSalespersonSet: boolean;
  arrivedOutstandingCny: number;
  allCostsConfirmed: boolean;
  logisticsCostConfirmed: boolean;
  settleableCommissionCny: number;
  commissionStatus?: string;
  commissionCanSettle?: boolean;
  commissionAmountCny?: number;
  reminderStatus?: string;
  overdueDays?: number;
  [key: string]: unknown;
};

type ReminderResult = {
  status: string;
  overdueDays: number;
};

export function confirmedPayment(payment: PaymentLike) {
  return payment.status === "已到账" && !payment.deletedAt;
}

export function validCost(cost: CostLike) {
  return cost.paymentStatus !== "已取消" && !cost.deletedAt && !NON_PARTICIPATING_COST_TYPES.includes(cost.costType || "");
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

export function roundMoney(value: unknown) {
  return Math.round(num(value) * 100) / 100;
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
  if (summary.arrivedOutstandingCny > 0 || !["已收齐", "多收款"].includes(order.status || "")) return "不可结算：订单未收齐";
  if (!summary.allCostsConfirmed) return "不可结算：成本未全部确认";
  if (!summary.logisticsCostConfirmed) return "不可结算：物流成本未确认";
  if (summary.settleableCommissionCny <= 0) return "不可结算：提成金额为0";
  return "可结算";
}

export function depositRatioForPaymentTerm(paymentTermType: string | null | undefined, before?: { depositRatio?: number | string | null } | null) {
  if (!paymentTermType && before) return before.depositRatio == null ? null : Number(before.depositRatio);
  return null;
}

export function calcReminderStatus({
  outstandingCny,
  dueDate,
  reminderDays,
}: {
  outstandingCny: number;
  dueDate?: Date | null;
  reminderDays?: number | string | null;
}): ReminderResult {
  if (outstandingCny <= 0) return { status: "已结清", overdueDays: 0 };
  if (!dueDate) return { status: "未到期", overdueDays: 0 };
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const diff = Math.round((due.getTime() - todayDate.getTime()) / 86400000);
  if (diff < 0) return { status: "已逾期", overdueDays: Math.abs(diff) };
  if (diff <= Number(reminderDays || 0)) return { status: "即将到期", overdueDays: 0 };
  return { status: "未到期", overdueDays: 0 };
}

export function summarizeOrder(order: OrderLike) {
  const estimatedAmount = Number(order.estimatedReceivableAmount ?? order.receivableAmount);
  const estimatedCny = Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny);
  const actualAmount = order.actualShipmentAmount == null ? null : Number(order.actualShipmentAmount);
  const actualCny = order.actualShipmentAmountCny == null ? null : Number(order.actualShipmentAmountCny);
  const finalAmount = Number(order.finalReceivableAmount ?? (actualAmount ?? estimatedAmount));
  const finalCny = Number(order.finalReceivableAmountCny ?? (actualCny ?? estimatedCny));
  const receivableCny = finalCny;
  const receivableAmount = finalAmount;
  const exchangeRate = Number(order.exchangeRate) || 1;
  const confirmedPaymentsCny = (order.payments || [])
    .filter(confirmedPayment)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const arrivedPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const receivedDepositCny = (order.payments || [])
    .filter((payment) => payment.paymentType === "预付款" && payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const pendingPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "待确认" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
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
  const arrivedBalanceCny = receivableCny - arrivedPaymentsCny;
  const arrivedOutstandingCny = Math.max(arrivedBalanceCny, 0);
  const balanceCny = receivableCny - confirmedPaymentsCny;
  const outstandingCny = Math.max(balanceCny, 0);
  const overpaidCny = Math.max(-balanceCny, 0);
  const balanceAmount = receivableAmount - (confirmedPaymentsCny / exchangeRate);
  const outstandingAmount = Math.max(balanceAmount, 0);
  const overpaidAmount = Math.max(-balanceAmount, 0);
  const depositRatio = order.depositRatio == null ? null : Number(order.depositRatio);
  const requiredDepositAmount = depositRatio == null ? 0 : Math.round(receivableCny * depositRatio * 100) / 100;
  const depositGapCny = Math.max(requiredDepositAmount - receivedDepositCny, 0);
  const depositOverpaidCny = Math.max(receivedDepositCny - requiredDepositAmount, 0);
  const expectedGrossProfit = receivableCny - confirmedTotalCostCny;
  const expectedGrossMargin = receivableCny > 0 ? expectedGrossProfit / receivableCny : null;
  const realizedGrossProfit = arrivedPaymentsCny - paidConfirmedCostCny;
  const realizedGrossMargin = arrivedPaymentsCny > 0 ? realizedGrossProfit / arrivedPaymentsCny : null;
  const commissionRate = commissionRateFromOrder(order);
  const realSalespersonSet = hasRealSalesperson(order);
  const allCostsAreConfirmed = allCostsConfirmed(order.costs || []);
  const logisticsCostConfirmed = logisticsCostsConfirmed(logisticsCosts);
  const estimatedCommissionBaseCny = Math.max(expectedGrossProfit, 0);
  const estimatedCommissionCny = roundMoney((estimatedCommissionBaseCny * commissionRate) / 100);
  const settleableCommissionBaseCny = Math.max(expectedGrossProfit, 0);
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
    arrivedPaymentsCny,
    prepaidAmountCny: receivedDepositCny,
    receivedDepositCny,
    requiredDepositAmount,
    requiredDepositAmountCny: requiredDepositAmount,
    depositGapCny,
    depositOverpaidCny,
    depositRatio,
    pendingPaymentsCny,
    arrivedBalanceCny,
    arrivedOutstandingCny,
    balanceCny,
    balanceAmount,
    outstandingCny,
    outstandingAmount,
    overpaidCny,
    overpaidAmount,
    isOverpaid: overpaidCny > 0,
    isUnderpaid: outstandingCny > 0,
    totalCostCny,
    confirmedTotalCostCny,
    paidConfirmedCostCny,
    logisticsCostCny,
    confirmedLogisticsCostCny: logisticsCostConfirmed ? logisticsCostCny : 0,
    allCostsConfirmed: allCostsAreConfirmed,
    logisticsCostConfirmed,
    realSalespersonSet,
    commissionRate,
    commissionBaseCny: estimatedCommissionBaseCny,
    estimatedCommissionBaseCny,
    estimatedCommissionCny,
    settleableCommissionBaseCny,
    settleableCommissionCny,
    expectedGrossProfit,
    expectedGrossMargin,
    realizedGrossProfit,
    realizedGrossMargin,
    actualGrossProfit: realizedGrossProfit,
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
