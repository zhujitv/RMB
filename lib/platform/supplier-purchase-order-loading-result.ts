import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import type { SupplierPurchaseOrderActor } from "./supplier-purchase-orders";
import { assertActiveSupplierPurchaseOrderActor } from "./supplier-purchase-orders";
import { supplierPurchaseOrderScope } from "./supplier-purchase-orders-query";
import {
  containerLoadingScopeSelect,
  factoryPurchaseLoadingAuditState,
  factoryPurchaseLoadingOrderSelect,
} from "./factory-purchase-order-loading-result-core";
import { normalizeFactoryPurchaseLoadingSubmissionInput } from "./factory-purchase-order-loading-result-inputs";
import { appendFactoryPurchaseLoadingResult } from "./factory-purchase-order-loading-result-workflow";
import { serializeSupplierFactoryPurchaseLoadingResult } from "./factory-purchase-order-loading-result-serialization";
import { lockContainerLoadingScope } from "./container-loading-locks";

type AuditRequest = Parameters<typeof writeAudit>[0];

function findSupplierLoadingOrder(
  tx: Prisma.TransactionClient,
  id: string,
  actor: SupplierPurchaseOrderActor,
) {
  return tx.factoryPurchaseOrder.findFirst({
    where: { id: nonEmpty(id), ...supplierPurchaseOrderScope(actor) },
    select: factoryPurchaseLoadingOrderSelect,
  });
}

export async function submitSupplierFactoryPurchaseLoadingResult(
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
      const scoped = await findSupplierLoadingOrder(tx, id, actor);
      if (!scoped) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      const input = normalizeFactoryPurchaseLoadingSubmissionInput(rawInput);
      const scopedContainer = await tx.salesExecutionContainerLoad.findFirst({
        where: {
          id: input.containerLoadId,
          executionId: scoped.executionId,
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
        scoped.executionId,
        scopedContainer.id,
        scopedContainer.allocations.map((allocation) => allocation.purchaseOrderId),
      );
      const before = await findSupplierLoadingOrder(tx, scoped.id, actor);
      if (!before) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      const container = await tx.salesExecutionContainerLoad.findFirst({
        where: {
          id: scopedContainer.id,
          executionId: before.executionId,
          status: "OPEN",
          allocations: { some: { purchaseOrderId: before.id } },
        },
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
        requestedById: actorId,
        attribution: {
          source: "SUPPLIER_PORTAL",
          channel: "PORTAL",
          supplierContact: validActor.name.trim().slice(0, 100) || "供应商账号",
        },
      });
      const saved = await findSupplierLoadingOrder(tx, before.id, actor);
      if (!saved) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      const savedResult = saved.loadingResults.find((entry) => entry.id === result.id) || result;
      await writeAudit(
        request,
        { id: actorId },
        savedResult.status === "APPROVED"
          ? "供应商提交本柜无差异装柜结果并自动批准"
          : "供应商提交本柜装柜差异结果",
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
        loadingResult: serializeSupplierFactoryPurchaseLoadingResult(savedResult),
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
