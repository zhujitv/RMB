import {
  Prisma,
  type FactoryPurchaseOrderAdjustment,
  type FactoryPurchaseOrderPriceCorrection,
} from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { requireAdminGlobal, assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import {
  factoryLedgerInput,
  factoryLedgerText,
  runFactoryPurchaseMutation,
} from "./factory-purchase-order-ledger-values";
import { assertPriceCorrectionSupplierDocumentsWithdrawn } from "./factory-purchase-price-correction-contract";
import {
  assertPriceCorrectionAllowed,
  currentApprovedUnitPrice,
  formatCorrectionAmount,
  formatCorrectionPrice,
  loadPurchaseOrderWithPriceCorrections,
  type PriceCorrectionAuditRequest,
  type PriceCorrectionPurchaseOrder,
} from "./factory-purchase-order-price-correction-values";
import { applyPriceCorrectionBatchSettlement } from "./factory-purchase-order-price-correction-batch-settlement";
import {
  lockFactoryPurchaseOrder,
  requireSalesExecutionActorId,
  type SalesExecutionActor,
} from "./sales-execution-access";

type BatchCorrection = PriceCorrectionPurchaseOrder["priceCorrections"][number];
type ReviewAction = "APPROVE" | "REJECT";

function exactBatchRows(purchaseOrder: PriceCorrectionPurchaseOrder, batchId: string) {
  const rows = purchaseOrder.priceCorrections
    .filter((correction) => correction.batchId === batchId)
    .sort((left, right) => (left.batchLineNo || 0) - (right.batchLineNo || 0));
  const expectedCount = rows[0]?.batchLineCount || 0;
  const valid = expectedCount >= 1
    && rows.length === expectedCount
    && rows.every((row, index) => row.batchId === batchId
      && row.batchLineNo === index + 1
      && row.batchLineCount === expectedCount
      && row.reason === rows[0]?.reason
      && row.currency === rows[0]?.currency
      && row.requestedById === rows[0]?.requestedById);
  if (!valid) {
    throw codedError(
      "批量采购价格更正申请的数据不完整，请联系管理员检查数据",
      409,
      "FACTORY_PRICE_CORRECTION_BATCH_INCOMPLETE",
    );
  }
  return rows;
}

function terminalBatchReviewReplay(rows: BatchCorrection[], action: ReviewAction) {
  const expectedStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
  if (rows.every((row) => row.status === expectedStatus)) return rows;
  if (rows.every((row) => row.status === "PENDING")) return null;
  throw codedError(
    "同批采购价格更正已经审核或状态不一致，不能重复执行相反的审核动作",
    409,
    "FACTORY_PRICE_CORRECTION_REVIEW_CONFLICT",
  );
}

function assertCurrentBatchValues(
  purchaseOrder: PriceCorrectionPurchaseOrder,
  corrections: BatchCorrection[],
) {
  return corrections.map((correction) => {
    const item = purchaseOrder.items.find((candidate) => candidate.id === correction.purchaseOrderItemId);
    if (!item) throw codedError("采购单产品行不存在", 404, "FACTORY_PRICE_CORRECTION_ITEM_NOT_FOUND");
    const currentPrice = currentApprovedUnitPrice(purchaseOrder, item).unitPrice;
    if (!currentPrice || !currentPrice.eq(correction.oldUnitPrice)) {
      throw codedError(
        "本批次中至少一个产品的当前生效采购单价已变化，请驳回整批后重新提交",
        409,
        "FACTORY_PRICE_CORRECTION_CURRENT_PRICE_CONFLICT",
      );
    }
    if (purchaseOrder.settlement) {
      if (item.actualDeliveredQuantity === null) {
        throw codedError(
          "该采购单已完成最终应付确认，必须先补齐全部更正产品的实际交付数量",
          409,
          "FACTORY_PRICE_CORRECTION_ACTUAL_DELIVERY_REQUIRED",
        );
      }
      if (!item.actualDeliveredQuantity.eq(correction.quantitySnapshot)) {
        throw codedError(
          "本批次中至少一个产品的实际交付数量在申请后发生变化，请驳回整批后重新提交",
          409,
          "FACTORY_PRICE_CORRECTION_QUANTITY_SNAPSHOT_CONFLICT",
        );
      }
    }
    return { correction, item };
  });
}

async function createBatchAdjustments(
  tx: Prisma.TransactionClient,
  request: PriceCorrectionAuditRequest,
  actorId: string,
  purchaseOrder: PriceCorrectionPurchaseOrder,
  rows: ReturnType<typeof assertCurrentBatchValues>,
  reviewedAt: Date,
) {
  let sequenceNo = purchaseOrder.adjustments.reduce(
    (max, adjustment) => Math.max(max, adjustment.sequenceNo),
    0,
  );
  const adjustments: FactoryPurchaseOrderAdjustment[] = [];
  for (const { correction, item } of rows) {
    sequenceNo += 1;
    const direction = correction.deltaAmount.gte(0) ? "INCREASE" : "DECREASE";
    const amount = correction.deltaAmount.abs().toDecimalPlaces(2);
    const productName = item.productNameSnapshot || `第 ${correction.sequenceNo} 行`;
    const adjustment = await tx.factoryPurchaseOrderAdjustment.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        sequenceNo,
        kind: "OTHER",
        direction,
        amount,
        currency: purchaseOrder.purchaseCurrency,
        description: `批量采购价格更正：${productName}，${formatCorrectionPrice(correction.oldUnitPrice)} → ${formatCorrectionPrice(correction.newUnitPrice)}，差额 ${formatCorrectionAmount(correction.deltaAmount)}。原因：${correction.reason}`,
        status: "CONFIRMED",
        sourceType: "PURCHASE_PRICE_CORRECTION",
        sourceId: correction.id,
        createdById: correction.requestedById,
        confirmedById: actorId,
        confirmedAt: reviewedAt,
      },
    });
    adjustments.push(adjustment);
    await writeAudit(
      request,
      { id: actorId },
      "批量采购价格更正生成差额调整",
      "factory_purchase_order_adjustments",
      adjustment.id,
      null,
      adjustment,
      tx,
    );
  }
  return adjustments;
}

