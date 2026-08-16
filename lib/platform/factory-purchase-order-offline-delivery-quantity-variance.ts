import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import type { SalesExecutionActor } from "./sales-execution-access";
import {
  requireActiveInternalConfirmationActor,
  type ActiveInternalConfirmationActor,
} from "./factory-purchase-order-confirmation-access";
import {
  appendDeliveryQuantityVariance,
  deliveryQuantityVarianceAuditState,
  deliveryQuantityVarianceOrderSelect,
  serializeDeliveryQuantityVariance,
} from "./factory-purchase-order-delivery-quantity-variance-core";
import { normalizeOfflineDeliveryQuantityVarianceInput } from "./factory-purchase-order-delivery-quantity-variance-service-inputs";
import { salesExecutionAccessWhere } from "./sales-execution-access";

type AuditRequest = Parameters<typeof writeAudit>[0];

function findInternalVarianceOrder(
  tx: Prisma.TransactionClient,
  actor: ActiveInternalConfirmationActor,
  executionId: string,
  purchaseOrderId: string,
) {
  return tx.factoryPurchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      executionId,
      dispatchedAt: { not: null },
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    select: deliveryQuantityVarianceOrderSelect,
  });
}

export async function requestOfflineDeliveryQuantityVariance(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  try {
    return await prisma.$transaction(async (tx) => {
      const validActor = await requireActiveInternalConfirmationActor(tx, actor);
      const scoped = await findInternalVarianceOrder(tx, validActor, executionId, purchaseOrderId);
      if (!scoped) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findInternalVarianceOrder(tx, validActor, executionId, scoped.id);
      if (!before) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      const input = normalizeOfflineDeliveryQuantityVarianceInput(
        rawInput,
        before.items,
        before.deliveryQuantityToleranceRatio,
      );
      const variance = await appendDeliveryQuantityVariance({
        tx,
        order: before,
        expectedRevision: input.expectedRevision,
        requestedById: validActor.id,
        reason: input.reason,
        items: input.items,
        attribution: input.attribution,
      });
      const saved = await findInternalVarianceOrder(tx, validActor, executionId, before.id);
      if (!saved) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      await writeAudit(
        request,
        { id: validActor.id },
        "内部代录供应商交付数量差异申请",
        "factory_purchase_order_delivery_quantity_variances",
        variance.id,
        deliveryQuantityVarianceAuditState(before),
        deliveryQuantityVarianceAuditState(saved, variance),
        tx,
      );
      return {
        purchaseOrderId: before.id,
        revision: saved.revision,
        variance: serializeDeliveryQuantityVariance(variance),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError(
        "交付数量差异申请状态已变化，请刷新后重试",
        409,
        "FACTORY_DELIVERY_QUANTITY_VARIANCE_CONFLICT",
      );
    }
    throw error;
  }
}
