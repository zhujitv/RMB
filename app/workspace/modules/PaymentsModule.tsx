"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { formatCny, moneyText } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";

const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
const PAYMENT_TYPES = ["预付款", "尾款", "补差款", "其他"];
const PAYMENT_STATUSES = ["待确认", "已到账", "已退回", "已取消"];

type UserLite = {
  name?: string;
};

type PaymentRow = {
  id: string;
  orderId?: string;
  orderNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  paymentDate?: string;
  currency?: string;
  exchangeRate?: number;
  exchangeRateSource?: string;
  exchangeRateType?: string;
  amount?: number;
  amountCny?: number;
  paymentType?: string;
  status?: string;
  bankReference?: string;
  remark?: string;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
};

type PaymentsResponse = {
  payments: PaymentRow[];
};

type PaymentOrderOption = {
  id: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  currency?: string;
};

type OrdersResponse = {
  orders: PaymentOrderOption[];
};

type ExchangeRateResponse = {
  rate?: {
    rateToCny?: number;
    exchangeRate?: number;
    rate?: number;
    source?: string;
    rateType?: string;
    rateDate?: string;
  };
};

type QuickPaymentForm = {
  orderId: string;
  paymentDate: string;
  paymentType: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  status: string;
  bankReference: string;
  remark: string;
};

const PAGE_SIZE = 20;

const emptyQuickPaymentForm: QuickPaymentForm = {
  orderId: "",
  paymentDate: new Date().toISOString().slice(0, 10),
  paymentType: "尾款",
  amount: "",
  currency: "",
  exchangeRate: "",
  status: "待确认",
  bankReference: "",
  remark: "",
};

export function PaymentsModule({ currentUser }: { currentUser: User }) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const canManagePayments = ["管理员", "财务"].includes(currentUser.role);

  async function loadPayments(nextKeyword = submittedKeyword) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<PaymentsResponse>(`/api/payments${params.size ? `?${params}` : ""}`);
      setPayments(Array.isArray(result.payments) ? result.payments : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取收款明细失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPayments("");
  }, []);

  const totalPages = Math.max(1, Math.ceil(payments.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return payments.slice(start, start + PAGE_SIZE);
  }, [payments, page]);

  function submitSearch() {
    setPage(1);
    setExpandedId("");
    setNotice("");
    setSubmittedKeyword(keyword.trim());
    void loadPayments(keyword.trim());
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setPage(1);
    setExpandedId("");
    setNotice("");
    void loadPayments("");
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>业务模块</span>
          <h2>收款管理</h2>
        </div>
        <div className={styles.headerActions}>
          {canManagePayments ? (
            <button
              className={styles.primaryButtonCompact}
              type="button"
              onClick={() => {
                setEditPayment(null);
                setCreateOpen((current) => !current);
              }}
            >
              {createOpen ? "收起登记" : "登记收款"}
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadPayments();
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canManagePayments && (createOpen || editPayment) ? (
        <QuickCreatePaymentPanel
          initialPayment={editPayment}
          canConfirmArrived={canManagePayments}
          onCancel={() => {
            setCreateOpen(false);
            setEditPayment(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditPayment(null);
            setPage(1);
            setExpandedId("");
            setNotice(editPayment ? "收款已更新" : "收款已保存");
            void loadPayments(submittedKeyword);
          }}
        />
      ) : null}

      <div className={styles.infoStrip}>
        收款凭证上传将接入新的 R2 文件体系；旧附件地址和停用的 `/api/attachments` 不会在业务工作台中恢复使用。
      </div>

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 银行流水"
        />
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
              <th>客户简称</th>
              <th>收款日期</th>
              <th>金额</th>
              <th>状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : pageRows.length ? pageRows.map((payment) => (
              <PaymentTableRows
                key={payment.id}
                payment={payment}
                expanded={expandedId === payment.id}
                onToggle={() => setExpandedId((current) => current === payment.id ? "" : payment.id)}
                deleting={deletingId === payment.id}
                onEdit={() => {
                  setCreateOpen(false);
                  setEditPayment(payment);
                  setExpandedId(payment.id);
                }}
                onDelete={() => void deletePayment(payment)}
                onConfirmArrived={() => void confirmPaymentArrived(payment)}
                canManage={canManagePayments}
                confirming={confirmingId === payment.id}
              />
            )) : (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>未找到匹配的收款明细</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={payments.length} page={page} totalPages={totalPages} onPage={setPage} />
    </section>
  );

  async function deletePayment(payment: PaymentRow) {
    if (!window.confirm(`确认删除这笔收款？\n\n订单：${payment.orderNo || "-"}\n金额：${moneyText(payment.currency, payment.amount, payment.amountCny)}`)) return;
    setDeletingId(payment.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/payments/${encodeURIComponent(payment.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除收款失败");
      setExpandedId("");
      await loadPayments(submittedKeyword);
      setNotice(result.message || "收款已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除收款失败");
    } finally {
      setDeletingId("");
    }
  }

  async function confirmPaymentArrived(payment: PaymentRow) {
    const confirmed = window.confirm(
      [
        "确认该笔收款已经到账？",
        "",
        `订单：${payment.orderNo || "-"}`,
        `客户：${payment.customerShortName || payment.customerName || "-"}`,
        `金额：${moneyText(payment.currency, payment.amount, payment.amountCny)}`,
      ].join("\n"),
    );
    if (!confirmed) return;
    setConfirmingId(payment.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/payments/${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          orderId: payment.orderId,
          paymentDate: payment.paymentDate,
          paymentType: payment.paymentType,
          amount: Number(payment.amount || 0),
          currency: payment.currency,
          exchangeRate: Number(payment.exchangeRate || 0),
          status: "已到账",
          bankReference: payment.bankReference || "",
          remark: payment.remark || "",
        }),
      });
      if (result.success !== true) throw new Error(result.message || "确认到账失败");
      setExpandedId("");
      await loadPayments(submittedKeyword);
      setNotice(result.message || "收款已确认到账");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "确认到账失败");
    } finally {
      setConfirmingId("");
    }
  }
}

