import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import {
  FACTORY_DELAY_GRACE_DAYS,
  FACTORY_DELAY_RATE_PER_DAY,
  calculateFactoryDelayPenalty,
} from "./factory-purchase-order-financials";
import { requiredFactoryLedgerDate } from "./factory-purchase-order-ledger-values";

export const FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE = "FACTORY_PURCHASE_SETTLEMENT";
export const FACTORY_PURCHASE_SETTLEMENT_PENALTY_SOURCE_TYPE = "FACTORY_PURCHASE_SETTLEMENT_DELAY_PENALTY";

export type FactoryPaymentLike = {
  id?: string;
  sequenceNo?: number;
  status: string;
  kind?: string;
  amount: Prisma.Decimal;
  paidAt: Date;
};

export type FactoryPurchaseSettlementStatus = "PENDING_PAYMENT" | "PENDING_REFUND" | "SETTLED";

type SettlementSnapshotLike = {
  id: string;
  purchaseOrderId: string;
  revision: number;
  baseAmount: Prisma.Decimal;
  increaseAmount: Prisma.Decimal;
  decreaseAmount: Prisma.Decimal;
  delayDays: number;
  delayPenaltyAmount: Prisma.Decimal;
  finalPayableAmount: Prisma.Decimal;
  currency: string;
  exchangeRate: Prisma.Decimal;
  exchangeRateDate: Date;
  paidAmountAtSettlement: Prisma.Decimal;
  status: string;
  settledAt: Date | null;
  settledById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function factorySettlementExpectedRevision(input: Record<string, unknown>) {
  const revision = input.expectedRevision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
    throw codedError("缺少有效的采购单版本，请刷新后重试", 409, "FACTORY_SETTLEMENT_REVISION_CONFLICT");
  }
  return revision;
}

export function factorySettlementExchangeRate(input: Record<string, unknown>, currency: string) {
  if (currency === "CNY") return new Prisma.Decimal(1);
  const raw = typeof input.exchangeRate === "string" || typeof input.exchangeRate === "number"
    ? String(input.exchangeRate).trim()
    : "";
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(raw)) {
    throw codedError("非人民币采购结算必须填写最多六位小数的有效汇率", 400, "FACTORY_SETTLEMENT_EXCHANGE_RATE_REQUIRED");
  }
  const rate = new Prisma.Decimal(raw);
  if (!rate.gt(0)) {
    throw codedError("采购结算汇率必须大于 0", 400, "FACTORY_SETTLEMENT_EXCHANGE_RATE_REQUIRED");
  }
  return rate.toDecimalPlaces(6);
}

export function factorySettlementExchangeRateDate(input: Record<string, unknown>, actualDeliveryDate: Date) {
  if (typeof input.exchangeRateDate !== "string" || !input.exchangeRateDate.trim()) return actualDeliveryDate;
  return requiredFactoryLedgerDate(input.exchangeRateDate, "结算汇率日期", false);
}

