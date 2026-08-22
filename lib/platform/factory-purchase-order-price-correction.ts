import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite, requireAdminGlobal } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import {
  factoryLedgerIdempotencyKey,
  factoryLedgerInput,
  factoryLedgerText,
  runFactoryPurchaseMutation,
} from "./factory-purchase-order-ledger-values";
import {
  assertMatchingExistingSettlementCost,
  settlementCostPaymentState,
  settlementOrderCost,
} from "./factory-purchase-order-settlement-cost";
import { assertPriceCorrectionSupplierDocumentsWithdrawn } from "./factory-purchase-price-correction-contract";
import {
  confirmedFactoryPaymentTotal,
  factorySettlementStatusForNetPaid,
  latestConfirmedFactoryPaymentDate,
} from "./factory-purchase-order-settlement-values";
import {
  assertFactoryMoneyAmount,
  assertPriceCorrectionAllowed,
  assertPriceCorrectionRequestReplay,
  confirmedPriceCorrectionAdjustmentTotals,
  correctionQuantitySnapshot,
  currentApprovedUnitPrice,
  factoryCorrectionAmounts,
  factoryCorrectionUnitPrice,
  factoryPriceCorrectionSettlementSnapshot,
  formatCorrectionAmount,
  formatCorrectionPrice,
  loadPurchaseOrderWithPriceCorrections,
  terminalPriceCorrectionReviewReplay,
  type PriceCorrectionAuditRequest,
} from "./factory-purchase-order-price-correction-values";
import {
  lockFactoryPurchaseOrder,
  requireSalesExecutionActorId,
  type SalesExecutionActor,
} from "./sales-execution-access";

