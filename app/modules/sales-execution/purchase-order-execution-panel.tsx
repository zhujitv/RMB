"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDate, formatDateTime } from "../../formatters";
import { formatTolerancePercent } from "../delivery-quantity-variance";
import styles from "./purchase-order-actions.module.css";
import { PurchaseOrderConfirmationAudit } from "./purchase-order-confirmation-audit";
import { PurchaseOrderDeliveryActions } from "./purchase-order-delivery-actions";
import { PurchaseOrderDeliveryQuantityVariance } from "./purchase-order-delivery-quantity-variance";
import { PurchaseOrderOfflineQuantityVariance } from "./purchase-order-offline-quantity-variance";
import { PurchaseOrderOfflineProductionCompletion } from "./purchase-order-offline-production-completion";
import { PurchaseOrderOfflineProductionProgress } from "./purchase-order-offline-production-progress";
import { PurchaseOrderOfflineResponse } from "./purchase-order-offline-response";
import { PurchaseOrderPriceCorrection } from "./purchase-order-price-correction";
import { PurchaseOrderProductionProgressSummary } from "./purchase-order-production-progress-summary";
import { PurchaseOrderQuantityCorrection } from "./purchase-order-quantity-correction";
import { PurchaseOrderReassignmentCard } from "./purchase-order-reassignment-card";
import { PurchaseOrderSettlementCard } from "./purchase-order-settlement-card";
import { factoryProductionStatusLabel } from "./status-values";
import { numeric, type FactoryPurchaseOrder } from "./types";

function dateAfter(value: string | null | undefined, days: number) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date.toISOString());
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function requestKey(
  ref: { current: { fingerprint: string; key: string } | null },
  prefix: string,
  fingerprint: string,
) {
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: `${prefix}-${Date.now()}-${crypto.randomUUID()}` };
  }
  return ref.current.key;
}

