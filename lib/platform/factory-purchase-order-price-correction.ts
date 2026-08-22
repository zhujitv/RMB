import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite, requireAdminGlobal } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  activeSupplierStatuses,
  loadPurchaseOrderForSales,
} from "./factory-purchase-order-execution-shared";
import {
  factoryLedgerIdempotencyKey,
  factoryLedgerInput,
  factoryLedgerText,
  runFactoryPurchaseMutation,
} from "./factory-purchase-order-ledger-values";
import {
  lockFactoryPurchaseOrder,
  requireSalesExecutionActorId,
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";

type AuditRequest = Parameters<typeof writeAudit>[0];

function factoryUnitPrice(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,6})?$/.test(text)) {
    throw codedError("采购单价格式错误，最多保留六位小数", 400, "FACTORY_PRICE_CORRECTION_UNIT_PRICE_INVALID");
  }
  const amount = new Prisma.Decimal(text);
  if (amount.lte(0)) throw codedError("采购单价必须大于 0", 400, "FACTORY_PRICE_CORRECTION_UNIT_PRICE_INVALID");
  return amount;
}

function formatPrice(value: Prisma.Decimal) {
  return value.toDecimalPlaces(6).toString();
}

function formatAmount(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2).toString();
}

function activeConfirmedPayments(
  payments: Array<{ status: string }>,
) {
  return payments.filter((payment) => payment.status === "CONFIRMED");
}

async function loadPurchaseOrderWithPriceCorrections(
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
      items: { orderBy: [{ lineNumber: "asc" }], include: { supplierPrice: true } },
      payments: true,
      adjustments: true,
      settlement: true,
      priceCorrections: { orderBy: [{ sequenceNo: "asc" }] },
      execution: { select: { receivableOrder: { select: { id: true } } } },
    },
  });
  if (!purchaseOrder) {
    throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  }
  return purchaseOrder;
}

function assertPriceCorrectionAllowed(
  purchaseOrder: Awaited<ReturnType<typeof loadPurchaseOrderWithPriceCorrections>>,
) {
  if (!(activeSupplierStatuses as readonly string[]).includes(purchaseOrder.status)) {
    throw codedError("只有已确认的采购单可以申请价格更正", 409, "FACTORY_PRICE_CORRECTION_PURCHASE_ORDER_NOT_ACTIVE");
  }
  if (purchaseOrder.settlement) {
    throw codedError("该采购单已进入最终应付确认，不能再申请价格更正", 409, "FACTORY_PRICE_CORRECTION_SETTLEMENT_FROZEN");
  }
  if (activeConfirmedPayments(purchaseOrder.payments).length) {
    throw codedError("该采购单已有付款记录，请先按财务冲销或补差流程处理，不能直接更正采购价格", 409, "FACTORY_PRICE_CORRECTION_PAYMENT_EXISTS");
  }
}

