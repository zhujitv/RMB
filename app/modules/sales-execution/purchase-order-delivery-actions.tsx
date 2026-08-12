"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "./purchase-order-actions.module.css";
import type { FactoryPurchaseOrder } from "./types";

function shanghaiDate(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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
  const [actualDeliveryDate, setActualDeliveryDate] = useState(() => shanghaiDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const latestResponse = order.supplierResponseHistory?.at(-1);
  const proposalPending = order.status === "DELIVERY_PROPOSED" && latestResponse?.action === "DELIVERY_PROPOSED";
  const deliveryFrozen = order.productionStatus === "COMPLETED" || Boolean(order.actualDeliveryDate);

  async function run(path: string, body: Record<string, unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await apiJson(path, { method: "POST", body: JSON.stringify(body) });
      setRemark("");
      await onChanged();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "操作失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function decide(action: "ACCEPT" | "REJECT") {
    if (action === "REJECT" && !remark.trim()) return;
    const label = action === "ACCEPT" ? "接受" : "拒绝";
    if (!window.confirm(`确认${label}供应商提出的新交期吗？`)) return;
    void run(
      `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/delivery-proposal-decision`,
      { action, remark: remark.trim(), expectedRevision: Number(order.revision || 1) },
    );
  }

  function recordActualDelivery() {
    if (!actualDeliveryDate || !window.confirm(`确认实际交付日期为 ${actualDeliveryDate} 吗？登记后不可修改。`)) return;
    void run(
      `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/actual-delivery`,
      { actualDeliveryDate, expectedRevision: Number(order.revision || 1) },
    );
  }

  return (
    <>
      {proposalPending ? (
        <section className={styles.workflowCard} data-tone="warning">
          <div className={styles.workflowHeader}>
            <div><strong>供应商新交期待内部确认</strong><small>建议日期：{formatDate(latestResponse?.deliveryDate)} · {latestResponse?.remark || "未填写说明"}</small></div>
          </div>
          {deliveryFrozen ? <span className={styles.warning}>该提案未在完工前确认，现已随完工冻结，不能再改变生效交期。</span> : canManage ? <div className={styles.workflowControls}>
            <input aria-label="交期内部决定备注" value={remark} maxLength={2000} placeholder="内部备注；拒绝时必填原因" onChange={(event) => setRemark(event.target.value)} />
            <button type="button" disabled={busy} onClick={() => decide("ACCEPT")}>接受新交期</button>
            <button className={styles.dangerButton} type="button" disabled={busy || !remark.trim()} onClick={() => decide("REJECT")}>拒绝新交期</button>
          </div> : <span className={styles.warning}>等待有权限的内部人员处理</span>}
        </section>
      ) : null}

      {latestResponse?.internalDecision ? <p className={styles.auditLine}>最近交期决定：{latestResponse.internalDecision === "ACCEPTED" ? "已接受" : "已拒绝"} · {formatDateTime(latestResponse.internalDecidedAt)}{latestResponse.internalDecidedBy?.name ? ` · ${latestResponse.internalDecidedBy.name}` : ""}{latestResponse.internalDecisionRemark ? ` · ${latestResponse.internalDecisionRemark}` : ""}</p> : null}

      {order.productionStatus === "COMPLETED" && order.status === "ACCEPTED" && !order.actualDeliveryDate && canManage ? (
        <section className={styles.workflowCard} data-tone="success">
          <div className={styles.workflowHeader}>
            <div><strong>登记工厂实际交付日期</strong><small>完工后交期已冻结；实际日期将用于计算第 11 天起的延误违约金。</small></div>
          </div>
          <div className={styles.workflowControls}>
            <input aria-label="工厂实际交付日期" type="date" min={order.productionCompletedAt ? shanghaiDate(order.productionCompletedAt) : undefined} max={shanghaiDate()} value={actualDeliveryDate} onChange={(event) => setActualDeliveryDate(event.target.value)} />
            <button type="button" disabled={busy || !actualDeliveryDate} onClick={recordActualDelivery}>确认实际交付</button>
          </div>
        </section>
      ) : null}

      {order.actualDeliveryDate ? <p className={styles.auditLine}>实际交付：{formatDate(order.actualDeliveryDate)} · 登记于 {formatDateTime(order.actualDeliveryRecordedAt)}{order.actualDeliveryRecordedBy?.name ? ` · ${order.actualDeliveryRecordedBy.name}` : ""}（已冻结）</p> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </>
  );
}
