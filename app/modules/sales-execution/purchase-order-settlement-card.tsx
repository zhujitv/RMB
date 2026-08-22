"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDate, formatDateTime } from "../../formatters";
import styles from "./purchase-order-actions.module.css";
import type { FactoryPurchaseOrder } from "./types";

export function PurchaseOrderSettlementCard({
  executionId,
  shippingStarted,
  order,
  canSettle,
  onChanged,
}: {
  executionId: string;
  shippingStarted: boolean;
  order: FactoryPurchaseOrder;
  canSettle: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const currency = String(order.purchaseCurrency || order.currency || "CNY");
  const [exchangeRate, setExchangeRate] = useState(currency === "CNY" ? "1" : "");
  const [exchangeRateDate, setExchangeRateDate] = useState(() => order.actualDeliveryDate?.slice(0, 10) || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const settlement = order.settlement;
  const eligible = shippingStarted && order.status === "ACCEPTED" && order.productionStatus === "COMPLETED" && Boolean(order.actualDeliveryDate);
  const settlementRevision = Number(settlement?.revision || 1);
  const refundPending = settlement?.status === "PENDING_REFUND";
  const remainingRefundAmount = Number(settlement?.remainingRefundAmount ?? Math.max(
    Number(settlement?.currentPaidAmount || 0) - Number(settlement?.finalPayableAmount || 0),
    0,
  ));
  const latestSettlementCorrection = [...(order.priceCorrections || [])]
    .reverse()
    .find((correction) => (
      correction.status === "APPROVED"
      && correction.settlementFinalPayableAfter !== null
      && correction.settlementFinalPayableAfter !== undefined
    ));

  if (!eligible && !settlement) return null;

  async function settle() {
    if (busyRef.current || !canSettle) return;
    if (currency !== "CNY" && (!exchangeRate || Number(exchangeRate) <= 0)) return;
    if (!window.confirm("确认生成工厂最终结算单吗？临时费用和违约金将冻结；此后价格错误必须走更正申请，付款差额通过尾款或供应商退款处理。")) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/settlement`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: Number(order.revision || 1),
          exchangeRate: currency === "CNY" ? "1" : exchangeRate,
          exchangeRateDate,
        }),
      });
      await onChanged();
    } catch (settlementError) {
      setError(settlementError instanceof Error ? settlementError.message : "生成结算单失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.workflowCard} data-tone={settlement?.status === "SETTLED" ? "success" : refundPending ? "warning" : "neutral"}>
      <div className={styles.workflowHeader}>
        <div><strong>工厂最终结算{settlement ? ` · V${settlementRevision}` : ""}</strong><small>{settlement ? `结算日 ${formatDate(settlement.exchangeRateDate)}` : "发货流程开始后确认最终成本与违约金"}</small></div>
        {settlement ? <span className={styles.settlementStatus} data-status={settlement.status}>{settlement.status === "SETTLED" ? "采购已结清" : refundPending ? "等待供应商退款" : "等待尾款"}</span> : null}
      </div>
      <p className={styles.auditLine}>结算货款按逐行批准的实际装柜数量计算，留仓不计供应商货款；延误违约金仍按原合同采购基数计算。</p>

      {settlement ? (
        <>
          <div className={styles.settlementGrid}>
            <div><span>实际交付货款</span><strong>{formatCurrencyAmount(currency, settlement.baseAmount || 0)}</strong></div>
            <div><span>增加费用</span><strong>+ {formatCurrencyAmount(currency, settlement.increaseAmount || 0)}</strong></div>
            <div><span>其他扣减</span><strong>- {formatCurrencyAmount(currency, settlement.decreaseAmount || 0)}</strong></div>
            <div><span>延误违约金</span><strong>- {formatCurrencyAmount(currency, settlement.delayPenaltyAmount || 0)} · {settlement.delayDays || 0} 天</strong></div>
            <div><span>最终应付</span><strong>{formatCurrencyAmount(currency, settlement.finalPayableAmount || 0)}</strong></div>
            <div><span>{refundPending ? "已付 / 待退" : "已付 / 待付"}</span><strong>{formatCurrencyAmount(currency, settlement.currentPaidAmount || 0)} / {formatCurrencyAmount(currency, refundPending ? remainingRefundAmount : settlement.remainingAmount || 0)}</strong></div>
          </div>
          {latestSettlementCorrection ? (
            <p className={styles.auditLine}>
              结算更正凭证：当前 V{settlementRevision}
              {latestSettlementCorrection.settlementFinalPayableBefore !== null && latestSettlementCorrection.settlementFinalPayableBefore !== undefined
                ? ` · 最终应付 ${formatCurrencyAmount(currency, latestSettlementCorrection.settlementFinalPayableBefore)} → ${formatCurrencyAmount(currency, latestSettlementCorrection.settlementFinalPayableAfter || 0)}`
                : ""}
            </p>
          ) : null}
          <p className={styles.auditLine}>{settlement.status === "SETTLED"
            ? `结清时间：${formatDateTime(settlement.settledAt)}${settlement.settledBy?.name ? ` · ${settlement.settledBy.name}` : ""}`
            : refundPending
              ? "更正后的最终应付低于已付款金额，请在上方登记“供应商退款”；退款完成后系统自动核销并结清。"
              : "请在上方登记“尾款”；累计付款达到最终应付后系统自动核销并结清。"}</p>
        </>
      ) : canSettle ? (
        <div className={styles.workflowControls}>
          <label>结算汇率<input inputMode="decimal" value={exchangeRate} disabled={currency === "CNY" || busy} placeholder="1 外币折合人民币" onChange={(event) => setExchangeRate(event.target.value)} /></label>
          <label>汇率日期<input type="date" value={exchangeRateDate} disabled={busy} onChange={(event) => setExchangeRateDate(event.target.value)} /></label>
          <button type="button" disabled={busy || !exchangeRateDate || (currency !== "CNY" && Number(exchangeRate) <= 0)} onClick={settle}>{busy ? "结算中..." : "生成最终结算单"}</button>
        </div>
      ) : <span className={styles.warning}>生成最终结算单需要采购付款登记权限</span>}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </section>
  );
}
