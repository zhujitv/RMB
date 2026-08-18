import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import { normalizeSupplierProductionProgressInput } from "./factory-purchase-order-production-progress-inputs";
import {
  approvedDeliveryQuantityVariance,
  resolveProductionProgressTargets,
} from "./factory-purchase-order-delivery-quantity-variance-values";
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

function latestCompletedQuantities(order: SelectedSupplierPurchaseOrder) {
  const latest = [...order.productionProgressReports]
    .sort((left, right) => right.sequenceNo - left.sequenceNo)[0];
  return new Map((latest?.items || []).map((item) => [
    item.purchaseOrderItemId,
    new Prisma.Decimal(item.completedQuantity.toString()),
  ]));
}

function progressAuditState(order: SelectedSupplierPurchaseOrder) {
  const dto = publicDto(order);
  return {
    revision: dto.revision,
    productionStatus: dto.productionStatus,
    productionProgress: {
      percent: dto.productionProgress.percent,
      latestSequence: dto.productionProgress.latestSequence,
      latestReportedAt: dto.productionProgress.latestReportedAt,
      items: dto.productionProgress.items,
    },
  };
}

export async function recordSupplierPurchaseOrderProductionProgress(
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
      const scoped = await findSupplierProductionOrder(tx, id, actor);
      if (!scoped) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findSupplierProductionOrder(tx, scoped.id, actor);
      if (!before) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      if (before.status !== "ACCEPTED" || before.productionStatus !== "IN_PRODUCTION") {
        throw codedError(
          "只有已开始生产的有效采购单可以填报生产进度",
          409,
          "FACTORY_PRODUCTION_PROGRESS_NOT_ALLOWED",
        );
      }
      const previous = latestCompletedQuantities(before);
      const input = normalizeSupplierProductionProgressInput(
        rawInput,
        resolveProductionProgressTargets(
          before.items,
          approvedDeliveryQuantityVariance(before.deliveryQuantityVariances),
        ).map((target) => ({
          ...target,
          previousCompletedQuantity: previous.get(target.id),
        })),
      );
      if (input.expectedRevision !== before.revision) {
        throw codedError(
          "采购单状态已变化，请刷新后重试",
          409,
          "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT",
        );
      }
      let changed = false;
      for (const item of input.items) {
        const previousQuantity = previous.get(item.purchaseOrderItemId) || new Prisma.Decimal(0);
        if (item.completedQuantity.lt(previousQuantity)) {
          throw codedError(
            "累计完成数量不能小于上次填报数量",
            409,
            "FACTORY_PRODUCTION_PROGRESS_CANNOT_DECREASE",
          );
        }
        if (!item.completedQuantity.eq(previousQuantity)) changed = true;
      }
      if (!changed) {
        throw codedError(
          "累计完成数量没有变化，无需重复提交",
          409,
          "FACTORY_PRODUCTION_PROGRESS_UNCHANGED",
        );
      }

      const sequenceNo = before.productionProgressReports.reduce(
        (maximum, report) => Math.max(maximum, report.sequenceNo),
        0,
      ) + 1;
      const reportedAt = new Date();
      await tx.factoryPurchaseOrderProductionReport.create({
        data: {
          purchaseOrder: { connect: { id: before.id } },
          sequenceNo,
          reportedBy: { connect: { id: actorId } },
          source: "SUPPLIER_PORTAL",
          channel: "PORTAL",
          supplierContact: validActor.name.trim().slice(0, 100) || "供应商账号",
          supplierReportedAt: reportedAt,
          reportedAt,
          remark: input.remark || null,
          items: {
            create: input.items.map((item) => ({
              purchaseOrderItemId: item.purchaseOrderItemId,
              completedQuantity: item.completedQuantity,
            })),
          },
        },
      });
      const updated = await tx.factoryPurchaseOrder.updateMany({
        where: {
          id: before.id,
          supplierId,
          status: "ACCEPTED",
          productionStatus: "IN_PRODUCTION",
          revision: before.revision,
        },
        data: { revision: { increment: 1 }, updatedById: actorId },
      });
      if (updated.count !== 1) {
        throw codedError(
          "采购单状态已变化，请刷新后重试",
          409,
          "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT",
        );
      }
      const saved = await findSupplierProductionOrder(tx, before.id, actor);
      if (!saved) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await writeAudit(
        request,
        { id: actorId },
        "供应商填报工厂采购单生产进度",
        "factory_purchase_order_production_reports",
        saved.productionProgressReports.find((report) => report.sequenceNo === sequenceNo)?.id || before.id,
        progressAuditState(before),
        {
          ...progressAuditState(saved),
          reportedBy: validActor.name,
          remark: input.remark,
        },
        tx,
      );
      return publicDto(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError(
        "生产进度已被更新，请刷新后重试",
        409,
        "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT",
      );
    }
    throw error;
  }
}
