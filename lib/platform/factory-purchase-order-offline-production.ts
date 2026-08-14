import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import type { SalesExecutionActor } from "./sales-execution-access";
import { normalizeOfflineProductionCompletionInput } from "./factory-purchase-order-confirmation-inputs";
import { applyFactoryPurchaseOrderProductionCompletion } from "./factory-purchase-order-production-completion-core";
import {
  findInternalConfirmationPurchaseOrder,
  requireActiveInternalConfirmationActor,
} from "./factory-purchase-order-confirmation-access";

type AuditRequest = Parameters<typeof writeAudit>[0];

function auditState(row: NonNullable<Awaited<ReturnType<typeof findInternalConfirmationPurchaseOrder>>>) {
  return {
    revision: row.revision,
    productionStatus: row.productionStatus,
    productionCompletedAt: row.productionCompletedAt,
    productionCompletedById: row.productionCompletedById,
    productionCompletionSource: row.productionCompletionSource,
    productionCompletionChannel: row.productionCompletionChannel,
    productionCompletionContact: row.productionCompletionContact,
    productionCompletionRecordedAt: row.productionCompletionRecordedAt,
    productionCompletionRemark: row.productionCompletionRemark,
  };
}

export async function recordOfflineFactoryProductionCompletion(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const normalized = normalizeOfflineProductionCompletionInput(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const validActor = await requireActiveInternalConfirmationActor(tx, actor);
      const scoped = await findInternalConfirmationPurchaseOrder(
        tx,
        validActor,
        executionId,
        purchaseOrderId,
      );
      if (!scoped) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findInternalConfirmationPurchaseOrder(
        tx,
        validActor,
        executionId,
        scoped.id,
      );
      if (!before) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      const applied = await applyFactoryPurchaseOrderProductionCompletion({
        tx,
        before,
        actorId: validActor.id,
        expectedRevision: normalized.expectedRevision,
        attribution: normalized.attribution,
      });
      if (!applied.changed) {
        return {
          purchaseOrderId: before.id,
          confirmationEventKey: `production-completion:${before.id}`,
          revision: before.revision,
          status: before.status,
          productionStatus: before.productionStatus,
        };
      }
      const saved = await findInternalConfirmationPurchaseOrder(
        tx,
        validActor,
        executionId,
        before.id,
      );
      if (!saved) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      await writeAudit(
        request,
        { id: validActor.id },
        "内部登记供应商线下生产完成",
        "factory_purchase_orders",
        before.id,
        auditState(before),
        auditState(saved),
        tx,
      );
      return {
        purchaseOrderId: before.id,
        confirmationEventKey: `production-completion:${before.id}`,
        revision: saved.revision,
        status: saved.status,
        productionStatus: saved.productionStatus,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
    }
    throw error;
  }
}
