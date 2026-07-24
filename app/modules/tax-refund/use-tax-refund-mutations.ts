import { createTaxRefundArchiveActions } from "./tax-refund-archive-actions";
import { createTaxRefundDocumentActions } from "./tax-refund-document-actions";
import type { TaxRefundMutationsContext } from "./tax-refund-mutations-context";

export function useTaxRefundMutations(context: TaxRefundMutationsContext) {
  const archiveActions = createTaxRefundArchiveActions(context);
  const documentActions = createTaxRefundDocumentActions(context);

  function refreshRows() {
    context.setNotice("");
    void context.loadRows(context.page);
  }

  async function handleCustomsSaved(orderId: string, order?: Parameters<typeof context.patchDetailForOrder>[1] | null) {
    if (order) context.patchDetailForOrder(orderId, order);
    context.setNotice("报关单信息已保存");
  }

  function openDomesticLogisticsFromDetail() {
    const keywordValue = (
      context.detail?.orderNo || context.detailRow?.orderNo || context.detailRow?.id || ""
    ).trim();
    if (keywordValue) context.onOpenDomesticLogistics?.(keywordValue);
  }

  return {
    ...archiveActions,
    ...documentActions,
    refreshRows,
    handleCustomsSaved,
    openDomesticLogisticsFromDetail,
  };
}
