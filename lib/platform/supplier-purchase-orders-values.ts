import { Prisma } from "../generated/prisma/client.js";
import {
  serializeProductionProgress,
  type ProductionProgressDto,
  type ProductionProgressReportRow,
} from "./factory-purchase-order-production-progress-values";
import { productVisibleDescription } from "./quotation-calculations";
import {
  serializeSupplierDeliveryQuantityVariances,
  type SupplierDeliveryQuantityVarianceDto,
  type SupplierDeliveryQuantityVarianceRow,
} from "./supplier-delivery-quantity-variance-values";
import {
  serializeSupplierFactoryPurchaseLoadingResult,
  type FactoryPurchaseLoadingResultRow,
  type SupplierFactoryPurchaseLoadingResultDto,
} from "./factory-purchase-order-loading-result-serialization";
import {
  serializeSupplierContainerLoad,
  type SupplierContainerLoadRow,
} from "./sales-execution-container-load-serialization";
export const SUPPLIER_PURCHASE_ORDER_VISIBLE_STATUSES = [
  "DISPATCHED",
  "ACCEPTED",
  "DELIVERY_PROPOSED",
  "REJECTED",
] as const;
export type SupplierPurchaseOrderStatus = typeof SUPPLIER_PURCHASE_ORDER_VISIBLE_STATUSES[number];
export type SupplierPurchaseOrderResponseAction = Exclude<SupplierPurchaseOrderStatus, "DISPATCHED">;
type DateValue = Date | string | null | undefined;
type QuantityValue = { toString(): string } | string | number;
type DecimalValue = QuantityValue | null | undefined;
export type SupplierPurchaseOrderPublicRow = {
  id: string;
  executionId: string;
  supplierId: string;
  revision: number;
  poNo: string;
  execution: { customerOrderNo: string; shippingStartedAt: DateValue };
  dispatchedAt: DateValue;
  purchaseCurrency: string;
  requestedDeliveryDate: DateValue;
  paymentTerm: string | null;
  prepaymentRatio: DecimalValue;
  prepaymentRequiredBeforeProduction: boolean;
  initialSupplierDeliveryDate: DateValue;
  confirmedSupplierDeliveryDate: DateValue;
  actualDeliveryDate: DateValue;
  actualDeliveryRecordedAt: DateValue;
  deliveryQuantityToleranceRatio: DecimalValue;
  penaltyBaseAmount: DecimalValue;
  delayGraceDays: number;
  delayPenaltyRatePerDay: DecimalValue;
  delayPenaltyCapRatio: DecimalValue;
  productionStatus: string;
  productionStartedAt: DateValue;
  productionCompletedAt: DateValue;
  productionCompletedById: string | null;
  productionCompletionSource: string | null;
  productionCompletionChannel: string | null;
  productionCompletionContact: string | null;
  productionCompletionRecordedAt: DateValue;
  productionCompletionRemark: string | null;
  productionCompletionEvidenceNote: string | null;
  remark: string | null;
  status: SupplierPurchaseOrderStatus;
  supplierDeliveryDate: DateValue;
  supplierResponseRemark: string | null;
  supplierResponseSequence: number;
  respondedAt: DateValue;
  productionProgressReports: ProductionProgressReportRow[];
  deliveryQuantityVariances: SupplierDeliveryQuantityVarianceRow[];
  loadingResults: FactoryPurchaseLoadingResultRow[];
  containerLoads?: SupplierContainerLoadRow[];
  supplierResponses: Array<{
    id: string;
    responseSequence: number;
    action: string;
    deliveryDate: DateValue;
    remark: string | null;
    source: string;
    channel: string;
    supplierContact: string;
    supplierRespondedAt: DateValue;
    evidenceNote: string | null;
    respondedAt: DateValue;
    internalDecision: string | null;
    internalDecidedAt: DateValue;
  }>;
  payments: Array<{ amount: DecimalValue }>;
  items: Array<{
    id: string;
    productNameSnapshot: string;
    specificationSnapshot: string | null;
    unitSnapshot: string;
    allocatedQuantity: QuantityValue;
    actualDeliveredQuantity: DecimalValue;
    purchaseUnitPrice: DecimalValue;
    amount: DecimalValue;
    supplierPrice: {
      unitPrice: DecimalValue;
      amount: DecimalValue;
      confirmedAt: DateValue;
    } | null;
    remark: string | null;
  }>;
};
export type SupplierPurchaseOrderDto = {
  id: string;
  revision: number;
  poNo: string;
  customerOrderNo: string;
  dispatchedAt: string | null;
  purchaseCurrency: string;
  requestedDeliveryDate: string | null;
  paymentTerm: string;
  prepaymentRatio: string;
  prepaymentRequiredAmount: string;
  paidPrepaymentAmount: string;
  prepaymentRequiredBeforeProduction: boolean;
  initialSupplierDeliveryDate: string | null;
  confirmedSupplierDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  actualDeliveryRecordedAt: string | null;
  deliveryQuantityToleranceRatio: string;
  penaltyBaseAmount: string | null;
  delayGraceDays: number;
  delayPenaltyRatePerDay: string;
  delayPenaltyCapRatio: string | null;
  productionStatus: string;
  productionStartedAt: string | null;
  productionCompletedAt: string | null;
  productionCompletionSource: string;
  productionCompletionChannel: string;
  productionCompletionContact: string;
  productionCompletionRecordedAt: string | null;
  productionCompletionRemark: string;
  productionProgress: ProductionProgressDto;
  deliveryQuantityVariances: SupplierDeliveryQuantityVarianceDto[];
  loadingResults: SupplierFactoryPurchaseLoadingResultDto[];
  containerLoads: ReturnType<typeof serializeSupplierContainerLoad>[];
  deliveryFrozen: boolean;
  purchaseRemark: string;
  status: SupplierPurchaseOrderStatus;
  supplierDeliveryDate: string | null;
  supplierResponseRemark: string;
  supplierResponseSequence: number;
  respondedAt: string | null;
  responseHistory: Array<{
    id: string;
    sequence: number;
    action: string;
    deliveryDate: string | null;
    remark: string;
    source: string;
    channel: string;
    supplierContact: string;
    supplierRespondedAt: string | null;
    recordedAt: string | null;
    respondedAt: string | null;
    internalDecision: string;
    internalDecidedAt: string | null;
  }>;
  items: Array<{
    id: string;
    productDescription: string;
    unit: string;
    quantity: string;
    actualDeliveredQuantity: string | null;
    unitPrice: string | null;
    amount: string | null;
    priceRequired: boolean;
    supplierFilledPrice: boolean;
    remark: string;
  }>;
};

