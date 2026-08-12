"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { useConfirmationDialog } from "../components";
import { formatCny } from "../formatters";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import { useWorkspaceTabBusy, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";
import { ProfitModuleView } from "./profit/module-view";
import { PAGE_SIZE, type ProfitResponse, type ProfitRow } from "./profit/shared";

export function ProfitModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOpenToken?: number;
}) {
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [detailRow, setDetailRow] = useState<ProfitRow | null>(null);
  const [settlingId, setSettlingId] = useState("");
  const [reversingId, setReversingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const listRequestRef = useRef(0);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteCommissions = canWritePermission(currentUser, permissions, "commissions", ["管理员", "财务"]);
  const canSettleCommission = canWriteCommissions && ["管理员", "财务"].includes(currentUser.role);
  const canReverseCommission = canWriteCommissions && currentUser.role === "管理员";
  useWorkspaceTabBusy(Boolean(settlingId || reversingId));

  async function loadRows(nextPage = page, nextKeyword = submittedKeyword) {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<ProfitResponse>(`/api/profit?${params}`);
      if (requestId !== listRequestRef.current) return [];
      const data = result.data || {};
      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(nextRows);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      if (result.error) setError(result.error || "读取资料失败");
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取利润分析失败");
      }
      return [];
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (initialOpenToken && initialKeyword.trim()) return;
    void loadRows(1, "");
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setDetailRow(null);
    setNotice("");
    void loadRows(1, value).then((nextRows) => {
      const matched = nextRows.find((row) => (
        row.orderNo === value
        || row.blNo === value
        || row.id === value
      )) || nextRows[0] || null;
      setDetailRow(matched);
    });
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setDetailRow(null);
      setNotice("");
      void loadRows(1, value);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setDetailRow(null);
    setNotice("");
    void loadRows(1, value);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setDetailRow(null);
    setNotice("");
    void loadRows(1, "");
  }

  function gotoPage(nextPage: number) {
    setDetailRow(null);
    setNotice("");
    void loadRows(nextPage, submittedKeyword);
  }

  async function settleCommission(row: ProfitRow) {
    const summary = row.summary || {};
    const confirmationResult = await requestConfirmation({
      title: "确认结算该订单业务员提成？",
      message: "结算后将写入提成结算记录，并刷新利润分析列表。",
      details: [
        `订单号：${row.orderNo || "-"}`,
        `已到账：${formatCny(summary.arrivedPaymentsCny)}`,
        `物流成本：${formatCny(summary.logisticsCostCny)}`,
        `提成基数：${formatCny(summary.commissionBaseCny)}`,
        `提成比例：${Number(summary.commissionRate || 0).toFixed(2)}%`,
        `应结算提成：${formatCny(summary.commissionAmountCny ?? summary.estimatedCommissionCny)}`,
      ],
      confirmLabel: "确认结算",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    setSettlingId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/commissions/${encodeURIComponent(row.id)}/settle`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      if (result.success !== true) throw new Error(result.message || "结算业务员提成失败");
      const nextRows = await loadRows(page, submittedKeyword);
      setDetailRow(nextRows.find((item) => item.id === row.id) || null);
      setNotice(result.message || "业务员提成已结算");
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : "结算业务员提成失败");
    } finally {
      setSettlingId("");
    }
  }

  async function reverseCommission(row: ProfitRow) {
    const confirmationResult = await requestConfirmation({
      title: "撤销该订单的提成结算？",
      message: "撤销后订单会恢复为未结算，才可更正订单、收款或成本。原结算快照和撤销原因会保留在审计日志中。",
      details: [
        `订单号：${row.orderNo || "-"}`,
        `结算时间：${row.commissionSettledAt ? new Date(row.commissionSettledAt).toLocaleString("zh-CN") : "-"}`,
        `结算人：${row.commissionSettledByName || "-"}`,
      ],
      confirmLabel: "确认撤销结算",
      cancelLabel: "取消",
      variant: "danger",
      requireInput: true,
      inputLabel: "撤销原因",
      inputPlaceholder: "例如：收款金额录入错误，需要更正后重新结算",
      inputRequiredMessage: "撤销提成结算必须填写原因。",
    });
    if (!confirmationResult.confirmed) return;
    setReversingId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/commissions/${encodeURIComponent(row.id)}/settle`,
        {
          method: "DELETE",
          body: JSON.stringify({ reason: confirmationResult.inputValue }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "撤销业务员提成结算失败");
      const nextRows = await loadRows(page, submittedKeyword);
      setDetailRow(nextRows.find((item) => item.id === row.id) || null);
      setNotice(result.message || "业务员提成结算已撤销");
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "撤销业务员提成结算失败");
    } finally {
      setReversingId("");
    }
  }

  useWorkspaceTabPresentation({
    title: detailRow ? `利润 · ${detailRow.orderNo || detailRow.blNo || "详情"}` : "利润分析",
    view: detailRow ? "detail" : "list",
    contextKey: detailRow ? `detail:${detailRow.id}` : "list:profit",
    ensureListTab: Boolean(detailRow),
  });
  useWorkspaceTabReactivation(() => {
    void loadRows(page, submittedKeyword);
  });

  return (
    <ProfitModuleView
      rows={rows}
      total={total}
      page={page}
      totalPages={totalPages}
      keyword={keyword}
      detailRow={detailRow}
      settlingId={settlingId}
      reversingId={reversingId}
      loading={loading}
      error={error}
      notice={notice}
      canSettleCommission={canSettleCommission}
      canReverseCommission={canReverseCommission}
      confirmation={confirmation}
      onKeywordChange={setKeyword}
      onSubmitSearch={submitSearch}
      onResetSearch={resetSearch}
      onRefresh={() => { setNotice(""); void loadRows(page); }}
      onPage={gotoPage}
      onSetDetailRow={setDetailRow}
      onSettle={(row) => void settleCommission(row)}
      onReverse={(row) => void reverseCommission(row)}
      onCancelConfirmation={cancelConfirmation}
      onConfirmConfirmation={confirmConfirmation}
      onUpdateConfirmationInput={updateConfirmationInput}
    />
  );
}
