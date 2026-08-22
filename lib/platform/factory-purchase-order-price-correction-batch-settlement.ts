import { type FactoryPurchaseOrderAdjustment } from "../generated/prisma/client.js";
import {
  assertMatchingExistingSettlementCost,
  settlementCostPaymentState,
  settlementOrderCost,
} from "./factory-purchase-order-settlement-cost";
import {
  confirmedFactoryPaymentTotal,
  factorySettlementStatusForNetPaid,
  latestConfirmedFactoryPaymentDate,
} from "./factory-purchase-order-settlement-values";
import {
  assertFactoryMoneyAmount,
  confirmedPriceCorrectionAdjustmentTotals,
  factoryPriceCorrectionSettlementSnapshot,
  type PriceCorrectionAuditRequest,
  type PriceCorrectionPurchaseOrder,
} from "./factory-purchase-order-price-correction-values";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import type { Prisma } from "../generated/prisma/client.js";

export async function applyPriceCorrectionBatchSettlement(
  tx: Prisma.TransactionClient,
  request: PriceCorrectionAuditRequest,
  actorId: string,
  purchaseOrder: PriceCorrectionPurchaseOrder,
  createdAdjustments: FactoryPurchaseOrderAdjustment[],
  reviewedAt: Date,
) {
  if (!purchaseOrder.settlement) return {};
  const settlementBefore = purchaseOrder.settlement;
  const totals = confirmedPriceCorrectionAdjustmentTotals([
    ...purchaseOrder.adjustments,
    ...createdAdjustments,
  ]);
  const nextFinalPayable = assertFactoryMoneyAmount(settlementBefore.baseAmount
    .add(totals.increase)
    .sub(totals.decrease)
    .sub(settlementBefore.delayPenaltyAmount)
    .toDecimalPlaces(2), "更正后的最终应付金额");
  if (nextFinalPayable.lt(0)) {
    throw codedError(
      "批量采购价格更正后的最终应付金额不能小于 0",
      409,
      "FACTORY_PRICE_CORRECTION_FINAL_PAYABLE_NEGATIVE",
    );
  }
  const netPaidAmount = confirmedFactoryPaymentTotal(purchaseOrder.payments);
  if (netPaidAmount.lt(0)) {
    throw codedError("累计退款不能超过已付款金额", 409, "FACTORY_SETTLEMENT_REFUND_EXCEEDS_PAID");
  }
  const nextStatus = factorySettlementStatusForNetPaid(nextFinalPayable, netPaidAmount);
  const confirmedPayments = purchaseOrder.payments.filter((payment) => payment.status === "CONFIRMED");
  const latestPaymentDate = confirmedPayments.length
    ? latestConfirmedFactoryPaymentDate(confirmedPayments, reviewedAt)
    : nextStatus === "SETTLED" && nextFinalPayable.eq(0)
      ? purchaseOrder.actualDeliveryDate || reviewedAt
      : null;
  const costBefore = await settlementOrderCost(tx, purchaseOrder.id);
  assertMatchingExistingSettlementCost(
    costBefore,
    purchaseOrder,
    settlementBefore.finalPayableAmount,
    settlementBefore.exchangeRate,
    settlementBefore.exchangeRateDate,
  );
  if (!costBefore) {
    throw codedError("工厂结算关联成本不存在或状态异常", 409, "FACTORY_SETTLEMENT_ORDER_COST_MISSING");
  }
  const remainsSettled = settlementBefore.status === "SETTLED" && nextStatus === "SETTLED";
  const settlementAfter = await tx.factoryPurchaseOrderSettlement.update({
    where: { id: settlementBefore.id },
    data: {
      increaseAmount: totals.increase.toDecimalPlaces(2),
      decreaseAmount: totals.decrease.toDecimalPlaces(2),
      finalPayableAmount: nextFinalPayable,
      paidAmountAtSettlement: netPaidAmount,
      status: nextStatus,
      settledAt: nextStatus === "SETTLED"
        ? remainsSettled ? settlementBefore.settledAt : reviewedAt
        : null,
      settledById: nextStatus === "SETTLED"
        ? remainsSettled ? settlementBefore.settledById : actorId
        : null,
      revision: { increment: 1 },
    },
  });
  const paymentState = settlementCostPaymentState(nextFinalPayable, netPaidAmount);
  const costAfter = await tx.orderCost.update({
    where: { id: costBefore.id },
    data: {
      amount: nextFinalPayable,
      amountCny: assertFactoryMoneyAmount(
        nextFinalPayable.mul(settlementBefore.exchangeRate).toDecimalPlaces(2),
        "更正后的人民币成本",
      ),
      paymentStatus: paymentState.paymentStatus,
      paid: paymentState.paid,
      paidAt: paymentState.paid ? latestPaymentDate : null,
      paymentDate: paymentState.paid ? latestPaymentDate : null,
      updatedById: actorId,
    },
  });
  await writeAudit(
    request,
    { id: actorId },
    "批量采购价格更正重算工厂最终应付",
    "factory_purchase_order_settlements",
    settlementBefore.id,
    settlementBefore,
    settlementAfter,
    tx,
  );
  await writeAudit(
    request,
    { id: actorId },
    "批量采购价格更正同步工厂货款成本",
    "order_costs",
    costBefore.id,
    costBefore,
    costAfter,
    tx,
  );
  return factoryPriceCorrectionSettlementSnapshot(settlementBefore, settlementAfter);
}
