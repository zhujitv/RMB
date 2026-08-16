import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import { PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";
import { PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT } from "./factory-purchase-order-production-progress-values";
import {
  SUPPLIER_PURCHASE_ORDER_VISIBLE_STATUSES,
  type SupplierPurchaseOrderStatus,
} from "./supplier-purchase-orders-values";
import type { SupplierPurchaseOrderActor } from "./supplier-purchase-orders";

export const supplierPurchaseOrderPublicSelect = Prisma.validator<Prisma.FactoryPurchaseOrderSelect>()({
  id: true, executionId: true, supplierId: true, revision: true, poNo: true, supplierResponseSequence: true, dispatchedAt: true,
  purchaseCurrency: true, requestedDeliveryDate: true, paymentTerm: true, prepaymentRatio: true,
  prepaymentRequiredBeforeProduction: true, initialSupplierDeliveryDate: true,
  confirmedSupplierDeliveryDate: true, actualDeliveryDate: true, actualDeliveryRecordedAt: true,
  deliveryQuantityToleranceRatio: true,
  penaltyBaseAmount: true, delayGraceDays: true, delayPenaltyRatePerDay: true,
  delayPenaltyCapRatio: true, productionStatus: true, productionStartedAt: true,
  productionCompletedAt: true, productionCompletedById: true,
  productionCompletionSource: true, productionCompletionChannel: true,
  productionCompletionContact: true, productionCompletionRecordedAt: true,
  productionCompletionRemark: true, productionCompletionEvidenceNote: true,
  remark: true, status: true, supplierDeliveryDate: true,
  supplierResponseRemark: true, respondedAt: true, dispatchEmailStatus: true,
  dispatchEmailError: true, dispatchSmsStatus: true, dispatchSmsError: true,
  execution: { select: { customerOrderNo: true, shippingStartedAt: true } },
  supplierResponses: {
    orderBy: [{ responseSequence: "asc" }],
    select: {
      id: true, responseSequence: true, action: true, deliveryDate: true, remark: true,
      source: true, channel: true, supplierContact: true, supplierRespondedAt: true,
      evidenceNote: true,
      respondedAt: true,
      internalDecision: true, internalDecidedAt: true,
    },
  },
  productionProgressReports: {
    orderBy: [{ sequenceNo: "desc" }],
    take: PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT,
    select: {
      id: true, sequenceNo: true, source: true, channel: true,
      supplierContact: true, supplierReportedAt: true, reportedAt: true, remark: true,
      items: {
        orderBy: [{ purchaseOrderItemId: "asc" }],
        select: { purchaseOrderItemId: true, completedQuantity: true },
      },
    },
  },
  deliveryQuantityVariances: {
    orderBy: [{ sequenceNo: "desc" }],
    take: 100,
    select: {
      id: true, purchaseOrderId: true, sequenceNo: true, status: true,
      source: true, channel: true, supplierContact: true,
      supplierRequestedAt: true, requestedAt: true, reason: true,
      decidedAt: true,
      items: {
        orderBy: [{ purchaseOrderItemId: "asc" }],
        select: {
          purchaseOrderItemId: true,
          orderedQuantitySnapshot: true,
          proposedQuantity: true,
        },
      },
    },
  },
  loadingResults: {
    orderBy: [{ sequenceNo: "desc" }],
    take: 100,
    select: {
      id: true, containerLoadId: true, executionId: true, purchaseOrderId: true, sequenceNo: true, status: true,
      reason: true, reasonDetail: true, source: true, channel: true,
      supplierContact: true, requestedAt: true,
      decidedAt: true, legacyBackfill: true,
      containerLoad: { select: { loadingDate: true } },
      items: {
        orderBy: [{ purchaseOrderItemId: "asc" }],
        select: {
          purchaseOrderItemId: true,
          plannedQuantitySnapshot: true,
          deliveryTargetQuantitySnapshot: true,
          completedQuantitySnapshot: true,
          previouslyApprovedLoadedQuantitySnapshot: true,
          loadedQuantity: true,
          cumulativeApprovedLoadedQuantitySnapshot: true,
          warehouseRetainedQuantitySnapshot: true,
        },
      },
    },
  },
  payments: { where: { status: "CONFIRMED", kind: "PREPAYMENT" }, select: { amount: true } },
  items: {
    orderBy: [{ lineNumber: "asc" }],
    select: {
      id: true, productNameSnapshot: true, specificationSnapshot: true, unitSnapshot: true,
      allocatedQuantity: true, purchaseUnitPrice: true, amount: true,
      actualDeliveredQuantity: true,
      supplierPrice: { select: { unitPrice: true, amount: true, confirmedAt: true } }, remark: true,
    },
  },
});

export type SelectedSupplierPurchaseOrder = Prisma.FactoryPurchaseOrderGetPayload<{
  select: typeof supplierPurchaseOrderPublicSelect;
}>;

export function supplierPurchaseOrderScope(actor: SupplierPurchaseOrderActor) {
  const supplierId = nonEmpty(actor?.supplierId);
  if (!supplierId) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
  return {
    supplierId,
    dispatchedAt: { not: null },
    status: { in: [...SUPPLIER_PURCHASE_ORDER_VISIBLE_STATUSES] },
    supplier: {
      is: {
        deletedAt: null,
        status: "启用",
        supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
        allowFactoryDocumentUpload: true,
      },
    },
  } satisfies Prisma.FactoryPurchaseOrderWhereInput;
}

export function visibleSupplierPurchaseOrderStatus(value: unknown): SupplierPurchaseOrderStatus | "" {
  const status = String(value || "") as SupplierPurchaseOrderStatus;
  return SUPPLIER_PURCHASE_ORDER_VISIBLE_STATUSES.includes(status) ? status : "";
}
