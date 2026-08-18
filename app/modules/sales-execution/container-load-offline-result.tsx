"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  containerQuantitiesEqual,
  containerQuantityRemaining,
  containerQuantitySum,
  containerQuantityWithin,
  type ContainerLoad,
  type ContainerLoadAllocation,
  type ContainerLoadingReason,
} from "../container-load";
import styles from "../container-loads.module.css";
import { OFFLINE_FACTORY_CHANNELS, type OfflineFactoryConfirmationChannel } from "./offline-confirmation-values";
import { productionItemDescription, productionItemQuantity, productionItemUnit } from "./production-progress-presentation";
import type { FactoryPurchaseOrder, PurchaseOrderItem } from "./types";

const REASONS: Array<{ value: ContainerLoadingReason; label: string }> = [
  { value: "EXACT", label: "按本柜计划装柜" },
  { value: "WEIGHT_LIMIT", label: "集装箱限重" },
  { value: "VOLUME_LIMIT", label: "集装箱限容" },
  { value: "OTHER", label: "其它原因" },
];

type ResultLine = {
  allocation: ContainerLoadAllocation;
  item: PurchaseOrderItem & { id: string };
  target: string;
  completed: string;
  previous: string;
  maximum: string;
};

function resultLines(order: FactoryPurchaseOrder, allocations: ContainerLoadAllocation[], loads: ContainerLoad[]): ResultLine[] {
  const itemById = new Map((order.items || []).flatMap((item) => item.id ? [[item.id, item as PurchaseOrderItem & { id: string }]] : []));
  const progressById = new Map((order.productionProgress?.items || []).map((item) => [item.purchaseOrderItemId, item]));
  return allocations.flatMap((allocation) => {
    const item = itemById.get(allocation.purchaseOrderItemId);
    if (!item) return [];
    const target = progressById.get(item.id)?.targetQuantity || productionItemQuantity(item);
    const completed = progressById.get(item.id)?.completedQuantity || "0";
    const approved = loads.filter((load) => load.status !== "VOIDED").flatMap((load) => load.loadingResults)
      .filter((result) => result.purchaseOrderId === order.id && result.status === "APPROVED")
      .flatMap((result) => result.items)
      .filter((line) => line.purchaseOrderItemId === item.id)
      .map((line) => line.loadedQuantity);
    const previous = containerQuantitySum(approved) || "0";
    return [{ allocation, item, target, completed, previous, maximum: containerQuantityRemaining(target, approved) }];
  });
}

