"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import {
  ConfirmationDialog,
  PaginationBar,
  useConfirmationDialog,
} from "../components";
import styles from "../WorkspaceShell.module.css";
import { LogisticsExpenseBillTable } from "./logistics-fees/bill-table";
import { LogisticsExpenseRows } from "./logistics-fees/details-drawer";
import { useLogisticsFeesBillActions } from "./logistics-fees/use-logistics-fees-bill-actions";
import { useLogisticsFeesStatement } from "./logistics-fees/use-logistics-fees-statement";
import { LogisticsFeesCreateForm } from "./logistics-fees/module-create-form";
import { LogisticsFeesModuleHeader } from "./logistics-fees/module-header";
import { LogisticsFeesStatementPanel } from "./logistics-fees/statement-panel";
import {
  AUDIT_FILTERS,
  COST_TYPE_OPTIONS,
  PAGE_SIZE,
  type LogisticsExpense,
  type LogisticsExpensesResponse,
} from "./logistics-fees/model";
import {
  logisticsExpenseBillCanApprove,
  logisticsExpenseSelectionSelected,
  logisticsExpenseShipmentBillIds,
  sortLogisticsExpenseBillsForDisplay,
} from "./logistics-fees/shared";

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
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const {
    statementMonth,
    setStatementMonth,
    statementRows,
    statementLoading,
    loadStatement,
    exportStatementCsv,
  } = useLogisticsFeesStatement({ setError, setNotice });
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

  const {
    busyId,
    deletingId,
    savingBillId,
    applyLogisticsExpenseMutationResult,
    reviewExpenseBills,
    reviewSelectedBills,
    saveBillDetails,
    withdrawExpense,
    submitDraftExpenseBill,
    rejectExpense,
    resendInvoiceNotice,
    markExpenseBillPaid,
  } = useLogisticsFeesBillActions({
    rows,
    setRows,
    setTotal,
    selectedReviewableRows,
    setSelectedBillIds,
    expandedId,
    setExpandedId,
    page,
    submittedKeyword,
    status,
    costType,
    statementMonth,
    loadExpenses,
    loadStatement,
    setError,
    setNotice,
    requestConfirmation,
  });

  return (
    <section
      id={sectionId || undefined}
      className={`${embedded ? styles.subModuleCard : styles.moduleCard} ${styles.logisticsTypographyScope}`}
    >
      <LogisticsFeesModuleHeader
        title={title}
        canCreateExpense={canCreateExpense}
        createOpen={createOpen}
        loading={loading}
        onToggleCreate={() => {
          setNotice("");
          setCreateOpen((open) => !open);
        }}
        onRefresh={() => {
          setNotice("");
          void loadExpenses(page);
        }}
      />

      <LogisticsFeesCreateForm
        open={createOpen}
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

      <LogisticsFeesStatementPanel
        statementMonth={statementMonth}
        setStatementMonth={setStatementMonth}
        statementRows={statementRows}
        statementLoading={statementLoading}
        loadStatement={loadStatement}
        exportStatementCsv={exportStatementCsv}
      />

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
            setNotice(result.message || "上传成功");
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
