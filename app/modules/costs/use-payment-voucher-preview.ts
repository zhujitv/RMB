"use client";

import { hasPaymentVoucher } from "./helpers";
import type { CostRow } from "./model";

export function usePaymentVoucherPreview({
  fetchCostDetail,
  setVoucherPreviewCost,
  setError,
}: {
  fetchCostDetail: (costId: string) => Promise<CostRow>;
  setVoucherPreviewCost: (cost: CostRow | null) => void;
  setError: (message: string) => void;
}) {
  return async (cost: CostRow) => {
    if (!hasPaymentVoucher(cost)) return;
    setVoucherPreviewCost(cost);
    try {
      const freshCost = await fetchCostDetail(cost.id);
      if (!hasPaymentVoucher(freshCost)) {
        setVoucherPreviewCost(null);
        setError("该成本记录当前没有付款凭证。");
        return;
      }
      setVoucherPreviewCost(freshCost);
    } catch (error) {
      setError(error instanceof Error ? error.message : "读取最新付款凭证失败");
    }
  };
}
