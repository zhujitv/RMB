"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  containerAllocationReservedQuantity,
  containerQuantityRemaining,
  containerQuantitySum,
  containerQuantityWithin,
  type ContainerLoad,
} from "../container-load";
import styles from "../container-loads.module.css";
import { productionItemDescription, productionItemQuantity, productionItemUnit } from "./production-progress-presentation";
import type { FactoryPurchaseOrder, PurchaseOrderItem } from "./types";

type EditorLine = {
  item: PurchaseOrderItem & { id: string };
  order: FactoryPurchaseOrder;
  target: string;
  usedElsewhere: string[];
  available: string;
};

function orderName(order: FactoryPurchaseOrder) {
  return order.supplierNameSnapshot || order.supplier?.supplierName || order.supplier?.name || "未命名供应商";
}

function editorLines(orders: FactoryPurchaseOrder[], loads: ContainerLoad[], editing?: ContainerLoad | null): EditorLine[] {
  const otherLoads = loads.filter((load) => load.status !== "VOIDED" && load.id !== editing?.id);
  return orders.filter((order) => order.status === "ACCEPTED").flatMap((order) => {
    const progressById = new Map((order.productionProgress?.items || []).map((item) => [item.purchaseOrderItemId, item]));
    return (order.items || []).flatMap((item) => {
      if (!item.id) return [];
      const target = progressById.get(item.id)?.targetQuantity || productionItemQuantity(item);
      const usedElsewhere = otherLoads.flatMap((load) => load.allocations
        .filter((allocation) => allocation.purchaseOrderItemId === item.id)
        .map((allocation) => containerAllocationReservedQuantity(load, allocation)));
      return [{ item: item as PurchaseOrderItem & { id: string }, order, target, usedElsewhere, available: containerQuantityRemaining(target, usedElsewhere) }];
    });
  });
}

export function ContainerLoadEditor({
  executionId,
  executionRevision,
  orders,
  loads,
  editing,
  onSaved,
  onClose,
}: {
  executionId: string;
  executionRevision: number;
  orders: FactoryPurchaseOrder[];
  loads: ContainerLoad[];
  editing?: ContainerLoad | null;
  onSaved: (message: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const lines = useMemo(() => editorLines(orders, loads, editing), [editing, loads, orders]);
  const existing = new Map((editing?.allocations || []).map((row) => [row.purchaseOrderItemId, row.plannedQuantity]));
  const [containerNo, setContainerNo] = useState(editing?.containerNo || "");
  const [containerType, setContainerType] = useState(editing?.containerType || "");
  const [sealNo, setSealNo] = useState(editing?.sealNo || "");
  const [loadingDate, setLoadingDate] = useState(editing?.loadingDate?.slice(0, 10) || "");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((line) => [line.item.id, existing.get(line.item.id) || ""])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  useWorkspaceTabBusy(saving);

  function validate() {
    const selected = lines.filter((line) => String(values[line.item.id] || "").trim());
    if (!selected.length) return "请至少分配一条正数装柜计划";
    for (const [index, line] of selected.entries()) {
      const value = String(values[line.item.id] || "").trim();
      if (!containerQuantityWithin(value, line.available)) return `第 ${index + 1} 条计划数量格式错误或超过剩余可分配数量`;
    }
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
      const url = editing
        ? `/api/sales-executions/${encodeURIComponent(executionId)}/container-loads/${encodeURIComponent(editing.id)}`
        : `/api/sales-executions/${encodeURIComponent(executionId)}/container-loads`;
      const response = await apiJson<{ message?: string }>(url, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          expectedRevision: editing ? editing.revision : executionRevision,
          containerNo: containerNo.trim(),
          containerType: containerType.trim(),
          sealNo: sealNo.trim(),
          loadingDate: loadingDate || null,
          allocations: lines.flatMap((line) => {
            const plannedQuantity = String(values[line.item.id] || "").trim();
            return plannedQuantity ? [{ purchaseOrderItemId: line.item.id, plannedQuantity }] : [];
          }),
        }),
      });
      await onSaved(response.message || (editing ? "柜总单草稿已更新" : "柜总单草稿已创建"));
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存柜总单失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <DismissibleLayer ariaLabel={editing ? "编辑装运单" : "创建装运单"} overlayClassName={shell.modalOverlay} surfaceClassName={styles.dialog} onClose={onClose} dismissible={!saving} dismissConfirmMessage="装运单草稿尚未保存，确定关闭吗？">
    {({ requestClose }) => <form className={styles.form} onSubmit={submit} inert={saving} aria-busy={saving}>
      <header className={styles.formHeader}><div><h2>{editing ? `编辑第 ${editing.sequenceNo} 个装运单` : "创建装运单"}</h2><p>先确认供应商实际装运数量；柜号等运输资料可在后续物流环节补充，散货进舱请直接留空。开放填报后数量计划冻结。</p></div></header>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>柜号（可后补）<input autoFocus maxLength={64} value={containerNo} placeholder="未知或散货进舱请留空" onChange={(event) => setContainerNo(event.target.value)} /></label>
        <label className={styles.field}>柜型<input maxLength={64} value={containerType} placeholder="散货可留空；整柜例如 40HQ" onChange={(event) => setContainerType(event.target.value)} /></label>
        <label className={styles.field}>封号<input maxLength={64} value={sealNo} placeholder="散货可留空" onChange={(event) => setSealNo(event.target.value)} /></label>
        <label className={styles.field}>预计装柜 / 进舱日期（可选）<input type="date" value={loadingDate} onChange={(event) => setLoadingDate(event.target.value)} /><small>仅作计划参考；最终放行时系统自动记录实际日期。</small></label>
      </div>
      <section><div className={styles.sectionHeader}><div><h4>按采购明细分配计划装柜量</h4><p>同一明细在所有未作废柜中的计划合计不能超过交付目标。</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>供应商 / 产品</th><th>采购单</th><th>单位</th><th>交付目标</th><th>其它柜已计划</th><th>本柜可分配</th><th>本柜计划</th></tr></thead><tbody>{lines.map((line, index) => <tr key={line.item.id}><td>{orderName(line.order)}<br /><small>{productionItemDescription(line.item, index)}</small></td><td>{line.order.poNo || line.order.purchaseOrderNo || "-"}</td><td>{productionItemUnit(line.item) || "-"}</td><td>{line.target}</td><td>{containerQuantitySum(line.usedElsewhere) || "-"}</td><td>{line.available}</td><td><input aria-label={`${orderName(line.order)} ${productionItemDescription(line.item, index)}本柜计划数量`} inputMode="decimal" maxLength={19} value={values[line.item.id] || ""} placeholder="不装此项请留空" onChange={(event) => setValues((current) => ({ ...current, [line.item.id]: event.target.value }))} /></td></tr>)}</tbody></table></div></section>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.formActions}><button className={styles.secondaryButton} type="button" disabled={saving} onClick={requestClose}>取消</button><button className={styles.button} type="submit" disabled={saving}>{saving ? "保存中..." : "保存草稿"}</button></div>
    </form>}
  </DismissibleLayer>;
}
