import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import {
  appendDeliveryQuantityVariance,
  deliveryQuantityVarianceAuditState,
  deliveryQuantityVarianceOrderSelect,
} from "./factory-purchase-order-delivery-quantity-variance-core";
import { normalizeDeliveryQuantityVarianceInput } from "./factory-purchase-order-delivery-quantity-variance-inputs";
import type { SupplierPurchaseOrderActor } from "./supplier-purchase-orders";
import {
  assertActiveSupplierPurchaseOrderActor,
} from "./supplier-purchase-orders";
import { supplierPurchaseOrderScope } from "./supplier-purchase-orders-query";
import { serializeSupplierDeliveryQuantityVariance } from "./supplier-delivery-quantity-variance-values";

type AuditRequest = Parameters<typeof writeAudit>[0];

function findSupplierVarianceOrder(
  tx: Prisma.TransactionClient,
  id: string,
  actor: SupplierPurchaseOrderActor,
) {
  return tx.factoryPurchaseOrder.findFirst({
    where: { id: nonEmpty(id), ...supplierPurchaseOrderScope(actor) },
    select: deliveryQuantityVarianceOrderSelect,
  });
}

export async function requestSupplierDeliveryQuantityVariance(
  request: AuditRequest,
  actor: SupplierPurchaseOrderActor,
  id: string,
  rawInput: unknown,
) {
  assertWrite(actor, "supplierPurchaseOrders");
  const actorId = nonEmpty(actor?.id);
  const supplierId = nonEmpty(actor?.supplierId);
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  if (!supplierId) {
    throw codedError("供应商账号未绑定工厂", 403, "SUPPLIER_ACCOUNT_NOT_BOUND");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const validActor = await assertActiveSupplierPurchaseOrderActor(tx, actorId, supplierId);
      const scoped = await findSupplierVarianceOrder(tx, id, actor);
      if (!scoped) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findSupplierVarianceOrder(tx, scoped.id, actor);
      if (!before) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      const input = normalizeDeliveryQuantityVarianceInput(
        rawInput,
        before.items,
        before.deliveryQuantityToleranceRatio,
      );
      const variance = await appendDeliveryQuantityVariance({
        tx,
        order: before,
        expectedRevision: input.expectedRevision,
        requestedById: actorId,
        reason: input.reason,
        items: input.items,
        attribution: {
          source: "SUPPLIER_PORTAL",
          channel: "PORTAL",
          supplierContact: validActor.name.trim().slice(0, 100) || "供应商账号",
          supplierRequestedAt: new Date(),
        },
      });
      const saved = await findSupplierVarianceOrder(tx, before.id, actor);
      if (!saved) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await writeAudit(
        request,
        { id: actorId },
        "供应商申请交付数量差异",
        "factory_purchase_order_delivery_quantity_variances",
        variance.id,
        deliveryQuantityVarianceAuditState(before),
        deliveryQuantityVarianceAuditState(saved, variance),
        tx,
      );
      return {
        purchaseOrderId: before.id,
        revision: saved.revision,
        variance: serializeSupplierDeliveryQuantityVariance(variance),
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
