"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "./purchase-order-actions.module.css";
import type { FactoryPurchaseOrder } from "./types";

export function PurchaseOrderDeliveryActions({
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
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const latestResponse = order.supplierResponseHistory?.at(-1);
  const proposalPending = order.status === "DELIVERY_PROPOSED" && latestResponse?.action === "DELIVERY_PROPOSED";
  const deliveryFrozen = order.productionStatus === "COMPLETED" || Boolean(order.actualDeliveryDate);

  async function decide(action: "ACCEPT" | "REJECT") {
    if (busyRef.current || (action === "REJECT" && !remark.trim())) return;
    const label = action === "ACCEPT" ? "接受" : "拒绝";
    if (!window.confirm(`确认${label}供应商提出的新交期吗？`)) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/delivery-proposal-decision`, {
        method: "POST",
        body: JSON.stringify({ action, remark: remark.trim(), expectedRevision: Number(order.revision || 1) }),
      });
      setRemark("");
      await onChanged();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "处理供应商新交期失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {proposalPending ? <section className={styles.workflowCard} data-tone="warning"><div className={styles.workflowHeader}><div><strong>供应商新交期待内部确认</strong><small>建议日期：{formatDate(latestResponse?.deliveryDate)} · {latestResponse?.remark || "未填写说明"}</small></div></div>{deliveryFrozen ? <span className={styles.warning}>该提案未在完工前确认，现已随完工冻结，不能再改变生效交期。</span> : canManage ? <div className={styles.workflowControls}><input aria-label="交期内部决定备注" value={remark} maxLength={2000} placeholder="内部备注；拒绝时必填原因" onChange={(event) => setRemark(event.target.value)} /><button type="button" disabled={busy} onClick={() => void decide("ACCEPT")}>接受新交期</button><button className={styles.dangerButton} type="button" disabled={busy || !remark.trim()} onClick={() => void decide("REJECT")}>拒绝新交期</button></div> : <span className={styles.warning}>等待有权限的内部人员处理</span>}</section> : null}
      {latestResponse?.internalDecision ? <p className={styles.auditLine}>最近交期决定：{latestResponse.internalDecision === "ACCEPTED" ? "已接受" : "已拒绝"} · {formatDateTime(latestResponse.internalDecidedAt)}{latestResponse.internalDecidedBy?.name ? ` · ${latestResponse.internalDecidedBy.name}` : ""}{latestResponse.internalDecisionRemark ? ` · ${latestResponse.internalDecisionRemark}` : ""}</p> : null}
      {order.productionStatus === "COMPLETED" && !order.actualDeliveryDate ? <p className={styles.auditLine}>生产完成后请通过“最终装柜结果”登记实装数量；旧实际交付入口已停用，避免重复登记。</p> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </>
  );
}
