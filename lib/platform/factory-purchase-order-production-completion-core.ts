import type { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import type {
  FactoryConfirmationChannel,
  FactoryConfirmationSource,
} from "./factory-purchase-order-response-core";
import type { SelectedSupplierPurchaseOrder } from "./supplier-purchase-orders-query";

export type FactoryProductionCompletionAttribution = {
  source: FactoryConfirmationSource;
  channel: FactoryConfirmationChannel;
  supplierContact: string;
  productionCompletedAt?: Date;
  remark?: string;
  evidenceNote?: string;
};

export async function applyFactoryPurchaseOrderProductionCompletion({
  tx,
  before,
  actorId,
  expectedRevision,
  attribution,
}: {
  tx: Prisma.TransactionClient;
  before: SelectedSupplierPurchaseOrder;
  actorId: string;
  expectedRevision: number;
  attribution: FactoryProductionCompletionAttribution;
}) {
  if (before.status !== "ACCEPTED") {
    throw codedError("只有已确认的有效采购单可以确认生产完成", 409, "SUPPLIER_PRODUCTION_PURCHASE_ORDER_NOT_ACTIVE");
  }
  if (before.productionStatus === "COMPLETED") {
    if (before.productionCompletionSource !== attribution.source) {
      throw codedError(
        "该采购单已通过其他渠道确认生产完成，请刷新查看确认记录",
        409,
        "FACTORY_PRODUCTION_ALREADY_COMPLETED_BY_OTHER_SOURCE",
      );
    }
    return { changed: false, recordedAt: before.productionCompletionRecordedAt || before.productionCompletedAt };
  }
  if (before.productionStatus !== "IN_PRODUCTION") {
    throw codedError("只有生产中的采购单可以确认生产完成", 409, "SUPPLIER_PRODUCTION_NOT_IN_PROGRESS");
  }
  if (before.revision !== expectedRevision) {
    throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
  }

  const recordedAt = new Date();
  const productionCompletedAt = attribution.productionCompletedAt || recordedAt;
  const productionStartedAt = before.productionStartedAt ? new Date(before.productionStartedAt) : null;
  if (Number.isNaN(productionCompletedAt.getTime())
    || productionCompletedAt.getTime() > recordedAt.getTime()
    || !productionStartedAt
    || productionCompletedAt.getTime() < productionStartedAt.getTime()) {
    throw codedError(
      "供应商实际完工时间必须在开始生产后且不能晚于当前时间",
      400,
      "FACTORY_PRODUCTION_COMPLETION_TIME_INVALID",
    );
  }

  const changed = await tx.factoryPurchaseOrder.updateMany({
    where: {
      id: before.id,
      supplierId: before.supplierId,
      status: "ACCEPTED",
      productionStatus: "IN_PRODUCTION",
      productionCompletedAt: null,
      productionCompletedById: null,
      revision: expectedRevision,
    },
    data: {
      productionStatus: "COMPLETED",
      productionCompletedAt,
      productionCompletedById: actorId,
      productionCompletionSource: attribution.source,
      productionCompletionChannel: attribution.channel,
      productionCompletionContact: attribution.supplierContact,
      productionCompletionRecordedAt: recordedAt,
      productionCompletionRemark: attribution.remark || null,
      productionCompletionEvidenceNote: attribution.evidenceNote || null,
      revision: { increment: 1 },
      updatedById: actorId,
    },
  });
  if (changed.count !== 1) {
    throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
  }
  return { changed: true, recordedAt, productionCompletedAt };
}
