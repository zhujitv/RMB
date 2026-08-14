import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import {
  effectiveFactoryPurchaseOrderAmount,
  factoryPrepaymentRequiredAmount,
} from "./factory-purchase-order-financials";
import {
  normalizeSupplierPurchaseOrderPrices,
  normalizeSupplierPurchaseOrderResponse,
} from "./supplier-purchase-orders-values";
import type { SelectedSupplierPurchaseOrder } from "./supplier-purchase-orders-query";

export type FactoryConfirmationSource = "SUPPLIER_PORTAL" | "INTERNAL_OFFLINE";
export type FactoryConfirmationChannel = "PORTAL" | "WECHAT" | "PHONE" | "EMAIL" | "PAPER" | "OTHER";

export type FactoryResponseAttribution = {
  source: FactoryConfirmationSource;
  channel: FactoryConfirmationChannel;
  supplierContact: string;
  supplierRespondedAt?: Date;
  evidenceNote?: string;
};

type ApplyFactoryResponseInput = {
  tx: Prisma.TransactionClient;
  before: SelectedSupplierPurchaseOrder;
  supplierId: string;
  actorId: string;
  rawInput: unknown;
  attribution: FactoryResponseAttribution;
};

export async function applyFactoryPurchaseOrderResponse({
  tx,
  before,
  supplierId,
  actorId,
  rawInput,
  attribution,
}: ApplyFactoryResponseInput) {
  if (!(before.status === "DISPATCHED" || before.status === "ACCEPTED" || before.status === "DELIVERY_PROPOSED")) {
    throw codedError("该采购单当前不能再次回复", 409, "SUPPLIER_PURCHASE_ORDER_RESPONSE_NOT_ALLOWED");
  }
  if (before.execution.shippingStartedAt || before.productionStatus === "COMPLETED" || before.actualDeliveryDate) {
    throw codedError("该采购单已经进入交付阶段，不能再次变更交期", 409, "SUPPLIER_PURCHASE_ORDER_DELIVERY_FROZEN");
  }
  if (before.status === "DELIVERY_PROPOSED") {
    throw codedError("上一次新交期正在等待内部确认，请勿重复提交", 409, "SUPPLIER_PURCHASE_ORDER_PROPOSAL_PENDING");
  }
  const response = normalizeSupplierPurchaseOrderResponse(
    rawInput,
    before.confirmedSupplierDeliveryDate || before.supplierDeliveryDate || before.requestedDeliveryDate,
  );
  if (before.status !== "DISPATCHED" && response.action !== "DELIVERY_PROPOSED") {
    throw codedError("已回复采购单只允许再次变更交货期", 409, "SUPPLIER_PURCHASE_ORDER_ONLY_DELIVERY_CHANGE_ALLOWED");
  }
  if (response.expectedRevision !== before.revision) {
    throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
  }

  const priceRows = response.action === "REJECTED"
    ? []
    : normalizeSupplierPurchaseOrderPrices(rawInput, before.items, {
      allowOriginalPriceOverride: before.status === "DISPATCHED" && before.supplierResponseSequence === 0,
    });
  const suppliedPriceByItem = new Map(priceRows.map((row) => [row.purchaseOrderItemId, row.unitPriceText]));
  const effectiveItems = before.items.map((item) => {
    const suppliedUnitPrice = suppliedPriceByItem.get(item.id);
    return {
      amount: item.amount,
      supplierPrice: suppliedUnitPrice === undefined
        ? item.supplierPrice
        : { amount: new Prisma.Decimal(suppliedUnitPrice).mul(item.allocatedQuantity).toDecimalPlaces(2) },
    };
  });
  const firstAcceptedResponse = response.action === "ACCEPTED" && !before.initialSupplierDeliveryDate;
  const freezePenaltyBase = response.action === "ACCEPTED" && before.penaltyBaseAmount === null;
  const penaltyBaseAmount = freezePenaltyBase
    ? effectiveFactoryPurchaseOrderAmount(effectiveItems)
    : before.penaltyBaseAmount;
  if (freezePenaltyBase && penaltyBaseAmount === null) {
    throw codedError("采购单金额尚未完整，不能确认首次交期", 409, "FACTORY_PURCHASE_ORDER_PENALTY_BASE_INCOMPLETE");
  }

  const recordedAt = new Date();
  const supplierRespondedAt = attribution.supplierRespondedAt || recordedAt;
  const dispatchedAt = before.dispatchedAt ? new Date(before.dispatchedAt) : null;
  if (Number.isNaN(supplierRespondedAt.getTime())
    || supplierRespondedAt.getTime() > recordedAt.getTime()
    || (dispatchedAt && supplierRespondedAt.getTime() < dispatchedAt.getTime())) {
    throw codedError("供应商实际回复时间必须在采购单下发后且不能晚于当前时间", 400, "FACTORY_RESPONSE_TIME_INVALID");
  }

  if (response.action === "REJECTED") {
    const staleSendingBefore = new Date(recordedAt.getTime() - 5 * 60 * 1000);
    await tx.notificationOutbox.updateMany({
      where: {
        type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
        relatedEntityType: "factory_purchase_order",
        relatedEntityId: before.id,
        OR: [
          { status: { in: ["queued", "failed", "pending"] } },
          { status: "sending", updatedAt: { lte: staleSendingBefore } },
        ],
      },
      data: { status: "cancelled", lastError: "采购单已被供应商拒绝，未发送通知已取消" },
    });
  }

  const responseSequence = before.supplierResponseSequence + 1;
  const responseHistory = await tx.factoryPurchaseOrderSupplierResponse.create({
    data: {
      purchaseOrderId: before.id,
      responseSequence,
      action: response.action,
      deliveryDate: response.deliveryDate,
      remark: response.remark || null,
      source: attribution.source,
      channel: attribution.channel,
      supplierContact: attribution.supplierContact,
      supplierRespondedAt,
      evidenceNote: attribution.evidenceNote || null,
      respondedById: actorId,
      respondedAt: recordedAt,
    },
  });
  for (const price of priceRows) {
    const item = before.items.find((candidate) => candidate.id === price.purchaseOrderItemId);
    if (!item) {
      throw codedError("价格回填包含无效采购明细", 400, "SUPPLIER_PURCHASE_ORDER_PRICE_ITEM_INVALID");
    }
    const unitPrice = new Prisma.Decimal(price.unitPriceText);
    await tx.factoryPurchaseOrderSupplierPrice.create({
      data: {
        purchaseOrderId: before.id,
        purchaseOrderItemId: item.id,
        supplierResponseId: responseHistory.id,
        unitPrice,
        amount: unitPrice.mul(item.allocatedQuantity).toDecimalPlaces(2),
        confirmedById: actorId,
        confirmedAt: recordedAt,
      },
    });
  }

  const changed = await tx.factoryPurchaseOrder.updateMany({
    where: {
      id: before.id,
      supplierId,
      status: before.status,
      dispatchedAt: { not: null },
      revision: response.expectedRevision,
      supplierResponseSequence: before.supplierResponseSequence,
    },
    data: {
      status: response.action,
      supplierDeliveryDate: response.action === "ACCEPTED" ? response.deliveryDate : before.supplierDeliveryDate,
      supplierResponseRemark: response.remark || null,
      supplierResponseSequence: responseSequence,
      respondedAt: recordedAt,
      respondedById: actorId,
      ...(firstAcceptedResponse ? { initialSupplierDeliveryDate: response.deliveryDate } : {}),
      ...(response.action === "ACCEPTED" ? { confirmedSupplierDeliveryDate: response.deliveryDate } : {}),
      ...(freezePenaltyBase ? { penaltyBaseAmount } : {}),
      ...(response.action === "REJECTED" ? {
        dispatchEmailStatus: before.dispatchEmailStatus === "SENT" ? "SENT" : "CANCELLED",
        dispatchEmailError: before.dispatchEmailStatus === "SENT"
          ? before.dispatchEmailError
          : "采购单已被供应商拒绝，未发送通知已取消",
      } : {}),
      ...(response.action === "ACCEPTED" && (firstAcceptedResponse || freezePenaltyBase) ? {
        productionStatus: before.prepaymentRequiredBeforeProduction
          && factoryPrepaymentRequiredAmount(penaltyBaseAmount, before.prepaymentRatio).gt(0)
          ? "WAITING_PREPAYMENT"
          : "READY",
      } : {}),
      revision: { increment: 1 },
      updatedById: actorId,
    },
  });
  if (changed.count !== 1) {
    throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
  }
  return { response, responseHistory, responseSequence, recordedAt, supplierRespondedAt };
}
