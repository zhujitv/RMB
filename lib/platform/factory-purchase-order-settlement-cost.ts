import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import type { SettlementPurchaseOrder } from "./factory-purchase-order-settlement-query";
import {
  FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE,
  confirmedFactoryPaymentTotal,
  latestConfirmedFactoryPaymentDate,
  type FactoryPaymentLike,
} from "./factory-purchase-order-settlement-values";

export function settlementOrderCost(tx: Prisma.TransactionClient, purchaseOrderId: string) {
  return tx.orderCost.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE,
        sourceId: purchaseOrderId,
      },
    },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      supplierNameSnapshot: true,
      costType: true,
      vendorName: true,
      amount: true,
      amountCny: true,
      currency: true,
      exchangeRate: true,
      exchangeRateDate: true,
      exchangeRateSource: true,
      exchangeRateType: true,
      paymentStatus: true,
      paid: true,
      costConfirmed: true,
      costConfirmedAt: true,
      sourceType: true,
      sourceId: true,
      deletedAt: true,
      status: true,
    },
  });
}

export function assertMatchingExistingSettlementCost(
  cost: Awaited<ReturnType<typeof settlementOrderCost>>,
  purchaseOrder: SettlementPurchaseOrder,
  finalPayableAmount: Prisma.Decimal,
  exchangeRate: Prisma.Decimal,
  exchangeRateDate: Date,
) {
  if (!cost) return;
  const orderId = purchaseOrder.execution.receivableOrder?.id || "";
  const expectedAmountCny = finalPayableAmount.mul(exchangeRate).toDecimalPlaces(2);
  const expectedRateSource = purchaseOrder.purchaseCurrency === "CNY" ? "系统" : "历史录入";
  const expectedRateType = purchaseOrder.purchaseCurrency === "CNY" ? "人民币" : "采购结算";
  if (
    cost.deletedAt
    || cost.status !== "ACTIVE"
    || cost.orderId !== orderId
    || cost.supplierId !== purchaseOrder.supplierId
    || cost.supplierNameSnapshot !== purchaseOrder.supplierNameSnapshot
    || cost.costType !== "工厂货款"
    || cost.vendorName !== purchaseOrder.supplierNameSnapshot
    || cost.currency !== purchaseOrder.purchaseCurrency
    || !cost.amount.eq(finalPayableAmount)
    || !cost.amountCny.eq(expectedAmountCny)
    || !cost.exchangeRate.eq(exchangeRate)
    || !cost.exchangeRateDate
    || cost.exchangeRateDate.getTime() !== exchangeRateDate.getTime()
    || cost.exchangeRateSource !== expectedRateSource
    || cost.exchangeRateType !== expectedRateType
    || !cost.costConfirmed
    || !cost.costConfirmedAt
    || cost.sourceType !== FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE
    || cost.sourceId !== purchaseOrder.id
  ) {
    throw codedError("工厂结算关联成本与采购单不一致，请联系管理员处理", 409, "FACTORY_SETTLEMENT_ORDER_COST_CONFLICT");
  }
}