export async function reviewFactoryPurchaseOrderPriceCorrectionBatch(
  request: PriceCorrectionAuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  batchId: string,
  rawInput: unknown,
) {
  requireAdminGlobal(actor, "只有管理员可以审核采购价格更正申请");
  assertWrite(actor, "costs");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "批量采购价格更正审核");
  const action = String(input.action || "").trim().toUpperCase() as ReviewAction;
  if (!(action === "APPROVE" || action === "REJECT")) {
    throw codedError("审核动作无效", 400, "FACTORY_PRICE_CORRECTION_REVIEW_ACTION_INVALID");
  }
  const reviewRemark = factoryLedgerText(input.reviewRemark, "审核备注", 2_000);
  if (action === "REJECT" && !reviewRemark) {
    throw codedError("驳回采购价格更正时请填写审核备注", 400, "FACTORY_PRICE_CORRECTION_REJECT_REMARK_REQUIRED");
  }

  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const purchaseOrder = await loadPurchaseOrderWithPriceCorrections(
      tx,
      executionId,
      purchaseOrderId,
      actor,
    );
    const corrections = exactBatchRows(purchaseOrder, batchId);
    const replay = terminalBatchReviewReplay(corrections, action);
    if (replay) {
      return {
        batchId,
        corrections: replay,
        totalDeltaAmount: replay.reduce(
          (sum, correction) => sum.add(correction.deltaAmount),
          new Prisma.Decimal(0),
        ).toDecimalPlaces(2),
      };
    }

    if (action === "APPROVE") {
      assertPriceCorrectionAllowed(purchaseOrder);
      const orderId = purchaseOrder.execution.receivableOrder?.id || "";
      if (orderId) {
        await assertBusinessOrderWritableInTransaction(
          tx,
          orderId,
          "该订单已提交退税并归档，不能审核通过采购价格更正。",
        );
        await assertCommissionOrderWritableInTransaction(tx, orderId);
      }
      await assertPriceCorrectionSupplierDocumentsWithdrawn(tx, purchaseOrder.id);
    }

    const reviewedAt = new Date();
    const adjustmentByCorrectionId = new Map<string, string>();
    let settlementSnapshot: Record<string, unknown> = {};
    if (action === "APPROVE") {
      const rows = assertCurrentBatchValues(purchaseOrder, corrections);
      const adjustments = await createBatchAdjustments(
        tx,
        request,
        actorId,
        purchaseOrder,
        rows,
        reviewedAt,
      );
      adjustments.forEach((adjustment, index) => {
        adjustmentByCorrectionId.set(corrections[index]!.id, adjustment.id);
      });
      settlementSnapshot = await applyPriceCorrectionBatchSettlement(
        tx,
        request,
        actorId,
        purchaseOrder,
        adjustments,
        reviewedAt,
      );
    }

    const savedCorrections: FactoryPurchaseOrderPriceCorrection[] = [];
    for (const correction of corrections) {
      const isBatchLeader = correction.batchLineNo === 1;
      const saved = await tx.factoryPurchaseOrderPriceCorrection.update({
        where: { id: correction.id },
        data: {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewRemark: reviewRemark || null,
          adjustmentId: adjustmentByCorrectionId.get(correction.id) || null,
          reviewedById: actorId,
          reviewedAt,
          ...(isBatchLeader ? settlementSnapshot : {}),
        },
      });
      savedCorrections.push(saved);
      await writeAudit(
        request,
        { id: actorId },
        action === "APPROVE" ? "审核通过批量采购价格更正" : "驳回批量采购价格更正",
        "factory_purchase_order_price_corrections",
        saved.id,
        correction,
        saved,
        tx,
      );
    }
    await tx.factoryPurchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: { revision: { increment: 1 }, updatedById: actorId },
    });
    return {
      batchId,
      corrections: savedCorrections,
      totalDeltaAmount: savedCorrections.reduce(
        (sum, correction) => sum.add(correction.deltaAmount),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
