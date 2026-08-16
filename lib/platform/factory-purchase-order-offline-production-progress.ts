import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import type { SalesExecutionActor } from "./sales-execution-access";
import {
  findInternalConfirmationPurchaseOrder,
  requireActiveInternalConfirmationActor,
} from "./factory-purchase-order-confirmation-access";
import { normalizeOfflineProductionProgressInput } from "./factory-purchase-order-offline-production-progress-inputs";
import { serializeProductionProgress } from "./factory-purchase-order-production-progress-values";
import {
  approvedDeliveryQuantityVariance,
  resolveProductionProgressTargets,
} from "./factory-purchase-order-delivery-quantity-variance-values";
import type { SelectedSupplierPurchaseOrder } from "./supplier-purchase-orders-query";

type AuditRequest = Parameters<typeof writeAudit>[0];

function latestProgressReport(order: SelectedSupplierPurchaseOrder) {
  return [...order.productionProgressReports]
    .sort((left, right) => right.sequenceNo - left.sequenceNo)[0] || null;
}

function latestCompletedQuantities(order: SelectedSupplierPurchaseOrder) {
  return new Map((latestProgressReport(order)?.items || []).map((item) => [
    item.purchaseOrderItemId,
    new Prisma.Decimal(item.completedQuantity.toString()),
  ]));
}

function progressState(order: SelectedSupplierPurchaseOrder) {
  return {
    revision: order.revision,
    status: order.status,
    productionStatus: order.productionStatus,
    productionProgress: serializeProductionProgress(
      order.productionProgressReports,
      order.items,
      approvedDeliveryQuantityVariance(order.deliveryQuantityVariances),
    ),
  };
}

function assertProgressCanBeRecorded(order: SelectedSupplierPurchaseOrder) {
  if (order.status !== "ACCEPTED" || order.productionStatus !== "IN_PRODUCTION") {
    throw codedError(
      "只有已开始生产的有效采购单可以代录生产进度",
      409,
      "FACTORY_PRODUCTION_PROGRESS_NOT_ALLOWED",
    );
  }
}

function validateReportedAt(
  order: SelectedSupplierPurchaseOrder,
  supplierReportedAt: Date,
  recordedAt: Date,
) {
  const productionStartedAt = order.productionStartedAt
    ? new Date(order.productionStartedAt)
    : null;
  const previousReportedAt = latestProgressReport(order)?.supplierReportedAt;
  const previousInstant = previousReportedAt ? new Date(previousReportedAt) : null;
  if (!productionStartedAt
    || supplierReportedAt.getTime() < productionStartedAt.getTime()
    || supplierReportedAt.getTime() > recordedAt.getTime()) {
    throw codedError(
      "供应商实际进度反馈时间必须在开始生产后且不能晚于当前时间",
      400,
      "FACTORY_PRODUCTION_PROGRESS_REPORTED_AT_INVALID",
    );
  }
  if (previousInstant && supplierReportedAt.getTime() < previousInstant.getTime()) {
    throw codedError(
      "供应商实际进度反馈时间不能早于上次填报时间",
      409,
      "FACTORY_PRODUCTION_PROGRESS_REPORTED_AT_DECREASED",
    );
  }
}

function validateProgressChange(
  order: SelectedSupplierPurchaseOrder,
  items: Array<{ purchaseOrderItemId: string; completedQuantity: Prisma.Decimal }>,
) {
  const latest = latestProgressReport(order);
  const previousByItemId = new Map((latest?.items || []).map((item) => [
    item.purchaseOrderItemId,
    new Prisma.Decimal(item.completedQuantity.toString()),
  ]));
  let changed = false;
  for (const item of items) {
    const previous = previousByItemId.get(item.purchaseOrderItemId) || new Prisma.Decimal(0);
    if (item.completedQuantity.lt(previous)) {
      throw codedError(
        "累计完成数量不能小于上次填报数量",
        409,
        "FACTORY_PRODUCTION_PROGRESS_CANNOT_DECREASE",
      );
    }
    if (!item.completedQuantity.eq(previous)) changed = true;
  }
  if (!changed) {
    throw codedError(
      "累计完成数量没有变化，无需重复提交",
      409,
      "FACTORY_PRODUCTION_PROGRESS_UNCHANGED",
    );
  }
}

async function findScopedOrder(
  tx: Prisma.TransactionClient,
  actor: Parameters<typeof findInternalConfirmationPurchaseOrder>[1],
  executionId: string,
  purchaseOrderId: string,
) {
  return findInternalConfirmationPurchaseOrder(tx, actor, executionId, purchaseOrderId);
}

export async function recordOfflineFactoryProductionProgress(
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
      const scoped = await findScopedOrder(tx, validActor, executionId, purchaseOrderId);
      if (!scoped) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findScopedOrder(tx, validActor, executionId, scoped.id);
      if (!before) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      assertProgressCanBeRecorded(before);
      const previous = latestCompletedQuantities(before);
      const input = normalizeOfflineProductionProgressInput(
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
      const recordedAt = new Date();
      validateReportedAt(before, input.attribution.supplierReportedAt, recordedAt);
      validateProgressChange(before, input.items);

      const sequenceNo = before.productionProgressReports.reduce(
        (maximum, report) => Math.max(maximum, report.sequenceNo),
        0,
      ) + 1;
      const report = await tx.factoryPurchaseOrderProductionReport.create({
        data: {
          purchaseOrderId: before.id,
          sequenceNo,
          reportedById: validActor.id,
          source: input.attribution.source,
          channel: input.attribution.channel,
          supplierContact: input.attribution.supplierContact,
          supplierReportedAt: input.attribution.supplierReportedAt,
          reportedAt: recordedAt,
          remark: input.remark || null,
          items: {
            create: input.items.map((item) => ({
              purchaseOrderId: before.id,
              purchaseOrderItemId: item.purchaseOrderItemId,
              completedQuantity: item.completedQuantity,
            })),
          },
        },
      });
      const updated = await tx.factoryPurchaseOrder.updateMany({
        where: {
          id: before.id,
          executionId,
          status: "ACCEPTED",
          productionStatus: "IN_PRODUCTION",
          revision: before.revision,
        },
        data: { revision: { increment: 1 }, updatedById: validActor.id },
      });
      if (updated.count !== 1) {
        throw codedError(
          "采购单状态已变化，请刷新后重试",
          409,
          "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT",
        );
      }
      const saved = await findScopedOrder(tx, validActor, executionId, before.id);
      if (!saved) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      const beforeState = progressState(before);
      const afterState = progressState(saved);
      await writeAudit(
        request,
        { id: validActor.id },
        "内部代录供应商线下生产进度",
        "factory_purchase_order_production_reports",
        report.id,
        beforeState,
        {
          ...afterState,
          source: input.attribution.source,
          channel: input.attribution.channel,
          supplierContact: input.attribution.supplierContact,
          supplierReportedAt: input.attribution.supplierReportedAt,
          remark: input.remark,
        },
        tx,
      );
      return {
        purchaseOrderId: before.id,
        reportId: report.id,
        revision: saved.revision,
        status: saved.status,
        productionStatus: saved.productionStatus,
        productionProgress: afterState.productionProgress,
      };
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