export function ContainerLoadOfflineResult({
  executionId,
  load,
  allLoads,
  order,
  allocations,
  canManage,
  onSaved,
}: {
  executionId: string;
  load: ContainerLoad;
  allLoads: ContainerLoad[];
  order: FactoryPurchaseOrder;
  allocations: ContainerLoadAllocation[];
  canManage: boolean;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const active = load.loadingResults.some((result) => result.purchaseOrderId === order.id && (result.status === "PENDING" || result.status === "APPROVED"));
  const eligible = canManage && load.status === "OPEN" && order.status === "ACCEPTED" && order.productionStatus === "COMPLETED" && !active;
  if (!eligible) return null;
  return <><button className={styles.secondaryButton} type="button" onClick={() => setOpen(true)}>代录该供应商实装</button>{open ? <OfflineResultDialog executionId={executionId} load={load} allLoads={allLoads} order={order} allocations={allocations} onSaved={onSaved} onClose={() => setOpen(false)} /> : null}</>;
}

function OfflineResultDialog({ executionId, load, allLoads, order, allocations, onSaved, onClose }: {
  executionId: string; load: ContainerLoad; allLoads: ContainerLoad[]; order: FactoryPurchaseOrder;
  allocations: ContainerLoadAllocation[]; onSaved: (message: string) => void | Promise<void>; onClose: () => void;
}) {
  const lines = useMemo(() => resultLines(order, allocations, allLoads), [allocations, allLoads, order]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((line) => [line.item.id, line.allocation.plannedQuantity])));
  const [channel, setChannel] = useState<OfflineFactoryConfirmationChannel | "">("");
  const [supplierContact, setSupplierContact] = useState("");
  const [reason, setReason] = useState<ContainerLoadingReason>("EXACT");
  const [reasonDetail, setReasonDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  useWorkspaceTabBusy(saving);

  function validate() {
    if (!channel) return "请选择线下确认渠道";
    if (!supplierContact.trim()) return "请填写供应商实际确认人";
    let differs = false;
    for (const [index, line] of lines.entries()) {
      const loaded = String(values[line.item.id] || "").trim();
      if (!containerQuantityWithin(loaded, line.maximum, true)) return `第 ${index + 1} 行实装数量格式错误或超过剩余可装数量`;
      if (!containerQuantitiesEqual(loaded, line.allocation.plannedQuantity)) differs = true;
    }
    if (differs && reason === "EXACT") return "实装数量与本柜计划不同，请选择限重、限容或其它原因";
    if (!differs && reason !== "EXACT") return "实装数量与本柜计划一致，请选择“按本柜计划装柜”";
    if (differs && !reasonDetail.trim()) return "实装数量有差异时必须填写说明";
    return "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const validation = validate();
    if (validation) { setError(validation); return; }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await apiJson<{ message?: string }>(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/offline-loading-result`, {
        method: "POST",
        body: JSON.stringify({ containerLoadId: load.id, expectedRevision: load.revision, channel, supplierContact: supplierContact.trim(), reason, reasonDetail: reasonDetail.trim(), items: lines.map((line) => ({ purchaseOrderItemId: line.item.id, loadedQuantity: String(values[line.item.id] || "").trim() })) }),
      });
      await onSaved(response.message || "线下实装结果已登记");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "登记线下实装结果失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <DismissibleLayer ariaLabel="代录供应商实装结果" overlayClassName={shell.modalOverlay} surfaceClassName={styles.dialog} onClose={onClose} dismissible={!saving} dismissConfirmMessage="实装结果尚未保存，确定关闭吗？">{({ requestClose }) => <form className={styles.form} onSubmit={submit} inert={saving} aria-busy={saving}>
    <header className={styles.formHeader}><div><h2>代录供应商实装结果</h2><p>第 {load.sequenceNo} 柜 · {load.containerNo || "未填写柜号"} · {order.supplierNameSnapshot || order.supplier?.supplierName || "供应商"}</p></div></header>
    <div className={styles.fieldGrid}><label className={styles.field}>确认渠道<select autoFocus value={channel} required onChange={(event) => setChannel(event.target.value as OfflineFactoryConfirmationChannel | "")}><option value="">请选择</option>{OFFLINE_FACTORY_CHANNELS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={styles.field}>供应商实际确认人<input value={supplierContact} maxLength={100} required onChange={(event) => setSupplierContact(event.target.value)} /></label><label className={styles.field}>实际装柜日期<input value="最终放行时由系统记录" readOnly /></label><label className={styles.field}>结果原因<select value={reason} onChange={(event) => setReason(event.target.value as ContainerLoadingReason)}>{REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{reason !== "EXACT" ? <label className={`${styles.field} ${styles.full}`}>差异说明<textarea maxLength={2000} required value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} /></label> : null}</div>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>产品</th><th>单位</th><th>本柜计划</th><th>此前已装</th><th>剩余可装</th><th>本柜实装</th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.item.id}><td>{productionItemDescription(line.item, index)}</td><td>{productionItemUnit(line.item) || "-"}</td><td>{line.allocation.plannedQuantity}</td><td>{line.previous}</td><td>{line.maximum}</td><td><input aria-label={`${productionItemDescription(line.item, index)}本柜实装数量`} inputMode="decimal" maxLength={19} value={values[line.item.id] || ""} onChange={(event) => setValues((current) => ({ ...current, [line.item.id]: event.target.value }))} /></td></tr>)}</tbody></table></div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}<div className={styles.formActions}><button className={styles.secondaryButton} type="button" disabled={saving} onClick={requestClose}>取消</button><button className={styles.button} type="submit" disabled={saving}>{saving ? "保存中..." : "保存实装结果"}</button></div>
  </form>}</DismissibleLayer>;
}
