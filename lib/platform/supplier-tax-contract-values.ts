import { Prisma } from "../generated/prisma/client.js";

export type SupplierTaxContractSupplierLike = {
  supplierName?: string | null;
  invoiceTitle?: string | null;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function quantityNumberText(value: unknown) {
  return cleanText(value).replace(/[,，\s]/g, "").replace(/．/g, ".");
}

export function supplierTaxContractQuantityNeedsTwoDecimals(...values: unknown[]) {
  return values.some((value) => {
    const fraction = quantityNumberText(value).match(/^\d+\.(\d+)$/)?.[1] || "";
    return /[1-9]/.test(fraction);
  });
}

export function supplierTaxContractQuantityText(value: unknown, ...decimalSignalValues: unknown[]) {
  const text = quantityNumberText(value);
  if (!text) return "";
  try {
    const quantity = new Prisma.Decimal(text);
    const needsTwoDecimals = supplierTaxContractQuantityNeedsTwoDecimals(...decimalSignalValues, value);
    if (needsTwoDecimals) return quantity.toFixed(2);
    const fixed = quantity.toFixed(4);
    return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  } catch {
    return cleanText(value);
  }
}

function normalizeDraftItems(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const row = item as Record<string, unknown>;
    return {
      ...row,
      quantity: supplierTaxContractQuantityText(row.quantity, row.declaredQuantity),
    };
  });
}

export function supplierTaxContractSupplierName(supplier: SupplierTaxContractSupplierLike) {
  return cleanText(supplier.supplierName) || cleanText(supplier.invoiceTitle);
}

export function dateText(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function validDate(value: Date | null | undefined) {
  return value && !Number.isNaN(value.getTime()) ? value : null;
}

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function oneMonthBeforeDate(value: Date) {
  let year = value.getUTCFullYear();
  let month = value.getUTCMonth() - 1;
  if (month < 0) {
    year -= 1;
    month = 11;
  }
  const day = Math.min(value.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

export function supplierTaxContractSigningDate(deliveryDate: Date | null | undefined, fallback = new Date()) {
  return dateText(oneMonthBeforeDate(validDate(deliveryDate) || fallback));
}

export function dateFromText(value: unknown) {
  const text = cleanText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return dateText(date) === text ? date : null;
}

export function normalizeSupplierTaxContractDraftValues<T extends Record<string, unknown>>(
  draft: T,
  options: { supplierName?: string | null } = {},
) {
  const supplierName = cleanText(options.supplierName) || cleanText(draft.supplierName);
  const latestDeliveryDate = dateFromText(draft.latestDeliveryDate);
  return {
    ...draft,
    ...(supplierName ? { supplierName } : {}),
    ...(latestDeliveryDate ? { signingDate: supplierTaxContractSigningDate(latestDeliveryDate) } : {}),
    ...(Array.isArray(draft.items) ? { items: normalizeDraftItems(draft.items) } : {}),
  };
}
