import { Prisma } from "../generated/prisma/client.js";
import { nonEmpty } from "./shared-base-utils";

export type CustomsQuantityChoice = { index?: number; quantity?: string; unit?: string };

export function customsUnitKey(value: unknown) {
  const key = String(value || "").toUpperCase().replace(/[\s（）()【】\[\]，,。._\-\/\\]/g, "");
  if (["KG", "KGS", "KILOGRAM", "KILOGRAMS"].includes(key)) return "千克";
  if (["M", "METER", "METERS", "METRE", "METRES"].includes(key)) return "米";
  if (["M2", "SQM", "SQUAREMETER", "SQUAREMETERS"].includes(key)) return "平方米";
  if (["SET", "SETS"].includes(key)) return "套";
  if (["PC", "PCS", "PIECE", "PIECES"].includes(key)) return "件";
  if (key === "枝") return "支";
  return key;
}

export function customsQuantityKey(value: unknown) {
  const text = String(value || "").replace(/[,，\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return "";
  try {
    return new Prisma.Decimal(text).toDecimalPlaces(4).toString();
  } catch {
    return "";
  }
}

export function customsQuantityRows(candidate: Record<string, unknown>) {
  return (Array.isArray(candidate.quantityUnits) ? candidate.quantityUnits as Array<Record<string, unknown>> : [])
    .map((row, index) => ({ index, quantity: nonEmpty(row.quantity), unit: nonEmpty(row.unit) }))
    .filter((row) => row.quantity && row.unit);
}

export function hasCustomsUnit(candidate: Record<string, unknown>, unit: unknown) {
  const unitKey = customsUnitKey(unit);
  return Boolean(unitKey) && customsQuantityRows(candidate).some((row) => customsUnitKey(row.unit) === unitKey);
}

export function customsQuantityForUnit(candidate: Record<string, unknown>, preferredUnit: string, preferredQuantity?: unknown) {
  const rows = customsQuantityRows(candidate);
  const unitKey = customsUnitKey(preferredUnit);
  const quantityKey = customsQuantityKey(preferredQuantity);
  const exact = rows.find((row) => customsUnitKey(row.unit) === unitKey && customsQuantityKey(row.quantity) === quantityKey);
  const sameUnit = rows.find((row) => customsUnitKey(row.unit) === unitKey);
  if (exact) return exact;
  if (sameUnit) return sameUnit;
  if (unitKey) return { index: -1, quantity: nonEmpty(preferredQuantity), unit: preferredUnit };
  const sameQuantity = quantityKey ? rows.find((row) => customsQuantityKey(row.quantity) === quantityKey) : null;
  if (sameQuantity) return sameQuantity;
  return rows[0] || {};
}
