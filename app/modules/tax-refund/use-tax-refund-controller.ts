import { useEffect } from "react";
import { apiJson } from "../../api";
import { useTaxRefundMutations } from "./use-tax-refund-mutations";
import styles from "../../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../../types";
import { canWritePermission } from "../../utils";
import { taxTargetDomId } from "./helpers";
import {
  type BusinessEntityOption,
  type TaxRefundMode,
  type TaxRefundResponse,
} from "./model";
import { createTaxRefundDetailActions } from "./use-tax-refund-detail-actions";
import { useTaxRefundState } from "./use-tax-refund-state";

export type TaxRefundModuleProps = {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialAction?: string;
  initialOpenToken?: number;
  onOpenDomesticLogistics?: (keyword: string) => void;
  onOpenSupplierDocuments?: (keyword: string) => void;
};

export function useTaxRefundController({
  currentUser,
  permissions,
  initialKeyword = "",
  initialAction = "",
  initialOpenToken = 0,
  onOpenDomesticLogistics,
}: TaxRefundModuleProps) {
  const state = useTaxRefundState();
  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "业务员", "财务"]);
  const canManageTaxRefund = canWritePermission(currentUser, permissions, "taxRefund", ["管理员", "财务"]);
  const canCancelArchive = currentUser.role === "管理员";
  const detailActions = createTaxRefundDetailActions(state);
  const {
    clearDetail,
    closeDetailDrawer,
    fetchDetail,
    loadDetail,
    openMissingTarget,
    patchDetailForOrder,
    patchRowsForOrder,
    patchUploadedDocument,
    selectDetailTab,
  } = detailActions;

  async function loadRows(
    nextPage = state.page,
    nextKeyword = state.submittedKeyword,
    nextMode = state.mode,
    nextStartMonth = state.declarationStartMonth,
    nextEndMonth = state.declarationEndMonth,
    nextStatus = state.statusFilter,
    nextBusinessEntityId = state.businessEntityId,
  ) {
    const setError = state.setError;
    state.setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode: nextMode, page: String(nextPage), pageSize: String(state.pageSize) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStartMonth) params.set("declarationStartMonth", nextStartMonth);
      if (nextEndMonth) params.set("declarationEndMonth", nextEndMonth);
      if (nextStatus) params.set("status", nextStatus);
      if (nextBusinessEntityId) params.set("businessEntityId", nextBusinessEntityId);
      const result = await apiJson<TaxRefundResponse>(`/api/tax-refund/list?${params}`);
      const nextRows = Array.isArray(result.orders) ? result.orders : [];
      const pagination = result.pagination || {};
      state.setRows(nextRows);
      state.setTotal(Number(pagination.total || nextRows.length || 0));
      state.setPage(Number(pagination.page || nextPage));
      state.setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
      if (result.error) setError(result.error || "读取资料失败");
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取退税资料失败");
      return [];
    } finally {
      state.setLoading(false);
    }
  }

  async function loadBusinessEntities() {
    try {
      const result = await apiJson<{ entities?: BusinessEntityOption[] }>("/api/business-entities");
      state.setBusinessEntities(Array.isArray(result.entities) ? result.entities : []);
    } catch {
      state.setBusinessEntities([]);
    }
  }

  useEffect(() => {
    void loadRows(1, "");
    void loadBusinessEntities();
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    const statusFilter = state.statusFilter;
    const setStatusFilter = state.setStatusFilter;
    state.setKeyword(value);
    state.setSubmittedKeyword(value);
    state.setNotice("");
    void (async () => {
      const nextStatus = initialAction === "submitTaxArchive" ? "READY" : statusFilter;
      if (initialAction === "submitTaxArchive") setStatusFilter("READY");
      const nextRows = await loadRows(1, value, state.mode, state.declarationStartMonth, state.declarationEndMonth, nextStatus, state.businessEntityId);
      if (initialAction !== "submitTaxArchive") return;
      const matched = nextRows.find((row) => row.orderNo === value) || nextRows[0];
      if (matched) await loadDetail(matched);
    })();
  }, [initialAction, initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = state.keyword.trim();
    if (value === state.submittedKeyword) return;
    const timer = window.setTimeout(() => {
      state.setSubmittedKeyword(value);
      clearDetail();
      state.setNotice("");
      void loadRows(1, value, state.mode, state.declarationStartMonth, state.declarationEndMonth, state.statusFilter, state.businessEntityId);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [state.keyword, state.submittedKeyword, state.mode, state.declarationStartMonth, state.declarationEndMonth, state.statusFilter, state.businessEntityId]);

  useEffect(() => {
    if (!state.detail || !state.pendingDetailTarget || state.detailLoading) return;
    const targetId = taxTargetDomId(state.pendingDetailTarget);
    const timer = window.setTimeout(() => {
      const target = document.getElementById(targetId);
      if (!target) {
        state.setPendingDetailTarget("");
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add(styles.taxTargetHighlight);
      window.setTimeout(() => target.classList.remove(styles.taxTargetHighlight), 1500);
      state.setPendingDetailTarget("");
    }, 120);
    return () => window.clearTimeout(timer);
  }, [state.detail, state.detailLoading, state.pendingDetailTarget]);

  function switchMode(nextMode: TaxRefundMode) {
    state.setMode(nextMode);
    clearDetail();
    state.setKeyword("");
    state.setSubmittedKeyword("");
    state.setDeclarationStartMonth("");
    state.setDeclarationEndMonth("");
    state.setStatusFilter("");
    state.setBusinessEntityId("");
    state.setNotice("");
    void loadRows(1, "", nextMode, "", "", "", "");
  }

  function submitSearch() {
    const value = state.keyword.trim();
    state.setSubmittedKeyword(value);
    clearDetail();
    state.setNotice("");
    void loadRows(1, value, state.mode, state.declarationStartMonth, state.declarationEndMonth, state.statusFilter, state.businessEntityId);
  }

  function resetSearch() {
    state.setKeyword("");
    state.setSubmittedKeyword("");
    state.setDeclarationStartMonth("");
    state.setDeclarationEndMonth("");
    state.setStatusFilter("");
    state.setBusinessEntityId("");
    clearDetail();
    state.setNotice("");
    void loadRows(1, "", state.mode, "", "", "", "");
  }

  function gotoPage(nextPage: number) {
    clearDetail();
    state.setNotice("");
    void loadRows(nextPage, state.submittedKeyword, state.mode, state.declarationStartMonth, state.declarationEndMonth, state.statusFilter, state.businessEntityId);
  }

  const mutations = useTaxRefundMutations({
    currentUser,
    detail: state.detail,
    detailOrderId: state.detailOrderId,
    detailRow: state.detailRow,
    mode: state.mode,
    page: state.page,
    submittedKeyword: state.submittedKeyword,
    requestConfirmation: state.requestConfirmation,
    onOpenDomesticLogistics,
    setCancelingArchiveId: state.setCancelingArchiveId,
    setDeletingDocumentId: state.setDeletingDocumentId,
    setDetail: state.setDetail,
    setDetailError: state.setDetailError,
    setDetailOrderId: state.setDetailOrderId,
    setDetailRow: state.setDetailRow,
    setError: state.setError,
    setNotice: state.setNotice,
    setPackageDownloadingId: state.setPackageDownloadingId,
    setRefreshingCompletenessId: state.setRefreshingCompletenessId,
    setSubmittingTaxId: state.setSubmittingTaxId,
    setUploadProgressByKey: state.setUploadProgressByKey,
    setUploadingKey: state.setUploadingKey,
    loadRows,
    fetchDetail,
    openMissingTarget,
    patchDetailForOrder,
    patchRowsForOrder,
    patchUploadedDocument,
  });

  return {
    ...state,
    canManageTaxRefund,
    canCancelArchive,
    canWriteDocuments,
    ...mutations,
    switchMode,
    submitSearch,
    resetSearch,
    gotoPage,
    loadDetail,
    selectDetailTab,
    closeDetailDrawer,
    currentUserRole: currentUser.role,
  };
}
