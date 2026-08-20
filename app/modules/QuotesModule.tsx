"use client";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canReadPermission, canWritePermission } from "../utils";
import { useWorkspaceTabDiscardGuard, useWorkspaceTabBusy, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";
import { QuotationsModuleView } from "./quotations/quotations-module-view";
import { quotationNumber, QUOTATION_PAGE_SIZE, type QuotationDetailResponse, type QuotationRow, type QuotationsResponse } from "./quotations/types";
import { useQuotationDeletion } from "./quotations/use-quotation-deletion";
export function QuotesModule({ currentUser, permissions, initialKeyword = "", initialOpenToken = 0, onOpenSalesExecution, onOpenOrders, onOpenPayments }: {
  currentUser: User; permissions?: PermissionSnapshot; initialKeyword?: string; initialOpenToken?: number;
  onOpenSalesExecution: (quotationId: string, quotationNo: string, executionId?: string, executionNo?: string) => void;
  onOpenOrders: (keyword: string) => void; onOpenPayments: (keyword: string) => void;
}) {
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [submittedStatus, setSubmittedStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editQuotation, setEditQuotation] = useState<QuotationRow | null>(null);
  const [detailQuotation, setDetailQuotation] = useState<QuotationRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailLoaded, setDetailLoaded] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [voiding, setVoiding] = useState(false);
  const listRequestRef = useRef(0), detailRequestRef = useRef(0), voidingBusyRef = useRef(false);
  const canWriteQuotations = canWritePermission(currentUser, permissions, "quotations", ["管理员", "业务员"]), canSendCustomerEmail = canWritePermission(currentUser, permissions, "customerCommunication", ["管理员", "业务员"]), canWriteSalesExecution = canWritePermission(currentUser, permissions, "salesExecution", ["管理员", "业务员"]);
  const canReadOrders = canReadPermission(currentUser, permissions, "orders", ["管理员", "业务员", "财务"]), canReadPayments = canReadPermission(currentUser, permissions, "payments", ["管理员", "业务员", "财务"]);
  const confirmDiscard = useWorkspaceTabDiscardGuard("当前报价草稿尚未保存，确定放弃吗？");
  const { confirmation, requestConfirmation, cancelConfirmation, confirmConfirmation, updateConfirmationInput } = useConfirmationDialog();
  const { deleting, canDeleteQuotationDrafts, deleteQuotation } = useQuotationDeletion({
    currentUser, canWriteQuotations, detailLoaded, detailError, page, total, submittedKeyword, submittedStatus,
    detailRequestRef, loadQuotations, requestConfirmation, setDetailQuotation, setDetailLoading, setDetailLoaded,
    setDetailError, setQuotations, setTotal, setNotice,
  });
  useWorkspaceTabBusy(voiding);
  async function loadQuotations(nextPage = page, nextKeyword = submittedKeyword, nextStatus = submittedStatus) {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(QUOTATION_PAGE_SIZE) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStatus) params.set("status", nextStatus);
      const result = await apiJson<QuotationsResponse>(`/api/quotations?${params}`);
      if (requestId !== listRequestRef.current) return;
      const rows = Array.isArray(result.data?.rows)
        ? result.data.rows
        : Array.isArray(result.quotations) ? result.quotations : [];
      setQuotations(rows);
      setPage(Number(result.data?.page || nextPage));
      setTotal(Number(result.data?.total ?? rows.length));
      setTotalPages(Math.max(1, Number(result.data?.totalPages || 1)));
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取报价列表失败");
      }
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => { void loadQuotations(1, "", ""); }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setStatus("");
    setSubmittedStatus("");
    closeDetail();
    setCreateOpen(false);
    setEditQuotation(null);
    void loadQuotations(1, value, "");
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setSubmittedStatus(status);
      setNotice("");
      closeDetail();
      void loadQuotations(1, value, status);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, status, submittedKeyword]);

  const activeQuotation = editQuotation || detailQuotation;
  useWorkspaceTabPresentation({
    title: editQuotation
      ? `编辑报价 · ${quotationNumber(editQuotation) || "未编号"}`
      : createOpen
        ? "新建报价"
        : detailQuotation
          ? `报价 · ${quotationNumber(detailQuotation) || "未编号"}`
          : "客户与报价",
    view: editQuotation || createOpen ? "edit" : detailQuotation ? "detail" : "list",
    contextKey: editQuotation
      ? `edit:${editQuotation.id}`
      : createOpen
        ? "create:quotation"
        : activeQuotation
          ? `detail:${activeQuotation.id}`
          : "list:quotations",
    ensureListTab: Boolean(editQuotation || createOpen || detailQuotation),
  });
  useWorkspaceTabReactivation(() => { void loadQuotations(page, submittedKeyword, submittedStatus); });

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setSubmittedStatus(status);
    setNotice("");
    closeDetail();
    void loadQuotations(1, value, status);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setStatus("");
    setSubmittedStatus("");
    setNotice("");
    closeDetail();
    void loadQuotations(1, "", "");
  }

  function toggleCreate() {
    if ((createOpen || editQuotation) && !confirmDiscard()) return;
    detailRequestRef.current += 1;
    setDetailLoading(false); setDetailLoaded(false);
    setDetailError("");
    setDetailQuotation(null);
    setEditQuotation(null);
    setCreateOpen((current) => !current);
    setNotice("");
    setError("");
  }

  function cancelForm() {
    if (!confirmDiscard()) return;
    setCreateOpen(false);
    setEditQuotation(null);
  }

  async function openDetail(quotation: QuotationRow) {
    if ((createOpen || editQuotation) && !confirmDiscard()) return;
    setCreateOpen(false);
    setEditQuotation(null);
    setDetailQuotation(quotation);
    setDetailError(""); setDetailLoaded(false); setDetailLoading(true);
    const requestId = ++detailRequestRef.current;
    try {
      const result = await apiJson<QuotationDetailResponse>(`/api/quotations/${encodeURIComponent(quotation.id)}`);
      if (requestId !== detailRequestRef.current) return;
      const detail = result.quotation || result.data;
      if (!detail) throw new Error(result.message || "报价详情不存在");
      setDetailQuotation(detail);
      setDetailLoaded(true);
    } catch (detailLoadError) {
      if (requestId === detailRequestRef.current) {
        setDetailError(detailLoadError instanceof Error ? detailLoadError.message : "读取报价详情失败");
      }
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }

  function openEdit(quotation: QuotationRow) {
    if (!detailLoaded || detailError || !canWriteQuotations || !["DRAFT", "SENT", "REJECTED"].includes(String(quotation.status))) return;
    if ((createOpen || editQuotation) && !confirmDiscard()) return;
    detailRequestRef.current += 1;
    setDetailLoading(false); setDetailLoaded(false); setDetailError("");
    setDetailQuotation(null);
    setCreateOpen(false);
    setEditQuotation(quotation);
    setNotice("");
  }

  function quotationSaved(saved: QuotationRow, message: string) {
    setCreateOpen(false);
    setEditQuotation(null);
    setDetailQuotation(saved);
    setDetailLoaded(true);
    setDetailError("");
    setNotice(message);
    setQuotations((current) => {
      const exists = current.some((item) => item.id === saved.id);
      if (exists) return current.map((item) => item.id === saved.id ? saved : item);
      return page === 1 ? [saved, ...current].slice(0, QUOTATION_PAGE_SIZE) : current;
    });
    void loadQuotations(page === 1 ? 1 : page, submittedKeyword, submittedStatus);
  }

  function closeDetail() {
    if (voiding || deleting) return;
    detailRequestRef.current += 1;
    setDetailLoading(false); setDetailLoaded(false);
    setDetailError(""); setDetailQuotation(null);
  }

  async function voidQuotation(quotation: QuotationRow) {
    if (!detailLoaded || detailError || !canWriteQuotations || !["DRAFT", "SENT", "REJECTED"].includes(String(quotation.status)) || voidingBusyRef.current) return;
    voidingBusyRef.current = true;
    const result = await requestConfirmation({
      title: "作废报价",
      message: `确定作废报价 ${quotationNumber(quotation) || "未编号"} 吗？作废后记录仍会保留。`,
      variant: "danger",
      confirmLabel: "确认作废",
      cancelLabel: "返回",
      requireInput: true,
      inputLabel: "作废原因",
      inputValue: "报价内容调整，不再使用",
      inputPlaceholder: "请填写作废原因",
      inputRequiredMessage: "请填写作废原因后继续。",
    });
    if (!result.confirmed) { voidingBusyRef.current = false; return; }
    setVoiding(true);
    setDetailError("");
    try {
      const response = await apiJson<QuotationDetailResponse>(`/api/quotations/${encodeURIComponent(quotation.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: result.inputValue || "报价内容调整，不再使用", expectedVersionNumber: Number(quotation.currentVersionNumber || 1) }),
      });
      const saved = response.quotation || response.data;
      if (response.success !== true || !saved) throw new Error(response.message || "报价作废失败");
      setDetailQuotation(saved);
      setDetailLoaded(true);
      setQuotations((current) => current.map((item) => item.id === saved.id ? saved : item));
      setNotice(response.message || "报价已作废，原记录已保留");
      void loadQuotations(page, submittedKeyword, submittedStatus);
    } catch (voidError) {
      setDetailError(voidError instanceof Error ? voidError.message : "报价作废失败");
    } finally {
      voidingBusyRef.current = false;
      setVoiding(false);
    }
  }

  return (
    <QuotationsModuleView
      quotations={quotations} keyword={keyword} status={status}
      page={page} total={total} totalPages={totalPages}
      loading={loading} error={error} notice={notice}
      createOpen={createOpen} editQuotation={editQuotation}
      detailQuotation={detailQuotation} detailLoading={detailLoading} detailLoaded={detailLoaded} detailError={detailError}
      voiding={voiding} deleting={deleting}
      canWriteQuotations={canWriteQuotations} canDeleteQuotationDrafts={canDeleteQuotationDrafts}
      canSendCustomerEmail={canSendCustomerEmail}
      canWriteSalesExecution={canWriteSalesExecution} canReadOrders={canReadOrders} canReadPayments={canReadPayments}
      confirmation={confirmation}
      onSetKeyword={setKeyword} onSetStatus={setStatus}
      onSubmitSearch={submitSearch} onResetSearch={resetSearch} onToggleCreate={toggleCreate}
      onOpenOrders={onOpenOrders} onOpenPayments={onOpenPayments}
      onRefresh={() => void loadQuotations(page, submittedKeyword, submittedStatus)}
      onCancelForm={cancelForm}
      onSaved={quotationSaved}
      onPage={(nextPage) => {
        closeDetail();
        setNotice("");
        void loadQuotations(nextPage, submittedKeyword, submittedStatus);
      }}
      onViewDetail={(quotation) => void openDetail(quotation)}
      onEdit={openEdit}
      onVoid={(quotation) => void voidQuotation(quotation)}
      onDelete={(quotation) => void deleteQuotation(quotation)}
      onOpenSalesExecution={onOpenSalesExecution}
      onCloseDetail={closeDetail}
      onCancelConfirmation={cancelConfirmation}
      onConfirmConfirmation={confirmConfirmation}
      onUpdateConfirmationInput={updateConfirmationInput}
    />
  );
}
