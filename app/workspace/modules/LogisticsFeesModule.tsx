"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, PaginationBar, useConfirmationDialog } from "../components";
import { formatCny, formatDate, formatDateTime, moneyText } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import { downloadBlob } from "../utils";
import styles from "../WorkspaceShell.module.css";

const PAGE_SIZE = 20;
const COST_TYPES = ["拖车费", "报关费", "港杂费", "海运费", "保险费", "查验费", "超重费", "提箱费", "进港费", "其他物流费用"];
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
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  supplierId?: string;
  supplierName?: string;
  supplierEmail?: string;
  costId?: string;
  costType?: string;
  currency?: string;
  exchangeRate?: number;
  amount?: number;
  amountCny?: number;
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
  amount: string;
  currency: string;
  exchangeRate: string;
  remark: string;
};

const emptyExpenseItem = (): ExpenseItemForm => ({
  costType: "拖车费",
  amount: "",
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
    <section className={embedded ? styles.subModuleCard : styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          {embedded ? null : <span className={styles.kicker}>业务模块</span>}
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
          placeholder="搜索订单号 / 提单号 / 客户 / 供应商"
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
              <th>订单号</th>
              <th>提单号</th>
              <th>客户简称</th>
              <th>供应商</th>
              <th>费用合计</th>
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
                busy={busyId === expense.id}
                onToggle={() => setExpandedId((current) => current === expense.id ? "" : expense.id)}
                canReview={canReviewExpense}
                canConfirmInvoice={canConfirmInvoice}
                canWithdraw={isLogisticsSupplier}
                onApprove={() => void patchExpense(expense, { action: "approve" }, "审核物流费用失败")}
                onReject={() => void rejectExpense(expense)}
                onWithdraw={() => void withdrawExpense(expense)}
                onMarkPaid={() => void patchExpense(expense, { action: "paymentStatus", paymentStatus: "已付款" }, "更新付款状态失败")}
                onConfirmInvoice={() => void confirmExpenseInvoice(expense)}
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
  busy,
  onToggle,
  onApprove,
  onReject,
  onWithdraw,
  onMarkPaid,
  onConfirmInvoice,
  onInvoiceUploaded,
  canReview,
  canConfirmInvoice,
  canWithdraw,
}: {
  expense: LogisticsExpense;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  canReview: boolean;
  canConfirmInvoice: boolean;
  canWithdraw: boolean;
  onApprove: () => void;
  onReject: () => void;
  onWithdraw: () => void;
  onMarkPaid: () => void;
  onConfirmInvoice: () => void;
  onInvoiceUploaded: () => void;
}) {
  const auditStatus = expense.auditStatus || "草稿";
  const invoiceStatus = expense.invoiceStatus || "未通知";
  const paymentStatus = expense.paymentStatus || "待开票";
  const canUploadInvoice = ["未通知", "已通知开票"].includes(invoiceStatus);
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{expense.orderNo || "-"}</strong></td>
        <td>{expense.blNo || expense.billOfLadingNo || "-"}</td>
        <td title={expense.customerName || ""}>{expense.customerShortName || expense.customerName || "-"}</td>
        <td>{expense.supplierName || "-"}</td>
        <td>
          <strong>{formatCny(expense.amountCny || 0)}</strong>
          <small className={styles.mutedText}>{expense.costType || "-"} {expense.currency || "CNY"} {Number(expense.amount || 0).toFixed(2)}</small>
        </td>
        <td><StatusPill value={auditStatus} /></td>
        <td><StatusPill value={invoiceStatus} /></td>
        <td><StatusPill value={paymentStatus} /></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={9}>
            <div className={styles.detailCard} onClick={(event) => event.stopPropagation()}>
              <div className={styles.detailActions}>
                {auditStatus === "待审核" && canReview ? (
                  <>
                    <button className={styles.primaryButtonCompact} type="button" disabled={busy} onClick={onApprove}>{busy ? "处理中..." : "审核通过"}</button>
                    <button className={styles.secondaryButton} type="button" disabled={busy} onClick={onReject}>驳回</button>
                  </>
                ) : null}
                {auditStatus === "待审核" && canWithdraw ? (
                  <>
                    <button className={styles.secondaryButton} type="button" disabled={busy} onClick={onWithdraw}>撤回</button>
                  </>
                ) : null}
                {auditStatus === "审核通过" ? (
                  <>
                    {invoiceStatus === "已上传" && canConfirmInvoice ? (
                      <button className={styles.secondaryButton} type="button" disabled={busy} onClick={onConfirmInvoice}>
                        {busy ? "处理中..." : "确认发票"}
                      </button>
                    ) : null}
                    {invoiceStatus === "已确认" && canConfirmInvoice ? (
                      <button className={styles.secondaryButton} type="button" disabled={busy || paymentStatus === "已付款"} onClick={onMarkPaid}>
                      {paymentStatus === "已付款" ? "已付款" : "标记已付款"}
                      </button>
                    ) : null}
                    {canUploadInvoice ? <InvoiceUploadForm expense={expense} onUploaded={onInvoiceUploaded} /> : null}
                  </>
                ) : null}
                {auditStatus === "草稿" || auditStatus === "已驳回" ? (
                  <span className={styles.mutedText}>草稿或驳回记录可由录入人重新提交。</span>
                ) : null}
              </div>
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={expense.customerName || "-"} wide />
                <DetailField label="提单号" value={expense.blNo || expense.billOfLadingNo || "-"} />
                <DetailField label="供应商" value={expense.supplierName || "-"} />
                <DetailField label="费用类型" value={expense.costType || "-"} />
                <DetailField label="费用金额" value={moneyText(expense.currency, expense.amount, expense.amountCny)} />
                <DetailField label="折人民币" value={formatCny(expense.amountCny || 0)} />
                <DetailField label="币种 / 汇率" value={`${expense.currency || "CNY"} / ${Number(expense.exchangeRate || 1).toFixed(4)}`} />
                <DetailField label="审核人 / 时间" value={`${expense.reviewedBy?.name || "-"} / ${formatDateTime(expense.reviewedAt)}`} />
                <DetailField label="提交时间" value={formatDateTime(expense.submittedAt)} />
                <DetailField label="生成成本" value={expense.costId ? "已同步到成本管理" : "未同步"} />
                <DetailField label="发票号码" value={expense.invoiceNo || "-"} />
                <DetailField label="开票日期" value={formatDate(expense.invoiceDate)} />
                <DetailField label="发票金额" value={expense.invoiceAmount ? formatCny(expense.invoiceAmount) : "-"} />
                <DetailField label="发票文件" value={expense.invoiceDocument?.fileName || expense.invoiceDocument?.originalFilename || "-"} wide />
                <DetailField label="驳回原因" value={expense.rejectReason || "-"} wide />
                <DetailField label="审核备注" value={expense.reviewRemark || "-"} wide />
                <DetailField label="备注" value={expense.remark || "-"} wide />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
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
    void searchSuppliers("");
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
      amount: Number(item.amount),
      currency: item.currency,
      exchangeRate: Number(item.exchangeRate),
      remark: item.remark.trim(),
    }));
    const invalidIndex = normalizedItems.findIndex((item) => (
      !item.costType || !item.amount || item.amount <= 0 || !item.currency || !item.exchangeRate || item.exchangeRate <= 0
    ));
    if (invalidIndex >= 0) {
      setMessage(`请完整填写第 ${invalidIndex + 1} 行费用类型、金额、币种和汇率`);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>("/api/logistics-costs", {
        method: "POST",
        body: JSON.stringify({
          orderId: form.orderId,
          supplierId: form.supplierId || undefined,
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
  const totalAmountCny = form.items.reduce((sum, item) => sum + (Number(item.amount || 0) * Number(item.exchangeRate || 0)), 0);

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
              const supplierCount = filterLogisticsFeeSuppliers(order.logisticsSuppliers || []).length;
              return `${order.customerName || "客户未设置"}${supplierCount ? ` · 已绑定 ${supplierCount} 家物流供应商` : ""}`;
            }}
            search={searchOrders}
            onSelect={handleOrderSelect}
          />
        </label>
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
      </div>
      {selectedOrder ? (
        <div className={styles.detailGrid}>
          <DetailField label="订单号" value={selectedOrder.orderNo || "-"} />
          <DetailField label="提单号" value={selectedOrder.blNo || selectedOrder.billOfLadingNo || "-"} />
          <DetailField label="客户简称" value={selectedOrder.customerShortName || selectedOrder.customerName || "-"} />
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
            <span>金额</span>
            <span>币种</span>
            <span>汇率</span>
            <span>折人民币</span>
            <span>备注</span>
            <span>操作</span>
          </div>
          {form.items.map((item, index) => (
            <div className={styles.logisticsItemsRow} key={`${index}-${item.costType}`}>
              <select value={item.costType} onChange={(event) => setItemField(index, "costType", event.target.value)}>
                {costTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <input value={item.amount} onChange={(event) => setItemField(index, "amount", event.target.value)} inputMode="decimal" required />
              <select value={item.currency} onChange={(event) => setItemField(index, "currency", event.target.value)}>
                {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
              <input value={item.exchangeRate} onChange={(event) => setItemField(index, "exchangeRate", event.target.value)} readOnly={item.currency === "CNY"} inputMode="decimal" required />
              <strong>{formatCny(Number(item.amount || 0) * Number(item.exchangeRate || 0))}</strong>
              <input value={item.remark} onChange={(event) => setItemField(index, "remark", event.target.value)} placeholder="可选" />
              <button className={styles.secondaryButton} type="button" disabled={form.items.length <= 1} onClick={() => removeExpenseItem(index)}>删除</button>
            </div>
          ))}
        </div>
        <div className={styles.logisticsItemsTotal}>合计：{formatCny(totalAmountCny)}</div>
      </div>
      <div className={styles.quickCreateMeta}>
        <span>供应商：{supplierSummaryText}</span>
        {supplierAllowedCostTypes ? <span>允许费用：{supplierAllowedCostTypes}</span> : null}
      </div>
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
    if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
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
  if (["待审核", "未通知", "已通知开票", "待付款", "草稿"].includes(value)) tone = styles.statusWarning;
  if (["已驳回", "已退回", "已取消"].includes(value)) tone = styles.statusDanger;
  return <span className={`${styles.statusPill} ${tone}`}>{value || "-"}</span>;
}

function normalizeExpenseOrder(order: Partial<ExpenseOrderOption>): ExpenseOrderOption {
  const id = order.orderId || order.id || "";
  return {
    ...order,
    id,
    orderId: id,
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
  const customer = order.customerShortName || order.customerName || "-";
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

function logisticsActionSuccessMessage(action: unknown) {
  if (action === "approve") return "物流费用已审核通过";
  if (action === "reject") return "物流费用已驳回";
  if (action === "paymentStatus") return "物流费用付款状态已更新";
  if (action === "confirmInvoice") return "物流发票已确认";
  return "物流费用已更新";
}

function csvCell(value: string) {
  const escaped = value.replaceAll("\"", "\"\"");
  const safe = /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${safe}"`;
}
