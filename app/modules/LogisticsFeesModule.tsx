"use client";

import { useEffect, useState } from "react";
import { ApiRequestError, apiJson } from "../api";
import {
  ConfirmationDialog,
  PaginationBar,
  useConfirmationDialog,
} from "../components";
import { downloadBlob } from "../utils";
import styles from "../WorkspaceShell.module.css";
import { LogisticsExpenseBillTable } from "./logistics-fees/bill-table";
import { LogisticsExpenseRows } from "./logistics-fees/details-drawer";
import { LogisticsExpenseForm } from "./logistics-fees/expense-form";
import {
  MonthlySummaryComponent,
  SupplierSectionComponent,
} from "./logistics-fees/monthly-summary";
import {
  AUDIT_FILTERS,
  COST_TYPE_OPTIONS,
  PAGE_SIZE,
  PAY_BUTTON_DISABLED_TOOLTIP,
  todayInputInChinaClient,
  type LogisticsExpense,
  type LogisticsExpenseBatchSavePayload,
  type LogisticsExpenseBatchSaveResult,
  type LogisticsExpensesResponse,
  type LogisticsExpenseMutationResult,
  type LogisticsStatementRow,
} from "./logistics-fees/model";
import {
  billSupplierIds,
  csvCell,
  formatOriginalCurrencyAccounting,
  logisticsCurrencySummaryPlainText,
  logisticsExpenseBillAuditStatus,
  logisticsExpenseBillCanApprove,
  logisticsExpenseBillIsEditable,
  logisticsExpenseBillItems,
  logisticsExpenseCurrencySummaryFromItems,
  logisticsExpenseDeleteBlockReason,
  logisticsExpensePayButtonState,
  logisticsExpenseReviewFailureMessage,
  logisticsExpenseReviewNotice,
  logisticsExpenseSelectionSelected,
  logisticsExpenseShipmentBillIds,
  markLogisticsExpenseBillRejected,
  markLogisticsExpenseBillSubmitted,
  reconcileLogisticsExpenseMutationRows,
  reconcileLogisticsExpenseRowsAfterBatchSave,
  removeLogisticsExpenseFromRows,
  replaceLogisticsExpenseItemsInRows,
  sortLogisticsExpenseBillsForDisplay,
  statementRowSummary,
} from "./logistics-fees/shared";
import { logisticsCostTypeLabel } from "../../lib/platform/logistics-cost-types";

