import { Prisma } from "../generated/prisma/client.js";

type LooseRecord = Record<string, unknown>;

function record(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function decimalText(value: unknown, fallback = "0") {
  if (value === null || value === undefined || value === "") return fallback;
  return Prisma.Decimal.isDecimal(value) ? value.toString() : String(value);
}

export function serializePurchaseOrderRelations(order: LooseRecord) {
  const responseHistory = Array.isArray(order.supplierResponses)
    ? order.supplierResponses.map((responseValue) => {
      const response = record(responseValue);
      const internalDecidedBy = record(response.internalDecidedBy);
      return {
        sequence: Number(response.responseSequence || 0), action: String(response.action || ""),
        deliveryDate: response.deliveryDate || null, remark: String(response.remark || ""),
        respondedAt: response.respondedAt || null, internalDecision: String(response.internalDecision || ""),
        internalDecisionRemark: String(response.internalDecisionRemark || ""),
        internalDecidedAt: response.internalDecidedAt || null,
        internalDecidedBy: internalDecidedBy.id
          ? { id: String(internalDecidedBy.id), name: String(internalDecidedBy.name || "") } : null,
      };
    }) : [];
  const payments = Array.isArray(order.payments)
    ? order.payments.map((paymentValue) => {
      const payment = record(paymentValue);
      return {
        id: String(payment.id || ""), sequenceNo: Number(payment.sequenceNo || 0),
        kind: String(payment.kind || "PREPAYMENT"), amount: decimalText(payment.amount),
        currency: String(payment.currency || order.purchaseCurrency || ""), paidAt: payment.paidAt || null,
        bankReference: String(payment.bankReference || ""), remark: String(payment.remark || ""),
        status: String(payment.status || "CONFIRMED"), voidedAt: payment.voidedAt || null,
        voidReason: String(payment.voidReason || ""),
      };
    }) : [];
  const adjustments = Array.isArray(order.adjustments)
    ? order.adjustments.map((adjustmentValue) => {
      const adjustment = record(adjustmentValue);
      return {
        id: String(adjustment.id || ""), sequenceNo: Number(adjustment.sequenceNo || 0),
        kind: String(adjustment.kind || "TEMPORARY_FEE"), direction: String(adjustment.direction || "INCREASE"),
        amount: decimalText(adjustment.amount), currency: String(adjustment.currency || order.purchaseCurrency || ""),
        description: String(adjustment.description || ""), occurredAt: adjustment.occurredAt || null,
        status: String(adjustment.status || "PROVISIONAL"),
      };
    }) : [];
  return { responseHistory, payments, adjustments };
}

export function serializePurchaseOrderSettlement(
  order: LooseRecord,
  confirmedPaymentAmount: Prisma.Decimal,
) {
  const settlement = record(order.settlement);
  if (!settlement.id) return null;
  const finalPayable = new Prisma.Decimal(decimalText(settlement.finalPayableAmount));
  const remaining = finalPayable.sub(confirmedPaymentAmount);
  const createdBy = record(settlement.createdBy);
  const settledBy = record(settlement.settledBy);
  return {
    id: String(settlement.id), baseAmount: decimalText(settlement.baseAmount),
    increaseAmount: decimalText(settlement.increaseAmount), decreaseAmount: decimalText(settlement.decreaseAmount),
    delayDays: Number(settlement.delayDays || 0), delayPenaltyAmount: decimalText(settlement.delayPenaltyAmount),
    finalPayableAmount: finalPayable.toString(), currency: String(settlement.currency || order.purchaseCurrency || ""),
    exchangeRate: decimalText(settlement.exchangeRate, "1"), exchangeRateDate: settlement.exchangeRateDate || null,
    paidAmountAtSettlement: decimalText(settlement.paidAmountAtSettlement),
    currentPaidAmount: confirmedPaymentAmount.toString(),
    remainingAmount: (remaining.gt(0) ? remaining : new Prisma.Decimal(0)).toDecimalPlaces(2).toString(),
    status: String(settlement.status || "PENDING_PAYMENT"), settledAt: settlement.settledAt || null,
    createdAt: settlement.createdAt || null, updatedAt: settlement.updatedAt || null,
    createdBy: createdBy.id ? { id: String(createdBy.id), name: String(createdBy.name || "") } : null,
    settledBy: settledBy.id ? { id: String(settledBy.id), name: String(settledBy.name || "") } : null,
  };
}
