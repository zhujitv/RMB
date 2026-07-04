import { apiJson } from "../../api";
import { emptyTaxRefundSectionState } from "./detail-section-state";
import {
  taxRefundRowPatchFromDetail,
  upsertTaxDocument,
} from "./helpers";
import {
  type TaxDocument,
  type TaxRefundDetail,
  type TaxRefundDetailResponse,
  type TaxRefundDetailTab,
  type TaxRefundRow,
} from "./model";
import type { useTaxRefundState } from "./use-tax-refund-state";

type TaxRefundState = ReturnType<typeof useTaxRefundState>;

export function createTaxRefundDetailActions(state: TaxRefundState) {
  function clearDetail() {
    state.setDetailRow(null);
    state.setDetailOrderId("");
    state.setDetail(null);
  }

  function resetDetailSectionState() {
    state.setDetailLoadedSections(emptyTaxRefundSectionState());
    state.setDetailSectionLoading(emptyTaxRefundSectionState());
  }

  function detailSectionPath(tab: TaxRefundDetailTab) {
    return tab;
  }

  function patchRowsForOrder(orderId: string, patch: Partial<TaxRefundDetail>) {
    const rowPatch = taxRefundRowPatchFromDetail(patch);
    if (!Object.keys(rowPatch).length) return;
    state.setRows((current) => current.map((row) => (row.id === orderId ? { ...row, ...rowPatch } : row)));
    state.setDetailRow((current) => (current?.id === orderId ? { ...current, ...rowPatch } : current));
  }

  function patchDetailForOrder(orderId: string, patch: Partial<TaxRefundDetail>) {
    state.setDetail((current) => {
      if (!current || current.id !== orderId) return current;
      const mergeById = <T extends { id?: string }>(existing: T[] = [], incoming: T[] = []) => {
        if (!incoming.length) return existing;
        const next = new Map(existing.map((item) => [item.id || Math.random().toString(36), item]));
        incoming.forEach((item) => {
          const key = item.id || Math.random().toString(36);
          next.set(key, { ...(next.get(key) || ({} as T)), ...item });
        });
        return [...next.values()];
      };
      return {
        ...current,
        ...patch,
        documents: patch.documents ? mergeById(current.documents || [], patch.documents) : current.documents,
        costs: patch.costs ? mergeById(current.costs || [], patch.costs) : current.costs,
      };
    });
    patchRowsForOrder(orderId, patch);
  }

  async function fetchDetailSection(orderId: string, section: TaxRefundDetailTab, options: { replace?: boolean } = {}) {
    const requestToken = state.detailRequestTokenRef.current;
    state.setDetailError("");
    state.setDetailSectionLoading((current) => ({ ...current, [section]: true }));
    if (section === "basic") state.setDetailLoading(true);
    try {
      const result = await apiJson<TaxRefundDetailResponse>(`/api/tax-refund/${encodeURIComponent(orderId)}/${detailSectionPath(section)}`);
      if (state.detailRequestTokenRef.current !== requestToken) return;
      const nextDetail = result.order || null;
      if (!nextDetail) return;
      options.replace ? state.setDetail(nextDetail) : patchDetailForOrder(orderId, nextDetail);
      patchRowsForOrder(orderId, nextDetail);
      state.setDetailLoadedSections((current) => ({ ...current, [section]: true }));
    } catch (loadError) {
      if (state.detailRequestTokenRef.current === requestToken) {
        state.setDetailError(loadError instanceof Error ? loadError.message : "读取退税资料详情失败");
      }
    } finally {
      if (state.detailRequestTokenRef.current === requestToken) {
        state.setDetailSectionLoading((current) => ({ ...current, [section]: false }));
        if (section === "basic") state.setDetailLoading(false);
      }
    }
  }

  async function fetchDetail(orderId: string) {
    await fetchDetailSection(orderId, "basic");
    if (state.detailActiveTab !== "basic") await fetchDetailSection(orderId, state.detailActiveTab);
  }

  async function loadDetail(row: TaxRefundRow) {
    state.detailRequestTokenRef.current += 1;
    state.setDetailRow(row);
    state.setDetailOrderId(row.id);
    state.setDetail({ ...row });
    state.setDetailActiveTab("basic");
    resetDetailSectionState();
    await fetchDetailSection(row.id, "basic");
  }

  function selectDetailTab(tab: TaxRefundDetailTab) {
    state.setDetailActiveTab(tab);
    const orderId = state.detailOrderId || state.detailRow?.id || "";
    if (!orderId || state.detailLoadedSections[tab] || state.detailSectionLoading[tab]) return;
    void fetchDetailSection(orderId, tab);
  }

  function patchUploadedDocument(orderId: string, document: TaxDocument) {
    if (!document.id) return;
    state.setDetail((current) => current && current.id === orderId ? { ...current, documents: upsertTaxDocument(current.documents || [], document) } : current);
  }

  async function openMissingTarget(row: TaxRefundRow, targetKey: string) {
    state.setPendingDetailTarget(targetKey || "tax-detail-top");
    await loadDetail(row);
  }

  function closeDetailDrawer() {
    state.detailRequestTokenRef.current += 1;
    state.setDetailRow(null);
    state.setDetailOrderId("");
    state.setDetail(null);
    state.setDetailError("");
    state.setDetailLoading(false);
    state.setDetailActiveTab("basic");
    resetDetailSectionState();
    state.setPendingDetailTarget("");
  }

  return {
    clearDetail,
    closeDetailDrawer,
    fetchDetail,
    loadDetail,
    openMissingTarget,
    patchDetailForOrder,
    patchRowsForOrder,
    patchUploadedDocument,
    selectDetailTab,
  };
}
