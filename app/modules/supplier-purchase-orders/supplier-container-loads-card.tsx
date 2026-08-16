"use client";

import { formatDate } from "./presentation";
import {
  containerLoadStatusLabel,
  containerLoadingReasonLabel,
  containerLoadingResultStatusLabel,
  containerQuantityRemaining,
  containerQuantitySum,
  type ContainerLoadingReason,
} from "../container-load";
import styles from "../container-loads.module.css";
import type { SupplierPurchaseOrderDto } from "./types";
import { type SupplierContainerLoad, useSupplierContainerLoading } from "./use-supplier-container-loading";

const REASONS: Array<{ value: ContainerLoadingReason; label: string }> = [
  { value: "EXACT", label: "按本柜计划装柜" },
  { value: "WEIGHT_LIMIT", label: "集装箱限重" },
  { value: "VOLUME_LIMIT", label: "集装箱限容" },
  { value: "OTHER", label: "其它原因" },
];

export function SupplierContainerLoadsCard({ canWrite, detail, disabled, onSaved }: {
  canWrite: boolean;
  detail: SupplierPurchaseOrderDto;
  disabled: boolean;
  onSaved: (saved: SupplierPurchaseOrderDto, message: string) => void;
}) {
  const loads = detail.containerLoads || [];
  if (detail.productionStatus !== "COMPLETED" && !loads.length) return null;
  return <section className={styles.panel} aria-labelledby="supplier-container-loads-heading">
    <header className={styles.header}><div><p className={styles.eyebrow}>装柜协同</p><h3 id="supplier-container-loads-heading">集装箱装柜任务</h3><p>每个集装箱分别显示本采购单的计划量。这里只包含贵司产品，不会显示同柜其它供应商资料。</p></div></header>
    {!loads.length ? <div className={styles.empty}>暂未安排集装箱，请等待业务人员创建并开放装柜任务。</div> : loads.map((load) => <SupplierContainerLoadCard key={load.id} canWrite={canWrite} detail={detail} load={load} disabled={disabled} onSaved={onSaved} />)}
  </section>;
}

function SupplierContainerLoadCard({ canWrite, detail, load, disabled, onSaved }: {
  canWrite: boolean;
  detail: SupplierPurchaseOrderDto;
  load: SupplierContainerLoad;
  disabled: boolean;
  onSaved: (saved: SupplierPurchaseOrderDto, message: string) => void;
}) {
  const state = useSupplierContainerLoading({ canWrite, detail, load, disabled, onSaved });
  const itemById = new Map(detail.items.map((item) => [item.id, item]));
  return <article className={styles.supplierCard} data-status={load.status}>
    <header className={styles.cardHeader}><div><p className={styles.eyebrow}>第 {load.sequenceNo} 柜</p><h4>{load.containerNo || "柜号待更新"}</h4><p>{load.containerType || "柜型未填写"}{load.sealNo ? ` · 封号 ${load.sealNo}` : ""}</p></div><span className={styles.status} data-status={load.status}>{containerLoadStatusLabel(load.status)}</span></header>
    <div className={styles.facts}><div><span>装柜日期</span><strong>{formatDate(load.loadingDate)}</strong></div><div><span>本单计划明细</span><strong>{state.allocations.length} 条</strong></div><div><span>填报状态</span><strong>{state.active ? containerLoadingResultStatusLabel(state.active.status) : load.status === "OPEN" ? "待填报" : "-"}</strong></div><div><span>任务版本</span><strong>V{load.revision}</strong></div></div>
    {state.eligible ? <><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>产品</th><th>单位</th><th>本柜计划</th><th>此前已确认装柜</th><th>剩余可装</th><th>本柜实装</th></tr></thead><tbody>{state.allocations.map((allocation) => { const item = itemById.get(allocation.purchaseOrderItemId); const approved = state.approvedByItem.get(allocation.purchaseOrderItemId) || []; const target = state.progressById.get(allocation.purchaseOrderItemId)?.targetQuantity || item?.quantity || "0"; return <tr key={allocation.id}><td>{item?.productDescription || "产品"}</td><td>{item?.unit || "-"}</td><td>{allocation.plannedQuantity}</td><td>{containerQuantitySum(approved) || "0"}</td><td>{containerQuantityRemaining(target, approved)}</td><td><input aria-label={`${item?.productDescription || "产品"}本柜实装数量`} inputMode="decimal" maxLength={19} disabled={disabled || state.submitting} value={state.values[allocation.purchaseOrderItemId] || ""} onChange={(event) => state.setQuantity(allocation.purchaseOrderItemId, event.target.value)} /></td></tr>; })}</tbody></table></div><div className={styles.fieldGrid}><label className={styles.field}>装柜结果原因<select value={state.reason} disabled={disabled || state.submitting} onChange={(event) => state.setReason(event.target.value as ContainerLoadingReason)}>{REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{state.reason !== "EXACT" ? <label className={`${styles.field} ${styles.full}`}>差异说明<textarea maxLength={2000} required disabled={disabled || state.submitting} value={state.reasonDetail} placeholder="请说明限重、限容或其它差异" onChange={(event) => state.setReasonDetail(event.target.value)} /></label> : null}</div><div className={styles.actions}><p className={styles.hint}>{state.validationError || "实装与本柜计划一致时直接确认；存在差异时等待业务人员确认。"}</p><button className={styles.button} type="button" disabled={disabled || state.submitting || Boolean(state.validationError)} onClick={() => void state.submit()}>{state.submitting ? "提交中..." : "提交本柜实装结果"}</button></div></> : <div className={state.active?.status === "PENDING" ? styles.warning : styles.notice}>{state.active?.status === "PENDING" ? "本柜实装差异已提交，请等待业务人员确认。" : state.active?.status === "APPROVED" ? "本柜实装数量已经确认。" : load.status === "RELEASED" ? "该集装箱已最终放行。" : "当前不能填报该柜实装结果。"}</div>}
    {state.error ? <div className={styles.error} role="alert">{state.error}</div> : null}
    {state.history.length ? <ol className={styles.resultList}>{state.history.map((result) => <li className={styles.result} data-status={result.status} key={result.id}><div className={styles.resultHeader}><strong>第 {result.sequenceNo} 次 · {containerLoadingResultStatusLabel(result.status)}</strong><span className={styles.status} data-status={result.status}>{containerLoadingReasonLabel(result.reason)}</span></div><p className={styles.meta}>装柜日期：{formatDate(result.loadingDate)} · 联系人：{result.supplierContact || "-"}</p>{result.reasonDetail ? <p className={styles.meta}>差异说明：{result.reasonDetail}</p> : null}<div className={styles.quantitySummary}>{result.items.map((line) => <span key={line.purchaseOrderItemId}><strong>{itemById.get(line.purchaseOrderItemId)?.productDescription || "产品"}</strong>：计划 {line.plannedQuantity} · 实装 {line.loadedQuantity} · 累计 {line.cumulativeApprovedLoadedQuantity}</span>)}</div></li>)}</ol> : null}
  </article>;
}
