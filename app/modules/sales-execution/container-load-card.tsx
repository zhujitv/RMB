"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatDate, formatDateTime } from "../../formatters";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  containerLoadStatusLabel,
  containerLoadingReasonLabel,
  containerLoadingResultStatusLabel,
  containerQuantityTotalPositive,
  type ContainerLoad,
  type ContainerLoadingResult,
} from "../container-load";
import styles from "../container-loads.module.css";
import { productionItemDescription } from "./production-progress-presentation";
import { ContainerLoadOfflineResult } from "./container-load-offline-result";
import type { FactoryPurchaseOrder } from "./types";

function orderName(order?: FactoryPurchaseOrder) {
  return order?.supplierNameSnapshot || order?.supplier?.supplierName || order?.supplier?.name || "未知供应商";
}

function resultTable(result: ContainerLoadingResult, order?: FactoryPurchaseOrder) {
  const itemById = new Map((order?.items || []).flatMap((item, index) => item.id ? [[item.id, productionItemDescription(item, index)]] : []));
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>产品</th><th>本柜计划</th><th>本柜实装</th><th>累计已装</th><th>生产留仓</th></tr></thead><tbody>{result.items.map((item) => <tr key={item.purchaseOrderItemId}><td>{itemById.get(item.purchaseOrderItemId) || "产品"}</td><td>{item.plannedQuantity}</td><td>{item.loadedQuantity}</td><td>{item.cumulativeApprovedLoadedQuantity}</td><td>{item.warehouseRetainedQuantity}</td></tr>)}</tbody></table></div>;
}

