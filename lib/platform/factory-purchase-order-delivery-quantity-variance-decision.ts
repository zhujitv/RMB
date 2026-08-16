import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import type { SalesExecutionActor } from "./sales-execution-access";
import { salesExecutionAccessWhere } from "./sales-execution-access";
import {
  requireActiveInternalConfirmationActor,
  type ActiveInternalConfirmationActor,
} from "./factory-purchase-order-confirmation-access";
import {
  assertDeliveryQuantityVarianceOpen,
  deliveryQuantityVarianceAuditState,
  deliveryQuantityVarianceOrderSelect,
  serializeDeliveryQuantityVariance,
} from "./factory-purchase-order-delivery-quantity-variance-core";
import { normalizeDeliveryQuantityVarianceDecisionInput } from "./factory-purchase-order-delivery-quantity-variance-service-inputs";
import {
  assertDeliveryQuantityApprovalPreservesSalesCoverage,
  lockDeliveryQuantityVarianceApprovalScope,
} from "./factory-purchase-order-delivery-quantity-variance-coverage";

type AuditRequest = Parameters<typeof writeAudit>[0];

function findDecisionOrder(
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

export async function decideDeliveryQuantityVariance(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  const input = normalizeDeliveryQuantityVarianceDecisionInput(rawInput);
  try {
    return await prisma.$transaction(async (tx) => {
      const validActor = await requireActiveInternalConfirmationActor(tx, actor);
      const scoped = await findDecisionOrder(tx, validActor, executionId, purchaseOrderId);
      if (!scoped) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      if (input.decision === "APPROVED") {
        await lockDeliveryQuantityVarianceApprovalScope(tx, executionId);
      } else {
        await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_order_delivery_quantity_variances" WHERE "id" = ${input.varianceId} AND "purchase_order_id" = ${scoped.id} FOR UPDATE`;
      const before = await findDecisionOrder(tx, validActor, executionId, scoped.id);
      if (!before) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      assertDeliveryQuantityVarianceOpen(before);
      if (before.revision !== input.expectedRevision) {
        throw codedError(
          "采购单状态已变化，请刷新后重试",
          409,
          "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT",
        );
      }
      const variance = before.deliveryQuantityVariances.find((row) => row.id === input.varianceId);
      if (!variance) {
        throw codedError(
          "交付数量差异申请不存在或无权访问",
          404,
          "FACTORY_DELIVERY_QUANTITY_VARIANCE_NOT_FOUND",
        );
      }
      if (variance.status !== "PENDING" || variance.decidedAt || variance.decidedById) {
        throw codedError(
          "交付数量差异申请已经处理",
          409,
          "FACTORY_DELIVERY_QUANTITY_VARIANCE_ALREADY_DECIDED",
        );
      }
      if (variance.source === "INTERNAL_OFFLINE" && variance.requestedById === validActor.id) {
        throw codedError(
          "线下差异申请的代录人与审批人不能是同一人",
          403,
          "FACTORY_DELIVERY_QUANTITY_VARIANCE_SELF_APPROVAL_FORBIDDEN",
        );
      }
      if (input.decision === "APPROVED") {
        await assertDeliveryQuantityApprovalPreservesSalesCoverage(
          tx,
          executionId,
          before.id,
          variance.items,
        );
      }
      const decidedAt = new Date();
      const decided = await tx.factoryPurchaseOrderDeliveryQuantityVariance.updateMany({
        where: {
          id: variance.id,
          purchaseOrderId: before.id,
          status: "PENDING",
          decidedAt: null,
          decidedById: null,
        },
        data: {
          status: input.decision,
          decidedAt,
          decidedById: validActor.id,
          decisionRemark: input.remark || null,
        },
      });
      if (decided.count !== 1) {
        throw codedError(
          "交付数量差异申请状态已变化，请刷新后重试",
          409,
          "FACTORY_DELIVERY_QUANTITY_VARIANCE_DECISION_CONFLICT",
        );
      }
      const changed = await tx.factoryPurchaseOrder.updateMany({
        where: {
          id: before.id,
          revision: input.expectedRevision,
          status: "ACCEPTED",
          productionStatus: "IN_PRODUCTION",
          actualDeliveryDate: null,
          settlement: { is: null },
          execution: { is: { shippingStartedAt: null } },
        },
        data: { revision: { increment: 1 }, updatedById: validActor.id },
      });
      if (changed.count !== 1) {
        throw codedError(
          "采购单状态已变化，请刷新后重试",
          409,
          "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT",
        );
      }
      const saved = await findDecisionOrder(tx, validActor, executionId, before.id);
      const savedVariance = saved?.deliveryQuantityVariances.find((row) => row.id === variance.id);
      if (!saved || !savedVariance) {
        throw codedError(
          "交付数量差异申请不存在或无权访问",
          404,
          "FACTORY_DELIVERY_QUANTITY_VARIANCE_NOT_FOUND",
        );
      }
      await writeAudit(
        request,
        { id: validActor.id },
        input.decision === "APPROVED" ? "批准供应商交付数量差异" : "拒绝供应商交付数量差异",
        "factory_purchase_order_delivery_quantity_variances",
        variance.id,
        deliveryQuantityVarianceAuditState(before, variance),
        deliveryQuantityVarianceAuditState(saved, savedVariance),
        tx,
      );
      return {
        purchaseOrderId: before.id,
        revision: saved.revision,
        variance: serializeDeliveryQuantityVariance(savedVariance),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError(
        "交付数量差异审批状态已变化，请刷新后重试",
        409,
        "FACTORY_DELIVERY_QUANTITY_VARIANCE_DECISION_CONFLICT",
      );
    }
    throw error;
  }
}