function QuickCreatePaymentPanel({
  initialPayment,
  canConfirmArrived,
  onCancel,
  onSaved,
}: {
  initialPayment?: PaymentRow | null;
  canConfirmArrived: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<QuickPaymentForm>(() => paymentFormFromRow(initialPayment));
  const [orders, setOrders] = useState<PaymentOrderOption[]>([]);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function searchOrders(keyword: string) {
    try {
      const params = new URLSearchParams({ q: keyword.trim() });
      const result = await apiJson<OrdersResponse>(`/api/receivables/search?${params}`);
      return Array.isArray(result.orders) ? result.orders : [];
    } catch (orderError) {
      setMessage(orderError instanceof Error ? orderError.message : "读取订单列表失败");
      return [];
    }
  }

  function setFormValue<K extends keyof QuickPaymentForm>(key: K, value: QuickPaymentForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function resolveExchangeRate(currency: string, paymentDate = form.paymentDate) {
    const normalized = currency.trim().toUpperCase();
    if (!normalized) {
      setExchangeMeta("");
      setFormValue("exchangeRate", "");
      return;
    }
    if (normalized === "CNY") {
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setFormValue("exchangeRate", "1");
      return;
    }
    setExchangeMeta("正在获取汇率...");
    try {
      const params = new URLSearchParams({ currency: normalized });
      if (paymentDate) params.set("date", paymentDate);
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${params}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setFormValue("exchangeRate", String(rate));
        setExchangeMeta(`来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`);
      } else {
        setExchangeMeta("汇率来源：待获取，请手工填写");
      }
    } catch (rateError) {
      setExchangeMeta(rateError instanceof Error ? rateError.message : "汇率获取失败，请手工填写");
    }
  }

  async function handleOrderSelect(order: PaymentOrderOption) {
    setOrders((current) => current.some((item) => item.id === order.id) ? current : [order, ...current]);
    setForm((current) => ({
      ...current,
      orderId: order.id,
      currency: order?.currency || "",
      exchangeRate: "",
    }));
    await resolveExchangeRate(order?.currency || "");
  }

  async function handleCurrencyChange(currency: string) {
    const normalized = currency.toUpperCase();
    setForm((current) => ({ ...current, currency: normalized, exchangeRate: "" }));
    await resolveExchangeRate(normalized);
  }

  async function handlePaymentDateChange(paymentDate: string) {
    setFormValue("paymentDate", paymentDate);
    if (form.currency && form.currency !== "CNY") await resolveExchangeRate(form.currency, paymentDate);
  }

  async function submitQuickPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setMessage("请填写收款金额");
      return;
    }
    if (!form.currency) {
      setMessage("请选择币种");
      return;
    }
    if (!Number(form.exchangeRate)) {
      setMessage("请填写汇率；CNY 收款汇率应自动为 1");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const isEdit = Boolean(initialPayment?.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/payments/${encodeURIComponent(initialPayment?.id || "")}` : "/api/payments",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            orderId: form.orderId,
            paymentDate: form.paymentDate,
            paymentType: form.paymentType,
            amount: Number(form.amount),
            currency: form.currency,
            exchangeRate: Number(form.exchangeRate),
            status: form.status,
            bankReference: form.bankReference.trim(),
            remark: form.remark.trim(),
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "收款保存失败");
      setForm(paymentFormFromRow(null));
      setExchangeMeta("");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "收款保存失败");
    } finally {
      setSaving(false);
    }
  }

  const initialOrder = initialPayment?.orderId ? {
    id: initialPayment.orderId,
    orderNo: initialPayment.orderNo,
    customerName: initialPayment.customerName,
    customerFullName: initialPayment.customerFullName,
    customerShortName: initialPayment.customerShortName,
    currency: initialPayment.currency,
  } : null;
  const orderOptions = initialOrder && !orders.some((order) => order.id === initialOrder.id)
    ? [initialOrder, ...orders]
    : orders;
  const selectedOrder = orderOptions.find((order) => order.id === form.orderId);

  return (
    <form className={styles.quickCreatePanel} onSubmit={submitQuickPayment}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{initialPayment?.id ? "编辑收款" : "快速登记收款"}</strong>
          <span>待确认收款不进入正式统计；已到账状态由后端权限校验，保存后自动刷新订单回款口径。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            cacheKey="payment-orders"
            emptyLabel="未找到订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={(order) => `${order.customerFullName || order.customerName || "-"}${order.currency ? ` · ${order.currency}` : ""}`}
            search={searchOrders}
            onSelect={(order) => void handleOrderSelect(order)}
          />
        </label>
        <label>
          收款日期
          <input type="date" value={form.paymentDate} onChange={(event) => void handlePaymentDateChange(event.target.value)} required />
        </label>
        <label>
          收款类型
          <select value={form.paymentType} onChange={(event) => setFormValue("paymentType", event.target.value)}>
            {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          收款金额
          <input value={form.amount} onChange={(event) => setFormValue("amount", event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          币种
          <select value={form.currency} onChange={(event) => void handleCurrencyChange(event.target.value)}>
            <option value="">请选择币种</option>
            {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label>
          汇率
          <input
            value={form.exchangeRate}
            onChange={(event) => setFormValue("exchangeRate", event.target.value)}
            readOnly={form.currency === "CNY"}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          收款状态
          <select value={form.status} onChange={(event) => setFormValue("status", event.target.value)}>
            {paymentStatusOptions(canConfirmArrived).map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          银行流水号
          <input value={form.bankReference} onChange={(event) => setFormValue("bankReference", event.target.value)} placeholder="可选" />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setFormValue("remark", event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className={styles.quickCreateMeta}>
        <span>订单：{selectedOrder ? orderLabel(selectedOrder) : "-"}</span>
        <span>{exchangeMeta || "汇率来源：待获取"}</span>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : initialPayment?.id ? "更新收款" : "保存收款"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function PaymentTableRows({
  payment,
  expanded,
  deleting,
  onToggle,
  onEdit,
  onDelete,
  onConfirmArrived,
  canManage,
  confirming,
}: {
  payment: PaymentRow;
  expanded: boolean;
  deleting: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConfirmArrived: () => void;
  canManage: boolean;
  confirming: boolean;
}) {
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{payment.orderNo || "-"}</strong></td>
        <td title={payment.customerFullName || payment.customerName || ""}>{payment.customerShortName || payment.customerName || "-"}</td>
        <td>{payment.paymentDate || "-"}</td>
        <td>{moneyText(payment.currency, payment.amount, payment.amountCny)}</td>
        <td><span className={`${styles.statusPill} ${paymentStatusClass(payment.status)}`}>{payment.status || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={6}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                {canManage ? (
                  <>
                    {payment.status === "待确认" ? (
                      <button
                        className={styles.primaryButtonCompact}
                        type="button"
                        disabled={confirming}
                        onClick={(event) => {
                          event.stopPropagation();
                          onConfirmArrived();
                        }}
                      >
                        {confirming ? "确认中..." : "确认到账"}
                      </button>
                    ) : null}
                    <button
                      className={styles.primaryButtonCompact}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit();
                      }}
                    >
                      编辑收款
                    </button>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={deleting}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete();
                      }}
                    >
                      {deleting ? "删除中..." : "删除收款"}
                    </button>
                  </>
                ) : <span className={styles.mutedText}>只读查看</span>}
              </div>
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={payment.customerFullName || payment.customerName || "-"} wide />
                <DetailField label="收款类型" value={payment.paymentType || "-"} />
                <DetailField label="币种 / 汇率" value={`${payment.currency || "-"} / ${Number(payment.exchangeRate || 0).toFixed(4)}`} />
                <DetailField label="折人民币" value={formatCny(Number(payment.amountCny || 0))} />
                <DetailField label="银行流水号" value={payment.bankReference || "-"} hidden={!payment.bankReference} />
                <DetailField label="汇率来源" value={rateMeta(payment)} />
                <DetailField label="创建人" value={payment.createdBy?.name || "-"} />
                <DetailField label="修改人" value={payment.updatedBy?.name || "-"} />
                <DetailField label="备注" value={payment.remark || "-"} wide hidden={!payment.remark} />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function paymentFormFromRow(payment?: PaymentRow | null): QuickPaymentForm {
  if (!payment) return { ...emptyQuickPaymentForm, paymentDate: new Date().toISOString().slice(0, 10) };
  return {
    orderId: payment.orderId || "",
    paymentDate: payment.paymentDate || new Date().toISOString().slice(0, 10),
    paymentType: payment.paymentType || "尾款",
    amount: payment.amount == null ? "" : String(payment.amount),
    currency: payment.currency || "",
    exchangeRate: payment.exchangeRate == null ? "" : String(payment.exchangeRate),
    status: payment.status || "待确认",
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
  };
}

function paymentStatusClass(status = "") {
  if (status === "已到账") return styles.statusSuccess;
  if (status === "待确认") return styles.statusWarning;
  if (status === "已退回") return styles.statusDanger;
  if (status === "已取消") return styles.statusMuted;
  return "";
}

function paymentStatusOptions(canConfirmArrived: boolean) {
  return canConfirmArrived ? PAYMENT_STATUSES : PAYMENT_STATUSES.filter((status) => status !== "已到账");
}

function rateMeta(payment: PaymentRow) {
  const source = payment.exchangeRateSource || "待获取";
  const type = payment.exchangeRateType || "-";
  return `来源：${source} / 类型：${type}`;
}

function orderLabel(order: PaymentOrderOption) {
  const customer = order.customerShortName || order.customerName || order.customerFullName || "-";
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}
