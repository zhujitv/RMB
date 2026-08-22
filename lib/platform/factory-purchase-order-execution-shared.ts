import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { todayInChina } from "./quotation-date-values";
import { factoryPrepaymentRequiredAmount } from "./factory-purchase-order-financials";
import { confirmedFactoryPaymentTotal } from "./factory-purchase-order-settlement";
import {
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";

export const activeSupplierStatuses = ["ACCEPTED"] as const;

export const factoryPurchaseOrderFinanceInclude = Prisma.validator<Prisma.FactoryPurchaseOrderInclude>()({
  payments: { orderBy: [{ sequenceNo: "asc" }] },
  settlement: true,
  execution: { select: { receivableOrder: { select: { id: true } } } },
});

export async function loadPurchaseOrderForSales(
  tx: Prisma.TransactionClient,
  executionId: string,
  purchaseOrderId: string,
  actor: SalesExecutionActor,
) {
  const purchaseOrder = await tx.factoryPurchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      executionId,
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    include: {
      payments: true,
      adjustments: true,
      settlement: true,
      execution: { select: { receivableOrder: { select: { id: true } } } },
    },
  });
  if (!purchaseOrder) {
    throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  }
  return purchaseOrder;
}

export function confirmedPrepaymentTotal(payments: Array<{
  status: string;
  kind: string;
  amount: Prisma.Decimal;
  paidAt: Date;
}>) {
  const today = todayInChina().getTime();
  return payments
    .filter((payment) => payment.status === "CONFIRMED" && payment.kind === "PREPAYMENT" && payment.paidAt.getTime() <= today)
    .reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
}

export function assertFactorySettlementPaymentAllowed(
  settlement: { status: string; finalPayableAmount: Prisma.Decimal } | null,
  payments: Array<{ status: string; kind: string; amount: Prisma.Decimal; paidAt: Date }>,
  kind: string,
  amount: Prisma.Decimal,
) {
  if (!settlement) {
    if (kind === "REFUND") {
      throw codedError("只有结算状态为待退款时才可以登记供应商退款", 409, "FACTORY_SETTLEMENT_REFUND_NOT_AVAILABLE");
    }
    return;
  }
  if (settlement.status === "SETTLED") {
    throw codedError("该工厂采购单已结清，不能继续登记付款或退款", 409, "FACTORY_SETTLEMENT_ALREADY_SETTLED");
  }
  const netPaid = confirmedFactoryPaymentTotal(payments);
  if (settlement.status === "PENDING_PAYMENT") {
    if (kind !== "BALANCE") throw codedError("当前结算状态只允许登记补付尾款", 409, "FACTORY_SETTLEMENT_BALANCE_ONLY");
    const remaining = settlement.finalPayableAmount.sub(netPaid).toDecimalPlaces(2);
    if (!remaining.gt(0)) throw codedError("该工厂采购单已无待付余额", 409, "FACTORY_SETTLEMENT_NO_REMAINING_BALANCE");
    if (amount.gt(remaining)) throw codedError("尾款不能超过采购结算剩余应付金额", 409, "FACTORY_SETTLEMENT_PAYMENT_EXCEEDS_PAYABLE");
    return;
  }
  if (kind !== "REFUND") throw codedError("当前结算状态只允许登记供应商退款", 409, "FACTORY_SETTLEMENT_REFUND_ONLY");
  const pendingRefund = netPaid.sub(settlement.finalPayableAmount).toDecimalPlaces(2);
  if (!pendingRefund.gt(0)) throw codedError("该工厂采购单已无待退款金额", 409, "FACTORY_SETTLEMENT_NO_PENDING_REFUND");
  if (amount.gt(pendingRefund)) throw codedError("退款金额不能超过采购结算待退款金额", 409, "FACTORY_SETTLEMENT_REFUND_EXCEEDS_PENDING");
}

type FinancePurchaseOrder = Prisma.FactoryPurchaseOrderGetPayload<{
  include: typeof factoryPurchaseOrderFinanceInclude;
}>;

export function buildFactoryPaymentSummary(purchaseOrder: FinancePurchaseOrder) {
  const required = factoryPrepaymentRequiredAmount(purchaseOrder.penaltyBaseAmount, purchaseOrder.prepaymentRatio);
  const paid = confirmedPrepaymentTotal(purchaseOrder.payments);
  const totalPaid = confirmedFactoryPaymentTotal(purchaseOrder.payments);
  const remainingPayable = purchaseOrder.settlement
    ? Prisma.Decimal.max(purchaseOrder.settlement.finalPayableAmount.sub(totalPaid), 0).toDecimalPlaces(2)
    : null;
  const remainingRefund = purchaseOrder.settlement
    ? Prisma.Decimal.max(totalPaid.sub(purchaseOrder.settlement.finalPayableAmount), 0).toDecimalPlaces(2)
    : null;
  return {
    purchaseOrderId: purchaseOrder.id,
    revision: purchaseOrder.revision,
    currency: purchaseOrder.purchaseCurrency,
    productionStatus: purchaseOrder.productionStatus,
    prepaymentRequiredAmount: required.toString(),
    paidPrepaymentAmount: paid.toString(),
    remainingPrepaymentAmount: Prisma.Decimal.max(required.sub(paid), 0).toDecimalPlaces(2).toString(),
    settlement: purchaseOrder.settlement ? {
      id: purchaseOrder.settlement.id,
      status: purchaseOrder.settlement.status,
      finalPayableAmount: purchaseOrder.settlement.finalPayableAmount.toString(),
      paidAmount: totalPaid.toString(),
      remainingPayableAmount: remainingPayable?.toString() || "0",
      remainingRefundAmount: remainingRefund?.toString() || "0",
      settledAt: purchaseOrder.settlement.settledAt,
    } : null,
    payments: purchaseOrder.payments.map((payment) => ({
      id: payment.id,
      sequenceNo: payment.sequenceNo,
      kind: payment.kind,
      amount: payment.amount.toString(),
      currency: payment.currency,
      paidAt: payment.paidAt,
      bankReference: payment.bankReference || "",
      remark: payment.remark || "",
      status: payment.status,
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason || "",
      createdAt: payment.createdAt,
    })),
  };
}
