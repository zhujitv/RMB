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
