"use client";

import { useEffect, useRef, useState } from "react";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import { apiJson } from "../../api";
import styles from "./purchase-order-actions.module.css";
import {
  filterSupplierOptions,
  supplierName,
  type FactoryPurchaseOrder,
  type SupplierOption,
} from "./types";

type SuppliersResponse = { suppliers?: SupplierOption[]; message?: string };
type ReassignmentResponse = { message?: string };

export function PurchaseOrderReassignmentCard({
  executionId,
  executionRevision,
  order,
  canManage,
  onChanged,
}: {
  executionId: string;
  executionRevision: number;
  order: FactoryPurchaseOrder;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [selected, setSelected] = useState<SupplierOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  useEffect(() => {
    if (!canManage || order.status !== "REJECTED") return;
    let active = true;
    setLoading(true);
    apiJson<SuppliersResponse>("/api/suppliers/available?type=factory")
      .then((result) => {
        if (!active) return;
        setSuppliers((result.suppliers || []).filter((supplier) => supplier.id !== order.supplierId));
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "读取可用工厂失败");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManage, order.id, order.status, order.supplierId]);

  if (!canManage || order.status !== "REJECTED") return null;

  async function submit() {
    if (!selected || busyRef.current) return;
    if (!window.confirm(`确认将被拒采购单重新分配给“${supplierName(selected)}”并单独下发吗？`)) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiJson<ReassignmentResponse>(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/reassign`, {
        method: "POST",
        body: JSON.stringify({
          newSupplierId: selected.id,
          expectedRevision: executionRevision,
          expectedPurchaseOrderRevision: Number(order.revision || 1),
        }),
      });
      window.alert(result.message || "已重新选厂并下发采购单");
      await onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "重新选厂失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.workflowCard} data-tone="danger">
      <div className={styles.workflowHeader}>
        <div><strong>被拒采购单重新选厂</strong><small>原单将保留为作废记录，新单独立编号；有门户账号则在线通知，否则转为线下协同。</small></div>
      </div>
      <div className={styles.workflowControls}>
        <label>新工厂
          <SearchAutocomplete
            value={selected}
            disabled={loading || busy}
            cacheKey={`reassign-factory:${order.id}:${suppliers.map((supplier) => supplier.id).join("|")}`}
            emptyLabel="未找到其他可用工厂"
            placeholder={loading ? "正在读取工厂..." : "输入工厂名称模糊查找"}
            getLabel={supplierName}
            getDescription={(supplier) => supplier.supplierType || "产品供应商"}
            search={(keyword) => Promise.resolve(filterSupplierOptions(suppliers, keyword))}
            onSelect={setSelected}
            onSelectedValueInvalidated={() => setSelected(null)}
          />
        </label>
        <button type="button" disabled={!selected || loading || busy} onClick={submit}>{busy ? "下发中..." : "重新选厂并下发"}</button>
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
    </section>
  );
}
