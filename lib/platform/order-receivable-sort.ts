type ReceivableSortSummary = {
  balanceCny?: unknown;
  outstandingCny?: unknown;
  overpaidCny?: unknown;
  receivableCny?: unknown;
  confirmedPaymentsCny?: unknown;
  arrivedPaymentsCny?: unknown;
};

export type ReceivableSortRow = {
  finalReceivableAmountCny?: unknown;
  receivableAmountCny?: unknown;
  receivedAmountCny?: unknown;
  actualShipmentDate?: Date | string | null;
  blDate?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  summary?: ReceivableSortSummary | null;
};

function numeric(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function timestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function receivableUnpaidAmount(row: ReceivableSortRow) {
  const summary = row.summary || {};
  const balanceCny = numeric(summary.balanceCny, Number.NaN);
  if (Number.isFinite(balanceCny)) return balanceCny;

  const outstandingCny = numeric(summary.outstandingCny);
  const overpaidCny = numeric(summary.overpaidCny);
  if (outstandingCny > 0) return outstandingCny;
  if (overpaidCny > 0) return -overpaidCny;

  const receivableCny = numeric(
    summary.receivableCny,
    numeric(row.finalReceivableAmountCny, numeric(row.receivableAmountCny)),
  );
  const receivedCny = numeric(
    summary.arrivedPaymentsCny,
    numeric(summary.confirmedPaymentsCny, numeric(row.receivedAmountCny)),
  );
  return receivableCny - receivedCny;
}

function shipmentTimestamp(row: ReceivableSortRow) {
  return timestamp(row.actualShipmentDate)
    || timestamp(row.blDate);
}

export function sortReceivableRowsByShipmentDate<T extends ReceivableSortRow>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aShipmentTime = shipmentTimestamp(a);
    const bShipmentTime = shipmentTimestamp(b);
    if (aShipmentTime || bShipmentTime) {
      return bShipmentTime - aShipmentTime
        || timestamp(b.createdAt) - timestamp(a.createdAt)
        || timestamp(b.updatedAt) - timestamp(a.updatedAt);
    }
    return timestamp(b.createdAt) - timestamp(a.createdAt)
      || timestamp(b.updatedAt) - timestamp(a.updatedAt);
  });
}

export function sortReceivableRowsByPaymentPriority<T extends ReceivableSortRow>(rows: T[]) {
  return sortReceivableRowsByShipmentDate(rows).sort((a, b) => {
    const aShipmentTime = shipmentTimestamp(a);
    const bShipmentTime = shipmentTimestamp(b);
    if (aShipmentTime || bShipmentTime) {
      return bShipmentTime - aShipmentTime
        || timestamp(b.createdAt) - timestamp(a.createdAt)
        || timestamp(b.updatedAt) - timestamp(a.updatedAt);
    }
    const aUnpaid = receivableUnpaidAmount(a);
    const bUnpaid = receivableUnpaidAmount(b);
    return bUnpaid - aUnpaid
      || timestamp(b.createdAt) - timestamp(a.createdAt)
      || timestamp(b.updatedAt) - timestamp(a.updatedAt);
  });
}