export function PurchaseOrderExecutionPanel({
  executionId,
  executionRevision,
  shippingStarted,
  order,
  canStartProduction,
  canRecordPayment,
  canAddAdjustment,
  onChanged,
}: {
  executionId: string;
  executionRevision: number;
  shippingStarted: boolean;
  order: FactoryPurchaseOrder;
  canStartProduction: boolean;
  canRecordPayment: boolean;
  canAddAdjustment: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentKind, setPaymentKind] = useState("PREPAYMENT");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayInShanghai);
  const [bankReference, setBankReference] = useState("");
  const [paymentRemark, setPaymentRemark] = useState("");
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentKind, setAdjustmentKind] = useState("TEMPORARY_FEE");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentDescription, setAdjustmentDescription] = useState("");
  const paymentRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const adjustmentRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const busyRef = useRef(false);
  const currency = String(order.purchaseCurrency || order.currency || "CNY");
  const active = order.status === "ACCEPTED";
  const settlementPending = order.settlement?.status === "PENDING_PAYMENT";
  const settlementClosed = order.settlement?.status === "SETTLED";

  async function run(task: () => Promise<unknown>, successMessage: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      setMessage(successMessage);
      await onChanged();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "操作失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function startProduction() {
    if (!window.confirm("确认将该工厂采购单标记为“开始生产”吗？")) return;
    void run(
      () => apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/production`, {
        method: "POST",
        body: JSON.stringify({ action: "START" }),
      }),
      "该工厂已独立进入生产",
    );
  }

  function showOfflineSaved(savedMessage: string) {
    setError("");
    setMessage(savedMessage);
  }

  function submitPayment() {
    void run(async () => {
      const kind = order.settlement ? "BALANCE" : paymentKind;
      const payload = { kind, amount: paymentAmount, paidAt, bankReference, remark: paymentRemark };
      await apiJson(`/api/factory-purchase-orders/${encodeURIComponent(order.id)}/payments`, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          idempotencyKey: requestKey(paymentRequestRef, "factory-payment", JSON.stringify(payload)),
        }),
      });
      paymentRequestRef.current = null;
      setPaymentOpen(false);
      setPaymentAmount("");
      setBankReference("");
      setPaymentRemark("");
    }, "采购付款已登记");
  }

  function submitAdjustment() {
    void run(async () => {
      const payload = { kind: adjustmentKind, direction: "INCREASE", amount: adjustmentAmount, description: adjustmentDescription };
      await apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          idempotencyKey: requestKey(adjustmentRequestRef, "factory-adjustment", JSON.stringify(payload)),
        }),
      });
      adjustmentRequestRef.current = null;
      setAdjustmentOpen(false);
      setAdjustmentAmount("");
      setAdjustmentDescription("");
    }, "临时费用已登记为暂估");
  }

  function voidPayment(paymentId: string) {
    const reason = window.prompt("请输入采购付款冲销原因");
    if (!reason?.trim()) return;
    void run(
      () => apiJson(`/api/factory-purchase-orders/${encodeURIComponent(order.id)}/payments/${encodeURIComponent(paymentId)}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: reason.trim() }),
      }),
      "采购付款已冲销",
    );
  }

  function voidAdjustment(adjustmentId: string) {
    const reason = window.prompt("请输入暂估费用作废原因");
    if (!reason?.trim()) return;
    void run(
      () => apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/adjustments/${encodeURIComponent(adjustmentId)}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: reason.trim() }),
      }),
      "暂估费用已作废",
    );
  }

  const activePayments = (order.payments || []).filter((payment) => payment.status !== "VOIDED");
  const activeAdjustments = (order.adjustments || []).filter((adjustment) => adjustment.status !== "VOIDED");
  return (
    <section className={styles.executionPanel}>
      <div className={styles.metricGrid}>
        <div><span>生产状态</span><strong>{factoryProductionStatusLabel(order.productionStatus)}</strong></div>
        <div><span>首次确认交期</span><strong>{formatDate(order.initialSupplierDeliveryDate)}</strong></div>
        <div><span>当前生效交期</span><strong>{formatDate(order.confirmedSupplierDeliveryDate || order.supplierDeliveryDate || order.requestedDeliveryDate)}</strong></div>
        <div><span>免罚截止</span><strong>{dateAfter(order.initialSupplierDeliveryDate, Number(order.delayGraceDays || 10))}</strong></div>
        <div><span>预计延误扣款</span><strong>{Number(order.estimatedPenaltyDays || 0)} 天 · {formatCurrencyAmount(currency, order.estimatedPenaltyAmount || 0)}</strong></div>
        <div><span>预付款</span><strong>{formatCurrencyAmount(currency, order.paidPrepaymentAmount || 0)} / {formatCurrencyAmount(currency, order.prepaymentRequiredAmount || 0)}</strong></div>
        <div><span>交付数量公差</span><strong>±{formatTolerancePercent(order.deliveryQuantityToleranceRatio || "0.05")}%（本单冻结）</strong></div>
      </div>

      {order.productionStartedAt ? <p className={styles.auditLine}>开始生产：{formatDateTime(order.productionStartedAt)}{order.productionStartedBy?.name ? ` · ${order.productionStartedBy.name}` : ""}</p> : null}
      <PurchaseOrderProductionProgressSummary order={order} />
      <PurchaseOrderDeliveryQuantityVariance executionId={executionId} order={order} canManage={canStartProduction} onChanged={onChanged} />
      <PurchaseOrderConfirmationAudit executionId={executionId} order={order} canManage={canStartProduction} onChanged={onChanged} />
      <PurchaseOrderReassignmentCard executionId={executionId} executionRevision={executionRevision} order={order} canManage={canStartProduction} onChanged={onChanged} />
      <PurchaseOrderDeliveryActions executionId={executionId} order={order} canManage={canStartProduction} onChanged={onChanged} />
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.actionRow}>
        <PurchaseOrderOfflineResponse executionId={executionId} shippingStarted={shippingStarted} order={order} canManage={canStartProduction} onChanged={onChanged} onSaved={showOfflineSaved} />
        <PurchaseOrderOfflineProductionProgress executionId={executionId} order={order} canManage={canStartProduction} onChanged={onChanged} onSaved={showOfflineSaved} />
        <PurchaseOrderOfflineQuantityVariance executionId={executionId} order={order} canManage={canStartProduction} onChanged={onChanged} onSaved={showOfflineSaved} />
        <PurchaseOrderOfflineProductionCompletion executionId={executionId} order={order} canManage={canStartProduction} onChanged={onChanged} onSaved={showOfflineSaved} />
        <PurchaseOrderQuantityCorrection executionId={executionId} executionRevision={executionRevision} shippingStarted={shippingStarted} order={order} canManage={canStartProduction} onChanged={onChanged} onSaved={showOfflineSaved} />
        <PurchaseOrderPriceCorrection executionId={executionId} order={order} canManage={canAddAdjustment} onChanged={onChanged} onSaved={showOfflineSaved} />
        {canStartProduction && active && order.productionStatus === "READY" ? <button type="button" disabled={busy} onClick={startProduction}>开始生产</button> : null}
        {order.productionStatus === "IN_PRODUCTION" ? <span className={styles.warning}>{order.productionProgress?.allCompleted ? "进度已达 100%，等待确认生产完成" : "等待供应商持续填报生产进度"}</span> : null}
        {order.productionStatus === "WAITING_PREPAYMENT" ? <span className={styles.warning}>预付款到账后才可生产</span> : null}
        {canRecordPayment && active && !settlementClosed ? <button type="button" disabled={busy} onClick={() => { if (settlementPending) setPaymentKind("BALANCE"); setPaymentOpen((value) => !value); }}>{settlementPending ? "登记尾款" : "登记采购付款"}</button> : null}
        {canAddAdjustment && active && !order.settlement ? <button type="button" disabled={busy} onClick={() => setAdjustmentOpen((value) => !value)}>登记临时费用</button> : null}
      </div>

      {paymentOpen ? (
        <div className={styles.entryGrid}>
          <label>付款类型<select value={order.settlement ? "BALANCE" : paymentKind} disabled={Boolean(order.settlement)} onChange={(event) => setPaymentKind(event.target.value)}>{order.settlement ? <option value="BALANCE">尾款</option> : <><option value="PREPAYMENT">预付款</option><option value="BALANCE">尾款</option></>}</select></label>
          <label>付款金额<input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
          <label>付款日期<input type="date" max={todayInShanghai()} value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
          <label>银行流水号<input value={bankReference} onChange={(event) => setBankReference(event.target.value)} /></label>
          <label className={styles.wide}>付款备注<input value={paymentRemark} onChange={(event) => setPaymentRemark(event.target.value)} /></label>
          <button type="button" disabled={busy || numeric(paymentAmount) <= 0 || !paidAt} onClick={submitPayment}>确认登记</button>
        </div>
      ) : null}

      {adjustmentOpen ? (
        <div className={styles.entryGrid}>
          <label>费用类型<select value={adjustmentKind} onChange={(event) => setAdjustmentKind(event.target.value)}><option value="TEMPORARY_FEE">临时费用</option><option value="OTHER">其他调整</option></select></label>
          <label>金额<input inputMode="decimal" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} /></label>
          <label className={styles.wide}>费用说明<input value={adjustmentDescription} onChange={(event) => setAdjustmentDescription(event.target.value)} placeholder="例如：临时包装费、加急人工费" /></label>
          <button type="button" disabled={busy || numeric(adjustmentAmount) <= 0 || !adjustmentDescription.trim()} onClick={submitAdjustment}>保存暂估费用</button>
        </div>
      ) : null}

      {activePayments.length ? <div className={styles.ledgerList}><strong>付款记录</strong>{activePayments.map((payment) => <span key={payment.id}>{payment.kind === "PREPAYMENT" ? "预付款" : "尾款"} · {formatCurrencyAmount(currency, payment.amount || 0)} · {formatDate(payment.paidAt)}{canRecordPayment && !settlementClosed && (!order.settlement || payment.kind === "BALANCE") ? <button type="button" disabled={busy} onClick={() => voidPayment(payment.id)}>冲销</button> : null}</span>)}</div> : null}
      {activeAdjustments.length ? <div className={styles.ledgerList}><strong>费用调整</strong>{activeAdjustments.map((adjustment) => <span key={adjustment.id}>{adjustment.description || "费用调整"} · {adjustment.direction === "DECREASE" ? "-" : "+"}{formatCurrencyAmount(currency, adjustment.amount || 0)} · {adjustment.status === "CONFIRMED" ? "已确认" : "待结算"}{canAddAdjustment && !order.settlement ? <button type="button" disabled={busy} onClick={() => voidAdjustment(adjustment.id)}>作废</button> : null}</span>)}</div> : null}
      <PurchaseOrderSettlementCard executionId={executionId} shippingStarted={shippingStarted} order={order} canSettle={canRecordPayment} onChanged={onChanged} />
    </section>
  );
}
