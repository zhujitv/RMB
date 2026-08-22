import { Prisma, type FactoryPurchaseOrderAdjustment } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import type { SettlementPurchaseOrder } from "./factory-purchase-order-settlement-query";

export const FACTORY_PRICE_CORRECTION_QUANTITY_RECONCILIATION_SOURCE_TYPE =
  "PURCHASE_PRICE_CORRECTION_QUANTITY_RECONCILIATION";

type AuditRequest = Parameters<typeof writeAudit>[0];

function actualCorrectionDelta(
  correction: SettlementPurchaseOrder["priceCorrections"][number],
  quantity: Prisma.Decimal,
) {
  const oldAmount = quantity.mul(correction.oldUnitPrice).toDecimalPlaces(2);
  const newAmount = quantity.mul(correction.newUnitPrice).toDecimalPlaces(2);
  return newAmount.sub(oldAmount).toDecimalPlaces(2);
}

export async function reconcilePriceCorrectionsForFinalSettlement(
  tx: Prisma.TransactionClient,
  request: AuditRequest,
  actorId: string,
  purchaseOrder: SettlementPurchaseOrder,
  confirmedAt: Date,
) {
  const approved = purchaseOrder.priceCorrections.filter((row) => row.status === "APPROVED");
  const created: FactoryPurchaseOrderAdjustment[] = [];
  let sequenceNo = purchaseOrder.adjustments.reduce(
    (max, adjustment) => Math.max(max, adjustment.sequenceNo),
    0,
  );
  for (const correction of approved) {
    const item = purchaseOrder.items.find((candidate) => candidate.id === correction.purchaseOrderItemId);
    if (!item?.actualDeliveredQuantity) {
      throw codedError(
        "已审核的采购价格更正缺少对应产品实际交付数量，不能确认最终应付",
        409,
        "FACTORY_SETTLEMENT_PRICE_CORRECTION_QUANTITY_REQUIRED",
      );
    }
    const actualDelta = actualCorrectionDelta(correction, item.actualDeliveredQuantity);
    const reconciliation = actualDelta.sub(correction.deltaAmount).toDecimalPlaces(2);
    if (reconciliation.eq(0)) continue;
    sequenceNo += 1;
    const adjustment = await tx.factoryPurchaseOrderAdjustment.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        sequenceNo,
        kind: "OTHER",
        direction: reconciliation.gt(0) ? "INCREASE" : "DECREASE",
        amount: reconciliation.abs(),
        currency: purchaseOrder.purchaseCurrency,
        description: `采购价格更正按实际交付数量重算：申请数量 ${correction.quantitySnapshot.toString()}，实际数量 ${item.actualDeliveredQuantity.toString()}，补正差额 ${reconciliation.toFixed(2)}`,
        occurredAt: purchaseOrder.actualDeliveryDate,
        status: "CONFIRMED",
        sourceType: FACTORY_PRICE_CORRECTION_QUANTITY_RECONCILIATION_SOURCE_TYPE,
        sourceId: correction.id,
        createdById: actorId,
        confirmedById: actorId,
        confirmedAt,
      },
    });
    created.push(adjustment);
    await writeAudit(
      request,
      { id: actorId },
      "采购价格更正按实际交付数量补正",
      "factory_purchase_order_adjustments",
      adjustment.id,
      null,
      adjustment,
      tx,
    );
  }
  return created;
}
