import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import type { SalesExecutionActor } from "./sales-execution-access";
import { applyFactoryPurchaseOrderResponse } from "./factory-purchase-order-response-core";
import { normalizeOfflineFactoryResponseInput } from "./factory-purchase-order-confirmation-inputs";
import {
  findInternalConfirmationPurchaseOrder,
  requireActiveInternalConfirmationActor,
} from "./factory-purchase-order-confirmation-access";

type AuditRequest = Parameters<typeof writeAudit>[0];

function auditState(row: NonNullable<Awaited<ReturnType<typeof findInternalConfirmationPurchaseOrder>>>) {
  const latest = row.supplierResponses.at(-1);
  return {
    revision: row.revision,
    status: row.status,
    productionStatus: row.productionStatus,
    supplierResponseSequence: row.supplierResponseSequence,
    supplierDeliveryDate: row.supplierDeliveryDate,
    confirmedSupplierDeliveryDate: row.confirmedSupplierDeliveryDate,
    respondedAt: row.respondedAt,
    latestResponse: latest ? {
      id: latest.id,
      sequence: latest.responseSequence,
      action: latest.action,
      source: latest.source,
      channel: latest.channel,
      supplierContact: latest.supplierContact,
      supplierRespondedAt: latest.supplierRespondedAt,
      recordedAt: latest.respondedAt,
    } : null,
  };
}

export async function recordOfflineFactoryPurchaseOrderResponse(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const normalized = normalizeOfflineFactoryResponseInput(input);
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
      const applied = await applyFactoryPurchaseOrderResponse({
        tx,
        before,
        supplierId: before.supplierId,
        actorId: validActor.id,
        rawInput: input,
        attribution: normalized.attribution,
      });
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
        "内部登记供应商线下回复",
        "factory_purchase_orders",
        before.id,
        auditState(before),
        auditState(saved),
        tx,
      );
      return {
        purchaseOrderId: before.id,
        responseId: applied.responseHistory.id,
        confirmationEventKey: `supplier-response:${applied.responseHistory.id}`,
        revision: saved.revision,
        status: saved.status,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
    }
    throw error;
  }
}
