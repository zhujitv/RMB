import { Prisma } from "../generated/prisma/client.js";
import { productVisibleDescription } from "./quotation-calculations";

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
  penaltyBaseAmount: DecimalValue;
  delayGraceDays: number;
  delayPenaltyRatePerDay: DecimalValue;
  delayPenaltyCapRatio: DecimalValue;
  productionStatus: string;
  productionStartedAt: DateValue;
  productionCompletedAt: DateValue;
  remark: string | null;
  status: SupplierPurchaseOrderStatus;
  supplierDeliveryDate: DateValue;
  supplierResponseRemark: string | null;
  supplierResponseSequence: number;
  respondedAt: DateValue;
  supplierResponses: Array<{
    responseSequence: number;
    action: string;
    deliveryDate: DateValue;
    remark: string | null;
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
  penaltyBaseAmount: string | null;
  delayGraceDays: number;
  delayPenaltyRatePerDay: string;
  delayPenaltyCapRatio: string | null;
  productionStatus: string;
  productionStartedAt: string | null;
  productionCompletedAt: string | null;
  deliveryFrozen: boolean;
  purchaseRemark: string;
  status: SupplierPurchaseOrderStatus;
  supplierDeliveryDate: string | null;
  supplierResponseRemark: string;
  supplierResponseSequence: number;
  respondedAt: string | null;
  responseHistory: Array<{
    sequence: number;
    action: string;
    deliveryDate: string | null;
    remark: string;
    respondedAt: string | null;
    internalDecision: string;
    internalDecidedAt: string | null;
  }>;
  items: Array<{
    id: string;
    productDescription: string;
    unit: string;
    quantity: string;
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
  const prepaymentRatio = row.prepaymentRatio == null ? new Prisma.Decimal(0) : new Prisma.Decimal(row.prepaymentRatio.toString());
  const penaltyBaseAmount = row.penaltyBaseAmount == null ? null : new Prisma.Decimal(row.penaltyBaseAmount.toString());
  const paidPrepaymentAmount = (row.payments || []).reduce(
    (sum, payment) => sum.add(payment.amount == null ? 0 : payment.amount.toString()),
    new Prisma.Decimal(0),
  ).toDecimalPlaces(2);
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
    penaltyBaseAmount: penaltyBaseAmount?.toString() || null,
    delayGraceDays: Number(row.delayGraceDays ?? 10),
    delayPenaltyRatePerDay: row.delayPenaltyRatePerDay == null ? "0" : row.delayPenaltyRatePerDay.toString(),
    delayPenaltyCapRatio: row.delayPenaltyCapRatio == null ? null : row.delayPenaltyCapRatio.toString(),
    productionStatus: row.productionStatus || "WAITING_SUPPLIER",
    productionStartedAt: isoDate(row.productionStartedAt),
    productionCompletedAt: isoDate(row.productionCompletedAt),
    deliveryFrozen: Boolean(row.execution.shippingStartedAt || row.productionStatus === "COMPLETED" || row.actualDeliveryDate),
    purchaseRemark: row.remark || "",
    status: row.status,
    supplierDeliveryDate: isoDate(row.supplierDeliveryDate),
    supplierResponseRemark: row.supplierResponseRemark || "",
    supplierResponseSequence: row.supplierResponseSequence,
    respondedAt: isoDate(row.respondedAt),
    responseHistory: row.supplierResponses.map((response) => ({
      sequence: response.responseSequence,
      action: response.action,
      deliveryDate: isoDate(response.deliveryDate),
      remark: response.remark || "",
      respondedAt: isoDate(response.respondedAt),
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