export function ContainerLoadCard({ executionId, load, allLoads, orders, canManage, shippingStarted, onEdit, onSaved }: {
  executionId: string; load: ContainerLoad; allLoads: ContainerLoad[]; orders: FactoryPurchaseOrder[];
  canManage: boolean; shippingStarted: boolean; onEdit: () => void; onSaved: (message: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const busyRef = useRef(false);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const purchaseOrderIds = [...new Set(load.allocations.map((allocation) => allocation.purchaseOrderId))];
  const supplierCount = new Set(purchaseOrderIds.map((id) => orderById.get(id)?.supplierId || id)).size;
  const pending = load.loadingResults.filter((result) => result.status === "PENDING");
  const approvedIds = new Set(load.loadingResults.filter((result) => result.status === "APPROVED").map((result) => result.purchaseOrderId));
  const approvedLoaded = load.loadingResults.filter((result) => result.status === "APPROVED").flatMap((result) => result.items.map((item) => item.loadedQuantity));
  const releaseReady = purchaseOrderIds.length > 0 && !pending.length && purchaseOrderIds.every((id) => approvedIds.has(id)) && containerQuantityTotalPositive(approvedLoaded);
  useWorkspaceTabBusy(busy);

  async function run(task: () => Promise<{ message?: string }>, fallback: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await task();
      await onSaved(response.message || fallback);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "柜总单操作失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function mutate(action: "open" | "release" | "void") {
    let extra: Record<string, string> = {};
    if (action === "open" && !window.confirm("开放后柜资料和计划分配将冻结，确认开放供应商填报吗？")) return;
    if (action === "release") {
      if (!window.confirm("确认所有供应商实装结果无误并最终放行该柜吗？")) return;
      const remark = window.prompt("放行备注（可选）") || "";
      extra = { remark: remark.trim() };
    }
    if (action === "void") {
      const reason = window.prompt("请输入作废原因");
      if (!reason?.trim()) return;
      extra = { reason: reason.trim() };
    }
    void run(() => apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/container-loads/${encodeURIComponent(load.id)}/${action}`, {
      method: "POST", body: JSON.stringify({ expectedRevision: load.revision, ...extra }),
    }), action === "open" ? "柜总单已开放填报" : action === "release" ? "柜总单已最终放行" : "柜总单已作废");
  }

  function decide(result: ContainerLoadingResult, decision: "APPROVED" | "REJECTED") {
    const remark = String(remarks[result.id] || "").trim();
    if (decision === "REJECTED" && !remark) { setError("拒绝实装差异时必须填写原因"); return; }
    if (!window.confirm(`确认${decision === "APPROVED" ? "批准" : "拒绝"}${orderName(orderById.get(result.purchaseOrderId))}在本柜的实装结果吗？`)) return;
    void run(() => apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(result.purchaseOrderId)}/loading-result-decision`, {
      method: "POST",
      body: JSON.stringify({ containerLoadId: load.id, expectedRevision: load.revision, loadingResultId: result.id, decision, remark }),
    }), decision === "APPROVED" ? "实装差异已批准" : "实装差异已拒绝");
  }

  return <article className={styles.card} data-status={load.status}>
    <header className={styles.cardHeader}><div><p className={styles.eyebrow}>第 {load.sequenceNo} 柜</p><h4>{load.containerNo || "柜号待填写"}</h4><p>{load.containerType || "柜型未填"}{load.sealNo ? ` · 封号 ${load.sealNo}` : ""}</p></div><span className={styles.status} data-status={load.status}>{containerLoadStatusLabel(load.status)}</span></header>
    <div className={styles.facts}><div><span>装柜日期</span><strong>{formatDate(load.loadingDate)}</strong></div><div><span>供应商</span><strong>{supplierCount} 家</strong></div><div><span>计划明细</span><strong>{load.allocations.length} 条</strong></div><div><span>柜版本</span><strong>V{load.revision}</strong></div></div>
    <div className={styles.toolbar}>{canManage && load.status === "DRAFT" ? <><button className={styles.secondaryButton} type="button" disabled={busy || shippingStarted} onClick={onEdit}>编辑草稿</button><button className={styles.button} type="button" disabled={busy || shippingStarted || !load.containerNo || !load.loadingDate || !load.allocations.length} onClick={() => mutate("open")}>开放供应商填报</button></> : null}{canManage && load.status === "OPEN" ? <button className={styles.button} type="button" disabled={busy || shippingStarted || !releaseReady} title={releaseReady ? undefined : "所有供应商实装结果确认后才能放行"} onClick={() => mutate("release")}>最终放行</button> : null}{canManage && (load.status === "DRAFT" || load.status === "OPEN") ? <button className={styles.dangerButton} type="button" disabled={busy || shippingStarted || pending.length > 0 || approvedIds.size > 0} onClick={() => mutate("void")}>作废该柜</button> : null}</div>
    {load.status === "OPEN" && !releaseReady ? <div className={styles.warning}>{pending.length ? `${pending.length} 个供应商采购槽位的实装差异待审批` : "等待所有供应商提交本柜实装结果"}</div> : null}
    {purchaseOrderIds.map((purchaseOrderId) => { const order = orderById.get(purchaseOrderId); const allocations = load.allocations.filter((allocation) => allocation.purchaseOrderId === purchaseOrderId); return <section className={styles.supplierGroup} key={purchaseOrderId}><div className={styles.sectionHeader}><div><strong>{orderName(order)}</strong><small>{order?.poNo || order?.purchaseOrderNo || "采购单"} · {allocations.length} 条计划</small></div>{order ? <ContainerLoadOfflineResult executionId={executionId} load={load} allLoads={allLoads} order={order} allocations={allocations} canManage={canManage && !shippingStarted} onSaved={onSaved} /> : null}</div><div className={styles.quantitySummary}>{allocations.map((allocation) => { const item = order?.items?.find((entry) => entry.id === allocation.purchaseOrderItemId); return <span key={allocation.id}><strong>{item ? productionItemDescription(item, 0) : "产品"}</strong>：计划 {allocation.plannedQuantity}</span>; })}</div></section>; })}
    {load.loadingResults.length ? <ol className={styles.resultList}>{load.loadingResults.map((result) => { const order = orderById.get(result.purchaseOrderId); return <li className={styles.result} data-status={result.status} key={result.id}><div className={styles.resultHeader}><strong>{orderName(order)} · 第 {result.sequenceNo} 次 · {containerLoadingResultStatusLabel(result.status)}</strong><span className={styles.status} data-status={result.status}>{containerLoadingReasonLabel(result.reason)}</span></div><p className={styles.meta}>{result.source === "INTERNAL_OFFLINE" ? "内部代录" : "供应商门户"} · 联系人 {result.supplierContact || "-"} · 提交 {formatDateTime(result.requestedAt)}{result.requestedBy?.name ? ` / ${result.requestedBy.name}` : ""}</p>{result.reasonDetail ? <p className={styles.meta}>差异说明：{result.reasonDetail}</p> : null}{resultTable(result, order)}{result.status === "PENDING" && canManage ? <div className={styles.decision}><textarea aria-label={`${orderName(order)}实装审批备注`} value={remarks[result.id] || ""} maxLength={2000} disabled={busy} placeholder="批准备注可选；拒绝时必须填写原因" onChange={(event) => setRemarks((current) => ({ ...current, [result.id]: event.target.value }))} /><div className={styles.decisionActions}><button className={styles.button} type="button" disabled={busy} onClick={() => decide(result, "APPROVED")}>批准</button><button className={styles.dangerButton} type="button" disabled={busy || !String(remarks[result.id] || "").trim()} onClick={() => decide(result, "REJECTED")}>拒绝</button></div></div> : null}{result.decidedAt ? <p className={styles.meta}>决定：{formatDateTime(result.decidedAt)}{result.decidedBy?.name ? ` / ${result.decidedBy.name}` : ""}{result.decisionRemark ? ` · ${result.decisionRemark}` : ""}</p> : null}</li>; })}</ol> : null}
    {load.releasedAt ? <p className={styles.notice}>最终放行：{formatDateTime(load.releasedAt)}{load.releasedBy?.name ? ` · ${load.releasedBy.name}` : ""}{load.releaseRemark ? ` · ${load.releaseRemark}` : ""}</p> : null}{load.voidedAt ? <p className={styles.error}>已作废：{formatDateTime(load.voidedAt)}{load.voidReason ? ` · ${load.voidReason}` : ""}</p> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}
  </article>;
}
