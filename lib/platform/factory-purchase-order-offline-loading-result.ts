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
  containerLoadingScopeSelect,
  factoryPurchaseLoadingAuditState,
  factoryPurchaseLoadingOrderSelect,
} from "./factory-purchase-order-loading-result-core";
import { normalizeOfflineFactoryPurchaseLoadingSubmissionInput } from "./factory-purchase-order-loading-result-inputs";
import { appendFactoryPurchaseLoadingResult } from "./factory-purchase-order-loading-result-workflow";
import { serializeInternalFactoryPurchaseLoadingResult } from "./factory-purchase-order-loading-result-serialization";
import { lockContainerLoadingScope } from "./container-loading-locks";

type AuditRequest = Parameters<typeof writeAudit>[0];

function findInternalLoadingOrder(
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
    select: factoryPurchaseLoadingOrderSelect,
  });
}

export async function submitOfflineFactoryPurchaseLoadingResult(
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
      const scoped = await findInternalLoadingOrder(tx, validActor, executionId, purchaseOrderId);
      if (!scoped) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      const input = normalizeOfflineFactoryPurchaseLoadingSubmissionInput(rawInput);
      const scopedContainer = await tx.salesExecutionContainerLoad.findFirst({
        where: {
          id: input.containerLoadId,
          executionId,
          status: "OPEN",
          allocations: { some: { purchaseOrderId: scoped.id } },
        },
        select: containerLoadingScopeSelect,
      });
      if (!scopedContainer) {
        throw codedError("集装箱不存在、未开放或未分配该采购单", 404, "CONTAINER_LOAD_NOT_FOUND");
      }
      await lockContainerLoadingScope(
        tx,
        executionId,
        scopedContainer.id,
        scopedContainer.allocations.map((allocation) => allocation.purchaseOrderId),
      );
      const before = await findInternalLoadingOrder(tx, validActor, executionId, scoped.id);
      if (!before) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      const container = await tx.salesExecutionContainerLoad.findFirst({
        where: { id: scopedContainer.id, executionId, status: "OPEN" },
        select: containerLoadingScopeSelect,
      });
      if (!container) {
        throw codedError("集装箱状态已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
      }
      const result = await appendFactoryPurchaseLoadingResult({
        tx,
        order: before,
        container,
        input,
        requestedById: validActor.id,
        attribution: input.attribution,
      });
      const saved = await findInternalLoadingOrder(tx, validActor, executionId, before.id);
      if (!saved) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      const savedResult = saved.loadingResults.find((entry) => entry.id === result.id) || result;
      await writeAudit(
        request,
        { id: validActor.id },
        savedResult.status === "APPROVED"
          ? "内部代录本柜无差异装柜结果并自动批准"
          : "内部代录供应商本柜装柜差异结果",
        "factory_purchase_order_loading_results",
        result.id,
        factoryPurchaseLoadingAuditState(before, container),
        factoryPurchaseLoadingAuditState(saved, { ...container, revision: container.revision + 1 }, savedResult),
        tx,
      );
      return {
        purchaseOrderId: before.id,
        revision: saved.revision,
        containerLoadId: container.id,
        containerRevision: container.revision + 1,
        loadingResult: serializeInternalFactoryPurchaseLoadingResult(savedResult),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError(
        "装柜结果状态已变化，请刷新后重试",
        409,
        "FACTORY_PURCHASE_LOADING_CONFLICT",
      );
    }
    throw error;
  }
}
