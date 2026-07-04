import type { TaxRefundDetailTab } from "./model";

export function emptyTaxRefundSectionState(value = false): Record<TaxRefundDetailTab, boolean> {
  return {
    basic: value,
    "export-documents": value,
    "customs-documents": value,
    "factory-documents": value,
    "logistics-documents": value,
  };
}
