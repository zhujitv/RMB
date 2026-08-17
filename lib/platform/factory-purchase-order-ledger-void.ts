import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { factoryPrepaymentRequiredAmount } from "./factory-purchase-order-financials";
import {
  factoryLedgerInput,
  factoryLedgerText,
  runFactoryPurchaseMutation,
} from "./factory-purchase-order-ledger-values";
import {
  confirmedFactoryPaymentTotal,
  syncFactorySettlementCostPayment,
} from "./factory-purchase-order-settlement";
import { todayInChina } from "./quotation-date-values";
import {
  lockFactoryPurchaseOrder,
  requireSalesExecutionActorId,
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";

type AuditRequest = Parameters<typeof writeAudit>[0];

function voidReason(rawInput: unknown) {
  const input = factoryLedgerInput(rawInput, "冲销信息");
  const reason = factoryLedgerText(input.reason, "冲销原因", 500);
  if (!reason) throw codedError("请填写冲销原因", 400, "FACTORY_LEDGER_VOID_REASON_REQUIRED");
  return reason;
}

function activePaidPrepayment(payments: Array<{
  id: string;
  kind: string;
  status: string;
  amount: Prisma.Decimal;
  paidAt: Date;
}>, excludedId: string) {
  const today = todayInChina().getTime();
  return payments
    .filter((payment) => (
      payment.id !== excludedId
      && payment.kind === "PREPAYMENT"
      && payment.status === "CONFIRMED"
      && payment.paidAt.getTime() <= today
    ))
    .reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
}

export async function voidFactoryPurchaseOrderPayment(
  request: AuditRequest,
  actor: SalesExecutionActor,
  purchaseOrderId: string,
  paymentId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "payments");
  const actorId = requireSalesExecutionActorId(actor);
  const reason = voidReason(rawInput);
  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const payment = await tx.factoryPurchaseOrderPayment.findFirst({
      where: {
        id: paymentId,
        purchaseOrderId,
        purchaseOrder: { is: { execution: { is: salesExecutionAccessWhere(actor) } } },
      },
      include: {
        purchaseOrder: {
          include: {
            payments: true,
            settlement: true,
            execution: { select: { receivableOrder: { select: { id: true } } } },
          },
        },
      },
    });
    if (!payment) throw codedError("付款记录不存在或无权访问", 404, "FACTORY_PAYMENT_NOT_FOUND");
    if (payment.status === "VOIDED") return payment;
    if (payment.purchaseOrder.settlement?.status === "SETTLED") {
      throw codedError("该工厂采购单已结清，付款记录不能冲销", 409, "FACTORY_SETTLEMENT_ALREADY_SETTLED");
    }
    const orderId = payment.purchaseOrder.execution.receivableOrder?.id || "";
    if (payment.purchaseOrder.settlement) {
      if (payment.kind !== "BALANCE") {
        throw codedError("最终应付确认后只能冲销尾款记录", 409, "FACTORY_SETTLEMENT_BALANCE_VOID_ONLY");
      }
      if (!orderId) {
        throw codedError("销售执行单尚未生成应收订单，不能冲销结算尾款", 409, "FACTORY_SETTLEMENT_RECEIVABLE_ORDER_REQUIRED");
      }
    }
    const voidedAt = new Date();
    const saved = await tx.factoryPurchaseOrderPayment.update({
      where: { id: payment.id },
      data: { status: "VOIDED", voidedAt, voidedById: actorId, voidReason: reason },
    });
    const purchaseOrder = payment.purchaseOrder;
    if (purchaseOrder.settlement) {
      const activePaymentsAfter = purchaseOrder.payments.filter((row) => row.id !== payment.id && row.status === "CONFIRMED");
      const paidAmountAfter = confirmedFactoryPaymentTotal(activePaymentsAfter);
      const latestPaidAt = activePaymentsAfter.reduce<Date | null>(
        (latest, row) => !latest || row.paidAt.getTime() > latest.getTime() ? row.paidAt : latest,
        null,
      );
      await syncFactorySettlementCostPayment(
        tx,
        purchaseOrder.id,
        actorId,
        purchaseOrder.settlement.finalPayableAmount,
        paidAmountAfter,
        latestPaidAt,
      );
    }
    const required = factoryPrepaymentRequiredAmount(purchaseOrder.penaltyBaseAmount, purchaseOrder.prepaymentRatio);
    const paidAfter = activePaidPrepayment(purchaseOrder.payments, payment.id);
    const shouldRelock = purchaseOrder.productionStatus === "READY"
      && purchaseOrder.prepaymentRequiredBeforeProduction
      && paidAfter.lt(required);
    await tx.factoryPurchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: {
        ...(shouldRelock ? { productionStatus: "WAITING_PREPAYMENT" } : {}),
        revision: { increment: 1 },
        updatedById: actorId,
      },
    });
    await writeAudit(request, { id: actorId }, "冲销工厂采购付款", "factory_purchase_order_payments", payment.id, payment, saved, tx);
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function voidFactoryPurchaseOrderAdjustment(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  adjustmentId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "costs");
  const actorId = requireSalesExecutionActorId(actor);
  const reason = voidReason(rawInput);
  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const adjustment = await tx.factoryPurchaseOrderAdjustment.findFirst({
      where: {
        id: adjustmentId,
        purchaseOrderId,
        purchaseOrder: {
          is: { executionId, execution: { is: salesExecutionAccessWhere(actor) } },
        },
      },
      include: {
        purchaseOrder: {
          select: {
            settlement: true,
            execution: { select: { receivableOrder: { select: { id: true } } } },
          },
        },
      },
    });
    if (!adjustment) throw codedError("费用调整不存在或无权访问", 404, "FACTORY_ADJUSTMENT_NOT_FOUND");
    if (adjustment.status === "VOIDED") return adjustment;
    if (adjustment.purchaseOrder.settlement) {
      throw codedError("最终应付确认后不能作废费用调整", 409, "FACTORY_SETTLEMENT_ADJUSTMENTS_FROZEN");
    }
    const orderId = adjustment.purchaseOrder.execution.receivableOrder?.id || "";
    if (orderId) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能作废工厂采购费用。",
      );
    }
    const saved = await tx.factoryPurchaseOrderAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedById: actorId,
        voidReason: reason,
        revision: { increment: 1 },
      },
    });
    await tx.factoryPurchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { revision: { increment: 1 }, updatedById: actorId },
    });
    await writeAudit(request, { id: actorId }, "作废工厂采购费用调整", "factory_purchase_order_adjustments", adjustment.id, adjustment, saved, tx);
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