export function LogisticsFeesModule({
  embedded = false,
  title = "物流费用录入",
  initialStatus = "",
  sectionId = "",
  focusBillId = "",
  focusKeyword = "",
  focusToken = 0,
  hideCreateAction = false,
  refreshToken = 0,
  currentUserRole = "",
  currentUserSupplierId = "",
  canCreateExpense: canCreateExpenseProp,
}: {
  embedded?: boolean;
  title?: string;
  initialStatus?: string;
  sectionId?: string;
  focusBillId?: string;
  focusKeyword?: string;
  focusToken?: number;
  hideCreateAction?: boolean;
  refreshToken?: number;
  currentUserRole?: string;
  currentUserSupplierId?: string;
  canCreateExpense?: boolean;
}) {
  const [rows, setRows] = useState<LogisticsExpense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [costType, setCostType] = useState("");
  const [statementMonth, setStatementMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [statementRows, setStatementRows] = useState<LogisticsStatementRow[]>(
    [],
  );
  const [statementLoading, setStatementLoading] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [savingBillId, setSavingBillId] = useState("");
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canCreateExpense =
    !hideCreateAction &&
    (canCreateExpenseProp ??
      ["管理员", "物流供应商"].includes(currentUserRole));
  const canReviewExpense = currentUserRole === "管理员";
  const canConfirmInvoice = ["管理员", "财务"].includes(currentUserRole);
  const isLogisticsSupplier = currentUserRole === "物流供应商";
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

  async function loadExpenses(
    nextPage = page,
    nextKeyword = submittedKeyword,
    nextStatus = status,
    nextCostType = costType,
  ) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStatus) params.set("status", nextStatus);
      if (nextCostType) params.set("costType", nextCostType);
      const result = await apiJson<LogisticsExpensesResponse>(
        `/api/logistics-costs?${params}`,
      );
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
      setError(
        loadError instanceof Error ? loadError.message : "读取物流费用失败",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExpenses(1, "", initialStatus, "");
    void loadStatement(statementMonth);
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    void loadExpenses(1, submittedKeyword, status, costType);
    void loadStatement(statementMonth);
  }, [refreshToken]);

  useEffect(() => {
    if (!focusToken) return;
    const nextKeyword = focusKeyword.trim();
    setKeyword(nextKeyword);
    setSubmittedKeyword(nextKeyword);
    setStatus("");
    setCostType("");
    setCreateOpen(false);
    setNotice("");
    void loadExpenses(1, nextKeyword, "", "").then((nextRows) => {
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
      void loadExpenses(1, value, status, costType);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, status, costType]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeExpense = expandedId
    ? rows.find((row) => row.id === expandedId) || null
    : null;

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setExpandedId("");
    setSelectedBillIds([]);
    setNotice("");
    void loadExpenses(1, value, status, costType);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setStatus(initialStatus);
    setCostType("");
    setExpandedId("");
    setSelectedBillIds([]);
    setNotice("");
    void loadExpenses(1, "", initialStatus, "");
  }

  function applyLogisticsExpenseMutationResult(
    result: LogisticsExpenseMutationResult,
  ) {
    setRows((currentRows) =>
      reconcileLogisticsExpenseMutationRows(currentRows, result),
    );
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

  async function reviewExpenseBills(
    billIds: string[],
    sourceExpense: LogisticsExpense | null = null,
  ) {
    const ids = billIds.filter(Boolean);
    if (!ids.length) {
      setError("请选择需要审核的物流费用账单");
      setNotice("");
      return;
    }
    const busyKey = ids.length === 1 ? ids[0] : "__batch_review__";
    setBusyId(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/review`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "approve", billIds: ids }),
        },
      );
      const failureMessage = logisticsExpenseReviewFailureMessage(result);
      if (result.success !== true)
        throw new Error(failureMessage || result.message || "审核物流费用失败");
      await loadExpenses(page, submittedKeyword, status, costType);
      setSelectedBillIds((current) =>
        current.filter((id) => !ids.includes(id)),
      );
      if (sourceExpense && expandedId === sourceExpense.id)
        setExpandedId(sourceExpense.id);
      void loadStatement(statementMonth);
      setNotice(logisticsExpenseReviewNotice(result));
      if (failureMessage) setError(failureMessage);
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : "审核物流费用失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function reviewSelectedBills() {
    if (!selectedReviewableRows.length) {
      setError("请选择待审核的物流费用账单");
      setNotice("");
      return;
    }
    const supplierCount = new Set(
      selectedReviewableRows.flatMap((row) => billSupplierIds(row)),
    ).size;
    const confirmationResult = await requestConfirmation({
      title: "合并审核 / 批量审核",
      message:
        "审核通过后系统会按供应商合并发送开票通知，同一供应商只发送一封邮件。",
      details: [
        `选中账单：${selectedReviewableRows.length} 票`,
        `涉及供应商：${supplierCount || 0} 家`,
      ],
      confirmLabel: "审核通过并通知",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    await reviewExpenseBills(
      selectedReviewableRows.flatMap(logisticsExpenseShipmentBillIds),
    );
  }

  async function saveBillDetails(
    expense: LogisticsExpense,
    payload: LogisticsExpenseBatchSavePayload,
  ): Promise<LogisticsExpenseBatchSaveResult | null> {
    if (savingBillId === expense.id) return null;
    if (
      !payload.updates.length &&
      !payload.creates.length &&
      !payload.deletes.length
    ) {
      setNotice("没有需要保存的修改");
      return null;
    }
    setBusyId(expense.id);
    setSavingBillId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        bill?: LogisticsExpense;
        items?: LogisticsExpense[];
        details?: LogisticsExpense[];
        rows?: LogisticsExpense[];
        deletedIds?: string[];
        message?: string;
      }>("/api/logistics-expenses/batch-save", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (result.success !== true)
        throw new Error(result.message || "保存本账单明细失败");
      const savedRows = result.bill?.items?.length
        ? result.bill.items
        : Array.isArray(result.items)
          ? result.items
          : Array.isArray(result.details)
            ? result.details
            : Array.isArray(result.rows)
              ? result.rows
              : [];
      const deletedIds = Array.isArray(result.deletedIds)
        ? result.deletedIds
        : payload.deletes;
      let removedBill = false;
      setRows((currentRows) => {
        if (result.bill)
          return reconcileLogisticsExpenseMutationRows(currentRows, {
            bill: result.bill,
          });
        const reconciliation = reconcileLogisticsExpenseRowsAfterBatchSave(
          currentRows,
          expense.id,
          savedRows,
          deletedIds,
        );
        removedBill = reconciliation.removedBill;
        return reconciliation.rows;
      });
      if (removedBill) setTotal((current) => Math.max(0, current - 1));
      setNotice(result.message || "✓ 已保存");
      return { bill: result.bill, items: savedRows, deletedIds };
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存本账单明细失败",
      );
      return null;
    } finally {
      setBusyId("");
      setSavingBillId("");
    }
  }

  async function deleteExpense(expense: LogisticsExpense) {
    const blockReason = logisticsExpenseDeleteBlockReason(expense);
    if (blockReason) {
      setError(blockReason);
      setNotice("");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "删除物流费用明细",
      message: "确定删除这条费用明细吗？删除后不可恢复。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `费用：${logisticsCostTypeLabel(expense.costType || "") || "-"} ${formatOriginalCurrencyAccounting(expense.currency || "CNY", expense.amount || 0)}`,
      ],
      confirmLabel: "确认删除",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setDeletingId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/logistics-expenses/${encodeURIComponent(expense.id)}`,
        {
          method: "DELETE",
        },
      );
      if (result.success !== true) {
        throw new Error(result.message || "删除物流费用明细失败");
      }
      const removal = removeLogisticsExpenseFromRows(rows, expense.id);
      setRows(removal.rows);
      if (removal.removedBill) setTotal((current) => Math.max(0, current - 1));
      await loadStatement(statementMonth);
      setNotice("已删除");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "删除物流费用明细失败",
      );
    } finally {
      setBusyId("");
      setDeletingId("");
    }
  }

  async function withdrawExpense(expense: LogisticsExpense) {
    const items = logisticsExpenseBillItems(expense);
    const confirmationResult = await requestConfirmation({
      title: "确认撤回该物流费用账单？",
      message:
        "撤回后该账单下所有费用明细将同步回草稿，供应商可继续修改后重新提交。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `明细：${items.length} 项`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(items))}`,
      ],
      confirmLabel: "撤回账单",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "withdraw" }),
        },
      );
      if (result.success !== true)
        throw new Error(result.message || "撤回物流费用账单失败");
      applyLogisticsExpenseMutationResult(result);
      await loadStatement(statementMonth);
      setNotice(result.message || "物流费用账单已撤回为草稿");
    } catch (withdrawError) {
      setError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "撤回物流费用账单失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function submitDraftExpenseBill(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const items = logisticsExpenseBillItems(expense);
    const billAuditStatus = logisticsExpenseBillAuditStatus(items);
    if (!logisticsExpenseBillIsEditable(billAuditStatus)) {
      setError("只有草稿或已驳回的物流费用账单可以提交审核");
      setNotice("");
      return;
    }
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<
        LogisticsExpenseMutationResult & {
          updatedIds?: string[];
          submittedAt?: string;
        }
      >(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "submitBill" }),
        timeoutMs: 10000,
      });
      if (result.success !== true)
        throw new Error(result.message || "提交物流费用审核失败");
      if (
        result.bill ||
        result.bills?.length ||
        result.expenses?.length ||
        result.expense
      ) {
        applyLogisticsExpenseMutationResult(result);
      } else {
        const updatedIds =
          Array.isArray(result.updatedIds) && result.updatedIds.length
            ? result.updatedIds
            : items.map((item) => item.id);
        setRows((currentRows) =>
          markLogisticsExpenseBillSubmitted(
            currentRows,
            expense.id,
            updatedIds,
            result.submittedAt,
          ),
        );
      }
      setSelectedBillIds((current) =>
        current.filter((id) => id !== expense.id),
      );
      setNotice(result.message || "物流费用已提交审核");
    } catch (submitError) {
      const message =
        submitError instanceof ApiRequestError && submitError.status === 408
          ? "提交超时，请重试"
          : submitError instanceof Error
            ? submitError.message
            : "提交物流费用审核失败";
      setError(`提交失败：${message}`);
    } finally {
      setBusyId("");
    }
  }

  async function rejectExpense(expense: LogisticsExpense) {
    const confirmationResult = await requestConfirmation({
      title: "驳回物流费用账单",
      message: "请填写驳回原因，供应商将看到该原因并补充修改。",
      requireInput: true,
      inputLabel: "驳回原因",
      inputPlaceholder: "请输入需要供应商修改的内容",
      inputRequiredMessage: "请填写驳回原因。",
      confirmLabel: "确认驳回",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    const rejectReason = confirmationResult.inputValue || "";
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        expenses?: LogisticsExpense[];
        bill?: LogisticsExpense;
      }>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", rejectReason }),
      });
      if (result.success !== true)
        throw new Error(result.message || "驳回物流费用账单失败");
      const savedItems =
        Array.isArray(result.expenses) && result.expenses.length
          ? result.expenses
          : result.bill?.items || [];
      setRows((currentRows) =>
        savedItems.length
          ? replaceLogisticsExpenseItemsInRows(currentRows, savedItems)
          : markLogisticsExpenseBillRejected(
              currentRows,
              expense.id,
              rejectReason,
            ),
      );
      setSelectedBillIds((current) =>
        current.filter((id) => id !== expense.id),
      );
      setNotice(result.message || "物流费用账单已驳回");
    } catch (rejectError) {
      setError(
        rejectError instanceof Error
          ? rejectError.message
          : "驳回物流费用账单失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function resendInvoiceNotice(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "resendInvoiceNotice" }),
        },
      );
      if (result.success !== true)
        throw new Error(result.message || "重新发送开票通知失败");
      applyLogisticsExpenseMutationResult(result);
      setNotice(result.message || "开票通知已重新发送");
    } catch (noticeError) {
      setError(
        noticeError instanceof Error
          ? noticeError.message
          : "重新发送开票通知失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function markExpenseBillPaid(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const payState = logisticsExpensePayButtonState(expense);
    if (!payState.canMarkPaid) {
      setError(PAY_BUTTON_DISABLED_TOOLTIP);
      setNotice("");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "标记物流费用为已付款？",
      message: "确认后该账单付款状态将更新为已付款，并同步关联成本付款状态。",
      requireInput: true,
      inputType: "date",
      inputLabel: "付款时间",
      inputValue: expense.paymentDate || todayInputInChinaClient(),
      inputRequiredMessage: "请选择付款时间。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(logisticsExpenseBillItems(expense)))}`,
      ],
      confirmLabel: "标记已付款",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "markPaid",
            paymentStatus: "已付款",
            paymentDate: confirmationResult.inputValue,
          }),
        },
      );
      if (result.success !== true)
        throw new Error(result.message || "标记已付款失败");
      applyLogisticsExpenseMutationResult(result);
      await loadStatement(statementMonth);
      setNotice(result.message || "物流费用已标记为已付款");
    } catch (paymentError) {
      setError(
        paymentError instanceof Error ? paymentError.message : "标记已付款失败",
      );
    } finally {
      setBusyId("");
    }
  }

  async function loadStatement(month = statementMonth) {
    setStatementLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      const result = await apiJson<{ rows: LogisticsStatementRow[] }>(
        `/api/logistics-costs/statement${params.size ? `?${params}` : ""}`,
      );
      setStatementRows(Array.isArray(result.rows) ? result.rows : []);
    } catch (statementError) {
      setError(
        statementError instanceof Error
          ? statementError.message
          : "读取月结汇总失败",
      );
    } finally {
      setStatementLoading(false);
    }
  }

  function exportStatementCsv() {
    const header = [
      "月结月份",
      "供应商",
      "订单数",
      "应付金额",
      "待付款金额",
      "已付款金额",
    ];
    const body = statementRows.map((row) => [
      statementMonth,
      row.supplierName || "-",
      String(row.orderCount || 0),
      logisticsCurrencySummaryPlainText(statementRowSummary(row, "approved")),
      logisticsCurrencySummaryPlainText(
        statementRowSummary(row, "pendingPayment"),
      ),
      logisticsCurrencySummaryPlainText(statementRowSummary(row, "paid")),
    ]);
    const csv = [header, ...body]
      .map((line) => line.map(csvCell).join(","))
      .join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `物流费用月结_${statementMonth || "全部"}.csv`);
    setNotice("物流费用月结对账单已开始导出");
  }

  return (
    <section
      id={sectionId || undefined}
      className={`${embedded ? styles.subModuleCard : styles.moduleCard} ${styles.logisticsTypographyScope}`}
    >
      <div className={styles.moduleHeader}>
        <div>
          <h2>{title}</h2>
        </div>
        <div className={styles.headerActions}>
          {canCreateExpense ? (
            <button
              className={styles.primaryButtonCompact}
              type="button"
              onClick={() => {
                setNotice("");
                setCreateOpen((open) => !open);
              }}
            >
              {createOpen ? "收起登记" : "新增物流费用"}
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadExpenses(page);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {createOpen ? (
        <LogisticsExpenseForm
          currentUserRole={currentUserRole}
          currentUserSupplierId={currentUserSupplierId}
          onCancel={() => setCreateOpen(false)}
          onSaved={(message) => {
            setCreateOpen(false);
            setExpandedId("");
            setNotice(message || "物流费用已保存");
            void loadExpenses(1, submittedKeyword, status, costType);
            void loadStatement(statementMonth);
          }}
        />
      ) : null}

      <div className={styles.statementPanel}>
        <div className={styles.statementHeader}>
          <div>
            <strong>月结汇总</strong>
            <span>按审核通过日期统计供应商应付、开票和付款状态。</span>
          </div>
          <div className={styles.statementActions}>
            <input
              value={statementMonth}
              onChange={(event) => setStatementMonth(event.target.value)}
              type="month"
            />
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={statementLoading}
              onClick={() => loadStatement(statementMonth)}
            >
              {statementLoading ? "汇总中..." : "查询月结"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={!statementRows.length}
              onClick={exportStatementCsv}
            >
              导出对账单
            </button>
          </div>
        </div>
        <MonthlySummaryComponent rows={statementRows} />
        <SupplierSectionComponent
          rows={statementRows}
          loading={statementLoading}
        />
      </div>

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 供应商"
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setNotice("");
            void loadExpenses(
              1,
              submittedKeyword,
              event.target.value,
              costType,
            );
          }}
        >
          {AUDIT_FILTERS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={costType}
          onChange={(event) => {
            setCostType(event.target.value);
            setNotice("");
            void loadExpenses(1, submittedKeyword, status, event.target.value);
          }}
        >
          <option value="">全部费用类型</option>
          {COST_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className={styles.primaryButtonCompact}
          type="button"
          onClick={submitSearch}
          disabled={loading}
        >
          查询
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={resetSearch}
          disabled={loading}
        >
          重置
        </button>
        {canReviewExpense ? (
          <button
            className={styles.billSaveButton}
            type="button"
            disabled={
              !selectedReviewableRows.length || busyId === "__batch_review__"
            }
            onClick={() => void reviewSelectedBills()}
          >
            {busyId === "__batch_review__"
              ? "审核中..."
              : `合并审核 / 批量审核${selectedReviewableRows.length ? `（${selectedReviewableRows.length}）` : ""}`}
          </button>
        ) : null}
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <LogisticsExpenseBillTable
        rows={rows}
        loading={loading}
        canReviewExpense={canReviewExpense}
        hasReviewableRows={Boolean(reviewableRows.length)}
        allReviewableSelected={allReviewableSelected}
        selectedBillIds={selectedBillIds}
        expandedId={expandedId}
        onToggleAllReviewableBills={toggleAllReviewableBills}
        onOpen={(expense) => setExpandedId(expense.id)}
        onSelectBill={toggleBillSelection}
      />

      <PaginationBar
        total={total}
        page={page}
        totalPages={totalPages}
        loading={loading}
        onPage={(nextPage) => {
          setExpandedId("");
          setNotice("");
          void loadExpenses(nextPage, submittedKeyword, status, costType);
        }}
      />
      {activeExpense ? (
        <LogisticsExpenseRows
          key={activeExpense.id}
          expense={activeExpense}
          busyId={busyId}
          deletingId={deletingId}
          saving={savingBillId === activeExpense.id}
          onClose={() => setExpandedId("")}
          canReview={canReviewExpense}
          canWithdraw={isLogisticsSupplier}
          canEditAmount={isLogisticsSupplier}
          canUploadInvoice={
            isLogisticsSupplier || canConfirmInvoice || canReviewExpense
          }
          canMarkPaid={canConfirmInvoice}
          canSubmitDraft={canCreateExpense}
          canDeleteExpense={canCreateExpense}
          canShowSupplier={
            currentUserRole === "管理员" || currentUserRole === "财务"
          }
          onApprove={(item) =>
            void reviewExpenseBills(logisticsExpenseShipmentBillIds(item), item)
          }
          onReject={(item) => void rejectExpense(item)}
          onWithdraw={(item) => void withdrawExpense(item)}
          onResendInvoiceNotice={(item) => void resendInvoiceNotice(item)}
          onMarkPaid={(item) => void markExpenseBillPaid(item)}
          onSubmitDraft={(item) => void submitDraftExpenseBill(item)}
          onSaveDetails={(payload) => saveBillDetails(activeExpense, payload)}
          onValidationError={(message) => {
            setError(message);
            setNotice("");
          }}
          onInvoiceUploaded={(result) => {
            applyLogisticsExpenseMutationResult(result);
            setNotice(result.message || "物流发票已上传");
            void loadStatement(statementMonth);
          }}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={cancelConfirmation}
          onConfirm={confirmConfirmation}
          onInputChange={updateConfirmationInput}
        />
      ) : null}
    </section>
  );
}
