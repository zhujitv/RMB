import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import { formatCny, formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import styles from "./quotation-crm-workspace.module.css";
import type { CustomerInsight } from "./quotation-crm-insights";

type BusinessOrder = {
  id: string; orderNo?: string; blNo?: string; status?: string; currency?: string;
  finalReceivableAmount?: number; finalReceivableAmountCny?: number; actualShipmentDate?: string; dueDate?: string;
  summary?: { outstandingCny?: number; arrivedPaymentsCny?: number; reminderStatus?: string; overdueDays?: number };
};
type BusinessPayment = {
  id: string; orderNo?: string; paymentDate?: string; currency?: string; amount?: number; amountCny?: number; status?: string; paymentType?: string;
};
type BusinessRecords = {
  canReadOrders?: boolean; canReadPayments?: boolean;
  summary?: { orderCount?: number; shippedCount?: number; overdueCount?: number; receivableCny?: number; receivedCny?: number; outstandingCny?: number; paymentCount?: number; arrivedPaymentCny?: number; pendingPaymentCny?: number };
  orders?: BusinessOrder[]; payments?: BusinessPayment[];
};
type BusinessRecordsResponse = { data?: BusinessRecords };

export function QuotationCustomerBusinessRecords({
  customer, canReadOrders, canReadPayments, onOpenOrders, onOpenPayments,
}: {
  customer: CustomerInsight; canReadOrders: boolean; canReadPayments: boolean;
  onOpenOrders: (keyword: string) => void; onOpenPayments: (keyword: string) => void;
}) {
  const [records, setRecords] = useState<BusinessRecords | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const customerKeyword = customer.legalName || customer.name;

  useEffect(() => {
    if (!customer.customerId || (!canReadOrders && !canReadPayments)) return;
    let cancelled = false;
    setLoading(true); setError("");
    const params = new URLSearchParams({ customerId: customer.customerId });
    apiJson<BusinessRecordsResponse>(`/api/customer-business-records?${params}`)
      .then((result) => { if (!cancelled) setRecords(result.data || null); })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "读取客户发货订单与应收款失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customer.customerId, canReadOrders, canReadPayments]);

  if (!canReadOrders && !canReadPayments) return null;
  if (!customer.customerId) return (
    <section className={`${styles.crmPanel} ${styles.fullWidthPanel}`}>
      <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>发货与应收</span><h3>客户经营记录</h3></div></div>
      <div className={styles.crmEmpty}>该客户来自历史报价快照，尚未关联客户档案，无法精确读取发货订单和应收款。</div>
    </section>
  );

  const summary = records?.summary || {};
  const orders = records?.orders || [];
  const payments = records?.payments || [];
  return (
    <section className={`${styles.crmPanel} ${styles.fullWidthPanel}`}>
      <div className={styles.crmPanelHeader}>
        <div><span className={styles.crmEyebrow}>发货与应收</span><h3>客户经营记录</h3></div>
        <div className={styles.businessActions}>
          {canReadOrders ? <button className={shell.secondaryButton} type="button" onClick={() => onOpenOrders(customerKeyword)}>打开应收订单</button> : null}
          {canReadPayments ? <button className={shell.secondaryButton} type="button" onClick={() => onOpenPayments(customerKeyword)}>打开收款管理</button> : null}
        </div>
      </div>
      {loading ? <div className={styles.crmEmpty}>正在读取客户发货订单和应收款...</div> : null}
      {error ? <div className={shell.inlineError} role="alert">{error}</div> : null}
      {!loading && !error ? <>
        <div className={styles.businessStats}>
          <article><span>发货订单</span><strong>{summary.shippedCount || 0}/{summary.orderCount || 0}</strong><small>已发货 / 全部订单</small></article>
          <article><span>应收总额</span><strong>{formatCny(summary.receivableCny)}</strong><small>按现有应收订单汇总</small></article>
          <article><span>已到账</span><strong>{formatCny(summary.receivedCny)}</strong><small>来自已到账收款</small></article>
          <article><span>未收余额</span><strong>{formatCny(summary.outstandingCny)}</strong><small>{summary.overdueCount || 0} 单逾期</small></article>
        </div>
        <div className={styles.businessGrid}>
          <BusinessOrderList orders={orders} canReadOrders={canReadOrders} onOpenOrders={onOpenOrders} />
          <BusinessPaymentList payments={payments} canReadPayments={canReadPayments} onOpenPayments={onOpenPayments} />
        </div>
      </> : null}
    </section>
  );
}

function BusinessOrderList({ orders, canReadOrders, onOpenOrders }: { orders: BusinessOrder[]; canReadOrders: boolean; onOpenOrders: (keyword: string) => void }) {
  if (!canReadOrders) return <div className={styles.crmEmpty}>当前账号没有应收订单查看权限。</div>;
  return <div className={styles.businessList}><h4>最近发货/应收订单</h4>{orders.length ? orders.map((order) => (
    <button className={styles.businessRow} type="button" key={order.id} onClick={() => onOpenOrders(order.orderNo || "")}>
      <span><strong>{order.orderNo || "未编号"}</strong><small>提单 {order.blNo || "-"}</small></span>
      <span><strong>{formatCurrencyAmount(order.currency || "CNY", order.finalReceivableAmount)}</strong><small>未收 {formatCny(order.summary?.outstandingCny)}</small></span>
      <span><strong>{order.status || "-"}</strong><small>发货 {formatDate(order.actualShipmentDate)} · 到期 {formatDate(order.dueDate)}</small></span>
    </button>
  )) : <div className={styles.crmEmpty}>暂无该客户应收订单。</div>}</div>;
}

function BusinessPaymentList({ payments, canReadPayments, onOpenPayments }: { payments: BusinessPayment[]; canReadPayments: boolean; onOpenPayments: (keyword: string) => void }) {
  if (!canReadPayments) return <div className={styles.crmEmpty}>当前账号没有收款管理查看权限。</div>;
  return <div className={styles.businessList}><h4>最近收款记录</h4>{payments.length ? payments.map((payment) => (
    <button className={styles.businessRow} type="button" key={payment.id} onClick={() => onOpenPayments(payment.orderNo || "")}>
      <span><strong>{payment.orderNo || "未关联订单"}</strong><small>{payment.paymentType || "收款"}</small></span>
      <span><strong>{formatCurrencyAmount(payment.currency || "CNY", payment.amount)}</strong><small>折人民币 {formatCny(payment.amountCny)}</small></span>
      <span><strong>{payment.status || "-"}</strong><small>{formatDate(payment.paymentDate)}</small></span>
    </button>
  )) : <div className={styles.crmEmpty}>暂无该客户收款记录。</div>}</div>;
}
