import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api";
import { useConfirmationDialog } from "../../components";
import { useTaxRefundMutations } from "./use-tax-refund-mutations";
import styles from "../../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../../types";
import { canWritePermission, PDF_UPLOAD_MAX_SIZE_LABEL } from "../../utils";
import { emptyTaxRefundSectionState } from "./detail-section-state";
import {
  normalizedMissingLabels,
  taxMissingTargets,
  taxRefundHasPackageContent,
  taxRefundRowPatchFromDetail,
  taxRowStatus,
  taxTargetKeyFromMissingLabel,
  taxTargetDomId,
  uploadScopeKey,
  upsertTaxDocument,
  zipFileNameFromResponse,
} from "./helpers";
import {
  PAGE_SIZE,
  type BusinessEntityOption,
  type TaxDocument,
  type TaxRefundDetail,
  type TaxRefundDetailResponse,
  type TaxRefundDetailTab,
  type TaxRefundMode,
  type TaxRefundResponse,
  type TaxRefundRow,
  type UploadDocumentResponse,
  type UploadScope,
} from "./model";

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

  const [mode, setMode] = useState<TaxRefundMode>("current");
  const [rows, setRows] = useState<TaxRefundRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [declarationStartMonth, setDeclarationStartMonth] = useState("");
  const [declarationEndMonth, setDeclarationEndMonth] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [businessEntityId, setBusinessEntityId] = useState("");
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detailRow, setDetailRow] = useState<TaxRefundRow | null>(null);
  const [detail, setDetail] = useState<TaxRefundDetail | null>(null);
  const [pendingDetailTarget, setPendingDetailTarget] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailActiveTab, setDetailActiveTab] = useState<TaxRefundDetailTab>("basic");
  const [detailLoadedSections, setDetailLoadedSections] = useState<Record<TaxRefundDetailTab, boolean>>(() => emptyTaxRefundSectionState());
  const [detailSectionLoading, setDetailSectionLoading] = useState<Record<TaxRefundDetailTab, boolean>>(() => emptyTaxRefundSectionState());
  const [detailError, setDetailError] = useState("");
  const [packageDownloadingId, setPackageDownloadingId] = useState("");
  const [submittingTaxId, setSubmittingTaxId] = useState("");
  const [cancelingArchiveId, setCancelingArchiveId] = useState("");
  const [refreshingCompletenessId, setRefreshingCompletenessId] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailRequestTokenRef = useRef(0);

  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "业务员", "财务"]);
  const canManageTaxRefund = canWritePermission(currentUser, permissions, "taxRefund", ["管理员", "财务"]);
  const canCancelArchive = currentUser.role === "管理员";

  async function loadRows(
    nextPage = page,
    nextKeyword = submittedKeyword,
    nextMode = mode,
    nextStartMonth = declarationStartMonth,
    nextEndMonth = declarationEndMonth,
    nextStatus = statusFilter,
    nextBusinessEntityId = businessEntityId,
  ) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        mode: nextMode,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStartMonth) params.set("declarationStartMonth", nextStartMonth);
      if (nextEndMonth) params.set("declarationEndMonth", nextEndMonth);
      if (nextStatus) params.set("status", nextStatus);
      if (nextBusinessEntityId) params.set("businessEntityId", nextBusinessEntityId);
      const result = await apiJson<TaxRefundResponse>(`/api/tax-refund/list?${params}`);
      const nextRows = Array.isArray(result.orders) ? result.orders : [];
      const pagination = result.pagination || {};
      setRows(nextRows);
      setTotal(Number(pagination.total || nextRows.length || 0));
      setPage(Number(pagination.page || nextPage));
      setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
      if (result.error) setError(result.error || "读取资料失败");
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取退税资料失败");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows(1, "");
    void loadBusinessEntities();
  }, []);

  async function loadBusinessEntities() {
    try {
      const result = await apiJson<{ entities?: BusinessEntityOption[] }>("/api/business-entities");
      setBusinessEntities(Array.isArray(result.entities) ? result.entities : []);
    } catch {
      setBusinessEntities([]);
    }
  }

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setNotice("");
    void (async () => {
      const nextStatus = initialAction === "submitTaxArchive" ? "READY" : statusFilter;
      if (initialAction === "submitTaxArchive") setStatusFilter("READY");
      const nextRows = await loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, nextStatus, businessEntityId);
      if (initialAction !== "submitTaxArchive") return;
      const matched = nextRows.find((row) => row.orderNo === value) || nextRows[0];
      if (matched) await loadDetail(matched);
    })();
  }, [initialAction, initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setDetailRow(null);
      setDetailOrderId("");
      setDetail(null);
      setNotice("");
      void loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId]);

  useEffect(() => {
    if (!detail || !pendingDetailTarget || detailLoading) return;
    const targetId = taxTargetDomId(pendingDetailTarget);
    const timer = window.setTimeout(() => {
      const target = document.getElementById(targetId);
      if (!target) {
        setPendingDetailTarget("");
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add(styles.taxTargetHighlight);
      window.setTimeout(() => target.classList.remove(styles.taxTargetHighlight), 1500);
      setPendingDetailTarget("");
    }, 120);
    return () => window.clearTimeout(timer);
  }, [detail, detailLoading, pendingDetailTarget]);

  function switchMode(nextMode: TaxRefundMode) {
    setMode(nextMode);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setKeyword("");
    setSubmittedKeyword("");
    setDeclarationStartMonth("");
    setDeclarationEndMonth("");
    setStatusFilter("");
    setBusinessEntityId("");
    setNotice("");
    void loadRows(1, "", nextMode, "", "", "", "");
  }

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setDeclarationStartMonth("");
    setDeclarationEndMonth("");
    setStatusFilter("");
    setBusinessEntityId("");
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, "", mode, "", "", "", "");
  }

  function gotoPage(nextPage: number) {
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(nextPage, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId);
  }

  function resetDetailSectionState() {
    setDetailLoadedSections(emptyTaxRefundSectionState());
    setDetailSectionLoading(emptyTaxRefundSectionState());
  }

  function detailSectionPath(tab: TaxRefundDetailTab) {
    return tab;
  }

  async function fetchDetailSection(orderId: string, section: TaxRefundDetailTab, options: { replace?: boolean } = {}) {
    const requestToken = detailRequestTokenRef.current;
    setDetailError("");
    setDetailSectionLoading((current) => ({ ...current, [section]: true }));
    if (section === "basic") setDetailLoading(true);
    try {
      const result = await apiJson<TaxRefundDetailResponse>(`/api/tax-refund/${encodeURIComponent(orderId)}/${detailSectionPath(section)}`);
      if (detailRequestTokenRef.current === requestToken) {
        const nextDetail = result.order || null;
        if (nextDetail) {
          if (options.replace) {
            setDetail(nextDetail);
          } else {
            patchDetailForOrder(orderId, nextDetail);
          }
          patchRowsForOrder(orderId, nextDetail);
          setDetailLoadedSections((current) => ({ ...current, [section]: true }));
        }
      }
    } catch (loadError) {
      if (detailRequestTokenRef.current === requestToken) {
        setDetailError(loadError instanceof Error ? loadError.message : "读取退税资料详情失败");
      }
    } finally {
      if (detailRequestTokenRef.current === requestToken) {
        setDetailSectionLoading((current) => ({ ...current, [section]: false }));
        if (section === "basic") setDetailLoading(false);
      }
    }
  }

  async function fetchDetail(orderId: string) {
    await fetchDetailSection(orderId, "basic");
    if (detailActiveTab !== "basic") await fetchDetailSection(orderId, detailActiveTab);
  }

  async function loadDetail(row: TaxRefundRow) {
    detailRequestTokenRef.current += 1;
    setDetailRow(row);
    setDetailOrderId(row.id);
    setDetail({ ...row });
    setDetailActiveTab("basic");
    resetDetailSectionState();
    await fetchDetailSection(row.id, "basic");
  }

  function selectDetailTab(tab: TaxRefundDetailTab) {
    setDetailActiveTab(tab);
    const orderId = detailOrderId || detailRow?.id || "";
    if (!orderId || detailLoadedSections[tab] || detailSectionLoading[tab]) return;
    void fetchDetailSection(orderId, tab);
  }

  function patchRowsForOrder(orderId: string, patch: Partial<TaxRefundDetail>) {
    const rowPatch = taxRefundRowPatchFromDetail(patch);
    if (!Object.keys(rowPatch).length) return;
    setRows((current) => current.map((row) => (row.id === orderId ? { ...row, ...rowPatch } : row)));
    setDetailRow((current) => (current?.id === orderId ? { ...current, ...rowPatch } : current));
  }

  function patchDetailForOrder(orderId: string, patch: Partial<TaxRefundDetail>) {
    setDetail((current) => {
      if (!current || current.id !== orderId) return current;
      const mergeById = <T extends { id?: string }>(existing: T[] = [], incoming: T[] = []) => {
        if (!incoming.length) return existing;
        const next = new Map(existing.map((item) => [item.id || Math.random().toString(36), item]));
        incoming.forEach((item) => {
          const key = item.id || Math.random().toString(36);
          const existing = next.get(key) || ({} as T);
          next.set(key, { ...existing, ...item });
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

  function patchUploadedDocument(orderId: string, document: TaxDocument) {
    if (!document.id) return;
    setDetail((current) => {
      if (!current || current.id !== orderId) return current;
      return {
        ...current,
        documents: upsertTaxDocument(current.documents || [], document),
      };
    });
  }

  async function openMissingTarget(row: TaxRefundRow, targetKey: string) {
    setPendingDetailTarget(targetKey || "tax-detail-top");
    await loadDetail(row);
  }

  function closeDetailDrawer() {
    detailRequestTokenRef.current += 1;
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
    setDetailActiveTab("basic");
    resetDetailSectionState();
    setPendingDetailTarget("");
  }






















  const {
    downloadPackage,
    submitTaxRefund,
    updateTaxRefundStatus,
    refreshCompleteness,
    cancelTaxRefundArchive,
    uploadDocument,
    deleteDocument,
    refreshRows,
    handleCustomsSaved,
    openDomesticLogisticsFromDetail,
  } = useTaxRefundMutations({
    currentUser,
    detail,
    detailOrderId,
    detailRow,
    mode,
    page,
    submittedKeyword,
    requestConfirmation,
    onOpenDomesticLogistics,
    setCancelingArchiveId,
    setDeletingDocumentId,
    setDetail,
    setDetailError,
    setDetailOrderId,
    setDetailRow,
    setError,
    setNotice,
    setPackageDownloadingId,
    setRefreshingCompletenessId,
    setSubmittingTaxId,
    setUploadProgressByKey,
    setUploadingKey,
    loadRows,
    fetchDetail,
    openMissingTarget,
    patchDetailForOrder,
    patchRowsForOrder,
    patchUploadedDocument,
  });

  return {
    mode,
    rows,
    total,
    page,
    totalPages,
    loading,
    error,
    notice,
    keyword,
    declarationStartMonth,
    declarationEndMonth,
    statusFilter,
    businessEntityId,
    businessEntities,
    canManageTaxRefund,
    canCancelArchive,
    canWriteDocuments,
    submittingTaxId,
    detailRow,
    detail,
    detailOrderId,
    detailLoading,
    detailActiveTab,
    detailLoadedSections,
    detailSectionLoading,
    detailError,
    packageDownloadingId,
    cancelingArchiveId,
    refreshingCompletenessId,
    uploadingKey,
    uploadProgressByKey,
    deletingDocumentId,
    confirmation,
    readOnly: mode === "archive" || Boolean(detailRow?.taxArchived),
    refreshRows,
    switchMode,
    setKeyword,
    setDeclarationStartMonth,
    setDeclarationEndMonth,
    setStatusFilter,
    setBusinessEntityId,
    submitSearch,
    resetSearch,
    gotoPage,
    loadDetail,
    selectDetailTab,
    submitTaxRefund,
    cancelTaxRefundArchive,
    refreshCompleteness,
    updateTaxRefundStatus,
    closeDetailDrawer,
    downloadPackage,
    handleCustomsSaved,
    uploadDocument,
    deleteDocument,
    openDomesticLogisticsFromDetail,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
    currentUserRole: currentUser.role,
  };
}
