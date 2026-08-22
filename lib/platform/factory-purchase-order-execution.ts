import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { factoryPrepaymentRequiredAmount } from "./factory-purchase-order-financials";
import {
  activeSupplierStatuses,
  assertFactorySettlementPaymentAllowed,
  buildFactoryPaymentSummary,
  confirmedPrepaymentTotal,
  factoryPurchaseOrderFinanceInclude,
  loadPurchaseOrderForSales,
} from "./factory-purchase-order-execution-shared";
import {
  factoryLedgerAmount,
  factoryLedgerIdempotencyKey,
  factoryLedgerInput,
  factoryLedgerText,
  requiredFactoryLedgerDate,
  runFactoryPurchaseMutation,
} from "./factory-purchase-order-ledger-values";
import { finalizeFactorySettlementAfterPayment } from "./factory-purchase-order-settlement";
import { assertFactoryPaymentRunningBalance } from "./factory-purchase-order-settlement-values";
import {
  lockFactoryPurchaseOrder,
  requireSalesExecutionActorId,
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";

type AuditRequest = Parameters<typeof writeAudit>[0];

async function loadPurchaseOrderForFinance(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  actor: SalesExecutionActor,
) {
  const purchaseOrder = await tx.factoryPurchaseOrder.findFirst({
    where: { id: purchaseOrderId, execution: { is: salesExecutionAccessWhere(actor) } },
    include: factoryPurchaseOrderFinanceInclude,
  });
  if (!purchaseOrder) throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  return purchaseOrder;
}

function paymentSummary(purchaseOrder: Awaited<ReturnType<typeof loadPurchaseOrderForFinance>>) {
  return buildFactoryPaymentSummary(purchaseOrder);
}

export async function recordFactoryPurchaseOrderPayment(
  request: AuditRequest,
  actor: SalesExecutionActor,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "payments");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "付款记录");
  const kind = String(input.kind || "PREPAYMENT");
  if (!(kind === "PREPAYMENT" || kind === "BALANCE" || kind === "REFUND")) {
    throw codedError("付款类型无效", 400, "FACTORY_PAYMENT_KIND_INVALID");
  }
  const amount = factoryLedgerAmount(input.amount);
  const paidAt = requiredFactoryLedgerDate(input.paidAt, "付款日期", false);
  const bankReference = factoryLedgerText(input.bankReference, "银行流水号", 200);
  const remark = factoryLedgerText(input.remark, "付款备注", 2_000);
  const idempotencyKey = factoryLedgerIdempotencyKey(input.idempotencyKey);

  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const before = await loadPurchaseOrderForFinance(tx, purchaseOrderId, actor);
    if (!(activeSupplierStatuses as readonly string[]).includes(before.status)) {
      throw codedError("只有已确认的有效采购单可以登记付款", 409, "FACTORY_PAYMENT_PURCHASE_ORDER_NOT_ACTIVE");
    }
    const existing = before.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
    if (existing) {
      if (
        existing.kind !== kind
        || !existing.amount.eq(amount)
        || existing.paidAt.getTime() !== paidAt.getTime()
        || (existing.bankReference || "") !== bankReference
        || (existing.remark || "") !== remark
      ) {
        throw codedError("相同付款请求标识已用于不同数据", 409, "FACTORY_PAYMENT_IDEMPOTENCY_CONFLICT");
      }
      return paymentSummary(before);
    }
    const orderId = before.execution.receivableOrder?.id || "";
    if (before.settlement) {
      if (!orderId) {
        throw codedError("销售执行单尚未生成应收订单，不能登记结算款项", 409, "FACTORY_SETTLEMENT_RECEIVABLE_ORDER_REQUIRED");
      }
    } else if (kind === "REFUND") {
      throw codedError("只有结算状态为待退款时才可以登记供应商退款", 409, "FACTORY_SETTLEMENT_REFUND_NOT_AVAILABLE");
    }
    assertFactorySettlementPaymentAllowed(before.settlement, before.payments, kind, amount);
    const sequenceNo = (before.payments.at(-1)?.sequenceNo || 0) + 1;
    assertFactoryPaymentRunningBalance([
      ...before.payments,
      { id: "pending", sequenceNo, status: "CONFIRMED", kind, amount, paidAt },
    ]);
    const created = await tx.factoryPurchaseOrderPayment.create({
      data: {
        purchaseOrderId: before.id,
        sequenceNo,
        kind,
        amount,
        currency: before.purchaseCurrency,
        paidAt,
        bankReference: bankReference || null,
        remark: remark || null,
        idempotencyKey,
        createdById: actorId,
      },
    });
    const paidAfter = confirmedPrepaymentTotal([
      ...before.payments,
      { status: "CONFIRMED", kind, amount, paidAt },
    ]);
    const required = factoryPrepaymentRequiredAmount(before.penaltyBaseAmount, before.prepaymentRatio);
    const unlockProduction = before.productionStatus === "WAITING_PREPAYMENT" && paidAfter.gte(required);
    if (before.settlement) {
      await finalizeFactorySettlementAfterPayment(
        tx,
        before.id,
        actorId,
        before.settlement,
        [
          ...before.payments,
          { status: "CONFIRMED", kind, amount, paidAt },
        ],
        paidAt,
      );
    }
    await tx.factoryPurchaseOrder.update({
      where: { id: before.id },
      data: {
        ...(unlockProduction ? { productionStatus: "READY" } : {}),
        revision: { increment: 1 },
        updatedById: actorId,
      },
    });
    const saved = await loadPurchaseOrderForFinance(tx, before.id, actor);
    await writeAudit(
      request,
      { id: actorId },
      kind === "REFUND" ? "登记工厂采购退款" : "登记工厂采购付款",
      "factory_purchase_order_payments",
      created.id,
      null,
      created,
      tx,
    );
    if (before.settlement && saved.settlement && before.settlement.status !== saved.settlement.status) {
      await writeAudit(
        request,
        { id: actorId },
        saved.settlement.status === "SETTLED"
          ? "工厂采购款项结清"
          : saved.settlement.status === "PENDING_REFUND"
            ? "工厂采购结算转为待退款"
            : "工厂采购结算转为待付款",
        "factory_purchase_order_settlements",
        saved.settlement.id,
        before.settlement,
        saved.settlement,
        tx,
      );
    }
    return paymentSummary(saved);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function updateFactoryPurchaseOrderProduction(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  action: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const normalizedAction = String(action || "");
  if (normalizedAction === "COMPLETE") {
    throw codedError("生产完成必须由对应供应商账号确认", 403, "FACTORY_PRODUCTION_COMPLETION_SUPPLIER_REQUIRED");
  }
  if (normalizedAction !== "START") {
    throw codedError("生产操作无效", 400, "FACTORY_PRODUCTION_ACTION_INVALID");
  }
  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const before = await loadPurchaseOrderForSales(tx, executionId, purchaseOrderId, actor);
    if (!(activeSupplierStatuses as readonly string[]).includes(before.status)) {
      throw codedError("该采购单尚未确认，不能进入生产", 409, "FACTORY_PRODUCTION_PURCHASE_ORDER_NOT_READY");
    }
    if (before.prepaymentRequiredBeforeProduction) {
      const required = factoryPrepaymentRequiredAmount(before.penaltyBaseAmount, before.prepaymentRatio);
      const paid = confirmedPrepaymentTotal(before.payments);
      if (paid.lt(required)) {
        throw codedError("该采购单仍有生产前预付款未到账", 409, "FACTORY_PRODUCTION_PREPAYMENT_REQUIRED");
      }
    }
    const now = new Date();
    if (before.productionStatus !== "READY") {
      throw codedError(
        before.productionStatus === "WAITING_PREPAYMENT" ? "该采购单仍有生产前预付款未到账" : "该采购单当前不能开始生产",
        409,
        "FACTORY_PRODUCTION_NOT_READY",
      );
    }
    const saved = await tx.factoryPurchaseOrder.update({
      where: { id: before.id },
      data: { productionStatus: "IN_PRODUCTION", productionStartedAt: now, productionStartedById: actorId, revision: { increment: 1 }, updatedById: actorId },
      include: { payments: true, adjustments: true },
    });
    await writeAudit(request, { id: actorId }, "工厂采购单开始生产", "factory_purchase_orders", before.id, before, saved, tx);
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function addFactoryPurchaseOrderAdjustment(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "costs");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "临时费用");
  const kind = String(input.kind || "TEMPORARY_FEE");
  if (!(kind === "TEMPORARY_FEE" || kind === "OTHER")) {
    throw codedError("当前阶段仅允许登记临时费用或其他调整", 400, "FACTORY_ADJUSTMENT_KIND_INVALID");
  }
  const direction = String(input.direction || "INCREASE");
  if (!(direction === "INCREASE" || direction === "DECREASE") || (kind === "TEMPORARY_FEE" && direction !== "INCREASE")) {
    throw codedError("临时费用只能增加采购成本", 400, "FACTORY_ADJUSTMENT_DIRECTION_INVALID");
  }
  const amount = factoryLedgerAmount(input.amount);
  const description = factoryLedgerText(input.description, "费用说明", 2_000);
  if (!description) throw codedError("请填写费用说明", 400, "FACTORY_ADJUSTMENT_DESCRIPTION_REQUIRED");
  const occurredAt = input.occurredAt ? requiredFactoryLedgerDate(input.occurredAt, "发生日期") : null;
  const idempotencyKey = factoryLedgerIdempotencyKey(input.idempotencyKey);
  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const before = await loadPurchaseOrderForSales(tx, executionId, purchaseOrderId, actor);
    if (!(activeSupplierStatuses as readonly string[]).includes(before.status)) {
      throw codedError("只有已确认的采购单可以登记临时费用", 409, "FACTORY_ADJUSTMENT_PURCHASE_ORDER_NOT_ACTIVE");
    }
    const existing = before.adjustments.find((adjustment) => adjustment.sourceType === "MANUAL_REQUEST" && adjustment.sourceId === idempotencyKey);
    if (existing) {
      if (
        existing.kind !== kind
        || existing.direction !== direction
        || !existing.amount.eq(amount)
        || existing.description !== description
        || (existing.occurredAt?.getTime() || 0) !== (occurredAt?.getTime() || 0)
      ) {
        throw codedError("相同费用请求标识已用于不同数据", 409, "FACTORY_ADJUSTMENT_IDEMPOTENCY_CONFLICT");
      }
      return existing;
    }
    if (before.settlement) {
      throw codedError("最终应付确认后不能新增费用调整", 409, "FACTORY_SETTLEMENT_ADJUSTMENTS_FROZEN");
    }
    const orderId = before.execution.receivableOrder?.id || "";
    if (orderId) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能登记工厂采购费用。",
      );
    }
    const sequenceNo = before.adjustments.reduce((max, adjustment) => Math.max(max, adjustment.sequenceNo), 0) + 1;
    const saved = await tx.factoryPurchaseOrderAdjustment.create({
      data: {
        purchaseOrderId: before.id,
        sequenceNo,
        kind,
        direction,
        amount,
        currency: before.purchaseCurrency,
        description,
        occurredAt,
        sourceType: "MANUAL_REQUEST",
        sourceId: idempotencyKey,
        createdById: actorId,
      },
    });
    await tx.factoryPurchaseOrder.update({ where: { id: before.id }, data: { revision: { increment: 1 }, updatedById: actorId } });
    await writeAudit(request, { id: actorId }, "登记工厂临时费用", "factory_purchase_order_adjustments", saved.id, null, saved, tx);
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
