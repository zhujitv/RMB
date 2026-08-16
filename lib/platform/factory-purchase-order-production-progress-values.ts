import { Prisma } from "../generated/prisma/client.js";
import {
  productionProgressIsComplete,
  productionProgressPercent,
} from "./factory-purchase-order-production-progress-inputs";
import {
  resolveDeliveryQuantityTargets,
  type ApprovedDeliveryQuantityVariance,
} from "./factory-purchase-order-delivery-quantity-variance-values";

type DateValue = Date | string | null | undefined;
type QuantityValue = Prisma.Decimal | { toString(): string } | string | number;

export type ProductionProgressReportRow = {
  id: string;
  sequenceNo: number;
  source: string;
  channel: string;
  supplierContact: string;
  supplierReportedAt: DateValue;
  reportedAt: DateValue;
  remark: string | null;
  reportedBy?: { id: string; name: string };
  items: Array<{
    purchaseOrderItemId: string;
    completedQuantity: QuantityValue;
  }>;
};

export type ProductionProgressPurchaseItemRow = {
  id: string;
  allocatedQuantity: QuantityValue;
};

export type ProductionProgressDto = ReturnType<typeof serializeProductionProgress>;

export const PRODUCTION_PROGRESS_HISTORY_LIMIT = 100;
export const PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT = PRODUCTION_PROGRESS_HISTORY_LIMIT + 1;

function isoDate(value: DateValue) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function decimal(value: QuantityValue | null | undefined) {
  return new Prisma.Decimal(value == null ? 0 : value.toString());
}

export function serializeProductionProgress(
  reports: ProductionProgressReportRow[] | null | undefined,
  purchaseItems: ProductionProgressPurchaseItemRow[],
  approvedVariance?: ApprovedDeliveryQuantityVariance,
) {
  const orderedReports = [...(reports || [])]
    .sort((left, right) => left.sequenceNo - right.sequenceNo);
  const historyReports = orderedReports.slice(-PRODUCTION_PROGRESS_HISTORY_LIMIT);
  const baselineReport = orderedReports.length > historyReports.length
    ? orderedReports.at(-(historyReports.length + 1)) || null
    : null;
  const itemById = new Map(purchaseItems.map((item) => [item.id, item]));
  const targetByItemId = new Map(resolveDeliveryQuantityTargets(
    purchaseItems,
    approvedVariance,
  ).map((item) => [item.purchaseOrderItemId, item.targetQuantity]));
  const previousByItemId = new Map<string, Prisma.Decimal>(
    (baselineReport?.items || []).map((item) => [
      item.purchaseOrderItemId,
      decimal(item.completedQuantity),
    ]),
  );
  const history = historyReports.map((report) => {
    const snapshot = report.items.flatMap((item) => {
      const target = itemById.get(item.purchaseOrderItemId);
      if (!target) return [];
      const completed = decimal(item.completedQuantity);
      const previous = previousByItemId.get(item.purchaseOrderItemId) || new Prisma.Decimal(0);
      const allocated = decimal(target.allocatedQuantity);
      const targetQuantity = targetByItemId.get(item.purchaseOrderItemId) || allocated;
      previousByItemId.set(item.purchaseOrderItemId, completed);
      return [{
        purchaseOrderItemId: item.purchaseOrderItemId,
        completedQuantity: completed.toString(),
        incrementQuantity: completed.sub(previous).toString(),
        allocatedQuantity: allocated.toString(),
        targetQuantity: targetQuantity.toString(),
        percent: targetQuantity.gt(0)
          ? Prisma.Decimal.min(completed.div(targetQuantity), 1).mul(100).toDecimalPlaces(2).toNumber()
          : 0,
      }];
    });
    return {
      id: report.id,
      sequence: report.sequenceNo,
      source: report.source || "SUPPLIER_PORTAL",
      channel: report.channel || "PORTAL",
      supplierContact: report.supplierContact || "",
      supplierReportedAt: isoDate(report.supplierReportedAt),
      reportedAt: isoDate(report.supplierReportedAt),
      recordedAt: isoDate(report.reportedAt),
      reportedBy: {
        id: String(report.reportedBy?.id || ""),
        name: String(report.reportedBy?.name || ""),
      },
      remark: report.remark || "",
      percent: productionProgressPercent(snapshot.map((item) => ({
        allocatedQuantity: item.targetQuantity,
        completedQuantity: item.completedQuantity,
      }))),
      items: snapshot,
    };
  });
  const latestReport = history.at(-1) || null;
  const latestQuantityByItemId = new Map(
    (latestReport?.items || []).map((item) => [item.purchaseOrderItemId, item.completedQuantity]),
  );
  const items = purchaseItems.map((item) => {
    const allocated = decimal(item.allocatedQuantity);
    const targetQuantity = targetByItemId.get(item.id) || allocated;
    const completed = decimal(latestQuantityByItemId.get(item.id));
    return {
      purchaseOrderItemId: item.id,
      completedQuantity: completed.toString(),
      allocatedQuantity: allocated.toString(),
      targetQuantity: targetQuantity.toString(),
      percent: targetQuantity.gt(0)
        ? Prisma.Decimal.min(completed.div(targetQuantity), 1).mul(100).toDecimalPlaces(2).toNumber()
        : 0,
    };
  });
  return {
    percent: productionProgressPercent(items.map((item) => ({
      allocatedQuantity: item.targetQuantity,
      completedQuantity: item.completedQuantity,
    }))),
    allCompleted: productionProgressIsComplete(items.map((item) => ({
      allocatedQuantity: item.targetQuantity,
      completedQuantity: item.completedQuantity,
    }))),
    latestReportedAt: latestReport?.supplierReportedAt || null,
    latestRecordedAt: latestReport?.recordedAt || null,
    latestSequence: latestReport?.sequence || 0,
    latestRemark: latestReport?.remark || "",
    items,
    history,
  };
}