export async function requestFactoryPurchaseOrderPriceCorrection(
  request: PriceCorrectionAuditRequest, actor: SalesExecutionActor, executionId: string, purchaseOrderId: string, rawInput: unknown) {
  assertWrite(actor, "costs");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "采购价格更正申请");
  const purchaseOrderItemId = factoryLedgerText(input.purchaseOrderItemId, "产品行", 200);
  if (!purchaseOrderItemId) throw codedError("请选择需要更正价格的产品行", 400, "FACTORY_PRICE_CORRECTION_ITEM_REQUIRED");
  const newUnitPrice = factoryCorrectionUnitPrice(input.newUnitPrice);
  const reason = factoryLedgerText(input.reason, "更正原因", 2_000);
  if (!reason) throw codedError("请填写采购价格更正原因", 400, "FACTORY_PRICE_CORRECTION_REASON_REQUIRED");
  const idempotencyKey = factoryLedgerIdempotencyKey(input.idempotencyKey);
  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const before = await loadPurchaseOrderWithPriceCorrections(tx, executionId, purchaseOrderId, actor);
    const existing = before.priceCorrections.find((correction) => correction.idempotencyKey === idempotencyKey);
    if (existing) return assertPriceCorrectionRequestReplay(existing, { purchaseOrderItemId, newUnitPrice, reason });
    assertPriceCorrectionAllowed(before);
    const orderId = before.execution.receivableOrder?.id || "";
    if (orderId) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能申请采购价格更正。",
      );
    }
    const item = before.items.find((candidate) => candidate.id === purchaseOrderItemId);
    if (!item) throw codedError("采购单产品行不存在", 404, "FACTORY_PRICE_CORRECTION_ITEM_NOT_FOUND");
    const pendingOnItem = before.priceCorrections.find((correction) => (
      correction.purchaseOrderItemId === purchaseOrderItemId && correction.status === "PENDING"
    ));
    if (pendingOnItem) {
      throw codedError("该产品行已有待审核的采购价格更正申请", 409, "FACTORY_PRICE_CORRECTION_PENDING_EXISTS");
    }
    const currentPrice = currentApprovedUnitPrice(before, item); // Selects the latest correction whose status === "APPROVED".
    const oldUnitPrice = currentPrice.unitPrice;
    if (!oldUnitPrice) throw codedError("该产品行原采购单价为空，不能申请价格更正", 409, "FACTORY_PRICE_CORRECTION_OLD_PRICE_MISSING");
    if (oldUnitPrice.eq(newUnitPrice)) {
      throw codedError("更正后的采购单价与当前单价相同", 400, "FACTORY_PRICE_CORRECTION_NO_CHANGE");
    }
    const quantitySnapshot = correctionQuantitySnapshot(before, item); // Uses actualDeliveredQuantity ?? allocatedQuantity.
    const { oldAmount, newAmount, deltaAmount } = factoryCorrectionAmounts(quantitySnapshot, oldUnitPrice, newUnitPrice);
    const sequenceNo = before.priceCorrections.reduce((max, correction) => Math.max(max, correction.sequenceNo), 0) + 1;
    const saved = await tx.factoryPurchaseOrderPriceCorrection.create({
      data: {
        purchaseOrderId: before.id,
        purchaseOrderItemId: item.id,
        sequenceNo,
        quantitySnapshot,
        oldUnitPrice,
        newUnitPrice,
        oldAmount,
        newAmount,
        deltaAmount,
        currency: before.purchaseCurrency,
        reason,
        sourceUnitPriceType: currentPrice.sourceType,
        idempotencyKey,
        requestedById: actorId,
      },
    });
    await tx.factoryPurchaseOrder.update({
      where: { id: before.id },
      data: { revision: { increment: 1 }, updatedById: actorId },
    });
    await writeAudit(request, { id: actorId }, "提交采购价格更正申请", "factory_purchase_order_price_corrections", saved.id, null, saved, tx);
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function reviewFactoryPurchaseOrderPriceCorrection(
  request: PriceCorrectionAuditRequest, actor: SalesExecutionActor, executionId: string, purchaseOrderId: string, correctionId: string, rawInput: unknown) {
  requireAdminGlobal(actor, "只有管理员可以审核采购价格更正申请");
  assertWrite(actor, "costs");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "采购价格更正审核");
  const action = String(input.action || "").trim().toUpperCase();
  if (!(action === "APPROVE" || action === "REJECT")) {
    throw codedError("审核动作无效", 400, "FACTORY_PRICE_CORRECTION_REVIEW_ACTION_INVALID");
  }
  const reviewRemark = factoryLedgerText(input.reviewRemark, "审核备注", 2_000);
  if (action === "REJECT" && !reviewRemark) {
    throw codedError("驳回采购价格更正时请填写审核备注", 400, "FACTORY_PRICE_CORRECTION_REJECT_REMARK_REQUIRED");
  }
  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const before = await loadPurchaseOrderWithPriceCorrections(tx, executionId, purchaseOrderId, actor);
    const correction = before.priceCorrections.find((candidate) => candidate.id === correctionId);
    if (!correction) throw codedError("采购价格更正申请不存在或无权访问", 404, "FACTORY_PRICE_CORRECTION_NOT_FOUND");
    const replay = terminalPriceCorrectionReviewReplay(correction, action);
    if (replay) return replay;
    if (action === "APPROVE") {
      assertPriceCorrectionAllowed(before);
      const orderId = before.execution.receivableOrder?.id || "";
      if (orderId) {
        await assertBusinessOrderWritableInTransaction(
          tx,
          orderId,
          "该订单已提交退税并归档，不能审核通过采购价格更正。",
        );
        await assertCommissionOrderWritableInTransaction(tx, orderId);
      }
      await assertPriceCorrectionSupplierDocumentsWithdrawn(tx, before.id);
    }
    const reviewedAt = new Date();
    let adjustmentId: string | null = null;
    let settlementSnapshotData: ReturnType<typeof factoryPriceCorrectionSettlementSnapshot> | Record<string, never> = {};
    if (action === "APPROVE") {
      const direction = correction.deltaAmount.gte(0) ? "INCREASE" : "DECREASE";
      const amount = correction.deltaAmount.abs().toDecimalPlaces(2);
      const item = before.items.find((candidate) => candidate.id === correction.purchaseOrderItemId);
      if (!item) throw codedError("采购单产品行不存在", 404, "FACTORY_PRICE_CORRECTION_ITEM_NOT_FOUND");
      const currentPrice = currentApprovedUnitPrice(before, item).unitPrice;
      if (!currentPrice || !currentPrice.eq(correction.oldUnitPrice)) {
        throw codedError(
          "该产品当前生效采购单价已变化，请驳回本申请后重新提交",
          409,
          "FACTORY_PRICE_CORRECTION_CURRENT_PRICE_CONFLICT",
        );
      }
      if (before.settlement) {
        if (item.actualDeliveredQuantity === null) {
          throw codedError(
            "该采购单已完成最终应付确认，必须先补齐该产品的实际交付数量",
            409,
            "FACTORY_PRICE_CORRECTION_ACTUAL_DELIVERY_REQUIRED",
          );
        }
        if (!item.actualDeliveredQuantity.eq(correction.quantitySnapshot)) {
          throw codedError(
            "该产品实际交付数量在申请后发生变化，请驳回本申请后重新提交",
            409,
            "FACTORY_PRICE_CORRECTION_QUANTITY_SNAPSHOT_CONFLICT",
          );
        }
      }
      const productName = item.productNameSnapshot || `第 ${correction.sequenceNo} 行`;
      const sequenceNo = before.adjustments.reduce((max, adjustment) => Math.max(max, adjustment.sequenceNo), 0) + 1;
      const createdAdjustment = await tx.factoryPurchaseOrderAdjustment.create({
        data: {
          purchaseOrderId: before.id,
          sequenceNo,
          kind: "OTHER",
          direction,
          amount,
          currency: before.purchaseCurrency,
          description: `采购价格更正：${productName}，${formatCorrectionPrice(correction.oldUnitPrice)} → ${formatCorrectionPrice(correction.newUnitPrice)}，差额 ${formatCorrectionAmount(correction.deltaAmount)}。原因：${correction.reason}`,
          status: "CONFIRMED",
          sourceType: "PURCHASE_PRICE_CORRECTION",
          sourceId: correction.id,
          createdById: correction.requestedById,
          confirmedById: actorId,
          confirmedAt: reviewedAt,
        },
      });
      adjustmentId = createdAdjustment.id;
      await writeAudit(request, { id: actorId }, "采购价格更正生成差额调整", "factory_purchase_order_adjustments", createdAdjustment.id, null, createdAdjustment, tx);

      if (before.settlement) {
        const settlementBefore = before.settlement;
        const totals = confirmedPriceCorrectionAdjustmentTotals([...before.adjustments, createdAdjustment]);
        const nextFinalPayable = assertFactoryMoneyAmount(settlementBefore.baseAmount
          .add(totals.increase)
          .sub(totals.decrease)
          .sub(settlementBefore.delayPenaltyAmount)
          .toDecimalPlaces(2), "更正后的最终应付金额");
        if (nextFinalPayable.lt(0)) {
          throw codedError(
            "采购价格更正后的最终应付金额不能小于 0",
            409,
            "FACTORY_PRICE_CORRECTION_FINAL_PAYABLE_NEGATIVE",
          );
        }
        const netPaidAmount = confirmedFactoryPaymentTotal(before.payments);
        if (netPaidAmount.lt(0)) {
          throw codedError("累计退款不能超过已付款金额", 409, "FACTORY_SETTLEMENT_REFUND_EXCEEDS_PAID");
        }
        const nextSettlementStatus = factorySettlementStatusForNetPaid(nextFinalPayable, netPaidAmount);
        const confirmedPayments = before.payments.filter((payment) => payment.status === "CONFIRMED");
        const latestPaymentDate = confirmedPayments.length
          ? latestConfirmedFactoryPaymentDate(confirmedPayments, reviewedAt)
          : nextSettlementStatus === "SETTLED" && nextFinalPayable.eq(0)
            ? before.actualDeliveryDate || reviewedAt
            : null;
        const costBefore = await settlementOrderCost(tx, before.id);
        assertMatchingExistingSettlementCost(
          costBefore,
          before,
          settlementBefore.finalPayableAmount,
          settlementBefore.exchangeRate,
          settlementBefore.exchangeRateDate,
        );
        if (!costBefore) {
          throw codedError("工厂结算关联成本不存在或状态异常", 409, "FACTORY_SETTLEMENT_ORDER_COST_MISSING");
        }
        const settlementAfter = await tx.factoryPurchaseOrderSettlement.update({
          where: { id: settlementBefore.id },
          data: {
            increaseAmount: totals.increase.toDecimalPlaces(2),
            decreaseAmount: totals.decrease.toDecimalPlaces(2),
            finalPayableAmount: nextFinalPayable,
            paidAmountAtSettlement: netPaidAmount,
            status: nextSettlementStatus,
            settledAt: nextSettlementStatus === "SETTLED" ? reviewedAt : null,
            settledById: nextSettlementStatus === "SETTLED" ? actorId : null,
            revision: { increment: 1 },
          },
        });
        const costPaymentState = settlementCostPaymentState(nextFinalPayable, netPaidAmount);
        const costAfter = await tx.orderCost.update({
          where: { id: costBefore.id },
          data: {
            amount: nextFinalPayable,
            amountCny: assertFactoryMoneyAmount(nextFinalPayable.mul(settlementBefore.exchangeRate).toDecimalPlaces(2), "更正后的人民币成本"),
            paymentStatus: costPaymentState.paymentStatus,
            paid: costPaymentState.paid,
            paidAt: costPaymentState.paid ? latestPaymentDate : null,
            paymentDate: costPaymentState.paid ? latestPaymentDate : null,
            updatedById: actorId,
          },
        });
        settlementSnapshotData = factoryPriceCorrectionSettlementSnapshot(settlementBefore, settlementAfter);
        await writeAudit(request, { id: actorId }, "采购价格更正重算工厂最终应付", "factory_purchase_order_settlements", settlementBefore.id, settlementBefore, settlementAfter, tx);
        await writeAudit(request, { id: actorId }, "采购价格更正同步工厂货款成本", "order_costs", costBefore.id, costBefore, costAfter, tx);
      }
    }
    const saved = await tx.factoryPurchaseOrderPriceCorrection.update({
      where: { id: correction.id },
      data: {
        status: action === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewRemark: reviewRemark || null,
        adjustmentId,
        reviewedById: actorId,
        reviewedAt,
        ...settlementSnapshotData,
      },
    });
    await tx.factoryPurchaseOrder.update({
      where: { id: before.id },
      data: { revision: { increment: 1 }, updatedById: actorId },
    });
    await writeAudit(request, { id: actorId }, action === "APPROVE" ? "审核通过采购价格更正" : "驳回采购价格更正", "factory_purchase_order_price_corrections", saved.id, correction, saved, tx);
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