export async function createOrReuseSettlementCost(
  tx: Prisma.TransactionClient,
  purchaseOrder: SettlementPurchaseOrder,
  actorId: string,
  finalPayableAmount: Prisma.Decimal,
  exchangeRate: Prisma.Decimal,
  exchangeRateDate: Date,
  paidAmount: Prisma.Decimal,
  now: Date,
) {
  const existing = await settlementOrderCost(tx, purchaseOrder.id);
  assertMatchingExistingSettlementCost(existing, purchaseOrder, finalPayableAmount, exchangeRate, exchangeRateDate);
  if (existing) return { cost: existing, created: false };

  const fullyPaid = paidAmount.eq(finalPayableAmount);
  const partiallyPaid = paidAmount.gt(0) && !fullyPaid;
  const paymentDate = fullyPaid || partiallyPaid
    ? latestConfirmedFactoryPaymentDate(purchaseOrder.payments, purchaseOrder.actualDeliveryDate || now)
    : null;
  const orderId = purchaseOrder.execution.receivableOrder?.id;
  if (!orderId) {
    throw codedError("销售执行单尚未生成应收订单，不能完成采购结算", 409, "FACTORY_SETTLEMENT_RECEIVABLE_ORDER_REQUIRED");
  }
  const cost = await tx.orderCost.create({
    data: {
      orderId,
      supplierId: purchaseOrder.supplierId,
      supplierNameSnapshot: purchaseOrder.supplierNameSnapshot,
      costType: "工厂货款",
      vendorName: purchaseOrder.supplierNameSnapshot,
      currency: purchaseOrder.purchaseCurrency,
      exchangeRate,
      exchangeRateDate,
      exchangeRateSource: purchaseOrder.purchaseCurrency === "CNY" ? "系统" : "历史录入",
      exchangeRateType: purchaseOrder.purchaseCurrency === "CNY" ? "人民币" : "采购结算",
      amount: finalPayableAmount,
      amountCny: finalPayableAmount.mul(exchangeRate).toDecimalPlaces(2),
      paymentStatus: fullyPaid ? "已支付" : partiallyPaid ? "部分支付" : "待支付",
      paid: fullyPaid || partiallyPaid,
      paidAt: paymentDate,
      paymentDate,
      costConfirmed: true,
      costConfirmedAt: now,
      invoiceStatus: "未收到",
      sourceType: FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE,
      sourceId: purchaseOrder.id,
      remark: `由工厂采购单 ${purchaseOrder.poNo} 最终结算自动生成`,
      createdById: actorId,
      updatedById: actorId,
    },
    select: { id: true, paymentStatus: true, paid: true },
  });
  return { cost, created: true };
}

export async function syncFactorySettlementCostPayment(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  actorId: string,
  finalPayableAmount: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
  paymentDate: Date | null,
) {
  const fullyPaid = paidAmount.eq(finalPayableAmount);
  const partiallyPaid = paidAmount.gt(0) && !fullyPaid;
  const changed = await tx.orderCost.updateMany({
    where: {
      sourceType: FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE,
      sourceId: purchaseOrderId,
      deletedAt: null,
      status: "ACTIVE",
    },
    data: {
      paymentStatus: fullyPaid ? "已支付" : partiallyPaid ? "部分支付" : "待支付",
      paid: fullyPaid || partiallyPaid,
      paidAt: fullyPaid || partiallyPaid ? paymentDate : null,
      paymentDate: fullyPaid || partiallyPaid ? paymentDate : null,
      updatedById: actorId,
    },
  });
  if (changed.count !== 1) {
    throw codedError("工厂结算关联成本不存在或状态异常", 409, "FACTORY_SETTLEMENT_ORDER_COST_MISSING");
  }
}

export async function finalizeFactorySettlementAfterPayment(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  actorId: string,
  settlement: { id: string; status: string; finalPayableAmount: Prisma.Decimal },
  payments: FactoryPaymentLike[],
  paidAt: Date,
) {
  const paidAmount = confirmedFactoryPaymentTotal(payments);
  if (paidAmount.gt(settlement.finalPayableAmount)) {
    throw codedError("累计采购付款不能超过最终应付金额", 409, "FACTORY_SETTLEMENT_PAYMENT_EXCEEDS_PAYABLE");
  }
  const latestPaidAt = latestConfirmedFactoryPaymentDate(payments, paidAt);
  await syncFactorySettlementCostPayment(
    tx,
    purchaseOrderId,
    actorId,
    settlement.finalPayableAmount,
    paidAmount,
    paidAmount.gt(0) ? latestPaidAt : null,
  );
  if (paidAmount.eq(settlement.finalPayableAmount) && settlement.status !== "SETTLED") {
    const changed = await tx.factoryPurchaseOrderSettlement.updateMany({
      where: { id: settlement.id, status: "PENDING_PAYMENT" },
      data: {
        paidAmountAtSettlement: paidAmount,
        status: "SETTLED",
        settledAt: new Date(),
        settledById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw codedError("采购结算状态已变化，请刷新后重试", 409, "FACTORY_SETTLEMENT_STATE_CONFLICT");
    }
  }
  return { paidAmount, fullyPaid: paidAmount.eq(settlement.finalPayableAmount) };
}
