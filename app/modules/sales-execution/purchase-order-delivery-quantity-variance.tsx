"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatDateTime } from "../../formatters";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  formatSignedDifference,
  varianceChannelLabel,
  varianceStatusLabel,
  type DeliveryQuantityVariance,
} from "../delivery-quantity-variance";
import styles from "./purchase-order-delivery-quantity-variance.module.css";
import { productionItemDescription } from "./production-progress-presentation";
import type { FactoryPurchaseOrder } from "./types";

function sourceLabel(source: string) {
  return source === "INTERNAL_OFFLINE" ? "内部代录" : "供应商门户";
}

export function PurchaseOrderDeliveryQuantityVariance({
  executionId,
  order,
  canManage,
  onChanged,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const history = order.deliveryQuantityVariances || [];
  const pending = history.find((entry) => entry.status === "PENDING");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);
  const itemById = new Map((order.items || []).flatMap((item, index) => item.id ? [[String(item.id), productionItemDescription(item, index)]] : []));
  useWorkspaceTabBusy(busy);
  if (!history.length) return null;

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!pending || busyRef.current || (decision === "REJECTED" && !remark.trim())) return;
    const label = decision === "APPROVED" ? "批准" : "拒绝";
    if (!window.confirm(`确认${label}第 ${pending.sequenceNo} 次交付数量差异申请吗？`)) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiJson(
        `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/quantity-variance-decision`,
        {
          method: "POST",
          body: JSON.stringify({
            varianceId: pending.id,
            decision,
            remark: remark.trim(),
            expectedRevision: Number(order.revision || 1),
          }),
        },
      );
      setRemark("");
      await onChanged();
      setNotice(`第 ${pending.sequenceNo} 次交付数量差异申请已${label}`);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "审批交付数量差异失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function itemTable(variance: DeliveryQuantityVariance) {
    return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>产品</th><th>订单数量</th><th>拟交付数量</th><th>差额</th></tr></thead><tbody>{variance.items.map((line) => <tr key={line.purchaseOrderItemId}><td>{itemById.get(line.purchaseOrderItemId) || "产品"}</td><td>{line.orderedQuantity}</td><td>{line.proposedQuantity}</td><td>{formatSignedDifference(line.orderedQuantity, line.proposedQuantity)}</td></tr>)}</tbody></table></div>;
  }

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div><strong>交付数量差异</strong><small>所有数量差异均需内部审批；批准后成为生产完成和实际交付的唯一数量目标。</small></div>
        {pending ? <span className={styles.pill}>待审批</span> : null}
      </header>

      {pending ? (
        <>
          <p className={styles.meta}>{sourceLabel(pending.source)} · {varianceChannelLabel(pending.channel)} · 供应商联系人：{pending.supplierContact || "-"} · 实际申请：{formatDateTime(pending.supplierRequestedAt)} · 系统记录：{formatDateTime(pending.requestedAt)}{pending.requestedBy?.name ? ` / ${pending.requestedBy.name}` : ""}</p>
          <p className={styles.meta}>申请原因：{pending.reason || "-"}</p>
          {itemTable(pending)}
          {canManage ? <div className={styles.decision}><textarea aria-label="数量差异审批备注" maxLength={2000} value={remark} disabled={busy} placeholder="批准备注可选；拒绝时必须填写原因" onChange={(event) => setRemark(event.target.value)} /><div className={styles.decisionRow}><span className={styles.meta}>拒绝后供应商可修正并重新提交；批准后不能重复申请。</span><div className={styles.buttons}><button type="button" disabled={busy} onClick={() => void decide("APPROVED")}>批准</button><button className={styles.reject} type="button" disabled={busy || !remark.trim()} onClick={() => void decide("REJECTED")}>拒绝</button></div></div></div> : <p className={styles.meta}>等待有审批权限的内部人员处理。</p>}
        </>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}

      <h4 className={styles.historyTitle}>申请与决定历史（{history.length}）</h4>
      <ol className={styles.history}>
        {history.map((entry) => (
          <li key={entry.id} data-status={entry.status}>
            <div className={styles.historyMeta}><strong>第 {entry.sequenceNo} 次 · {varianceStatusLabel(entry.status)} · {sourceLabel(entry.source)} / {varianceChannelLabel(entry.channel)}</strong><time>系统记录：{formatDateTime(entry.requestedAt)}</time></div>
            <p>供应商联系人：{entry.supplierContact || "-"} · 实际申请：{formatDateTime(entry.supplierRequestedAt)} · 系统记录：{formatDateTime(entry.requestedAt)}{entry.requestedBy?.name ? ` / ${entry.requestedBy.name}` : ""}</p>
            <p>申请原因：{entry.reason || "-"}</p>
            {entry.decidedAt ? <p>决定时间：{formatDateTime(entry.decidedAt)}{entry.decidedBy?.name ? ` / ${entry.decidedBy.name}` : ""}{entry.decisionRemark ? ` · 审批备注：${entry.decisionRemark}` : ""}</p> : null}
            {itemTable(entry)}
          </li>
        ))}
      </ol>
    </section>
  );
}
