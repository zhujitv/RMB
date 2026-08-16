import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { factoryLedgerInput, runFactoryPurchaseMutation } from "./factory-purchase-order-ledger-values";
import {
  assertMatchingExistingSettlementCost,
  createOrReuseSettlementCost,
  settlementOrderCost,
} from "./factory-purchase-order-settlement-cost";
import { effectiveFactoryPurchaseOrderDeliveredAmount } from "./factory-purchase-order-financials";
import { loadPurchaseOrderForSettlement } from "./factory-purchase-order-settlement-query";
import {
  FACTORY_PURCHASE_SETTLEMENT_PENALTY_SOURCE_TYPE,
  calculateFactorySettlementAmounts,
  confirmedFactoryPaymentTotal,
  factorySettlementDto,
  factorySettlementExchangeRate,
  factorySettlementExchangeRateDate,
  factorySettlementExpectedRevision,
} from "./factory-purchase-order-settlement-values";
import {
  lockFactoryPurchaseOrder,
  lockSalesExecution,
  requireSalesExecutionActorId,
  type SalesExecutionActor,
} from "./sales-execution-access";

export {
  FACTORY_PURCHASE_SETTLEMENT_PENALTY_SOURCE_TYPE,
  FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE,
  calculateFactorySettlementAmounts,
  confirmedFactoryPaymentTotal,
} from "./factory-purchase-order-settlement-values";
export {
  finalizeFactorySettlementAfterPayment,
  syncFactorySettlementCostPayment,
} from "./factory-purchase-order-settlement-cost";

type AuditRequest = Parameters<typeof writeAudit>[0];

