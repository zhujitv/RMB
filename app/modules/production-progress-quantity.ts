export const PRODUCTION_QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

export function productionQuantityUnits(value: unknown) {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  if (!PRODUCTION_QUANTITY_PATTERN.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * BigInt(10_000) + BigInt(fraction.padEnd(4, "0"));
}

export function productionQuantityMaximum(target: string, previous: string) {
  const targetUnits = productionQuantityUnits(target) || BigInt(0);
  const previousUnits = productionQuantityUnits(previous) || BigInt(0);
  return previousUnits > targetUnits ? previous : target;
}
