"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, MoneyAmount, PaginationBar, useConfirmationDialog } from "../components";
import { formatAmount, formatCny, moneyText } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import { customerDisplayName, customerLegalName, downloadBlob, isPdfFile } from "../utils";
import styles from "../WorkspaceShell.module.css";
import { LOGISTICS_COST_TYPES } from "../../lib/platform/logistics-cost-types";

const PAGE_SIZE = 20;
const COST_TYPES = [...LOGISTICS_COST_TYPES];
const DEFAULT_BILLING_METHOD = "按柜";
const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
const LOGISTICS_FEE_SUPPLIER_TYPES = [
  "物流供应商",
  "报关供应商",
  "海运供应商",
  "港杂费用供应商",
  "LOGISTICS_SUPPLIER",
  "CUSTOMS_SUPPLIER",
  "FREIGHT_FORWARDER",
  "SHIPPING_SUPPLIER",
  "PORT_CHARGES_SUPPLIER",
];
const AUDIT_FILTERS = [
  { label: "全部审核状态", value: "" },
  { label: "草稿", value: "草稿" },
  { label: "待审核", value: "待审核" },
  { label: "审核通过", value: "审核通过" },
  { label: "已驳回", value: "已驳回" },
  { label: "待开票", value: "toInvoice" },
  { label: "已上传发票", value: "uploaded" },
  { label: "已确认发票", value: "confirmedInvoice" },
];
const PAYMENT_STATUSES = ["待开票", "已开票", "待付款", "已付款"];

type UserLite = {
  name?: string;
};

type DocumentLite = {
  id?: string;
  fileName?: string;
  originalFilename?: string;
  fileSize?: number;
  uploadedBy?: UserLite;
  uploadedAt?: string | null;
};

type LogisticsExpense = {
  id: string;
  isBill?: boolean;
  isTemporary?: boolean;
  itemCount?: number;
  items?: LogisticsExpense[];
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  supplierId?: string;
  supplierName?: string;
  supplierNames?: string[];
  supplierEmail?: string;
  costId?: string;
  costType?: string;
  currency?: string;
  exchangeRate?: number;
  amount?: number;
  amountCny?: number;
  containerType?: string;
  appliedContainerCount?: number | null;
  billingMethod?: string;
  billingQuantity?: number | null;
  containerScope?: string;
  order?: Partial<ExpenseOrderOption>;
  remark?: string;
  auditStatus?: string;
  invoiceStatus?: string;
  paymentStatus?: string;
  submittedAt?: string | null;
  reviewedBy?: UserLite;
  reviewedAt?: string | null;
  reviewRemark?: string;
  rejectReason?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  invoiceAmount?: number | "";
  invoiceRemark?: string;
  invoiceDocument?: DocumentLite | null;
  invoiceUploadedBy?: UserLite;
  invoiceUploadedAt?: string | null;
  invoiceConfirmedBy?: UserLite;
  invoiceConfirmedAt?: string | null;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
  sourceLabel?: string;
};