export async function requestFactoryPurchaseOrderPriceCorrection(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "costs");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "采购价格更正申请");
  const purchaseOrderItemId = factoryLedgerText(input.purchaseOrderItemId, "产品行", 200);
  if (!purchaseOrderItemId) throw codedError("请选择需要更正价格的产品行", 400, "FACTORY_PRICE_CORRECTION_ITEM_REQUIRED");
  const newUnitPrice = factoryUnitPrice(input.newUnitPrice);
  const reason = factoryLedgerText(input.reason, "更正原因", 2_000);
  if (!reason) throw codedError("请填写采购价格更正原因", 400, "FACTORY_PRICE_CORRECTION_REASON_REQUIRED");
  const idempotencyKey = factoryLedgerIdempotencyKey(input.idempotencyKey);

  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const before = await loadPurchaseOrderWithPriceCorrections(tx, executionId, purchaseOrderId, actor);
    assertPriceCorrectionAllowed(before);
    const orderId = before.execution.receivableOrder?.id || "";
    if (orderId) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能申请采购价格更正。",
      );
    }
    const existing = before.priceCorrections.find((correction) => correction.idempotencyKey === idempotencyKey);
    if (existing) return existing;
    const item = before.items.find((candidate) => candidate.id === purchaseOrderItemId);
    if (!item) throw codedError("采购单产品行不存在", 404, "FACTORY_PRICE_CORRECTION_ITEM_NOT_FOUND");
    const pendingOnItem = before.priceCorrections.find((correction) => (
      correction.purchaseOrderItemId === purchaseOrderItemId && correction.status === "PENDING"
    ));
    if (pendingOnItem) {
      throw codedError("该产品行已有待审核的采购价格更正申请", 409, "FACTORY_PRICE_CORRECTION_PENDING_EXISTS");
    }
    const oldUnitPrice = item.supplierPrice?.unitPrice ?? item.purchaseUnitPrice;
    if (!oldUnitPrice) throw codedError("该产品行原采购单价为空，不能申请价格更正", 409, "FACTORY_PRICE_CORRECTION_OLD_PRICE_MISSING");
    if (oldUnitPrice.eq(newUnitPrice)) {
      throw codedError("更正后的采购单价与当前单价相同", 400, "FACTORY_PRICE_CORRECTION_NO_CHANGE");
    }
    const quantitySnapshot = item.allocatedQuantity;
    const oldAmount = quantitySnapshot.mul(oldUnitPrice).toDecimalPlaces(2);
    const newAmount = quantitySnapshot.mul(newUnitPrice).toDecimalPlaces(2);
    const deltaAmount = newAmount.sub(oldAmount).toDecimalPlaces(2);
    if (deltaAmount.eq(0)) {
      throw codedError("本次价格更正不会产生金额差额", 400, "FACTORY_PRICE_CORRECTION_NO_AMOUNT_CHANGE");
    }
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
        sourceUnitPriceType: item.supplierPrice ? "SUPPLIER_CONFIRMED" : "PURCHASE_ORDER",
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
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  correctionId: string,
  rawInput: unknown,
) {
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
    assertPriceCorrectionAllowed(before);
    const orderId = before.execution.receivableOrder?.id || "";
    if (orderId) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能审核采购价格更正。",
      );
    }
    const correction = before.priceCorrections.find((candidate) => candidate.id === correctionId);
    if (!correction) throw codedError("采购价格更正申请不存在或无权访问", 404, "FACTORY_PRICE_CORRECTION_NOT_FOUND");
    if (correction.status !== "PENDING") return correction;
    const reviewedAt = new Date();
    let adjustmentId: string | null = null;
    if (action === "APPROVE") {
      const direction = correction.deltaAmount.gte(0) ? "INCREASE" : "DECREASE";
      const amount = correction.deltaAmount.abs().toDecimalPlaces(2);
      const item = before.items.find((candidate) => candidate.id === correction.purchaseOrderItemId);
      const productName = item?.productNameSnapshot || `第 ${correction.sequenceNo} 行`;
      const sequenceNo = before.adjustments.reduce((max, adjustment) => Math.max(max, adjustment.sequenceNo), 0) + 1;
      const createdAdjustment = await tx.factoryPurchaseOrderAdjustment.create({
        data: {
          purchaseOrderId: before.id,
          sequenceNo,
          kind: "OTHER",
          direction,
          amount,
          currency: before.purchaseCurrency,
          description: `采购价格更正：${productName}，${formatPrice(correction.oldUnitPrice)} → ${formatPrice(correction.newUnitPrice)}，差额 ${formatAmount(correction.deltaAmount)}。原因：${correction.reason}`,
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
    }
    const saved = await tx.factoryPurchaseOrderPriceCorrection.update({
      where: { id: correction.id },
      data: {
        status: action === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewRemark: reviewRemark || null,
        adjustmentId,
        reviewedById: actorId,
        reviewedAt,
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