export async function settleFactoryPurchaseOrder(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "payments");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "工厂采购结算");
  const expectedRevision = factorySettlementExpectedRevision(input);

  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockSalesExecution(tx, executionId);
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const purchaseOrder = await loadPurchaseOrderForSettlement(tx, executionId, purchaseOrderId, actor);
    if (!purchaseOrder) {
      throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
    }
    if (!purchaseOrder.execution.shippingStartedAt || !purchaseOrder.execution.receivableOrder || purchaseOrder.execution.receivableOrder.deletedAt) {
      throw codedError("销售执行单尚未进入发货，不能完成采购结算", 409, "FACTORY_SETTLEMENT_SHIPPING_REQUIRED");
    }
    if (purchaseOrder.status !== "ACCEPTED") {
      throw codedError("只有内部确认交期后的有效采购单可以结算", 409, "FACTORY_SETTLEMENT_PURCHASE_ORDER_NOT_ACCEPTED");
    }
    if (purchaseOrder.productionStatus !== "COMPLETED" || !purchaseOrder.productionCompletedAt) {
      throw codedError("工厂尚未确认生产完成，不能结算", 409, "FACTORY_SETTLEMENT_PRODUCTION_NOT_COMPLETED");
    }
    if (!purchaseOrder.actualDeliveryDate) {
      throw codedError("请先登记工厂实际交货日期", 409, "FACTORY_SETTLEMENT_ACTUAL_DELIVERY_REQUIRED");
    }
    if (!purchaseOrder.initialSupplierDeliveryDate || !purchaseOrder.penaltyBaseAmount) {
      throw codedError("采购单缺少冻结交期或结算基准金额", 409, "FACTORY_SETTLEMENT_ANCHOR_REQUIRED");
    }
    const deliveredGoodsAmount = effectiveFactoryPurchaseOrderDeliveredAmount(purchaseOrder.items);
    if (deliveredGoodsAmount === null) {
      throw codedError(
        "采购单缺少逐项实际交付数量或有效采购单价，不能结算",
        409,
        "FACTORY_SETTLEMENT_DELIVERED_GOODS_AMOUNT_INCOMPLETE",
      );
    }

    const exchangeRate = factorySettlementExchangeRate(input, purchaseOrder.purchaseCurrency);
    const exchangeRateDate = factorySettlementExchangeRateDate(input, purchaseOrder.actualDeliveryDate);
    if (purchaseOrder.settlement) {
      if (
        !purchaseOrder.settlement.exchangeRate.eq(exchangeRate)
        || purchaseOrder.settlement.exchangeRateDate.getTime() !== exchangeRateDate.getTime()
      ) {
        throw codedError("该采购单已按另一汇率完成结算", 409, "FACTORY_SETTLEMENT_IDEMPOTENCY_CONFLICT");
      }
      const cost = await settlementOrderCost(tx, purchaseOrder.id);
      assertMatchingExistingSettlementCost(
        cost,
        purchaseOrder,
        purchaseOrder.settlement.finalPayableAmount,
        exchangeRate,
        exchangeRateDate,
      );
      if (!cost) {
        throw codedError("工厂结算关联成本不存在，请联系管理员处理", 409, "FACTORY_SETTLEMENT_ORDER_COST_MISSING");
      }
      return factorySettlementDto(purchaseOrder.settlement, cost);
    }
    const orderId = purchaseOrder.execution.receivableOrder.id;
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，不能确认工厂最终应付。",
    );
    await assertCommissionOrderWritableInTransaction(tx, orderId);
    if (purchaseOrder.revision !== expectedRevision) {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "FACTORY_SETTLEMENT_REVISION_CONFLICT");
    }

    const amounts = calculateFactorySettlementAmounts({
      baseAmount: deliveredGoodsAmount,
      penaltyBaseAmount: purchaseOrder.penaltyBaseAmount,
      initialDeliveryDate: purchaseOrder.initialSupplierDeliveryDate,
      actualDeliveryDate: purchaseOrder.actualDeliveryDate,
      adjustments: purchaseOrder.adjustments,
      graceDays: purchaseOrder.delayGraceDays,
      ratePerDay: purchaseOrder.delayPenaltyRatePerDay,
      capRatio: purchaseOrder.delayPenaltyCapRatio,
    });
    const activePenaltyRows = purchaseOrder.adjustments.filter((adjustment) => adjustment.kind === "DELAY_PENALTY");
    if (activePenaltyRows.length > 1) {
      throw codedError("采购单存在重复违约金调整，请先核对", 409, "FACTORY_SETTLEMENT_DELAY_PENALTY_CONFLICT");
    }
    const existingPenalty = activePenaltyRows[0] || null;
    if (existingPenalty && (
      existingPenalty.direction !== "DECREASE"
      || existingPenalty.currency !== purchaseOrder.purchaseCurrency
      || !existingPenalty.amount.eq(amounts.delayPenaltyAmount)
    )) {
      throw codedError("现有违约金调整与自动计算结果不一致，请先核对", 409, "FACTORY_SETTLEMENT_DELAY_PENALTY_CONFLICT");
    }
    const now = new Date();
    if (!existingPenalty && amounts.delayPenaltyAmount.gt(0)) {
      const sequenceNo = purchaseOrder.adjustments.reduce((max, adjustment) => Math.max(max, adjustment.sequenceNo), 0) + 1;
      const dailyRatePercent = purchaseOrder.delayPenaltyRatePerDay.mul(100).toString();
      const capText = purchaseOrder.delayPenaltyCapRatio === null
        ? ""
        : `，最高不超过基准金额的 ${purchaseOrder.delayPenaltyCapRatio.mul(100).toString()}%`;
      const createdPenalty = await tx.factoryPurchaseOrderAdjustment.create({
        data: {
          purchaseOrderId: purchaseOrder.id,
          sequenceNo,
          kind: "DELAY_PENALTY",
          direction: "DECREASE",
          amount: amounts.delayPenaltyAmount,
          currency: purchaseOrder.purchaseCurrency,
          description: `实际交货超过 ${purchaseOrder.delayGraceDays} 天免罚期 ${amounts.delayDays} 天，按 ${dailyRatePercent}%/天自动扣款${capText}`,
          occurredAt: purchaseOrder.actualDeliveryDate,
          status: "CONFIRMED",
          sourceType: FACTORY_PURCHASE_SETTLEMENT_PENALTY_SOURCE_TYPE,
          sourceId: purchaseOrder.id,
          createdById: actorId,
          confirmedById: actorId,
          confirmedAt: now,
        },
      });
      await writeAudit(request, { id: actorId }, "工厂采购结算自动生成违约金", "factory_purchase_order_adjustments", createdPenalty.id, null, createdPenalty, tx);
    }

    const provisionalRows = purchaseOrder.adjustments.filter((adjustment) => adjustment.status === "PROVISIONAL");
    const provisionalIds = provisionalRows.map((adjustment) => adjustment.id);
    if (provisionalIds.length) {
      const confirmed = await tx.factoryPurchaseOrderAdjustment.updateMany({
        where: { id: { in: provisionalIds }, purchaseOrderId: purchaseOrder.id, status: "PROVISIONAL" },
        data: { status: "CONFIRMED", confirmedById: actorId, confirmedAt: now, revision: { increment: 1 } },
      });
      if (confirmed.count !== provisionalIds.length) {
        throw codedError("临时费用状态已变化，请刷新后重试", 409, "FACTORY_SETTLEMENT_ADJUSTMENT_CONFLICT");
      }
      for (const provisional of provisionalRows) {
        await writeAudit(
          request,
          { id: actorId },
          "工厂采购结算确认费用调整",
          "factory_purchase_order_adjustments",
          provisional.id,
          provisional,
          { ...provisional, status: "CONFIRMED", confirmedById: actorId, confirmedAt: now, revision: provisional.revision + 1 },
          tx,
        );
      }
    }

    const { baseAmount, increaseAmount, decreaseAmount, delayDays, delayPenaltyAmount, finalPayableAmount } = amounts;
    if (finalPayableAmount.lt(0)) {
      throw codedError("费用扣减超过采购基准金额，请先核对调整项", 409, "FACTORY_SETTLEMENT_FINAL_PAYABLE_NEGATIVE");
    }
    const paidAmount = confirmedFactoryPaymentTotal(purchaseOrder.payments);
    if (paidAmount.gt(finalPayableAmount)) {
      throw codedError("累计采购付款已超过最终应付金额，请先冲销多付记录", 409, "FACTORY_SETTLEMENT_PAYMENT_EXCEEDS_PAYABLE");
    }
    const fullyPaid = paidAmount.eq(finalPayableAmount);
    const settlement = await tx.factoryPurchaseOrderSettlement.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        baseAmount,
        increaseAmount,
        decreaseAmount,
        delayDays,
        delayPenaltyAmount,
        finalPayableAmount,
        currency: purchaseOrder.purchaseCurrency,
        exchangeRate,
        exchangeRateDate,
        paidAmountAtSettlement: paidAmount,
        status: fullyPaid ? "SETTLED" : "PENDING_PAYMENT",
        settledAt: fullyPaid ? now : null,
        settledById: fullyPaid ? actorId : null,
        createdById: actorId,
      },
    });
    const costResult = await createOrReuseSettlementCost(
      tx,
      purchaseOrder,
      actorId,
      finalPayableAmount,
      exchangeRate,
      exchangeRateDate,
      paidAmount,
      now,
    );
    const changed = await tx.factoryPurchaseOrder.updateMany({
      where: { id: purchaseOrder.id, revision: expectedRevision },
      data: { revision: { increment: 1 }, updatedById: actorId },
    });
    if (changed.count !== 1) {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "FACTORY_SETTLEMENT_REVISION_CONFLICT");
    }

    await writeAudit(request, { id: actorId }, "确认工厂采购单最终结算", "factory_purchase_order_settlements", settlement.id, null, settlement, tx);
    if (costResult.created) {
      await writeAudit(request, { id: actorId }, "工厂采购结算生成成本", "order_costs", costResult.cost.id, null, costResult.cost, tx);
    }
    return factorySettlementDto(settlement, costResult.cost);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