type LogisticsExpensesResponse = {
  rows: LogisticsExpense[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
};

type LogisticsStatementRow = {
  supplierId?: string;
  supplierName?: string;
  orderCount?: number;
  approvedAmountCny?: number;
  invoicedAmountCny?: number;
  pendingPaymentAmountCny?: number;
  paidAmountCny?: number;
};

type ExpenseOrderOption = {
  id: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  truckPlateNo?: string;
  cargoName?: string;
  containerCount?: number;
  containerNos?: string[];
  containerType?: string;
  containerTypes?: string[];
  transportItems?: Array<{
    id?: string;
    containerNo?: string;
    containerType?: string;
    sealNo?: string;
    truckPlateNo?: string;
    departureDate?: string;
    departurePlace?: string;
    arrivalPlace?: string;
    cargoName?: string;
  }>;
  logisticsSuppliers?: SupplierOption[];
};

type SupplierOption = {
  id: string;
  supplierName?: string;
  name?: string;
  supplierType?: string;
  allowLogisticsExpenseEntry?: boolean;
  allowedLogisticsCostTypes?: string[];
};

type ExpenseForm = {
  orderId: string;
  supplierId: string;
  items: ExpenseItemForm[];
};

type ExpenseItemForm = {
  costType: string;
  billingMethod: string;
  amount: string;
  appliedContainerCount: string;
  currency: string;
  exchangeRate: string;
  remark: string;
};

type LogisticsExpenseDraft = {
  costType: string;
  billingMethod: string;
  unitAmount: string;
  appliedContainerCount: string;
  remark: string;
};

type LogisticsExpenseBatchUpdateItem = {
  id: string;
  amount: number;
  billingMethod: string;
  billingQuantity: number;
  appliedContainerCount: number;
  remark: string;
};

type LogisticsExpenseBatchCreateItem = {
  expenseType: string;
  amount: number;
  billingMethod: string;
  billingQuantity: number;
  appliedContainerCount: number;
  remark: string;
};

type LogisticsExpenseBatchSavePayload = {
  groupKey: string;
  orderId?: string;
  updates: LogisticsExpenseBatchUpdateItem[];
  creates: LogisticsExpenseBatchCreateItem[];
  deletes: string[];
};

type LogisticsExpenseBatchSaveResult = {
  items: LogisticsExpense[];
  deletedIds: string[];
};

type LogisticsExpenseContainerSummary = {
  hasContainers: boolean;
  typeLines: string[];
  containerNoLines: string[];
  shortText: string;
};

const emptyExpenseItem = (): ExpenseItemForm => ({
  costType: "拖车费",
  billingMethod: "按柜",
  amount: "",
  appliedContainerCount: "1",
  currency: "CNY",
  exchangeRate: "1",
  remark: "",
});

const emptyExpenseForm: ExpenseForm = {
  orderId: "",
  supplierId: "",
  items: [emptyExpenseItem()],
};

export function LogisticsFeesModule({
  embedded = false,
  refreshToken = 0,
  currentUserRole = "",
  currentUserSupplierId = "",
  canCreateExpense: canCreateExpenseProp,
}: {
  embedded?: boolean;
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
  const [status, setStatus] = useState("");
  const [costType, setCostType] = useState("");
  const [statementMonth, setStatementMonth] = useState(new Date().toISOString().slice(0, 7));
  const [statementRows, setStatementRows] = useState<LogisticsStatementRow[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [savingBillId, setSavingBillId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canCreateExpense = canCreateExpenseProp ?? ["管理员", "物流供应商"].includes(currentUserRole);
  const canReviewExpense = currentUserRole === "管理员";
  const canConfirmInvoice = ["管理员", "财务"].includes(currentUserRole);
  const isLogisticsSupplier = currentUserRole === "物流供应商";

  async function loadExpenses(nextPage = page, nextKeyword = submittedKeyword, nextStatus = status, nextCostType = costType) {
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
      const result = await apiJson<LogisticsExpensesResponse>(`/api/logistics-costs?${params}`);
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setTotal(Number(result.total || 0));
      setPage(Number(result.page || nextPage));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取物流费用失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExpenses(1, "", "", "");
    void loadStatement(statementMonth);
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    void loadExpenses(1, submittedKeyword, status, costType);
    void loadStatement(statementMonth);
  }, [refreshToken]);

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

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setExpandedId("");
    setNotice("");
    void loadExpenses(1, value, status, costType);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setStatus("");
    setCostType("");
    setExpandedId("");
    setNotice("");
    void loadExpenses(1, "", "", "");
  }

  async function patchExpense(expense: LogisticsExpense, body: Record<string, unknown>, fallback: string) {
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (result.success !== true) throw new Error(result.message || fallback);
      await loadExpenses(page, submittedKeyword, status, costType);
      await loadStatement(statementMonth);
      setNotice(result.message || logisticsActionSuccessMessage(body.action));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : fallback);
    } finally {
      setBusyId("");
    }
  }

  async function saveBillDetails(expense: LogisticsExpense, payload: LogisticsExpenseBatchSavePayload): Promise<LogisticsExpenseBatchSaveResult | null> {
    if (!payload.updates.length && !payload.creates.length && !payload.deletes.length) {
      setNotice("没有需要保存的修改");
      return null;
    }
    setBusyId(expense.id);
    setSavingBillId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; items?: LogisticsExpense[]; rows?: LogisticsExpense[]; deletedIds?: string[]; message?: string }>("/api/logistics-expenses/batch-save", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (result.success !== true) throw new Error(result.message || "保存本账单明细失败");
      const savedRows = Array.isArray(result.items) ? result.items : (Array.isArray(result.rows) ? result.rows : []);
      const deletedIds = Array.isArray(result.deletedIds) ? result.deletedIds : payload.deletes;
      const reconciliation = reconcileLogisticsExpenseRowsAfterBatchSave(rows, expense.id, savedRows, deletedIds);
      setRows(reconciliation.rows);
      if (reconciliation.removedBill) setTotal((current) => Math.max(0, current - 1));
      await loadStatement(statementMonth);
      setNotice(result.message || "✓ 已保存");
      return { items: savedRows, deletedIds };
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存本账单明细失败");
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
        `费用：${expense.costType || "-"} ${moneyText(expense.currency, expense.amount, expense.amountCny)}`,
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
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/logistics-expenses/${encodeURIComponent(expense.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除物流费用明细失败");
      const removal = removeLogisticsExpenseFromRows(rows, expense.id);
      setRows(removal.rows);
      if (removal.removedBill) setTotal((current) => Math.max(0, current - 1));
      await loadStatement(statementMonth);
      setNotice("已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除物流费用明细失败");
    } finally {
      setBusyId("");
      setDeletingId("");
    }
  }

  async function withdrawExpense(expense: LogisticsExpense) {
    const confirmationResult = await requestConfirmation({
      title: "确认撤回该物流费用？",
      message: "撤回后该费用不会进入成本管理和月结统计。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `费用：${expense.costType || "-"} ${moneyText(expense.currency, expense.amount, expense.amountCny)}`,
      ],
      confirmLabel: "撤回费用",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "撤回物流费用失败");
      setExpandedId("");
      await loadExpenses(page, submittedKeyword, status, costType);
      await loadStatement(statementMonth);
      setNotice(result.message || "物流费用已撤回");
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : "撤回物流费用失败");
    } finally {
      setBusyId("");
    }
  }

  async function rejectExpense(expense: LogisticsExpense) {
    const confirmationResult = await requestConfirmation({
      title: "驳回物流费用",
      message: "请填写驳回原因，供应商将看到该原因并补充修改。",
      requireInput: true,
      inputLabel: "驳回原因",
      inputPlaceholder: "请输入驳回原因",
      inputRequiredMessage: "请填写驳回原因。",
      confirmLabel: "确认驳回",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    await patchExpense(expense, { action: "reject", rejectReason: confirmationResult.inputValue || "" }, "驳回物流费用失败");
  }

  async function confirmExpenseInvoice(expense: LogisticsExpense) {
    const body: Record<string, unknown> = { action: "confirmInvoice" };
    if (Number(expense.invoiceAmount || 0) > Number(expense.amount || 0)) {
      const confirmationResult = await requestConfirmation({
        title: "确认物流发票",
        message: "发票金额大于审核通过金额，请填写强制确认原因。",
        requireInput: true,
        inputLabel: "强制确认原因",
        inputPlaceholder: "请说明仍需确认该发票的原因",
        inputRequiredMessage: "请填写强制确认原因。",
        confirmLabel: "确认发票",
        cancelLabel: "取消",
        variant: "warning",
      });
      if (!confirmationResult.confirmed) return;
      body.forceConfirmReason = confirmationResult.inputValue || "";
    }
    await patchExpense(expense, body, "确认物流发票失败");
  }

  async function loadStatement(month = statementMonth) {
    setStatementLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      const result = await apiJson<{ rows: LogisticsStatementRow[] }>(`/api/logistics-costs/statement${params.size ? `?${params}` : ""}`);
      setStatementRows(Array.isArray(result.rows) ? result.rows : []);
    } catch (statementError) {
      setError(statementError instanceof Error ? statementError.message : "读取月结汇总失败");
    } finally {
      setStatementLoading(false);
    }
  }

  function exportStatementCsv() {
    const header = ["月结月份", "供应商", "订单数", "审核通过金额", "已开票金额", "待付款金额", "已付款金额"];
    const body = statementRows.map((row) => [
      statementMonth,
      row.supplierName || "-",
      String(row.orderCount || 0),
      String(Number(row.approvedAmountCny || 0).toFixed(2)),
      String(Number(row.invoicedAmountCny || 0).toFixed(2)),
      String(Number(row.pendingPaymentAmountCny || 0).toFixed(2)),
      String(Number(row.paidAmountCny || 0).toFixed(2)),
    ]);
    const csv = [header, ...body].map((line) => line.map(csvCell).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `物流费用月结_${statementMonth || "全部"}.csv`);
    setNotice("物流费用月结对账单已开始导出");
  }

  const statementTotals = statementRows.reduce((acc, row) => {
    acc.approved += Number(row.approvedAmountCny || 0);
    acc.invoiced += Number(row.invoicedAmountCny || 0);
    acc.pending += Number(row.pendingPaymentAmountCny || 0);
    acc.paid += Number(row.paidAmountCny || 0);
    return acc;
  }, { approved: 0, invoiced: 0, pending: 0, paid: 0 });

  return (
    <section className={`${embedded ? styles.subModuleCard : styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>物流费用录入</h2>
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
            <button className={styles.secondaryButton} type="button" disabled={statementLoading} onClick={() => loadStatement(statementMonth)}>
              {statementLoading ? "汇总中..." : "查询月结"}
            </button>
            <button className={styles.secondaryButton} type="button" disabled={!statementRows.length} onClick={exportStatementCsv}>
              导出对账单
            </button>
          </div>
        </div>
        <div className={styles.statementMetrics}>
          <div><span>应付总额</span><strong>{formatCny(statementTotals.approved)}</strong></div>
          <div><span>已开票</span><strong>{formatCny(statementTotals.invoiced)}</strong></div>
          <div><span>待付款</span><strong>{formatCny(statementTotals.pending)}</strong></div>
          <div><span>已付款</span><strong>{formatCny(statementTotals.paid)}</strong></div>
        </div>
        {statementRows.length ? (
          <div className={styles.statementList}>
            {statementRows.map((row) => (
              <div key={row.supplierId || row.supplierName || "-"} className={styles.statementRow}>
                <strong>{row.supplierName || "-"}</strong>
                <span>{row.orderCount || 0} 票</span>
                <span>应付 {formatCny(row.approvedAmountCny || 0)}</span>
                <span>待付 {formatCny(row.pendingPaymentAmountCny || 0)}</span>
                <span>已付 {formatCny(row.paidAmountCny || 0)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.mutedText}>{statementLoading ? "月结汇总加载中..." : "当前月份暂无已审核物流费用。"}</p>
        )}
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
        <select value={status} onChange={(event) => { setStatus(event.target.value); setNotice(""); void loadExpenses(1, submittedKeyword, event.target.value, costType); }}>
          {AUDIT_FILTERS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <select value={costType} onChange={(event) => { setCostType(event.target.value); setNotice(""); void loadExpenses(1, submittedKeyword, status, event.target.value); }}>
          <option value="">全部费用类型</option>
          {COST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.containerTypeColumn}>柜型</th>
              <th className={styles.blNoColumn}>提单号</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th className={styles.amountColumn}>费用合计</th>
              <th>审核状态</th>
              <th>发票状态</th>
              <th>付款状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}><div className={styles.emptyState}>数据加载中...</div></td></tr>
            ) : rows.length ? rows.map((expense) => (
              <LogisticsExpenseRows
                key={expense.id}
                expense={expense}
                expanded={expandedId === expense.id}
                busyId={busyId}
                deletingId={deletingId}
                saving={savingBillId === expense.id}
                onToggle={() => setExpandedId((current) => current === expense.id ? "" : expense.id)}
                canReview={canReviewExpense}
                canConfirmInvoice={canConfirmInvoice}
                canWithdraw={isLogisticsSupplier}
                canEditAmount={isLogisticsSupplier}
                canDeleteExpense={canCreateExpense}
                canShowSupplier={currentUserRole === "管理员" || currentUserRole === "财务"}
                onApprove={(item) => void patchExpense(item, { action: "approve" }, "审核物流费用失败")}
                onReject={(item) => void rejectExpense(item)}
                onWithdraw={(item) => void withdrawExpense(item)}
                onSaveDetails={(payload) => saveBillDetails(expense, payload)}
                onValidationError={(message) => {
                  setError(message);
                  setNotice("");
                }}
                onMarkPaid={(item) => void patchExpense(item, { action: "paymentStatus", paymentStatus: "已付款" }, "更新付款状态失败")}
                onConfirmInvoice={(item) => void confirmExpenseInvoice(item)}
                onInvoiceUploaded={() => {
                  setNotice("物流发票已上传");
                  void loadExpenses(page, submittedKeyword, status, costType);
                  void loadStatement(statementMonth);
                }}
              />
            )) : (
              <tr><td colSpan={9}><div className={styles.emptyState}>未找到匹配的物流费用</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={(nextPage) => {
        setExpandedId("");
        setNotice("");
        void loadExpenses(nextPage, submittedKeyword, status, costType);
      }} />
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

function LogisticsExpenseRows({
  expense,
  expanded,
  busyId,
  deletingId,
  saving,
  onToggle,
  onApprove,
  onReject,
  onWithdraw,
  onSaveDetails,
  onValidationError,
  onMarkPaid,
  onConfirmInvoice,
  onInvoiceUploaded,
  canReview,
  canConfirmInvoice,
  canWithdraw,
  canEditAmount,
  canDeleteExpense,
  canShowSupplier,
}: {
  expense: LogisticsExpense;
  expanded: boolean;
  busyId: string;
  deletingId: string;
  saving: boolean;
  onToggle: () => void;
  canReview: boolean;
  canConfirmInvoice: boolean;
  canWithdraw: boolean;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  canShowSupplier: boolean;
  onApprove: (expense: LogisticsExpense) => void;
  onReject: (expense: LogisticsExpense) => void;
  onWithdraw: (expense: LogisticsExpense) => void;
  onSaveDetails: (payload: LogisticsExpenseBatchSavePayload) => Promise<LogisticsExpenseBatchSaveResult | null>;
  onValidationError: (message: string) => void;
  onMarkPaid: (expense: LogisticsExpense) => void;
  onConfirmInvoice: (expense: LogisticsExpense) => void;
  onInvoiceUploaded: () => void;
}) {
  const auditStatus = expense.auditStatus || "草稿";
  const invoiceStatus = expense.invoiceStatus || "未通知";
  const paymentStatus = expense.paymentStatus || "待开票";
  const items = expense.items?.length ? expense.items : [expense];
  const supplierNames = expense.supplierNames?.length ? expense.supplierNames : [...new Set(items.map((item) => item.supplierName).filter(Boolean))];
  const containerSummary = logisticsExpenseContainerSummary(expense, items);
  const itemsSignature = items.map(logisticsExpenseDraftSignature).join("|");
  const [drafts, setDrafts] = useState<Record<string, LogisticsExpenseDraft>>(() => logisticsExpenseDraftsFromItems(items));
  const [newExpenseRows, setNewExpenseRows] = useState<LogisticsExpense[]>([]);
  const [deletedExpenseIds, setDeletedExpenseIds] = useState<string[]>([]);
  const [billSaved, setBillSaved] = useState(false);
  useEffect(() => {
    setDrafts(logisticsExpenseDraftsFromItems(items));
    setNewExpenseRows([]);
    setDeletedExpenseIds([]);
  }, [itemsSignature]);
  const persistedEditingRows = items.filter((item) => !deletedExpenseIds.includes(item.id));
  const editingExpenseRows = [...persistedEditingRows, ...newExpenseRows];
  const changedItems = persistedEditingRows.filter((item) => logisticsExpenseDraftChanged(item, drafts[item.id]));
  const hasDirtyChanges = changedItems.length > 0;
  const hasPendingCreates = newExpenseRows.length > 0;
  const hasPendingDeletes = deletedExpenseIds.length > 0;
  const hasPendingChanges = hasDirtyChanges || hasPendingCreates || hasPendingDeletes;
  const editedBillTotalCny = editingExpenseRows.reduce((sum, item) => sum + logisticsExpenseDraftAmountCny(item, drafts[item.id]), 0);

  function updateDraft(id: string, field: keyof LogisticsExpenseDraft, value: string) {
    setBillSaved(false);
    setDrafts((current) => {
      const currentDraft = current[id] || logisticsExpenseDraftFromItem(items.find((item) => item.id === id) || ({ id } as LogisticsExpense));
      const nextDraft = {
        ...currentDraft,
        [field]: value,
      };
      return {
        ...current,
        [id]: nextDraft,
      };
    });
  }

  function addExpenseDetailRow() {
    const temporaryRow = createTemporaryLogisticsExpenseRow(expense, items, newExpenseRows.length);
    setNewExpenseRows((current) => [...current, temporaryRow]);
    setDrafts((current) => ({
      ...current,
      [temporaryRow.id]: logisticsExpenseDraftFromItem(temporaryRow),
    }));
    setBillSaved(false);
  }

  function stageDeleteExpenseDetail(row: LogisticsExpense) {
    if (row.isTemporary) {
      setNewExpenseRows((current) => current.filter((item) => item.id !== row.id));
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setBillSaved(false);
      return;
    }
    const blockReason = logisticsExpenseDeleteBlockReason(row);
    if (blockReason) {
      onValidationError(blockReason);
      return;
    }
    setDeletedExpenseIds((current) => current.includes(row.id) ? current : [...current, row.id]);
    setBillSaved(false);
  }

  async function handleSaveBillDetails() {
    const invalidIndex = editingExpenseRows.findIndex((item) => {
      const draft = drafts[item.id];
      return (item.isTemporary || logisticsExpenseDraftChanged(item, draft)) && !validLogisticsExpenseDraft(draft, item.isTemporary);
    });
    if (invalidIndex >= 0) {
      const item = editingExpenseRows[invalidIndex];
      const validationMessage = logisticsExpenseDraftValidationMessage(item, drafts[item.id], invalidIndex);
      onValidationError(validationMessage);
      return;
    }
    const payload: LogisticsExpenseBatchSavePayload = {
      groupKey: expense.id,
      orderId: expense.orderId,
      updates: changedItems.map((item) => logisticsExpenseDraftPayload(item, drafts[item.id])),
      creates: newExpenseRows.map((item) => logisticsExpenseDraftCreatePayload(item, drafts[item.id])),
      deletes: deletedExpenseIds,
    };
    const saved = await onSaveDetails(payload);
    if (saved) {
      setNewExpenseRows([]);
      setDeletedExpenseIds([]);
      setBillSaved(true);
    }
  }

  function renderBillSaveControls() {
    if (!canEditAmount) return null;
    return (
      <>
        <span className={`${styles.saveStateBadge} ${hasPendingChanges ? styles.saveStateDirty : (billSaved ? styles.saveStateSaved : "")}`}>
          {hasPendingChanges ? "● 有未保存修改" : (billSaved ? "✓ 已保存" : "")}
        </span>
        <button
          className={styles.billAddLineButton}
          type="button"
          disabled={saving}
          onClick={(event) => {
            event.stopPropagation();
            addExpenseDetailRow();
          }}
        >
          + 新增费用明细
        </button>
        <button
          className={styles.billSaveButton}
          type="button"
          disabled={!hasPendingChanges || saving}
          onClick={(event) => {
            event.stopPropagation();
            void handleSaveBillDetails();
          }}
        >
          {saving ? "保存中..." : "保存本账单明细"}
        </button>
      </>
    );
  }
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td className={styles.orderNoColumn}><strong>{expense.orderNo || "-"}</strong></td>
        <td className={styles.containerTypeColumn}>{containerSummary.shortText}</td>
        <td className={styles.blNoColumn}>{expense.blNo || expense.billOfLadingNo || "-"}</td>
        <td className={styles.customerColumn} title={customerLegalName(expense)}>{customerDisplayName(expense)}</td>
        <td className={styles.amountColumn}>
          <MoneyAmount amountCny={expense.amountCny || 0} />
        </td>
        <td><StatusPill value={auditStatus} /></td>
        <td><StatusPill value={invoiceStatus} /></td>
        <td><StatusPill value={paymentStatus} /></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={9}>
            <div className={styles.logisticsBillDetail} onClick={(event) => event.stopPropagation()}>
              <div className={styles.logisticsBillSummary}>
                <div className={styles.logisticsBillSummaryMeta}>
	                  <span><strong>客户全称</strong>{customerLegalName(expense)}</span>
	                  <span><strong>提单号</strong>{expense.blNo || expense.billOfLadingNo || "-"}</span>
	                  <span><strong>费用明细</strong>{editingExpenseRows.length} 项</span>
	                  <span><strong>账单合计</strong>{formatCny(hasPendingChanges ? editedBillTotalCny : (expense.amountCny || 0))}</span>
                  {canShowSupplier && supplierNames.length ? (
                    <span><strong>供应商</strong>{supplierNames.join(" / ")}</span>
                  ) : null}
                </div>
                <div className={styles.logisticsBillSummaryActions}>
                  {renderBillSaveControls()}
                </div>
              </div>
              <LogisticsBillContainerInfo summary={containerSummary} />
              <LogisticsExpenseDetailsTable
                items={editingExpenseRows}
                drafts={drafts}
                busyId={busyId}
                deletingId={deletingId}
                canReview={canReview}
                canConfirmInvoice={canConfirmInvoice}
                canWithdraw={canWithdraw}
                canEditAmount={canEditAmount}
                canDeleteExpense={canDeleteExpense}
                onApprove={onApprove}
                onReject={onReject}
                onWithdraw={onWithdraw}
                onDraftChange={updateDraft}
                onStageDelete={stageDeleteExpenseDetail}
                onMarkPaid={onMarkPaid}
                onConfirmInvoice={onConfirmInvoice}
                onInvoiceUploaded={onInvoiceUploaded}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function LogisticsBillContainerInfo({ summary }: { summary: LogisticsExpenseContainerSummary }) {
  return (
    <div className={styles.logisticsContainerInfoCard}>
      <div className={styles.logisticsContainerInfoHeader}>
        <strong>集装箱信息</strong>
        {!summary.hasContainers ? <span>未录入集装箱信息</span> : null}
      </div>
      {summary.hasContainers ? (
        <div className={styles.logisticsContainerInfoGrid}>
          <div>
            <strong>柜型汇总：</strong>
            <div className={styles.logisticsContainerInfoList}>
              {summary.typeLines.length ? summary.typeLines.map((line) => <span key={line}>{line}</span>) : <span>未录入柜型</span>}
            </div>
          </div>
          <div>
            <strong>柜号列表：</strong>
            <div className={styles.logisticsContainerInfoList}>
              {summary.containerNoLines.length ? summary.containerNoLines.map((line) => <span key={line}>{line}</span>) : <span>未录入柜号</span>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LogisticsExpenseDetailsTable({
  items,
  drafts,
  busyId,
  deletingId,
  canReview,
  canConfirmInvoice,
  canWithdraw,
  canEditAmount,
  canDeleteExpense,
  onApprove,
  onReject,
  onWithdraw,
  onDraftChange,
  onStageDelete,
  onMarkPaid,
  onConfirmInvoice,
  onInvoiceUploaded,
}: {
  items: LogisticsExpense[];
  drafts: Record<string, LogisticsExpenseDraft>;
  busyId: string;
  deletingId: string;
  canReview: boolean;
  canConfirmInvoice: boolean;
  canWithdraw: boolean;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onApprove: (expense: LogisticsExpense) => void;
  onReject: (expense: LogisticsExpense) => void;
  onWithdraw: (expense: LogisticsExpense) => void;
  onDraftChange: (id: string, field: keyof LogisticsExpenseDraft, value: string) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
  onMarkPaid: (expense: LogisticsExpense) => void;
  onConfirmInvoice: (expense: LogisticsExpense) => void;
	onInvoiceUploaded: () => void;
}) {
  return (
    <div className={styles.logisticsDetailTableWrap}>
      <table className={styles.logisticsDetailTable}>
        <thead>
          <tr>
            <th>序号</th>
            <th>费用类型</th>
            <th>适用数量</th>
            <th className={styles.numericCell}>单价/金额</th>
            <th className={styles.numericCell}>折人民币</th>
            <th>备注</th>
            <th>同步成本状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((expense, index) => (
            <LogisticsExpenseDetailLine
              key={expense.id || `${expense.orderId || "expense"}-${index}`}
              expense={expense}
              draft={drafts[expense.id] || logisticsExpenseDraftFromItem(expense)}
	              index={index}
	              busy={busyId === expense.id}
	              deleting={deletingId === expense.id}
	              canReview={canReview}
              canConfirmInvoice={canConfirmInvoice}
              canWithdraw={canWithdraw}
              canEditAmount={canEditAmount}
              canDeleteExpense={canDeleteExpense}
              onApprove={onApprove}
              onReject={onReject}
              onWithdraw={onWithdraw}
              onDraftChange={onDraftChange}
              onStageDelete={onStageDelete}
              onMarkPaid={onMarkPaid}
              onConfirmInvoice={onConfirmInvoice}
              onInvoiceUploaded={onInvoiceUploaded}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogisticsExpenseDetailLine({
  expense,
  draft,
	  index,
	  busy,
	  deleting,
	  canReview,
  canConfirmInvoice,
  canWithdraw,
  canEditAmount,
  canDeleteExpense,
  onApprove,
  onReject,
  onWithdraw,
  onDraftChange,
  onStageDelete,
  onMarkPaid,
  onConfirmInvoice,
  onInvoiceUploaded,
}: {
	  expense: LogisticsExpense;
	  draft: LogisticsExpenseDraft;
	  index: number;
	  busy: boolean;
	  deleting: boolean;
  canReview: boolean;
  canConfirmInvoice: boolean;
  canWithdraw: boolean;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onApprove: (expense: LogisticsExpense) => void;
  onReject: (expense: LogisticsExpense) => void;
  onWithdraw: (expense: LogisticsExpense) => void;
  onDraftChange: (id: string, field: keyof LogisticsExpenseDraft, value: string) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
  onMarkPaid: (expense: LogisticsExpense) => void;
  onConfirmInvoice: (expense: LogisticsExpense) => void;
  onInvoiceUploaded: () => void;
}) {
  const auditStatus = expense.auditStatus || "草稿";
  const invoiceStatus = expense.invoiceStatus || "未通知";
  const paymentStatus = expense.paymentStatus || "待开票";
  const editBlockReason = logisticsExpenseEditBlockReason(expense);
  const canEditThisAmount = canEditAmount && !editBlockReason;
  const shouldRenderRemarkInput = canEditAmount || auditStatus === "审核通过";
  const editedSubtotal = editableLineSubtotal(draft.unitAmount, draft.appliedContainerCount);
  const editedAmountCny = editedSubtotal * Number(expense.exchangeRate || 1);
  const canUploadInvoice = auditStatus === "审核通过" && ["未通知", "已通知开票"].includes(invoiceStatus);
  const deleteBlockReason = logisticsExpenseDeleteBlockReason(expense);
  return (
    <tr>
      <td className={styles.indexCell}>{index + 1}</td>
      <td>
        {expense.isTemporary ? (
          <select
            className={styles.inlineCostTypeSelect}
            value={draft.costType}
            onChange={(event) => onDraftChange(expense.id, "costType", event.target.value)}
            aria-label="费用类型"
          >
            {COST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        ) : (
          expense.costType || "-"
        )}
	      </td>
      <td>
        {canEditThisAmount ? (
          <input
            className={styles.inlineQuantityInput}
	            type="number"
	            min="1"
	            step="1"
	            value={draft.appliedContainerCount}
	            onChange={(event) => onDraftChange(expense.id, "appliedContainerCount", event.target.value)}
	            aria-label="适用数量"
	          />
	        ) : (
	          editableQuantityText(expenseBillingQuantity(expense))
	        )}
      </td>
      <td className={styles.numericCell}>
        {canEditThisAmount ? (
          <div className={styles.inlineAmountEditor}>
            <input
              value={draft.unitAmount}
              onChange={(event) => onDraftChange(expense.id, "unitAmount", event.target.value)}
              inputMode="decimal"
              aria-label="物流费用单价"
            />
            <span>{expense.currency || "CNY"}</span>
          </div>
        ) : (
          expenseAmountText(expense)
        )}
      </td>
      <td className={styles.numericCell}>{formatCny(canEditThisAmount ? editedAmountCny : (expense.amountCny || 0))}</td>
      <td className={styles.remarkCell} title={draft.remark || expense.remark || ""}>
        {shouldRenderRemarkInput ? (
          <div className={styles.inlineRemarkCell}>
            <input
              className={styles.inlineRemarkInput}
              value={draft.remark}
              onChange={(event) => onDraftChange(expense.id, "remark", event.target.value)}
              disabled={!canEditThisAmount}
              placeholder="-"
              aria-label="物流费用备注"
            />
            {!canEditThisAmount && editBlockReason ? (
              <span className={styles.inlineEditHint}>{editBlockReason}</span>
            ) : null}
          </div>
        ) : (
          expense.remark || "-"
        )}
      </td>
      <td>
        <div className={styles.costSyncCell}>
          <span>{expenseCostSyncText(expense)}</span>
        </div>
      </td>
      <td>
        <div className={styles.compactDetailActions}>
          {auditStatus === "待审核" && canReview ? (
            <>
              <button className={styles.primaryButtonCompact} type="button" disabled={busy} onClick={() => onApprove(expense)}>{busy ? "处理中" : "通过"}</button>
              <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => onReject(expense)}>驳回</button>
            </>
          ) : null}
          {auditStatus === "待审核" && canWithdraw ? (
            <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => onWithdraw(expense)}>撤回</button>
          ) : null}
          {invoiceStatus === "已上传" && canConfirmInvoice ? (
            <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => onConfirmInvoice(expense)}>
              {busy ? "处理中" : "确认发票"}
            </button>
          ) : null}
          {invoiceStatus === "已确认" && canConfirmInvoice ? (
            <button className={styles.secondaryButton} type="button" disabled={busy || paymentStatus === "已付款"} onClick={() => onMarkPaid(expense)}>
              {paymentStatus === "已付款" ? "已付款" : "标记付款"}
            </button>
          ) : null}
          {canUploadInvoice ? (
            <div className={styles.compactInvoiceUpload}>
              <InvoiceUploadForm expense={expense} onUploaded={onInvoiceUploaded} />
            </div>
          ) : null}
          <button
            className={styles.logisticsLineDeleteButton}
            type="button"
            disabled={!canDeleteExpense || busy || deleting || (!expense.isTemporary && Boolean(deleteBlockReason))}
            title={!canDeleteExpense ? "无权限删除该费用明细" : (deleteBlockReason || "删除这条费用明细")}
            onClick={(event) => {
              event.stopPropagation();
              onStageDelete(expense);
            }}
          >
            {deleting ? "删除中..." : (expense.isTemporary ? "移除" : "删除")}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function LogisticsExpenseForm({
  onCancel,
  onSaved,
  initialOrder,
  currentUserRole = "",
  currentUserSupplierId = "",
}: {
  onCancel: () => void;
  onSaved: (message?: string) => void;
  initialOrder?: Partial<ExpenseOrderOption> | null;
  currentUserRole?: string;
  currentUserSupplierId?: string;
}) {
  const normalizedInitialOrder = initialOrder ? normalizeExpenseOrder(initialOrder) : null;
  const initialOrderId = normalizedInitialOrder?.id || "";
  const initialSuppliers = normalizedInitialOrder?.logisticsSuppliers || [];
  const isLockedSupplier = currentUserRole === "物流供应商" && Boolean(currentUserSupplierId);
  const [form, setForm] = useState<ExpenseForm>(() => ({
    ...emptyExpenseForm,
    orderId: initialOrderId,
    supplierId: isLockedSupplier ? currentUserSupplierId : (initialSuppliers.length === 1 ? initialSuppliers[0].id : ""),
    items: [emptyExpenseItem()],
  }));
  const [orders, setOrders] = useState<ExpenseOrderOption[]>(() => normalizedInitialOrder ? [normalizedInitialOrder] : []);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(() => initialSuppliers);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (initialOrder) {
      const order = normalizeExpenseOrder(initialOrder);
      const orderSuppliers = order.logisticsSuppliers || [];
      setOrders([order]);
      setSuppliers(orderSuppliers);
      setForm((current) => ({
        ...current,
        orderId: order.id,
        supplierId: isLockedSupplier
          ? currentUserSupplierId
          : (orderSuppliers.length === 1 ? orderSuppliers[0].id : (orderSuppliers.some((supplier) => supplier.id === current.supplierId) ? current.supplierId : "")),
      }));
    }
  }, [initialOrder, isLockedSupplier, currentUserSupplierId]);

  useEffect(() => {
    if (!isLockedSupplier) return;
    setForm((current) => ({ ...current, supplierId: currentUserSupplierId }));
  }, [isLockedSupplier, currentUserSupplierId]);

  async function searchOrders(nextKeyword: string) {
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<{ rows: ExpenseOrderOption[] }>(`/api/logistics-costs/orders${params.size ? `?${params}` : ""}`);
      const rows = (Array.isArray(result.rows) ? result.rows : []).map((order) => normalizeExpenseOrder(order));
      setOrders((current) => mergeOrders(current, rows));
      return rows;
    } catch (orderError) {
      setMessage(orderError instanceof Error ? orderError.message : "读取可录入订单失败");
      return [];
    }
  }

  async function searchSuppliers(nextKeyword: string) {
    setMessage("");
    const selected = orders.find((order) => order.id === form.orderId);
    const orderSuppliers = filterLogisticsFeeSuppliers(selected?.logisticsSuppliers || []);
    if (!selected) {
      setMessage("请先选择关联订单");
      return [];
    }
    setSuppliers((current) => mergeSuppliers(current, orderSuppliers));
    const keyword = nextKeyword.trim().toLowerCase();
    if (!keyword) return orderSuppliers;
    return orderSuppliers.filter((supplier) => [
      supplier.supplierName,
      supplier.name,
      supplier.supplierType,
    ].some((value) => String(value || "").toLowerCase().includes(keyword)));
  }

  function setField<K extends keyof ExpenseForm>(key: K, value: ExpenseForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

	  function setItemField<K extends keyof ExpenseItemForm>(index: number, key: K, value: ExpenseItemForm[K]) {
	    setForm((current) => ({
	      ...current,
	      items: current.items.map((item, itemIndex) => (
	        itemIndex === index
	          ? {
	              ...item,
	              [key]: value,
	              ...(key === "currency" && value === "CNY" ? { exchangeRate: "1" } : {}),
	            }
	          : item
	      )),
    }));
  }

  function addExpenseItem(copyLast = false) {
    setForm((current) => {
      const lastItem = current.items[current.items.length - 1];
      return {
        ...current,
        items: [
          ...current.items,
          copyLast && lastItem ? { ...lastItem, amount: "", remark: "" } : emptyExpenseItem(),
        ],
      };
    });
  }

  function removeExpenseItem(index: number) {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((_, itemIndex) => itemIndex !== index) : current.items,
    }));
  }

  function handleOrderSelect(order: ExpenseOrderOption) {
    const normalizedOrder = normalizeExpenseOrder(order);
    const orderSuppliers = filterLogisticsFeeSuppliers(normalizedOrder.logisticsSuppliers || []);
    const nextSupplierId = isLockedSupplier
      ? currentUserSupplierId
      : orderSuppliers.length === 1
      ? orderSuppliers[0].id
      : "";
    const nextSupplier = orderSuppliers.find((supplier) => supplier.id === nextSupplierId) || null;
    const nextCostTypes = allowedCostTypeOptions(nextSupplier, isLockedSupplier);
    setOrders((current) => mergeOrders(current, [normalizedOrder]));
    setSuppliers((current) => mergeSuppliers(current, orderSuppliers));
    const availableSupplierIds = new Set(orderSuppliers.map((supplier) => supplier.id));
    setForm((current) => ({
      ...current,
      orderId: normalizedOrder.id,
      supplierId: nextSupplierId || (current.supplierId && availableSupplierIds.has(current.supplierId) ? current.supplierId : ""),
      items: current.items.map((item) => normalizeExpenseItemCostType(item, nextCostTypes)),
    }));
  }

  async function submitExpense(auditStatus: "草稿" | "待审核") {
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
	    const normalizedItems = form.items.map((item) => ({
	      costType: item.costType,
	      billingMethod: DEFAULT_BILLING_METHOD,
	      amount: lineSubtotal(item),
	      billingQuantity: Number(item.appliedContainerCount || 1),
	      appliedContainerCount: Number(item.appliedContainerCount || 1),
	      currency: item.currency,
      exchangeRate: Number(item.exchangeRate),
      remark: item.remark.trim(),
    }));
    const invalidIndex = normalizedItems.findIndex((item) => (
      !item.costType
      || !item.amount
      || item.amount <= 0
	      || !item.currency
	      || !item.exchangeRate
	      || item.exchangeRate <= 0
	      || !validBillingQuantity(item.appliedContainerCount)
	      || item.appliedContainerCount <= 0
	    ));
    if (invalidIndex >= 0) {
	      setMessage(`请完整填写第 ${invalidIndex + 1} 行费用类型、单价/金额、适用数量、币种和汇率`);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>("/api/logistics-costs", {
        method: "POST",
        body: JSON.stringify({
          orderId: form.orderId,
          supplierId: isLockedSupplier ? undefined : form.supplierId || undefined,
          items: normalizedItems,
          auditStatus,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "保存物流费用失败");
      setForm({ ...emptyExpenseForm, items: [emptyExpenseItem()] });
      onSaved(result.message || (auditStatus === "草稿" ? "物流费用草稿已保存" : "物流费用已提交审核"));
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "保存物流费用失败");
    } finally {
      setSaving(false);
    }
  }

  const selectedOrder = orders.find((order) => order.id === form.orderId);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === form.supplierId)
    || null;
  useEffect(() => {
    const nextCostTypes = allowedCostTypeOptions(selectedSupplier, isLockedSupplier);
    setForm((current) => {
      const items = current.items.map((item) => normalizeExpenseItemCostType(item, nextCostTypes));
      if (items.every((item, index) => item.costType === current.items[index]?.costType)) return current;
      return { ...current, items };
    });
  }, [selectedSupplier?.id, isLockedSupplier]);
  const supplierSummaryText = selectedSupplier
    ? supplierLabel(selectedSupplier)
    : (isLockedSupplier ? "加载供应商信息中..." : (selectedOrder ? "未选择" : "请先选择订单"));
  const supplierAllowedCostTypes = selectedSupplier?.allowedLogisticsCostTypes?.length
    ? selectedSupplier.allowedLogisticsCostTypes.join(" / ")
    : "";
  const costTypeOptions = allowedCostTypeOptions(selectedSupplier, isLockedSupplier);
  const totalAmountCny = form.items.reduce((sum, item) => sum + (lineSubtotal(item) * Number(item.exchangeRate || 0)), 0);

  return (
    <form
      className={styles.quickCreatePanel}
      onSubmit={(event) => {
        event.preventDefault();
        void submitExpense("待审核");
      }}
    >
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>新增物流费用</strong>
          <span>物流费用提交审核后，审核通过的记录会自动进入成本管理和利润分析。</span>
        </div>
      </div>
      {message ? <div className={styles.inlineError}>{message}</div> : null}
      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            cacheKey="logistics-fee-orders"
            emptyLabel="未找到可录入订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={(order) => {
              if (isLockedSupplier) {
                return customerLegalName(order);
              }
              const supplierCount = filterLogisticsFeeSuppliers(order.logisticsSuppliers || []).length;
              return `${customerLegalName(order)}${supplierCount ? ` · 已绑定 ${supplierCount} 家物流供应商` : ""}`;
            }}
            search={searchOrders}
            onSelect={handleOrderSelect}
          />
        </label>
        {!isLockedSupplier ? (
        <label>
          供应商
          <SearchAutocomplete
            value={selectedSupplier || null}
            cacheKey={`logistics-fee-suppliers:${form.orderId || "none"}`}
            emptyLabel={selectedOrder ? "该订单未分配物流相关供应商" : "请先选择订单"}
            placeholder={selectedOrder ? "选择该订单绑定物流相关供应商" : "请先选择订单"}
            disabled={isLockedSupplier || !selectedOrder}
            searchOnFocus
            getLabel={supplierLabel}
            getDescription={(supplier) => {
              const allowedTypes = supplier.allowedLogisticsCostTypes?.length
                ? ` · 允许：${supplier.allowedLogisticsCostTypes.join(" / ")}`
                : "";
              return `${supplier.supplierType || "物流费用供应商"}${allowedTypes}`;
            }}
            search={searchSuppliers}
            onSelect={(supplier) => {
              setSuppliers((current) => mergeSuppliers(current, [supplier]));
              const nextCostTypes = allowedCostTypeOptions(supplier, isLockedSupplier);
              setForm((current) => ({
                ...current,
                supplierId: supplier.id,
                items: current.items.map((item) => normalizeExpenseItemCostType(item, nextCostTypes)),
              }));
            }}
          />
        </label>
        ) : null}
      </div>
      {selectedOrder ? (
        <div className={styles.detailGrid}>
          <DetailField label="订单号" value={selectedOrder.orderNo || "-"} />
          <DetailField label="提单号" value={selectedOrder.blNo || selectedOrder.billOfLadingNo || "-"} />
          <DetailField label="客户简称" value={customerDisplayName(selectedOrder)} />
          <DetailField label="集装箱" value={containerSummaryText(selectedOrder)} />
          <DetailField label="车牌" value={selectedOrder.truckPlateNo || "-"} />
          <DetailField label="货物" value={selectedOrder.cargoName || "-"} wide />
        </div>
      ) : null}
      <div className={styles.logisticsItemsPanel}>
        <div className={styles.logisticsItemsHeader}>
          <div>
            <strong>费用明细</strong>
            <span>可一次登记多条拖车费、报关费、港杂费等费用。</span>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.secondaryButton} type="button" onClick={() => addExpenseItem(false)}>添加费用</button>
            <button className={styles.secondaryButton} type="button" onClick={() => addExpenseItem(true)}>复制上一行</button>
          </div>
        </div>
        <div className={styles.logisticsItemsTable}>
          <div className={styles.logisticsItemsHead}>
	            <span>费用类型</span>
	            <span>适用数量</span>
	            <span>单价/金额</span>
	            <span>币种</span>
            <span>汇率</span>
            <span>小计</span>
            <span>备注</span>
            <span>操作</span>
          </div>
          {form.items.map((item, index) => (
            <div className={styles.logisticsItemsRow} key={`${index}-${item.costType}`}>
	              <select value={item.costType} onChange={(event) => setItemField(index, "costType", event.target.value)}>
	                {costTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
	              </select>
	              <input
	                value={item.appliedContainerCount}
	                onChange={(event) => setItemField(index, "appliedContainerCount", event.target.value)}
	                type="number"
	                min="1"
	                step="1"
	                inputMode="decimal"
	                required
	              />
              <input value={item.amount} onChange={(event) => setItemField(index, "amount", event.target.value)} inputMode="decimal" required />
              <select value={item.currency} onChange={(event) => setItemField(index, "currency", event.target.value)}>
                {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
              <input value={item.exchangeRate} onChange={(event) => setItemField(index, "exchangeRate", event.target.value)} readOnly={item.currency === "CNY"} inputMode="decimal" required />
              <strong>{formatCny(lineSubtotal(item) * Number(item.exchangeRate || 0))}</strong>
              <input value={item.remark} onChange={(event) => setItemField(index, "remark", event.target.value)} placeholder="可选" />
              <button className={styles.secondaryButton} type="button" disabled={form.items.length <= 1} onClick={() => removeExpenseItem(index)}>删除</button>
            </div>
          ))}
        </div>
        <div className={styles.logisticsItemsTotal}>合计：{formatCny(totalAmountCny)}</div>
      </div>
      {!isLockedSupplier ? (
      <div className={styles.quickCreateMeta}>
        <span>供应商：{supplierSummaryText}</span>
        {supplierAllowedCostTypes ? <span>允许费用：{supplierAllowedCostTypes}</span> : null}
      </div>
      ) : null}
      <div className={styles.detailActions}>
        <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => void submitExpense("草稿")}>
          {saving ? "保存中..." : "保存草稿"}
        </button>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>
          {saving ? "提交中..." : "提交审核"}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function InvoiceUploadForm({ expense, onUploaded }: { expense: LogisticsExpense; onUploaded: () => void }) {
  const [invoiceNo, setInvoiceNo] = useState(expense.invoiceNo || "");
  const [invoiceDate, setInvoiceDate] = useState(expense.invoiceDate || new Date().toISOString().slice(0, 10));
  const [invoiceAmount, setInvoiceAmount] = useState(expense.invoiceAmount ? String(expense.invoiceAmount) : String(expense.amount || ""));
  const [remark, setRemark] = useState(expense.invoiceRemark || "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  async function uploadInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceNo.trim()) {
      setMessage("请填写发票号码");
      return;
    }
    if (!invoiceDate) {
      setMessage("请选择开票日期");
      return;
    }
    if (!Number(invoiceAmount)) {
      setMessage("请填写发票金额");
      return;
    }
    if (!file) {
      setMessage("请选择发票文件");
      return;
    }
    if (!isPdfFile(file)) {
      setMessage("只能上传 PDF 文件");
      return;
    }
    setUploading(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("invoiceNo", invoiceNo.trim());
      body.set("invoiceDate", invoiceDate);
      body.set("invoiceAmount", invoiceAmount);
      body.set("remark", remark.trim());
      body.set("file", file);
      const response = await fetch(`/api/logistics-costs/${encodeURIComponent(expense.id)}/invoice`, {
        method: "POST",
        credentials: "include",
        body,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.message || "上传物流发票失败");
      setFile(null);
      onUploaded();
    } catch (uploadError) {
      setMessage(uploadError instanceof Error ? uploadError.message : "上传物流发票失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className={styles.inlineInvoiceForm} onSubmit={uploadInvoice}>
      <input value={invoiceNo} onChange={(event) => setInvoiceNo(event.target.value)} placeholder="发票号码" />
      <input value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} type="date" />
      <input value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} inputMode="decimal" placeholder="发票金额" />
      <input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="发票备注" />
      <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      <button className={styles.secondaryButton} type="submit" disabled={uploading}>{uploading ? "上传中..." : "上传发票"}</button>
      {message ? <span className={styles.inlineFormMessage}>{message}</span> : null}
    </form>
  );
}

function StatusPill({ value }: { value: string }) {
  let tone = styles.statusMuted;
  if (["审核通过", "已确认", "已付款"].includes(value)) tone = styles.statusSuccess;
  if (["待审核", "未通知", "已通知开票", "待付款", "草稿"].includes(value) || value.startsWith("部分")) tone = styles.statusWarning;
  if (["已驳回", "已退回", "已取消", "部分驳回"].includes(value)) tone = styles.statusDanger;
  return <span className={`${styles.statusPill} ${tone}`}>{value || "-"}</span>;
}

function normalizeExpenseOrder(order: Partial<ExpenseOrderOption>): ExpenseOrderOption {
  const id = order.orderId || order.id || "";
  const transportItems = Array.isArray(order.transportItems) ? order.transportItems : [];
  const containerNos = Array.isArray(order.containerNos)
    ? order.containerNos.filter(Boolean)
    : transportItems.map((item) => item.containerNo || "").filter(Boolean);
  const containerTypes = uniqueContainerTypes([
    order.containerType,
    ...(order.containerTypes || []),
    ...transportItems.map((item) => item.containerType),
  ]);
  return {
    ...order,
    id,
    orderId: id,
    transportItems,
    containerNos,
    containerTypes,
    containerType: order.containerType || (containerTypes.length === 1 ? containerTypes[0] : ""),
    containerCount: Number(order.containerCount || containerNos.length || transportItems.length || 0),
    logisticsSuppliers: filterLogisticsFeeSuppliers(order.logisticsSuppliers || []),
  };
}

function mergeOrders(current: ExpenseOrderOption[], next: ExpenseOrderOption[]) {
  const merged = [...current];
  for (const order of next.map((item) => normalizeExpenseOrder(item))) {
    if (order.id && !merged.some((item) => item.id === order.id)) merged.push(order);
  }
  return merged;
}

function mergeSuppliers(current: SupplierOption[], next: SupplierOption[]) {
  const merged = filterLogisticsFeeSuppliers(current);
  for (const supplier of filterLogisticsFeeSuppliers(next)) {
    if (supplier.id && !merged.some((item) => item.id === supplier.id)) merged.push(supplier);
  }
  return merged;
}

function orderLabel(order: ExpenseOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}

function supplierLabel(supplier: SupplierOption) {
  const name = supplier.supplierName || supplier.name || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}

function filterLogisticsFeeSuppliers(suppliers: SupplierOption[]) {
  return suppliers.filter((supplier) => LOGISTICS_FEE_SUPPLIER_TYPES.includes(supplier.supplierType || ""));
}

function allowedCostTypeOptions(supplier: SupplierOption | null, shouldRestrict: boolean) {
  if (!shouldRestrict) return COST_TYPES;
  const allowed = supplier?.allowedLogisticsCostTypes?.filter((type) => COST_TYPES.includes(type)) || [];
  return allowed.length ? allowed : COST_TYPES;
}

function normalizeExpenseItemCostType(item: ExpenseItemForm, options: string[]) {
  if (!options.length || options.includes(item.costType)) return item;
  return { ...item, costType: options[0] || item.costType };
}

function lineSubtotal(item: ExpenseItemForm) {
  const unitPrice = Number(item.amount || 0);
  const quantity = Number(item.appliedContainerCount || 1);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return unitPrice * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
}

function validBillingQuantity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  return Number.isInteger(numeric);
}

function billingQuantityLegacyInteger(value: unknown) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.max(1, Math.ceil(numeric));
}

function normalizeContainerType(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function uniqueContainerTypes(values: unknown[]) {
  return values
    .map(normalizeContainerType)
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function uniqueTextValues(values: unknown[]) {
  return values
    .map((value) => String(value || "").trim())
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function logisticsExpenseContainerSummary(expense: Partial<LogisticsExpense>, items: LogisticsExpense[] = []): LogisticsExpenseContainerSummary {
  const rows = [expense, ...(items.length ? items : [])];
  const seenTransportItems = new Set<string>();
  const transportItems: Array<{ containerNo: string; containerType: string }> = [];
  const fallbackNos: string[] = [];
  const fallbackTypes: unknown[] = [];
  let fallbackCount = 0;

  for (const row of rows) {
    const order = row.order || {};
    const orderTransportItems = Array.isArray(order.transportItems) ? order.transportItems : [];
    fallbackNos.push(...(order.containerNos || []));
    fallbackTypes.push(order.containerType, ...(order.containerTypes || []));
    fallbackCount = Math.max(fallbackCount, Number(order.containerCount || 0));
    for (const item of orderTransportItems) {
      const containerNo = String(item.containerNo || "").trim();
      const containerType = normalizeContainerType(item.containerType);
      const key = item.id || `${containerNo}|${containerType}|${String(item.sealNo || "").trim()}`;
      if ((!containerNo && !containerType) || seenTransportItems.has(key)) continue;
      seenTransportItems.add(key);
      transportItems.push({ containerNo, containerType });
    }
  }

  const typeCounts = new Map<string, number>();
  if (transportItems.length) {
    for (const item of transportItems) {
      if (!item.containerType) continue;
      typeCounts.set(item.containerType, (typeCounts.get(item.containerType) || 0) + 1);
    }
  } else {
    const types = uniqueContainerTypes(fallbackTypes);
    const nos = uniqueTextValues(fallbackNos);
    if (types.length === 1) {
      typeCounts.set(types[0], nos.length || fallbackCount || 1);
    } else {
      for (const type of types) typeCounts.set(type, 0);
    }
  }

  const typeLines = [...typeCounts.entries()].map(([type, count]) => (count > 0 ? `${type} × ${count}` : type));
  const containerNoLines = transportItems.length
    ? uniqueTextValues(transportItems.map((item) => item.containerNo))
    : uniqueTextValues(fallbackNos);
  const hasContainers = Boolean(typeLines.length || containerNoLines.length);
  return {
    hasContainers,
    typeLines,
    containerNoLines,
    shortText: hasContainers && typeLines.length ? typeLines.map((line) => line.replace(/\s×\s/g, "×")).join(" / ") : "未录入",
  };
}

function containerSummaryText(order?: ExpenseOrderOption | null) {
  const count = Number(order?.containerCount || 0);
  if (!count) return "未录入集装箱明细";
  const nos = order?.containerNos?.length ? `：${order.containerNos.join(" / ")}` : "";
  return `${count} 个柜${nos}`;
}

function expenseAmountText(expense: LogisticsExpense) {
  const currency = expense.currency || "CNY";
  if (currency === "CNY") return formatCny(expense.amount || expense.amountCny || 0);
  return `${currency} ${formatAmount(expense.amount || 0)}`;
}

function expenseUnitAmount(expense: LogisticsExpense) {
  const count = Number(expenseBillingQuantity(expense));
  const divisor = Number.isFinite(count) && count > 0 ? count : 1;
  return Number(expense.amount || 0) / divisor;
}

function expenseBillingQuantity(expense: Partial<LogisticsExpense>) {
  const quantity = Number(expense.billingQuantity ?? expense.appliedContainerCount ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function logisticsExpenseDraftFromItem(expense: Partial<LogisticsExpense>): LogisticsExpenseDraft {
  return {
    costType: expense.costType || "拖车费",
    billingMethod: DEFAULT_BILLING_METHOD,
    unitAmount: editableNumberText(expenseUnitAmount(expense as LogisticsExpense)),
    appliedContainerCount: editableQuantityText(expenseBillingQuantity(expense)),
    remark: expense.remark || "",
  };
}

function logisticsExpenseDraftsFromItems(items: LogisticsExpense[]) {
  return items.reduce<Record<string, LogisticsExpenseDraft>>((acc, item) => {
    if (item.id) acc[item.id] = logisticsExpenseDraftFromItem(item);
    return acc;
  }, {});
}

function logisticsExpenseDraftSignature(expense: LogisticsExpense) {
  return [
	    expense.id,
	    expense.costType || "",
	    expense.amount || 0,
	    expense.amountCny || 0,
	    expense.containerType || "",
	    expense.appliedContainerCount || 1,
	    expense.billingMethod || "",
	    expense.billingQuantity || "",
	    expense.exchangeRate || 1,
	    expense.remark || "",
	  ].join(":");
}

function logisticsExpenseDraftChanged(expense: LogisticsExpense, draft?: LogisticsExpenseDraft) {
  if (!draft) return false;
	  const initial = logisticsExpenseDraftFromItem(expense);
	  return draft.costType !== initial.costType
	    || draft.unitAmount.trim() !== initial.unitAmount
	    || draft.appliedContainerCount !== initial.appliedContainerCount
	    || draft.remark !== initial.remark;
}

function validLogisticsExpenseDraft(draft?: LogisticsExpenseDraft, isCreate = false) {
	  if (!draft) return false;
	  if (!draft.costType || !COST_TYPES.includes(draft.costType)) return false;
	  if (!draft.unitAmount.trim()) return false;
	  const unitAmount = Number(draft.unitAmount);
	  return Number.isFinite(unitAmount) && (isCreate ? unitAmount > 0 : unitAmount >= 0) && validBillingQuantity(draft.appliedContainerCount);
}

function logisticsExpenseDraftPayload(expense: LogisticsExpense, draft?: LogisticsExpenseDraft): LogisticsExpenseBatchUpdateItem {
  const safeDraft = draft || logisticsExpenseDraftFromItem(expense);
	  return {
	    id: expense.id,
	    amount: Number(safeDraft.unitAmount),
	    billingMethod: DEFAULT_BILLING_METHOD,
	    billingQuantity: Number(safeDraft.appliedContainerCount),
	    appliedContainerCount: billingQuantityLegacyInteger(safeDraft.appliedContainerCount),
	    remark: safeDraft.remark.trim(),
	  };
}

function logisticsExpenseDraftCreatePayload(expense: LogisticsExpense, draft?: LogisticsExpenseDraft): LogisticsExpenseBatchCreateItem {
  const safeDraft = draft || logisticsExpenseDraftFromItem(expense);
	  return {
	    expenseType: safeDraft.costType,
	    amount: Number(safeDraft.unitAmount),
	    billingMethod: DEFAULT_BILLING_METHOD,
	    billingQuantity: Number(safeDraft.appliedContainerCount),
	    appliedContainerCount: billingQuantityLegacyInteger(safeDraft.appliedContainerCount),
	    remark: safeDraft.remark.trim(),
	  };
}

function logisticsExpenseDraftValidationMessage(expense: LogisticsExpense, draft: LogisticsExpenseDraft | undefined, index: number) {
	  const lineNo = index + 1;
	  if (!draft?.costType || !COST_TYPES.includes(draft.costType)) return `第 ${lineNo} 行请选择费用类型`;
	  if (!draft.unitAmount.trim()) return `第 ${lineNo} 行金额不能为空`;
	  const unitAmount = Number(draft.unitAmount);
	  if (!Number.isFinite(unitAmount) || unitAmount < 0) return `第 ${lineNo} 行金额必须大于或等于 0`;
	  if (expense.isTemporary && unitAmount <= 0) return `第 ${lineNo} 行金额必须大于 0`;
	  if (!validBillingQuantity(draft.appliedContainerCount)) return `第 ${lineNo} 行适用数量必须为正整数`;
	  return `第 ${lineNo} 行填写不完整`;
}

function logisticsExpenseDraftAmountCny(expense: LogisticsExpense, draft?: LogisticsExpenseDraft) {
  if (!draft || (!validLogisticsExpenseDraft(draft, expense.isTemporary) && !draft.unitAmount.trim())) return Number(expense.amountCny || 0);
  return editableLineSubtotal(draft.unitAmount, draft.appliedContainerCount) * Number(expense.exchangeRate || 1);
}

function editableNumberText(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function editableQuantityText(value: unknown) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric) || numeric <= 0) return "1";
  return String(Math.max(1, Math.round(numeric)));
}

function editableLineSubtotal(unitAmount: string, appliedContainerCount: string) {
  const unitPrice = Number(unitAmount || 0);
  const count = Number(appliedContainerCount || 1);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return unitPrice * (Number.isFinite(count) && count > 0 ? count : 1);
}

function createTemporaryLogisticsExpenseRow(expense: LogisticsExpense, items: LogisticsExpense[], index: number): LogisticsExpense {
  const base = items[0] || expense;
  const now = Date.now();
  return {
    id: `temp:${expense.id}:${now}:${index}`,
    isTemporary: true,
    orderId: expense.orderId || base.orderId,
    orderNo: expense.orderNo || base.orderNo,
    blNo: expense.blNo || expense.billOfLadingNo || base.blNo || base.billOfLadingNo,
    billOfLadingNo: expense.billOfLadingNo || expense.blNo || base.billOfLadingNo || base.blNo,
    customerName: expense.customerName || base.customerName,
    customerShortName: expense.customerShortName || base.customerShortName,
    supplierId: base.supplierId,
    supplierName: base.supplierName,
    costType: "拖车费",
    currency: base.currency || "CNY",
	    exchangeRate: Number(base.exchangeRate || 1),
	    amount: 0,
	    amountCny: 0,
	    appliedContainerCount: 1,
	    billingMethod: DEFAULT_BILLING_METHOD,
	    billingQuantity: 1,
	    remark: "",
    auditStatus: ["草稿", "待审核", "已驳回"].includes(base.auditStatus || "") ? base.auditStatus : "草稿",
    invoiceStatus: "未通知",
    paymentStatus: "待开票",
    order: expense.order || base.order,
  };
}

function aggregateClientLogisticsExpenseStatus(items: LogisticsExpense[], field: keyof LogisticsExpense) {
  const unique = [...new Set(items.map((item) => item[field]).filter(Boolean).map(String))];
  if (!unique.length) return "-";
  if (unique.length === 1) return unique[0];
  if (field === "auditStatus") {
    if (unique.includes("草稿")) return "部分草稿";
    if (unique.includes("待审核")) return "部分待审核";
    if (unique.includes("已驳回")) return "部分驳回";
    if (unique.includes("审核通过")) return "部分审核通过";
  }
  if (field === "invoiceStatus") {
    if (unique.includes("已上传")) return "部分已上传";
    if (unique.includes("已确认")) return "部分已确认";
    if (unique.includes("已通知开票")) return "部分已通知";
    if (unique.includes("未通知")) return "部分未通知";
  }
  if (field === "paymentStatus") {
    if (unique.includes("已付款")) return "部分已付款";
    if (unique.includes("待付款")) return "部分待付款";
    if (unique.includes("已开票")) return "部分已开票";
    if (unique.includes("待开票")) return "部分待开票";
  }
  return "混合状态";
}

function removeLogisticsExpenseFromRows(rows: LogisticsExpense[], expenseId: string) {
  let removedBill = false;
  let billId = "";
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    if (!items.some((item) => item.id === expenseId)) return [row];
    billId = row.id;
    const nextItems = items.filter((item) => item.id !== expenseId);
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  return { rows: nextRows, removedBill, billId };
}

function replaceLogisticsExpenseItemsInRows(rows: LogisticsExpense[], savedItems: LogisticsExpense[]) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  return rows.map((row) => {
    const items = row.items?.length ? row.items : [row];
    if (!items.some((item) => savedById.has(item.id))) return row;
    const nextItems = items.map((item) => savedById.get(item.id) || item);
    return rebuildLogisticsExpenseBill(row, nextItems);
  });
}

function reconcileLogisticsExpenseRowsAfterBatchSave(rows: LogisticsExpense[], billId: string, savedItems: LogisticsExpense[], deletedIds: string[]) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  const deletedIdSet = new Set(deletedIds);
  let matchedBill = false;
  let removedBill = false;
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    const belongsToBill = row.id === billId || items.some((item) => savedById.has(item.id) || deletedIdSet.has(item.id));
    if (!belongsToBill) return [row];
    matchedBill = true;
    const nextItems = items
      .filter((item) => !deletedIdSet.has(item.id))
      .map((item) => savedById.get(item.id) || item);
    for (const savedItem of savedItems) {
      if (!nextItems.some((item) => item.id === savedItem.id)) nextItems.push(savedItem);
    }
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  if (!matchedBill && savedItems.length) {
    nextRows.unshift(buildLogisticsExpenseBillFromItems(savedItems));
  }
  return { rows: nextRows, removedBill };
}

function buildLogisticsExpenseBillFromItems(items: LogisticsExpense[]) {
  const first = items[0] || {};
  return rebuildLogisticsExpenseBill({
    id: logisticsExpenseBillIdFromItem(first),
    isBill: true,
    orderId: first.orderId,
    orderNo: first.orderNo,
    blNo: first.blNo || first.billOfLadingNo,
    billOfLadingNo: first.billOfLadingNo || first.blNo,
    customerName: first.customerName,
    customerShortName: first.customerShortName,
    order: first.order,
  } as LogisticsExpense, items);
}

function logisticsExpenseBillIdFromItem(item: Partial<LogisticsExpense>) {
  return `bill:${item.orderId || "order"}:${item.blNo || item.billOfLadingNo || item.orderNo || "no-bl"}`;
}

function rebuildLogisticsExpenseBill(row: LogisticsExpense, nextItems: LogisticsExpense[]) {
  const amountCny = nextItems.reduce((sum, item) => sum + Number(item.amountCny || 0), 0);
  const amount = nextItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const first = nextItems[0] || {};
  return {
    ...row,
    ...(
      nextItems.length === 1
        ? {
            costType: first.costType,
            currency: first.currency,
            exchangeRate: first.exchangeRate,
            amount,
          }
        : {
            costType: `${nextItems.length} 项费用`,
            amount: amountCny,
          }
    ),
    amountCny,
    auditStatus: aggregateClientLogisticsExpenseStatus(nextItems, "auditStatus"),
    invoiceStatus: aggregateClientLogisticsExpenseStatus(nextItems, "invoiceStatus"),
    paymentStatus: aggregateClientLogisticsExpenseStatus(nextItems, "paymentStatus"),
    itemCount: nextItems.length,
    supplierNames: [...new Set(nextItems.map((item) => item.supplierName).filter(Boolean))],
    items: nextItems,
  } as LogisticsExpense;
}

function expenseCostSyncText(expense: LogisticsExpense) {
  const status = String((expense as LogisticsExpense & { costSyncStatus?: string }).costSyncStatus || "").trim();
  if (["未同步", "已同步", "同步失败"].includes(status)) return status;
  return expense.costId ? "已同步" : "未同步";
}

function logisticsExpenseEditBlockReason(expense: LogisticsExpense) {
  const auditStatus = expense.auditStatus || "草稿";
  const invoiceStatus = expense.invoiceStatus || "未通知";
  const paymentStatus = expense.paymentStatus || "待开票";
  if (expense.costId || auditStatus === "审核通过") return "已审核，不能修改";
  if (["已上传", "已确认"].includes(invoiceStatus)) return "已开票，不能修改";
  if (["已开票", "待付款", "已付款"].includes(paymentStatus)) return "已付款流程中，不能修改";
  return "";
}

function logisticsExpenseDeleteBlockReason(expense: LogisticsExpense) {
  const auditStatus = expense.auditStatus || "草稿";
  const invoiceStatus = expense.invoiceStatus || "未通知";
  const paymentStatus = expense.paymentStatus || "待开票";
  if (expense.costId) return "该费用已同步到成本，请先取消同步后再删除。";
  if (auditStatus === "审核通过") return "已审核通过的物流费用不能删除。";
  if (["已上传", "已确认"].includes(invoiceStatus) || ["已开票", "待付款", "已付款"].includes(paymentStatus)) {
    return "已开票或已付款的物流费用不能删除。";
  }
  if (!["草稿", "待审核", "已驳回"].includes(auditStatus)) return "当前状态的物流费用不能删除。";
  return "";
}

function logisticsActionSuccessMessage(action: unknown) {
  if (action === "approve") return "物流费用已审核通过";
  if (action === "reject") return "物流费用已驳回";
  if (action === "updateAmount") return "物流费用金额已更新";
  if (action === "paymentStatus") return "物流费用付款状态已更新";
  if (action === "confirmInvoice") return "物流发票已确认";
  return "物流费用已更新";
}

function csvCell(value: string) {
  const escaped = value.replaceAll("\"", "\"\"");
  const safe = /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${safe}"`;
}
