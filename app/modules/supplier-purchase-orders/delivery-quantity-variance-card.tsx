"use client";

import {
  formatDifferenceRate,
  formatSignedDifference,
  formatTolerancePercent,
  quantitiesEqual,
  quantityToleranceRange,
  varianceStatusLabel,
} from "../delivery-quantity-variance";
import styles from "./delivery-quantity-variance-card.module.css";
import { formatDate } from "./presentation";
import type { SupplierPurchaseOrderDto } from "./types";
import { useDeliveryQuantityVariance } from "./use-delivery-quantity-variance";

function sourceLabel(source: string) {
  return source === "INTERNAL_OFFLINE" ? "内部代录" : "供应商门户";
}

export function DeliveryQuantityVarianceCard({
  canWrite,
  detail,
  disabled,
  onSaved,
}: {
  canWrite: boolean;
  detail: SupplierPurchaseOrderDto;
  disabled: boolean;
  onSaved: (saved: SupplierPurchaseOrderDto, message: string) => void;
}) {
  const state = useDeliveryQuantityVariance({ canWrite, detail, disabled, onSaved });
  const itemById = new Map(detail.items.map((item) => [item.id, item]));
  const visible = state.eligible || state.history.length > 0
    || (detail.status === "ACCEPTED" && detail.productionStatus === "IN_PRODUCTION" && !detail.actualDeliveryDate);
  if (!visible) return null;

  return (
    <section className={styles.card} aria-labelledby="delivery-quantity-variance-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>交付数量管理</p>
          <h3 id="delivery-quantity-variance-heading">交付数量差异申请</h3>
          <p className={styles.hint}>若最终交付数量与采购数量不同，请在实际交付前提交；每一行均需填写并等待内部审批。</p>
        </div>
        <span className={styles.tolerance}>本单冻结公差 ±{formatTolerancePercent(state.tolerance)}%</span>
      </header>

      {state.eligible ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>产品</th><th>采购数量</th><th>拟交付数量</th><th>差额 / 差异率</th><th>允许范围</th></tr></thead>
              <tbody>
                {detail.items.map((item) => {
                  const proposed = state.values[item.id] ?? "";
                  const range = quantityToleranceRange(item.quantity, state.tolerance);
                  const changed = !quantitiesEqual(item.quantity, proposed);
                  return (
                    <tr key={item.id}>
                      <td><strong>{item.productDescription || "-"}</strong><small>{item.unit || "-"}</small></td>
                      <td>{item.quantity}</td>
                      <td><input aria-label={`${item.productDescription || "产品"}拟交付数量`} inputMode="decimal" maxLength={19} value={proposed} disabled={disabled || state.submitting} onChange={(event) => state.setQuantity(item.id, event.target.value)} /></td>
                      <td><span className={styles.difference} data-changed={changed}>{formatSignedDifference(item.quantity, proposed)}</span><small>{formatDifferenceRate(item.quantity, proposed)}</small></td>
                      <td>{range ? `${range.minimum} — ${range.maximum}` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className={styles.reason}>数量差异原因<textarea maxLength={2000} value={state.reason} disabled={disabled || state.submitting} placeholder="请说明少交或多交原因，以及与订单约定的处理方式" onChange={(event) => state.setReason(event.target.value)} /></label>
          <div className={styles.footer}>
            <p className={styles.validation}>{state.validationError || "数量均在允许公差内，可以提交审批。"}</p>
            <button className={styles.submit} type="button" disabled={disabled || state.submitting || Boolean(state.validationError)} onClick={() => void state.submit()}>{state.submitting ? "提交中..." : "提交数量差异申请"}</button>
          </div>
        </>
      ) : (
        <p className={styles.blocked}>{state.active?.status === "PENDING" ? "当前已有数量差异申请待内部审批，审批完成前不能重复提交。" : state.active?.status === "APPROVED" ? "数量差异已批准，实际交付将按批准后的数量执行。" : "当前阶段不能提交数量差异申请。"}</p>
      )}
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}

      {state.history.length ? (
        <>
          <div className={styles.historyHeader}><h4>申请历史</h4><span>{state.history.length} 次</span></div>
          <ol className={styles.history}>
            {state.history.map((entry) => (
              <li key={entry.id} data-status={entry.status}>
                <div className={styles.historyMeta}><strong>第 {entry.sequenceNo} 次 · {varianceStatusLabel(entry.status)}</strong><time>系统记录：{formatDate(entry.requestedAt, true)}</time></div>
                <p>{sourceLabel(entry.source)} · 联系人：{entry.supplierContact || "-"} · 实际申请：{formatDate(entry.supplierRequestedAt, true)}{entry.decidedAt ? ` · 决定：${formatDate(entry.decidedAt, true)}` : ""}</p>
                <p>申请原因：{entry.reason || "-"}</p>
                <ul>
                  {entry.items.map((line) => {
                    const item = itemById.get(line.purchaseOrderItemId);
                    return <li key={line.purchaseOrderItemId}><span>{item?.productDescription || "产品"}</span><strong>{line.orderedQuantity} → {line.proposedQuantity}（{formatSignedDifference(line.orderedQuantity, line.proposedQuantity)}）</strong></li>;
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
