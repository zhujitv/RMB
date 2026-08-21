type BusinessOrderCollectionState = {
  status?: string | null;
  summary?: {
    arrivedPaymentsCny?: unknown;
    arrivedOutstandingCny?: unknown;
    outstandingCny?: unknown;
  } | null;
};

const SETTLED_COLLECTION_STATUSES = new Set(["已收齐", "多收款"]);

export function businessOrderNeedsPaymentRegistration(order: BusinessOrderCollectionState) {
  const arrivedPayments = Number(order.summary?.arrivedPaymentsCny);
  if (Number.isFinite(arrivedPayments) && arrivedPayments > 0) return false;
  if (SETTLED_COLLECTION_STATUSES.has(String(order.status || "").trim())) return false;

  const outstanding = order.summary?.arrivedOutstandingCny ?? order.summary?.outstandingCny;
  if (outstanding !== null && outstanding !== undefined && outstanding !== "") {
    const numericOutstanding = Number(outstanding);
    if (Number.isFinite(numericOutstanding)) return numericOutstanding > 0;
  }
  return true;
}
