import { Prisma } from "../generated/prisma/client.js";
import { productVisibleDescription } from "./quotation-calculations";

type LooseRecord = Record<string, unknown>;

function record(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function decimalText(value: unknown, fallback = "0") {
  if (value === null || value === undefined || value === "") return fallback;
  return Prisma.Decimal.isDecimal(value) ? value.toString() : String(value);
}

function nullableDecimalText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return Prisma.Decimal.isDecimal(value) ? value.toString() : String(value);
}

export function serializePurchaseOrderItem(value: unknown, approvedCorrectionValue?: unknown) {
  const item = record(value);
  const approvedCorrection = record(approvedCorrectionValue);
  const supplierPrice = record(item.supplierPrice);
  const productNameSnapshot = String(item.productNameSnapshot || "");
  const specificationSnapshot = String(item.specificationSnapshot || "");
  const purchaseUnitPrice = nullableDecimalText(item.purchaseUnitPrice);
  const supplierConfirmedUnitPrice = nullableDecimalText(supplierPrice.unitPrice);
  const amount = nullableDecimalText(item.amount);
  const supplierConfirmedAmount = nullableDecimalText(supplierPrice.amount);
  const correctedUnitPrice = nullableDecimalText(approvedCorrection.newUnitPrice);
  const effectivePurchaseUnitPrice = correctedUnitPrice ?? supplierConfirmedUnitPrice ?? purchaseUnitPrice;
  let effectiveAmount = supplierConfirmedAmount ?? amount;
  if (correctedUnitPrice !== null) {
    try {
      effectiveAmount = new Prisma.Decimal(decimalText(item.allocatedQuantity))
        .mul(correctedUnitPrice)
        .toDecimalPlaces(2)
        .toString();
    } catch {
      effectiveAmount = nullableDecimalText(approvedCorrection.newAmount) ?? effectiveAmount;
    }
  }
  return {
    id: String(item.id || ""),
    executionItemId: String(item.executionItemId || ""),
    lineNumber: Number(item.lineNumber || 0),
    productDescription: productVisibleDescription(productNameSnapshot, specificationSnapshot),
    productNameSnapshot,
    specificationSnapshot,
    unitSnapshot: String(item.unitSnapshot || ""),
    allocatedQuantity: decimalText(item.allocatedQuantity),
    actualDeliveredQuantity: nullableDecimalText(item.actualDeliveredQuantity),
    purchaseUnitPrice,
    supplierConfirmedUnitPrice,
    effectivePurchaseUnitPrice,
    amount,
    supplierConfirmedAmount,
    effectiveAmount,
    supplierPriceConfirmedAt: supplierPrice.confirmedAt || null,
    remark: String(item.remark || ""),
  };
}

export function effectivePurchaseOrderSubtotal(items: Array<ReturnType<typeof serializePurchaseOrderItem>>) {
  if (!items.length || items.some((item) => item.effectiveAmount === null)) return null;
  try {
    return items
      .reduce((sum, item) => sum.add(item.effectiveAmount || 0), new Prisma.Decimal(0))
      .toDecimalPlaces(2)
      .toString();
  } catch {
    return null;
  }
}
