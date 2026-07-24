"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiJson } from "../../api";
import {
  PAGE_SIZE,
  type LogisticsExpense,
  type LogisticsExpensesResponse,
} from "./model";
import {
  logisticsExpenseBillCanApprove,
  logisticsExpenseSelectionSelected,
  logisticsExpenseShipmentBillIds,
  sortLogisticsExpenseBillsForDisplay,
} from "./shared";
import { useWorkspaceTabActive, useWorkspaceTabReactivation } from "../../workspace/workspace-tab-context";

type UseLogisticsFeesListControllerParams = {
  initialStatus: string;
  focusBillId: string;
  focusKeyword: string;
  focusToken: number;
  refreshToken: number;
  statementMonth: string;
  loadStatement: (month?: string) => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useLogisticsFeesListController({
  initialStatus,
  focusBillId,
  focusKeyword,
  focusToken,
  refreshToken,
  statementMonth,
  loadStatement,
  setError,
  setNotice,
}: UseLogisticsFeesListControllerParams) {
  const workspaceTabActive = useWorkspaceTabActive();
  const [rows, setRows] = useState<LogisticsExpense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [costType, setCostType] = useState("");
  const [billStatus, setBillStatus] = useState("normal");
  const [businessScope, setBusinessScope] = useState("current");
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const listRequestRef = useRef(0);

  async function loadExpenses(
    nextPage = page,
    nextKeyword = submittedKeyword,
    nextStatus = status,
    nextCostType = costType,
    nextBillStatus = billStatus,
    nextBusinessScope = businessScope,
    options: { silent?: boolean } = {},
  ) {
    const requestId = ++listRequestRef.current;
    if (!options.silent) {
      setLoading(true);
      setError("");
    }
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStatus) params.set("status", nextStatus);
      if (nextCostType) params.set("costType", nextCostType);
      if (nextBillStatus) params.set("billStatus", nextBillStatus);
      params.set("archiveScope", nextBusinessScope);

      const result = await apiJson<LogisticsExpensesResponse>(
        `/api/logistics-costs?${params}`,
      );
      if (requestId !== listRequestRef.current) return [];
      const nextRows = sortLogisticsExpenseBillsForDisplay(
        Array.isArray(result.rows) ? result.rows : [],
      );
      setRows(nextRows);
      setSelectedBillIds((current) =>
        current.filter((id) =>
          nextRows.some(
            (row) => row.id === id && logisticsExpenseBillCanApprove(row),
          ),
        ),
      );
      setTotal(Number(result.total || 0));
      setPage(Number(result.page || nextPage));
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(
          loadError instanceof Error ? loadError.message : "读取物流费用失败",
        );
      }
      return [];
    } finally {
      if (requestId === listRequestRef.current && !options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadExpenses(1, "", initialStatus, "", billStatus, "current");
    void loadStatement(statementMonth);
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    void loadExpenses(1, submittedKeyword, status, costType, billStatus, businessScope);
    void loadStatement(statementMonth);
  }, [refreshToken]);

  useEffect(() => {
    if (!workspaceTabActive || loading) return;
    const hasProcessingInvoice = rows.some((row) =>
      (row.invoiceGroups || []).some((group) =>
        ["识别中", "已上传待识别"].includes(String(group.validationStatus || "")),
      ),
    );
    if (!hasProcessingInvoice) return;
    const timer = window.setInterval(() => {
      void loadExpenses(page, submittedKeyword, status, costType, billStatus, businessScope, { silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [rows, page, submittedKeyword, status, costType, billStatus, businessScope, loading, workspaceTabActive]);

  useWorkspaceTabReactivation(() => {
    void loadExpenses(page, submittedKeyword, status, costType, billStatus, businessScope);
    void loadStatement(statementMonth);
  });

  useEffect(() => {
    if (!focusToken) return;
    const nextKeyword = focusKeyword.trim();
    setKeyword(nextKeyword);
    setSubmittedKeyword(nextKeyword);
    setStatus("");
    setCostType("");
    setBillStatus("normal");
    setBusinessScope("current");
    setCreateOpen(false);
    setNotice("");
    void loadExpenses(1, nextKeyword, "", "", "normal", "current").then((nextRows) => {
      const matched =
        nextRows.find((row) => row.id === focusBillId) ||
        nextRows.find(
          (row) =>
            row.orderNo === nextKeyword ||
            row.blNo === nextKeyword ||
            row.billOfLadingNo === nextKeyword ||
            row.orderId === nextKeyword,
        ) ||
        nextRows[0];
      if (!matched) {
        setExpandedId("");
        setNotice("未找到对应物流费用账单，可在本区新增物流费用。");
        return;
      }
      setExpandedId(matched.id);
      setNotice("已打开对应物流费用账单。");
    });
  }, [focusToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setExpandedId("");
      setNotice("");
      void loadExpenses(1, value, status, costType, billStatus, businessScope);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, status, costType, billStatus, businessScope]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeExpense = expandedId
    ? rows.find((row) => row.id === expandedId) || null
    : null;
  const reviewableRows = rows.filter(logisticsExpenseBillCanApprove);
  const selectedReviewableRows = rows.filter(
    (row) =>
      logisticsExpenseSelectionSelected(row, selectedBillIds) &&
      logisticsExpenseBillCanApprove(row),
  );
  const allReviewableSelected =
    reviewableRows.length > 0 &&
    reviewableRows.every((row) =>
      logisticsExpenseSelectionSelected(row, selectedBillIds),
    );

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setExpandedId("");
    setSelectedBillIds([]);
    setNotice("");
    void loadExpenses(1, value, status, costType, billStatus, businessScope);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setStatus(initialStatus);
    setCostType("");
    setBillStatus("normal");
    setBusinessScope("current");
    setExpandedId("");
    setSelectedBillIds([]);
    setNotice("");
    void loadExpenses(1, "", initialStatus, "", "normal", "current");
  }

  function toggleBillSelection(expense: LogisticsExpense, checked: boolean) {
    if (!logisticsExpenseBillCanApprove(expense)) return;
    const ids = logisticsExpenseShipmentBillIds(expense);
    setSelectedBillIds((current) =>
      checked
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  }

  function toggleAllReviewableBills(checked: boolean) {
    setSelectedBillIds((current) => {
      const reviewableIds = reviewableRows.flatMap(
        logisticsExpenseShipmentBillIds,
      );
      if (!checked) return current.filter((id) => !reviewableIds.includes(id));
      return [...new Set([...current, ...reviewableIds])];
    });
  }

  return {
    rows,
    setRows,
    total,
    setTotal,
    page,
    keyword,
    setKeyword,
    submittedKeyword,
    status,
    setStatus,
    costType,
    setCostType,
    billStatus,
    setBillStatus,
    businessScope,
    setBusinessScope,
    expandedId,
    setExpandedId,
    loading,
    createOpen,
    setCreateOpen,
    selectedBillIds,
    setSelectedBillIds,
    totalPages,
    activeExpense,
    reviewableRows,
    selectedReviewableRows,
    allReviewableSelected,
    loadExpenses,
    submitSearch,
    resetSearch,
    toggleBillSelection,
    toggleAllReviewableBills,
  };
}
