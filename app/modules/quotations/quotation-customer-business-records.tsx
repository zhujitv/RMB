import { useEffect, useState } from "react";
import { SideDetailDrawer } from "../../components";
import { apiJson } from "../../api";
import { formatCny, formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { QuickCreatePaymentPanel } from "../payments/quick-payment-panel";
import type { PaymentOrderOption, PaymentRow } from "../payments/types";
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
  customer, canReadOrders, canReadPayments, canRegisterPayments, canConfirmPayments, onOpenOrders, onOpenPayments,
}: {
  customer: CustomerInsight; canReadOrders: boolean; canReadPayments: boolean; canRegisterPayments: boolean; canConfirmPayments: boolean;
  onOpenOrders: (keyword: string) => void; onOpenPayments: (keyword: string) => void;
}) {
  const [records, setRecords] = useState<BusinessRecords | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrderOption | null>(null);
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
  }, [customer.customerId, canReadOrders, canReadPayments, reloadToken]);

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
      {notice ? <div className={shell.infoStrip}>{notice}</div> : null}
      {!loading && !error ? <>
        <div className={styles.businessStats}>
          <article><span>发货订单</span><strong>{summary.shippedCount || 0}/{summary.orderCount || 0}</strong><small>已发货 / 全部订单</small></article>
          <article><span>应收总额</span><strong>{formatCny(summary.receivableCny)}</strong><small>按现有应收订单汇总</small></article>
          <article><span>已到账</span><strong>{formatCny(summary.receivedCny)}</strong><small>来自已到账收款</small></article>
          <article><span>未收余额</span><strong>{formatCny(summary.outstandingCny)}</strong><small>{summary.overdueCount || 0} 单逾期</small></article>
        </div>
        <div className={styles.businessGrid}>
          <BusinessOrderList
            orders={orders}
            canReadOrders={canReadOrders}
            canRegisterPayments={canRegisterPayments}
            onOpenOrders={onOpenOrders}
            onRegisterPayment={(order) => setPaymentOrder(paymentOrderFromBusinessOrder(order, customer))}
          />
          <BusinessPaymentList payments={payments} canReadPayments={canReadPayments} onOpenPayments={onOpenPayments} />
        </div>
      </> : null}
      {paymentOrder ? (
        <SideDetailDrawer
          ariaLabel="CRM 登记收款"
          kicker="客户 CRM"
          title={`登记收款 · ${paymentOrder.orderNo || "未编号"}`}
          subtitle="调用原收款管理接口保存"
          onClose={() => setPaymentOrder(null)}
        >
          <QuickCreatePaymentPanel
            key={paymentOrder.id}
            initialOrder={paymentOrder}
            canConfirmArrived={canConfirmPayments}
            onCancel={() => setPaymentOrder(null)}
            onConflict={async () => {
              setReloadToken((value) => value + 1);
              setError("该订单或收款数据刚刚被更新，请核对后重新登记。");
            }}
            onSaved={(payment?: PaymentRow | null) => {
              setPaymentOrder(null);
              setNotice(payment?.id ? "收款已保存，客户经营记录已刷新。" : "收款已保存。");
              setReloadToken((value) => value + 1);
            }}
          />
        </SideDetailDrawer>
      ) : null}
    </section>
  );
}

function paymentOrderFromBusinessOrder(order: BusinessOrder, customer: CustomerInsight): PaymentOrderOption {
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo,
    customerName: customer.name,
    customerFullName: customer.legalName,
    customerShortName: customer.name,
    currency: order.currency,
    finalReceivableAmount: order.finalReceivableAmount,
    finalReceivableAmountCny: order.finalReceivableAmountCny,
    outstandingCny: order.summary?.outstandingCny,
    summary: {
      receivableAmount: order.finalReceivableAmount,
      receivableCny: order.finalReceivableAmountCny,
      outstandingCny: order.summary?.outstandingCny,
    },
  };
}

function BusinessOrderList({ orders, canReadOrders, canRegisterPayments, onOpenOrders, onRegisterPayment }: {
  orders: BusinessOrder[]; canReadOrders: boolean; canRegisterPayments: boolean;
  onOpenOrders: (keyword: string) => void; onRegisterPayment: (order: BusinessOrder) => void;
}) {
  if (!canReadOrders) return <div className={styles.crmEmpty}>当前账号没有应收订单查看权限。</div>;
  return <div className={styles.businessList}><h4>最近发货/应收订单</h4>{orders.length ? orders.map((order) => (
    <div className={styles.businessRow} key={order.id}>
      <span><strong>{order.orderNo || "未编号"}</strong><small>提单 {order.blNo || "-"}</small></span>
      <span><strong>{formatCurrencyAmount(order.currency || "CNY", order.finalReceivableAmount)}</strong><small>未收 {formatCny(order.summary?.outstandingCny)}</small></span>
      <span><strong>{order.status || "-"}</strong><small>发货 {formatDate(order.actualShipmentDate)} · 到期 {formatDate(order.dueDate)}</small></span>
      <span className={styles.businessRowActions}>
        <button className={shell.secondaryButton} type="button" onClick={() => onOpenOrders(order.orderNo || "")}>查看订单</button>
        {canRegisterPayments ? <button className={shell.primaryButtonCompact} type="button" onClick={() => onRegisterPayment(order)}>登记收款</button> : null}
      </span>
    </div>
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