function isoDate(value: DateValue) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The supplier DTO is intentionally rebuilt field by field. Database rows may
 * gain internal sales or costing fields later; none can cross this boundary by
 * object spreading or relation serialization.
 */
export function serializeSupplierPurchaseOrder(row: SupplierPurchaseOrderPublicRow): SupplierPurchaseOrderDto {
  const deliveryQuantityVariances = row.deliveryQuantityVariances || [];
  const productionProgressReports = (row.productionProgressReports || []).map((report) => ({
    ...report,
    reportedBy: report.source === "SUPPLIER_PORTAL" ? report.reportedBy : undefined,
  }));
  const prepaymentRatio = row.prepaymentRatio == null ? new Prisma.Decimal(0) : new Prisma.Decimal(row.prepaymentRatio.toString());
  const penaltyBaseAmount = row.penaltyBaseAmount == null ? null : new Prisma.Decimal(row.penaltyBaseAmount.toString());
  const paidPrepaymentAmount = (row.payments || []).reduce(
    (sum, payment) => sum.add(payment.amount == null ? 0 : payment.amount.toString()),
    new Prisma.Decimal(0),
  ).toDecimalPlaces(2);
  const latestResponse = row.supplierResponses.at(-1);
  const productionProgress = serializeProductionProgress(
    productionProgressReports,
    row.items.map((item) => ({ id: item.id, allocatedQuantity: item.allocatedQuantity })),
    deliveryQuantityVariances.find((variance) => variance.status === "APPROVED"),
  );
  return {
    id: row.id,
    revision: row.revision,
    poNo: row.poNo,
    customerOrderNo: row.execution.customerOrderNo,
    dispatchedAt: isoDate(row.dispatchedAt),
    purchaseCurrency: row.purchaseCurrency,
    requestedDeliveryDate: isoDate(row.requestedDeliveryDate),
    paymentTerm: row.paymentTerm || "",
    prepaymentRatio: prepaymentRatio.toString(),
    prepaymentRequiredAmount: (penaltyBaseAmount ? penaltyBaseAmount.mul(prepaymentRatio) : new Prisma.Decimal(0)).toDecimalPlaces(2).toString(),
    paidPrepaymentAmount: paidPrepaymentAmount.toString(),
    prepaymentRequiredBeforeProduction: Boolean(row.prepaymentRequiredBeforeProduction),
    initialSupplierDeliveryDate: isoDate(row.initialSupplierDeliveryDate),
    confirmedSupplierDeliveryDate: isoDate(row.confirmedSupplierDeliveryDate),
    actualDeliveryDate: isoDate(row.actualDeliveryDate),
    actualDeliveryRecordedAt: isoDate(row.actualDeliveryRecordedAt),
    deliveryQuantityToleranceRatio: row.deliveryQuantityToleranceRatio?.toString() || "0.05",
    penaltyBaseAmount: penaltyBaseAmount?.toString() || null,
    delayGraceDays: Number(row.delayGraceDays ?? 10),
    delayPenaltyRatePerDay: row.delayPenaltyRatePerDay == null ? "0" : row.delayPenaltyRatePerDay.toString(),
    delayPenaltyCapRatio: row.delayPenaltyCapRatio == null ? null : row.delayPenaltyCapRatio.toString(),
    productionStatus: row.productionStatus || "WAITING_SUPPLIER",
    productionStartedAt: isoDate(row.productionStartedAt),
    productionCompletedAt: isoDate(row.productionCompletedAt),
    productionCompletionSource: row.productionCompletionSource || "",
    productionCompletionChannel: row.productionCompletionChannel || "",
    productionCompletionContact: row.productionCompletionContact || "",
    productionCompletionRecordedAt: isoDate(row.productionCompletionRecordedAt),
    productionCompletionRemark: row.productionCompletionRemark || "",
    productionProgress,
    deliveryQuantityVariances: serializeSupplierDeliveryQuantityVariances(
      deliveryQuantityVariances,
    ),
    loadingResults: (row.loadingResults || []).map(
      serializeSupplierFactoryPurchaseLoadingResult,
    ),
    containerLoads: (row.containerLoads || []).map(serializeSupplierContainerLoad),
    deliveryFrozen: Boolean(row.execution.shippingStartedAt || row.productionStatus === "COMPLETED" || row.actualDeliveryDate),
    purchaseRemark: row.remark || "",
    status: row.status,
    supplierDeliveryDate: isoDate(row.supplierDeliveryDate),
    supplierResponseRemark: row.supplierResponseRemark || "",
    supplierResponseSequence: row.supplierResponseSequence,
    respondedAt: isoDate(latestResponse?.supplierRespondedAt || row.respondedAt),
    responseHistory: row.supplierResponses.map((response) => ({
      id: response.id,
      sequence: response.responseSequence,
      action: response.action,
      deliveryDate: isoDate(response.deliveryDate),
      remark: response.remark || "",
      source: response.source || "SUPPLIER_PORTAL",
      channel: response.channel || "PORTAL",
      supplierContact: response.supplierContact || "",
      supplierRespondedAt: isoDate(response.supplierRespondedAt),
      recordedAt: isoDate(response.respondedAt),
      respondedAt: isoDate(response.supplierRespondedAt || response.respondedAt),
      internalDecision: response.internalDecision || "",
      internalDecidedAt: isoDate(response.internalDecidedAt),
    })),
    items: row.items.map((item) => {
      const originalUnitPrice = item.purchaseUnitPrice == null ? null : item.purchaseUnitPrice.toString();
      const confirmedUnitPrice = item.supplierPrice?.unitPrice == null ? null : item.supplierPrice.unitPrice.toString();
      const originalAmount = item.amount == null ? null : item.amount.toString();
      const confirmedAmount = item.supplierPrice?.amount == null ? null : item.supplierPrice.amount.toString();
      return {
        id: item.id,
        productDescription: productVisibleDescription(
          item.productNameSnapshot,
          item.specificationSnapshot,
        ),
        unit: item.unitSnapshot,
        quantity: item.allocatedQuantity.toString(),
        actualDeliveredQuantity: item.actualDeliveredQuantity?.toString() || null,
        unitPrice: confirmedUnitPrice ?? originalUnitPrice,
        amount: confirmedAmount ?? originalAmount,
        priceRequired: confirmedUnitPrice === null && originalUnitPrice === null,
        supplierFilledPrice: confirmedUnitPrice !== null,
        remark: item.remark || "",
      };
    }),
  };
}

export {
  normalizeSupplierPurchaseOrderPrices,
  normalizeSupplierPurchaseOrderResponse,
} from "./supplier-purchase-order-inputs";
export type {
  NormalizedSupplierPurchaseOrderPrice,
  NormalizedSupplierPurchaseOrderResponse,
  SupplierPurchaseOrderPriceTarget,
} from "./supplier-purchase-order-inputs";
