"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import type { PermissionSnapshot, User } from "../types";
import { canReadPermission, canWritePermission } from "../utils";
import {
  useWorkspaceTabBusy,
  useWorkspaceTabDiscardGuard,
  useWorkspaceTabPresentation,
  useWorkspaceTabReactivation,
} from "../workspace/workspace-tab-context";
import { SalesExecutionModuleView } from "./sales-execution/sales-execution-module-view";
import type { QuotationConversionDraft } from "./sales-execution/quotation-conversion-panel";
import { useSalesExecutionDispatch } from "./sales-execution/use-sales-execution-dispatch";
import { useSalesExecutionDeletion } from "./sales-execution/use-sales-execution-deletion";
import { useSalesExecutionEmailRetry } from "./sales-execution/use-sales-execution-email-retry";
import { useSalesExecutionShipping } from "./sales-execution/use-sales-execution-shipping";
import { useSalesExecutionVoid } from "./sales-execution/use-sales-execution-void";
import {
  customerOrderNumber,
  SALES_EXECUTION_PAGE_SIZE,
  type SalesExecutionResponse,
  type SalesExecutionRow,
  type SalesExecutionsResponse,
} from "./sales-execution/types";

type QuotationFocusResponse = { data?: { id?: string; currentVersionNumber?: number | null }; quotation?: { id?: string; currentVersionNumber?: number | null }; message?: string };
export function SalesExecutionModule({
  currentUser, permissions, initialKeyword = "", initialAction = "", initialQuotationId = "",
  initialExecutionId = "", initialOpenToken = 0, onOpenReceivableOrder,
}: {
  currentUser: User; permissions?: PermissionSnapshot; initialKeyword?: string; initialAction?: string;
  initialQuotationId?: string; initialExecutionId?: string; initialOpenToken?: number;
  onOpenReceivableOrder?: (orderNo: string) => void;
}) {
  const [rows, setRows] = useState<SalesExecutionRow[]>([]);
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
  const [editExecution, setEditExecution] = useState<SalesExecutionRow | null>(null);
  const [detailExecution, setDetailExecution] = useState<SalesExecutionRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [conversionDraft, setConversionDraft] = useState<QuotationConversionDraft | null>(null);
  const [converting, setConverting] = useState(false);
  const listRequestRef = useRef(0), detailRequestRef = useRef(0);
  const handledFocusRef = useRef(""), conversionBusyRef = useRef(false);
  const canWrite = canWritePermission(currentUser, permissions, "salesExecution", ["管理员", "业务员"]);
  const canDelete = currentUser.role === "管理员" && canWrite;
  const canWriteOrders = canWritePermission(currentUser, permissions, "orders", ["管理员", "业务员"]);
  const canReadOrders = canReadPermission(currentUser, permissions, "orders", ["管理员", "业务员", "财务"]);
  const canRecordFactoryPayment = canWritePermission(currentUser, permissions, "payments", ["管理员", "财务"]);
  const canAddFactoryAdjustment = canWritePermission(currentUser, permissions, "costs", ["管理员", "业务员"]);
  const dispatch = useSalesExecutionDispatch({ canWrite, onSaved: executionDispatched });
  const shipping = useSalesExecutionShipping({ canWrite: canWrite && canWriteOrders, onSaved: executionDispatched });
  const voidAction = useSalesExecutionVoid({ canWrite, onSaved: executionDispatched });
  const deleteAction = useSalesExecutionDeletion({ canDelete, onDeleted: executionDeleted });
  const emailRetry = useSalesExecutionEmailRetry({ canWrite, execution: detailExecution, onSaved: executionEmailRetried });
  const confirmDiscard = useWorkspaceTabDiscardGuard("当前销售执行草稿尚未保存，确定放弃吗？");
  useWorkspaceTabBusy(converting || emailRetry.retrying);
  async function loadRows(nextPage = page, nextKeyword = submittedKeyword, nextStatus = submittedStatus) {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(SALES_EXECUTION_PAGE_SIZE) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStatus) params.set("status", nextStatus);
      const result = await apiJson<SalesExecutionsResponse>(`/api/sales-executions?${params}`);
      if (requestId !== listRequestRef.current) return [];
      const nextRows = Array.isArray(result.data?.rows) ? result.data.rows : Array.isArray(result.executions) ? result.executions : [];
      setRows(nextRows);
      setPage(Number(result.data?.page || nextPage));
      setTotal(Number(result.data?.total ?? nextRows.length));
      setTotalPages(Math.max(1, Number(result.data?.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) setError(loadError instanceof Error ? loadError.message : "读取销售执行列表失败");
      return [];
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }
  async function loadDetail(id: string, editAfterLoad = false) {
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setDetailError("");
    try {
      const result = await apiJson<SalesExecutionResponse>(`/api/sales-executions/${encodeURIComponent(id)}`);
      if (requestId !== detailRequestRef.current) return;
      const execution = result.execution || result.data;
      if (!execution) throw new Error(result.message || "销售执行记录不存在");
      if (editAfterLoad && canWrite && execution.status === "DRAFT") {
        setDetailExecution(null);
        setEditExecution(execution);
      } else {
        setDetailExecution(execution);
      }
    } catch (detailLoadError) {
      if (requestId === detailRequestRef.current) setDetailError(detailLoadError instanceof Error ? detailLoadError.message : "读取销售执行详情失败");
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }
  async function prepareQuotationConversion(quotationId: string) {
    if (!canWrite) {
      setError("当前账号没有创建销售执行草稿的权限");
      return;
    }
    setConverting(true);
    setError("");
    setNotice("正在读取已接受报价...");
    try {
      const quotationResult = await apiJson<QuotationFocusResponse>(`/api/quotations/${encodeURIComponent(quotationId)}`);
      const quotation = quotationResult.quotation || quotationResult.data;
      if (!quotation?.id) throw new Error(quotationResult.message || "报价不存在");
      setCreateOpen(false);
      setEditExecution(null);
      setDetailExecution(null);
      setConversionDraft({ quotationId: quotation.id, expectedVersionNumber: Number(quotation.currentVersionNumber || 1), customerOrderNo: "", requestedDeliveryDate: "" });
      setNotice("请填写客户订单号和客户要求交货日期。");
    } catch (conversionError) {
      setNotice("");
      setError(conversionError instanceof Error ? conversionError.message : "读取报价失败");
    } finally {
      setConverting(false);
    }
  }
  async function submitQuotationConversion(draft: QuotationConversionDraft) {
    if (conversionBusyRef.current) return;
    conversionBusyRef.current = true;
    setConverting(true); setError("");
    setNotice("正在生成销售执行草稿...");
    try {
      const result = await apiJson<SalesExecutionResponse>("/api/sales-executions", {
        method: "POST",
        body: JSON.stringify({ sourceType: "QUOTATION", ...draft }),
      });
      const saved = result.execution || result.data;
      if (result.success !== true || !saved) throw new Error(result.message || "报价转入销售执行失败");
      setConversionDraft(null);
      setCreateOpen(false);
      setDetailExecution(null);
      setEditExecution(saved);
      setNotice(result.message || "已生成销售执行草稿，请完成工厂采购分配");
      void loadRows(1, "", "");
    } catch (conversionError) {
      setNotice("");
      setError(conversionError instanceof Error ? conversionError.message : "报价转入销售执行失败");
    } finally {
      conversionBusyRef.current = false; setConverting(false);
    }
  }
  useEffect(() => {
    void loadRows(1, "", "");
  }, []);
  useEffect(() => {
    if (!initialOpenToken) return;
    const focusKey = `${initialOpenToken}:${initialAction}:${initialQuotationId}:${initialExecutionId}:${initialKeyword}`;
    if (handledFocusRef.current === focusKey) return;
    handledFocusRef.current = focusKey;
    setCreateOpen(false);
    setEditExecution(null);
    setDetailExecution(null);
    setConversionDraft(null);
    setNotice("");
    if (initialAction === "convert" && initialQuotationId) {
      void prepareQuotationConversion(initialQuotationId);
      return;
    }
    if (initialExecutionId) {
      void loadRows(1, initialKeyword, "");
      void loadDetail(initialExecutionId, initialAction === "edit");
      return;
    }
    if (initialAction === "create") {
      setLoading(false);
      if (canWrite) setCreateOpen(true);
      return;
    }
    const nextKeyword = initialKeyword.trim();
    setKeyword(nextKeyword);
    setSubmittedKeyword(nextKeyword);
    void loadRows(1, nextKeyword, "");
  }, [initialOpenToken, initialAction, initialQuotationId, initialExecutionId, initialKeyword]);
  useEffect(() => {
    const nextKeyword = keyword.trim();
    if (nextKeyword === submittedKeyword && status === submittedStatus) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(nextKeyword);
      setSubmittedStatus(status);
      setDetailExecution(null);
      void loadRows(1, nextKeyword, status);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, status, submittedKeyword, submittedStatus]);
  const active = editExecution || detailExecution;
  useWorkspaceTabPresentation({
    title: conversionDraft ? "报价转入 · 补充订单凭证" : editExecution ? `编辑销售执行 · ${customerOrderNumber(editExecution) || "未填写客户订单号"}` : createOpen ? "直接创建销售执行" : detailExecution ? `销售执行 · ${customerOrderNumber(detailExecution) || "未填写客户订单号"}` : "销售执行",
    view: conversionDraft || editExecution || createOpen ? "edit" : detailExecution ? "detail" : "list",
    contextKey: conversionDraft ? `convert:${conversionDraft.quotationId}` : editExecution ? `edit:${editExecution.id}` : createOpen ? "create:sales-execution" : active ? `detail:${active.id}` : "list:sales-execution",
    ensureListTab: Boolean(conversionDraft || editExecution || createOpen || detailExecution),
  });
  useWorkspaceTabReactivation(() => { void loadRows(page, submittedKeyword, submittedStatus); });
  function closeEditors() {
    detailRequestRef.current += 1;
    setCreateOpen(false);
    setEditExecution(null);
    setDetailExecution(null);
    setConversionDraft(null);
    setDetailError("");
    emailRetry.clearError();
    dispatch.clearDispatchError();
    shipping.clearError(); voidAction.clearError();
    deleteAction.clearError();
  }
  function submitSearch() {
    if ((conversionDraft || createOpen || editExecution) && !confirmDiscard()) return;
    const nextKeyword = keyword.trim();
    setSubmittedKeyword(nextKeyword);
    setSubmittedStatus(status);
    closeEditors();
    void loadRows(1, nextKeyword, status);
  }
  function executionSaved(saved: SalesExecutionRow, message: string) {
    setConversionDraft(null);
    setCreateOpen(false);
    setEditExecution(null);
    setDetailExecution(saved);
    setDetailError("");
    setNotice(message);
    setRows((current) => current.some((row) => row.id === saved.id) ? current.map((row) => row.id === saved.id ? saved : row) : [saved, ...current].slice(0, SALES_EXECUTION_PAGE_SIZE));
    void loadRows(page, submittedKeyword, submittedStatus);
  }
  function executionDispatched(saved: SalesExecutionRow, message: string) {
    setDetailExecution(saved);
    setDetailError("");
    setError("");
    setNotice(message);
    setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
    void loadRows(page, submittedKeyword, submittedStatus);
    void loadDetail(saved.id);
  }
  function executionEmailRetried(saved: SalesExecutionRow, message: string) {
    setDetailExecution((current) => current?.id === saved.id ? saved : current);
    setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
    setNotice(message);
  }
  function executionDeleted(executionId: string, message: string) {
    detailRequestRef.current += 1;
    setDetailExecution(null); setDetailLoading(false); setDetailError("");
    setRows((current) => current.filter((row) => row.id !== executionId));
    setTotal((current) => Math.max(0, current - 1)); setNotice(message);
    void loadRows(page, submittedKeyword, submittedStatus);
  }
  const detailGeneration = detailRequestRef.current;
  return (
    <SalesExecutionModuleView
      rows={rows} keyword={keyword} status={status} page={page} total={total} totalPages={totalPages} loading={loading || converting}
      error={error} notice={notice} conversionDraft={conversionDraft} converting={converting} createOpen={createOpen} editExecution={editExecution} detailExecution={detailExecution}
      detailLoading={detailLoading} detailError={detailError} dispatching={dispatch.dispatching} dispatchError={dispatch.dispatchError} confirmation={dispatch.confirmation}
      shippingStarting={shipping.starting} shippingError={shipping.error} shippingConfirmation={shipping.confirmation}
      retryingPurchaseOrderId={emailRetry.retryingPurchaseOrderId} dispatchEmailRetryError={emailRetry.error}
      voiding={voidAction.voiding} voidError={voidAction.error} voidConfirmation={voidAction.confirmation}
      deleting={deleteAction.deleting} deleteError={deleteAction.error} deleteConfirmation={deleteAction.confirmation}
      canWrite={canWrite} canDelete={canDelete} canEnterShipping={canWrite && canWriteOrders} canOpenReceivableOrder={canReadOrders && Boolean(onOpenReceivableOrder)} canRecordFactoryPayment={canRecordFactoryPayment} canAddFactoryAdjustment={canAddFactoryAdjustment} onKeyword={setKeyword} onStatus={setStatus}
      onSearch={submitSearch} onReset={() => { if ((conversionDraft || createOpen || editExecution) && !confirmDiscard()) return; setKeyword(""); setSubmittedKeyword(""); setStatus(""); setSubmittedStatus(""); closeEditors(); void loadRows(1, "", ""); }}
      onRefresh={() => void loadRows(page, submittedKeyword, submittedStatus)}
      onToggleCreate={() => { if ((conversionDraft || createOpen || editExecution) && !confirmDiscard()) return; const nextOpen = !createOpen; closeEditors(); setCreateOpen(nextOpen); setNotice(""); }}
      onConversionChange={setConversionDraft} onConversionSubmit={(draft) => void submitQuotationConversion(draft)}
      onConversionCancel={() => { if (confirmDiscard()) closeEditors(); }}
      onCancelForm={() => { if (confirmDiscard()) closeEditors(); }} onSaved={executionSaved}
      onPage={(nextPage) => { if ((conversionDraft || createOpen || editExecution) && !confirmDiscard()) return; closeEditors(); void loadRows(nextPage, submittedKeyword, submittedStatus); }}
      onOpen={(row) => { if ((conversionDraft || createOpen || editExecution) && !confirmDiscard()) return; closeEditors(); setDetailExecution(row); void loadDetail(row.id); }}
      onEdit={() => { if (!detailExecution || !canWrite || detailExecution.status !== "DRAFT") return; setEditExecution(detailExecution); setDetailExecution(null); }}
      onDispatch={() => { if (detailExecution) void dispatch.dispatchExecution(detailExecution); }}
      onEnterShipping={() => { if (detailExecution) void shipping.enterShipping(detailExecution); }}
      onVoid={() => { if (detailExecution) void voidAction.voidExecution(detailExecution); }}
      onDelete={() => { if (detailExecution) void deleteAction.deleteExecution(detailExecution); }}
      onOpenReceivableOrder={(orderNo) => onOpenReceivableOrder?.(orderNo)}
      onRetryDispatchEmail={(purchaseOrderId) => void emailRetry.retry(purchaseOrderId)}
      onFactoryExecutionChanged={() => detailExecution && detailGeneration === detailRequestRef.current ? loadDetail(detailExecution.id) : undefined}
      onCloseDetail={() => { if (!detailLoading && !dispatch.dispatching && !shipping.starting && !emailRetry.retrying && !voidAction.voiding && !deleteAction.deleting) closeEditors(); }}
      onCancelConfirmation={dispatch.cancelConfirmation} onConfirmConfirmation={dispatch.confirmConfirmation}
      onCancelShippingConfirmation={shipping.cancelConfirmation} onConfirmShippingConfirmation={shipping.confirmConfirmation}
      onCancelVoidConfirmation={voidAction.cancelConfirmation} onConfirmVoidConfirmation={voidAction.confirmConfirmation} onUpdateVoidConfirmationInput={voidAction.updateConfirmationInput}
      onCancelDeleteConfirmation={deleteAction.cancelConfirmation} onConfirmDeleteConfirmation={deleteAction.confirmConfirmation} onUpdateDeleteConfirmationInput={deleteAction.updateConfirmationInput}
    />
  );
}
