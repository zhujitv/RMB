import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import type { SupplierPurchaseOrderActor } from "./supplier-purchase-orders";
import { assertActiveSupplierPurchaseOrderActor } from "./supplier-purchase-orders";
import {
  supplierPurchaseOrderPublicSelect,
  supplierPurchaseOrderScope,
  type SelectedSupplierPurchaseOrder,
} from "./supplier-purchase-orders-query";
import {
  serializeSupplierPurchaseOrder,
  type SupplierPurchaseOrderPublicRow,
} from "./supplier-purchase-orders-values";
import { normalizePortalProductionCompletionInput } from "./factory-purchase-order-confirmation-inputs";
import { applyFactoryPurchaseOrderProductionCompletion } from "./factory-purchase-order-production-completion-core";

type AuditRequest = Parameters<typeof writeAudit>[0];

function publicDto(row: SelectedSupplierPurchaseOrder) {
  return serializeSupplierPurchaseOrder(row as SupplierPurchaseOrderPublicRow);
}

async function findSupplierProductionOrder(
  tx: Prisma.TransactionClient,
  id: string,
  actor: SupplierPurchaseOrderActor,
) {
  return tx.factoryPurchaseOrder.findFirst({
    where: { id: nonEmpty(id), ...supplierPurchaseOrderScope(actor) },
    select: supplierPurchaseOrderPublicSelect,
  });
}

function completionAuditState(row: SelectedSupplierPurchaseOrder) {
  return {
    revision: row.revision,
    productionStatus: row.productionStatus,
    productionCompletedAt: row.productionCompletedAt,
    productionCompletedById: row.productionCompletedById,
    productionCompletionSource: row.productionCompletionSource,
    productionCompletionChannel: row.productionCompletionChannel,
    productionCompletionContact: row.productionCompletionContact,
    productionCompletionRecordedAt: row.productionCompletionRecordedAt,
  };
}

export async function completeSupplierPurchaseOrderProduction(
  request: AuditRequest,
  actor: SupplierPurchaseOrderActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "supplierPurchaseOrders");
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  const supplierId = nonEmpty(actor?.supplierId);
  if (!supplierId) {
    throw codedError("供应商账号未绑定工厂", 403, "SUPPLIER_ACCOUNT_NOT_BOUND");
  }
  const { expectedRevision } = normalizePortalProductionCompletionInput(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const validActor = await assertActiveSupplierPurchaseOrderActor(tx, actorId, supplierId);
      const scoped = await findSupplierProductionOrder(tx, id, actor);
      if (!scoped) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findSupplierProductionOrder(tx, scoped.id, actor);
      if (!before) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      const applied = await applyFactoryPurchaseOrderProductionCompletion({
        tx,
        before,
        actorId,
        expectedRevision,
        attribution: {
          source: "SUPPLIER_PORTAL",
          channel: "PORTAL",
          supplierContact: validActor.name.trim().slice(0, 100) || "供应商账号",
        },
      });
      if (!applied.changed) return publicDto(before);

      const saved = await findSupplierProductionOrder(tx, before.id, actor);
      if (!saved) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await writeAudit(
        request,
        { id: actorId },
        "供应商确认工厂采购单生产完成",
        "factory_purchase_orders",
        before.id,
        completionAuditState(before),
        completionAuditState(saved),
        tx,
      );
      return publicDto(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
    }
    throw error;
  }
}