function decimalSum(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

export function calculateFactorySettlementAmounts({
  baseAmount: baseAmountInput,
  penaltyBaseAmount: penaltyBaseAmountInput,
  initialDeliveryDate,
  actualDeliveryDate,
  adjustments,
  graceDays = FACTORY_DELAY_GRACE_DAYS,
  ratePerDay = FACTORY_DELAY_RATE_PER_DAY,
  capRatio = null,
}: {
  baseAmount: Prisma.Decimal | string | number;
  penaltyBaseAmount?: Prisma.Decimal | string | number;
  initialDeliveryDate: Date | string;
  actualDeliveryDate: Date | string;
  adjustments: Array<{
    kind: string;
    direction: string;
    amount: Prisma.Decimal | string | number;
  }>;
  graceDays?: number;
  ratePerDay?: Prisma.Decimal | string | number;
  capRatio?: Prisma.Decimal | string | number | null;
}) {
  const baseAmount = new Prisma.Decimal(baseAmountInput).toDecimalPlaces(2);
  const penaltyBaseAmount = penaltyBaseAmountInput == null
    ? baseAmount
    : new Prisma.Decimal(penaltyBaseAmountInput).toDecimalPlaces(2);
  const penalty = calculateFactoryDelayPenalty({
    initialDeliveryDate,
    actualDeliveryDate,
    penaltyBaseAmount,
    graceDays,
    ratePerDay,
    capRatio,
  });
  const ordinaryAdjustments = adjustments.filter((adjustment) => adjustment.kind !== "DELAY_PENALTY");
  const increaseAmount = decimalSum(ordinaryAdjustments
    .filter((adjustment) => adjustment.direction === "INCREASE")
    .map((adjustment) => new Prisma.Decimal(adjustment.amount)));
  const decreaseAmount = decimalSum(ordinaryAdjustments
    .filter((adjustment) => adjustment.direction === "DECREASE")
    .map((adjustment) => new Prisma.Decimal(adjustment.amount)));
  const finalPayableAmount = baseAmount
    .add(increaseAmount)
    .sub(decreaseAmount)
    .sub(penalty.amount)
    .toDecimalPlaces(2);
  return {
    baseAmount,
    increaseAmount,
    decreaseAmount,
    delayDays: penalty.delayDays,
    delayPenaltyAmount: penalty.amount,
    finalPayableAmount,
  };
}

export function confirmedFactoryPaymentTotal(payments: FactoryPaymentLike[]) {
  return decimalSum(payments
    .filter((payment) => payment.status === "CONFIRMED")
    .map((payment) => payment.kind === "REFUND" ? payment.amount.negated() : payment.amount));
}

export function assertFactoryPaymentRunningBalance(payments: FactoryPaymentLike[]) {
  let running = new Prisma.Decimal(0);
  const confirmed = payments
    .filter((payment) => payment.status === "CONFIRMED")
    .sort((left, right) => left.paidAt.getTime() - right.paidAt.getTime()
      || Number(left.sequenceNo || 0) - Number(right.sequenceNo || 0)
      || String(left.id || "").localeCompare(String(right.id || "")));
  for (const payment of confirmed) {
    running = payment.kind === "REFUND" ? running.sub(payment.amount) : running.add(payment.amount);
    if (running.lt(0)) {
      throw codedError(
        "按付款日期核算时退款早于或超过此前付款，请核对退款日期和金额",
        409,
        "FACTORY_SETTLEMENT_RUNNING_BALANCE_NEGATIVE",
      );
    }
  }
  return running.toDecimalPlaces(2);
}

export function factorySettlementStatusForNetPaid(
  finalPayableAmount: Prisma.Decimal,
  netPaidAmount: Prisma.Decimal,
): FactoryPurchaseSettlementStatus {
  if (netPaidAmount.lt(finalPayableAmount)) return "PENDING_PAYMENT";
  if (netPaidAmount.gt(finalPayableAmount)) return "PENDING_REFUND";
  return "SETTLED";
}

export function latestConfirmedFactoryPaymentDate(payments: FactoryPaymentLike[], fallback: Date) {
  return payments
    .filter((payment) => payment.status === "CONFIRMED")
    .reduce<Date | null>(
      (latest, payment) => !latest || payment.paidAt.getTime() > latest.getTime() ? payment.paidAt : latest,
      null,
    ) || fallback;
}

export function factorySettlementDto(
  settlement: SettlementSnapshotLike,
  cost: { id: string; paymentStatus: string; paid: boolean } | null,
) {
  return {
    id: settlement.id,
    purchaseOrderId: settlement.purchaseOrderId,
    revision: settlement.revision,
    baseAmount: settlement.baseAmount.toString(),
    increaseAmount: settlement.increaseAmount.toString(),
    decreaseAmount: settlement.decreaseAmount.toString(),
    delayDays: settlement.delayDays,
    delayPenaltyAmount: settlement.delayPenaltyAmount.toString(),
    finalPayableAmount: settlement.finalPayableAmount.toString(),
    currency: settlement.currency,
    exchangeRate: settlement.exchangeRate.toString(),
    exchangeRateDate: settlement.exchangeRateDate,
    paidAmountAtSettlement: settlement.paidAmountAtSettlement.toString(),
    status: settlement.status,
    settledAt: settlement.settledAt,
    settledById: settlement.settledById,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
    orderCost: cost,
  };
}
