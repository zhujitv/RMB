import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api";
import {
  canApplySupplierDocumentListResponse,
  canStartSupplierDocumentListRequest,
  supplierDocumentListView,
  type SupplierDocumentListView,
} from "./supplier-document-list-request-policy";
import type {
  SupplierDocumentDetailResponse,
  SupplierDocumentTask,
  SupplierDocumentsResponse,
  SupplierDocumentsStatsResponse,
} from "./types";

type LoadRowsOptions = { silent?: boolean; expectedView?: SupplierDocumentListView };

function mergeTaskDetail(listRow: SupplierDocumentTask, detail: SupplierDocumentTask) {
  return {
    ...listRow,
    ...detail,
    purchaseOrderNo: detail.purchaseOrderNo || detail.orderNo || listRow.purchaseOrderNo || listRow.orderNo || "",
    detailLoaded: true,
    detailLoading: false,
    detailError: "",
  };
}

function mergeListRowWithCachedDetail(listRow: SupplierDocumentTask, cached?: SupplierDocumentTask) {
  if (!cached?.detailLoaded) return listRow;
  return {
    ...cached,
    ...listRow,
    orderNo: cached.orderNo,
    purchaseOrderNo: listRow.purchaseOrderNo || cached.purchaseOrderNo || cached.orderNo || "",
    documents: cached.documents,
    factoryCostSlots: cached.factoryCostSlots,
    requestedByName: cached.requestedByName,
    message: cached.message,
    templateFileName: cached.templateFileName,
    hasTemplate: cached.hasTemplate,
    sendStatus: cached.sendStatus,
    sendError: cached.sendError,
    sentAt: cached.sentAt,
    canDelete: cached.canDelete,
    hasTaxRefundDocuments: cached.hasTaxRefundDocuments,
    taxRefundDocumentCount: cached.taxRefundDocumentCount,
    detailLoaded: true,
    detailLoading: false,
    detailError: "",
  };
}

export function useSupplierDocumentsData() {
  const [rows, setRows] = useState<SupplierDocumentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingCount, setPendingCount] = useState(0);
  const [statsTotalCount, setStatsTotalCount] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const visibleRequestRef = useRef(0);
  const silentRequestRef = useRef(0);
  const viewRef = useRef<SupplierDocumentListView>(supplierDocumentListView(1, 10, ""));
  const statsRequestRef = useRef(0);
  const detailRequestRef = useRef<Record<string, number>>({});

  async function loadRows(nextPage = page, nextPageSize = pageSize, nextKeyword = "", options: LoadRowsOptions = {}) {
    const requestedView = supplierDocumentListView(nextPage, nextPageSize, nextKeyword);
    const expectedView = options.expectedView
      ? supplierDocumentListView(options.expectedView.page, options.expectedView.pageSize, options.expectedView.keyword)
      : null;
    if (!canStartSupplierDocumentListRequest({
      silent: Boolean(options.silent), currentView: viewRef.current, requestedView, expectedView,
    })) return [];
    const visibleRequestIdAtStart = visibleRequestRef.current;
    const requestId = options.silent ? ++silentRequestRef.current : ++visibleRequestRef.current;
    if (!options.silent) {
      viewRef.current = requestedView;
      setLoading(true);
      setError("");
      setLoadError("");
      setSubmittedKeyword(nextKeyword);
    }
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await apiJson<SupplierDocumentsResponse>(`/api/supplier-document-requests?${params}`);
      if (!canApplySupplierDocumentListResponse({
        silent: Boolean(options.silent), requestId,
        latestVisibleRequestId: visibleRequestRef.current,
        latestSilentRequestId: silentRequestRef.current,
        visibleRequestIdAtStart, currentView: viewRef.current, requestedView, expectedView,
      })) return [];
      if (options.silent) viewRef.current = requestedView;
      const nextRows = data.requests || [];
      setRows((current) => nextRows.map(
        (row) => mergeListRowWithCachedDetail(row, current.find((item) => item.id === row.id)),
      ));
      const pagination = data.pagination || {};
      setPage(Number(pagination.page || nextPage));
      setPageSize(Number(pagination.pageSize || nextPageSize));
      setTotal(Number(pagination.total || data.requests?.length || 0));
      setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
      return nextRows;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "读取资料回传任务失败";
      if (!options.silent && requestId === visibleRequestRef.current) {
        setError(message);
        setLoadError(message);
      }
      return [];
    } finally {
      if (!options.silent && requestId === visibleRequestRef.current) setLoading(false);
    }
  }

  async function loadStats(nextKeyword = submittedKeyword, options: { silent?: boolean } = {}) {
    const requestId = ++statsRequestRef.current;
    if (!options.silent) setStatsLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await apiJson<SupplierDocumentsStatsResponse>(
        `/api/supplier-document-requests/stats${params.size ? `?${params}` : ""}`,
      );
      if (requestId !== statsRequestRef.current) return;
      setPendingCount(Number(data.stats?.pendingCount || 0));
      setStatsTotalCount(Number(data.stats?.totalCount || 0));
      setStatsError("");
    } catch {
      if (requestId !== statsRequestRef.current) return;
      setStatsError("资料回传统计加载失败，请点击刷新任务重试。");
    } finally {
      if (!options.silent && requestId === statsRequestRef.current) setStatsLoading(false);
    }
  }

  async function loadTaskDetail(taskId: string, options: { force?: boolean; silent?: boolean } = {}) {
    const cached = rows.find((row) => row.id === taskId);
    if (cached?.detailLoaded && !options.force) return cached;
    const requestId = (detailRequestRef.current[taskId] || 0) + 1;
    detailRequestRef.current[taskId] = requestId;
    setRows((current) => current.map((row) => row.id === taskId
      ? { ...row, detailLoading: true, detailError: "" } : row));
    try {
      const data = await apiJson<SupplierDocumentDetailResponse>(
        `/api/supplier-document-requests/${encodeURIComponent(taskId)}`,
      );
      if (detailRequestRef.current[taskId] !== requestId) return null;
      const detail = data.request || data.data;
      if (!detail?.id) throw new Error(data.message || "资料回传任务详情为空");
      setRows((current) => current.map((row) => row.id === taskId ? mergeTaskDetail(row, detail) : row));
      return detail;
    } catch (detailError) {
      const message = detailError instanceof Error ? detailError.message : "读取资料回传任务详情失败";
      if (detailRequestRef.current[taskId] === requestId) {
        setRows((current) => current.map((row) => row.id === taskId
          ? { ...row, detailLoading: false, detailError: message } : row));
        if (!options.silent) setError(message);
      }
      return null;
    }
  }

  function openTask(taskId: string) {
    setExpandedTaskId(taskId);
  }

  function toggleTask(taskId: string) {
    setExpandedTaskId((current) => current === taskId ? "" : taskId);
  }

  useEffect(() => { void loadRows(1, pageSize); void loadStats(""); }, []);

  return {
    rows, setRows, loading, error, setError, loadError, notice, setNotice,
    expandedTaskId, setExpandedTaskId, page, setPage, pageSize, setPageSize,
    total, setTotal, totalPages, pendingCount, setPendingCount, statsTotalCount,
    statsLoading, statsError, submittedKeyword, loadRows, loadStats, loadTaskDetail,
    openTask, toggleTask,
  };
}
