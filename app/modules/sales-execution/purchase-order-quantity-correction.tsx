"use client";

import { useMemo, useState } from "react";
import { apiJson } from "../../api";
import styles from "./purchase-order-actions.module.css";
import { numeric, type FactoryPurchaseOrder } from "./types";

function currentQuantityText(order: FactoryPurchaseOrder, itemId: string) {
  const item = (order.items || []).find((candidate) => candidate.id === itemId);
  return item ? String(item.allocatedQuantity ?? item.quantity ?? "") : "";
}

function itemLabel(item: NonNullable<FactoryPurchaseOrder["items"]>[number], index: number) {
  const name = String(item.productDescription || item.productNameSnapshot || `第 ${index + 1} 行`).trim();
  const quantity = String(item.allocatedQuantity ?? item.quantity ?? "-");
  return `${index + 1}. ${name}（当前 ${quantity} ${item.unitSnapshot || ""}）`;
}

export function PurchaseOrderQuantityCorrection({
  executionId,
  executionRevision,
  order,
  canManage,
  shippingStarted,
  onChanged,
  onSaved,
}: {
  executionId: string;
  executionRevision: number;
  order: FactoryPurchaseOrder;
  canManage: boolean;
  shippingStarted: boolean;
  onChanged: () => void | Promise<void>;
  onSaved: (message: string) => void;
}) {
  const items = order.items || [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [newQuantity, setNewQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const selectedCurrent = useMemo(() => currentQuantityText(order, itemId), [order, itemId]);
  const available = canManage
    && order.status === "ACCEPTED"
    && !shippingStarted
    && !order.actualDeliveryDate
    && !order.settlement;
  if (!available || !items.length) return null;

  function openForm() {
    const first = items[0]?.id || "";
    setItemId((value) => value || first);
    setNewQuantity(currentQuantityText(order, itemId || first));
    setReason("");
    setError("");
    setOpen((value) => !value);
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/quantity-correction`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: executionRevision,
          purchaseOrderItemId: itemId,
          newQuantity,
          reason,
        }),
      });
      setOpen(false);
      onSaved("订单数量已更正");
      await onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "更正失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={openForm}>更正订单数量</button>
      {open ? (
        <div className={styles.entryGrid}>
          <label className={styles.wide}>产品行
            <select value={itemId} onChange={(event) => {
              const next = event.target.value;
              setItemId(next);
              setNewQuantity(currentQuantityText(order, next));
            }}>
              {items.map((item, index) => (
                <option key={item.id || index} value={item.id || ""}>{itemLabel(item, index)}</option>
              ))}
            </select>
          </label>
          <label>正确数量
            <input inputMode="decimal" value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)} />
          </label>
          <label>当前数量
            <input value={selectedCurrent || "-"} readOnly />
          </label>
          <label className={styles.wide}>更正原因
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：客户原始订单录入错误，实际应为 1344 PCS" />
          </label>
          <button type="button" disabled={busy || numeric(newQuantity) <= 0 || !reason.trim()} onClick={submit}>确认更正</button>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
        </div>
      ) : null}
    </>
  );
}
