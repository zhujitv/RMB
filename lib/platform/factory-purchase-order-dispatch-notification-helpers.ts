export const ACTIVE_PURCHASE_ORDER_STATUSES = [
  "DISPATCHED",
  "ACCEPTED",
  "DELIVERY_PROPOSED",
] as const;

export function factoryDispatchContextRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function factoryDispatchVariables(value: unknown) {
  const context = factoryDispatchContextRecord(value);
  return context.variables && typeof context.variables === "object" && !Array.isArray(context.variables)
    ? context.variables as Record<string, unknown>
    : {};
}
