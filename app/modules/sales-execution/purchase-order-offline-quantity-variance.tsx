"use client";

import { useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  formatDifferenceRate,
  formatSignedDifference,
  formatTolerancePercent,
  quantitiesEqual,
  quantityToleranceRange,
  quantityWithinTolerance,
} from "../delivery-quantity-variance";
import { productionQuantityUnits } from "../production-progress-quantity";
import styles from "./offline-confirmation.module.css";
import varianceStyles from "./offline-delivery-quantity-variance.module.css";
import {
  OFFLINE_FACTORY_CHANNELS,
  shanghaiDateTimeInputValue,
  shanghaiDateTimeIso,
  type OfflineFactoryConfirmationChannel,
} from "./offline-confirmation-values";
import { productionItemDescription, productionItemQuantity, productionItemUnit } from "./production-progress-presentation";
import type { FactoryPurchaseOrder, PurchaseOrderItem } from "./types";

function minimumDateTimeInput(value: string | null | undefined) {
  if (!value) return shanghaiDateTimeInputValue();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return shanghaiDateTimeInputValue();
  if (date.getUTCMilliseconds() > 0) {
    date.setUTCMilliseconds(0);
    date.setUTCSeconds(date.getUTCSeconds() + 1);
  }
  return shanghaiDateTimeInputValue(date);
}

export function PurchaseOrderOfflineQuantityVariance({
  executionId,
  order,
  canManage,
  onChanged,
  onSaved,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
  onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = (order.deliveryQuantityVariances || []).some((entry) => entry.status === "PENDING" || entry.status === "APPROVED");
  const canRecord = canManage && order.status === "ACCEPTED" && order.productionStatus === "IN_PRODUCTION" && !order.actualDeliveryDate && !active;
  if (!canRecord) return null;
  return <><button type="button" onClick={() => setOpen(true)}>代录交付数量差异</button>{open ? <OfflineVarianceDialog executionId={executionId} order={order} onChanged={onChanged} onSaved={onSaved} onClose={() => setOpen(false)} /> : null}</>;
}

function OfflineVarianceDialog({
  executionId,
  order,
  onChanged,
  onSaved,
  onClose,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  onChanged: () => void | Promise<void>;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const items = (order.items || []).filter((item): item is PurchaseOrderItem & { id: string } => Boolean(item.id));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(items.map((item) => [item.id, productionItemQuantity(item)])));
  const [channel, setChannel] = useState<OfflineFactoryConfirmationChannel | "">("");
  const [supplierContact, setSupplierContact] = useState("");
  const [supplierRequestedAt, setSupplierRequestedAt] = useState(() => shanghaiDateTimeInputValue());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const tolerance = String(order.deliveryQuantityToleranceRatio ?? "0.05");
  const latest = order.deliveryQuantityVariances?.[0];
  const minRequestedAt = minimumDateTimeInput(latest?.supplierRequestedAt || order.productionStartedAt);
  useWorkspaceTabBusy(saving);

  function validate() {
    if (!channel) return "请选择供应商申请渠道";
    if (!supplierContact.trim()) return "请填写供应商实际联系人";
    const requestedIso = shanghaiDateTimeIso(supplierRequestedAt);
    if (!requestedIso) return "请选择供应商实际申请时间";
    const requestedTime = new Date(requestedIso).getTime();
    if (requestedTime > Date.now()) return "供应商实际申请时间不能晚于当前时间";
    if (order.productionStartedAt && requestedTime < new Date(order.productionStartedAt).getTime()) return "供应商实际申请时间不能早于开始生产时间";
    if (latest?.supplierRequestedAt && requestedTime < new Date(latest.supplierRequestedAt).getTime()) return "供应商实际申请时间不能早于上次申请时间";
    let changed = false;
    for (const [index, item] of items.entries()) {
      const proposed = String(values[item.id] ?? "").trim();
      const units = productionQuantityUnits(proposed);
      if (units === null || units <= BigInt(0)) return `第 ${index + 1} 行拟交付数量格式错误`;
      if (!quantityWithinTolerance(productionItemQuantity(item), proposed, tolerance)) return `第 ${index + 1} 行超出本采购单允许的数量公差`;
      if (!quantitiesEqual(productionItemQuantity(item), proposed)) changed = true;
    }
    if (!changed) return "请至少调整一项拟交付数量";
    if (!reason.trim()) return "请填写供应商申请数量差异的原因";
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
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/offline-quantity-variance`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: Number(order.revision || 1),
            channel,
            supplierContact: supplierContact.trim(),
            supplierRequestedAt: shanghaiDateTimeIso(supplierRequestedAt),
            reason: reason.trim(),
            items: items.map((item) => ({ purchaseOrderItemId: item.id, proposedQuantity: String(values[item.id]).trim() })),
          }),
        },
      );
      if (!result.success) throw new Error(result.message || "线下数量差异申请登记失败");
      await onChanged();
      onSaved(result.message || "供应商线下交付数量差异申请已登记");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "线下数量差异申请登记失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <DismissibleLayer ariaLabel="代录交付数量差异申请" overlayClassName={shell.modalOverlay} surfaceClassName={`${styles.dialog} ${varianceStyles.dialog}`} onClose={onClose} dismissible={!saving} dismissConfirmMessage="数量差异申请尚未保存，确定关闭吗？">
    {({ requestClose }) => <form className={styles.form} onSubmit={submit} inert={saving} aria-busy={saving}>
      <header className={styles.header}><div><h2>代录交付数量差异申请</h2><p>{order.poNo || order.purchaseOrderNo || "工厂采购单"} · 本单冻结公差 ±{formatTolerancePercent(tolerance)}%</p></div></header>
      <div className={styles.context}>请按供应商真实反馈逐行登记拟交付数量；申请提交后必须由另一位有权限人员审批。</div>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>申请渠道<select autoFocus value={channel} required onChange={(event) => setChannel(event.target.value as OfflineFactoryConfirmationChannel | "")}><option value="">请选择</option>{OFFLINE_FACTORY_CHANNELS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label className={styles.field}>供应商实际联系人<input value={supplierContact} maxLength={100} required onChange={(event) => setSupplierContact(event.target.value)} /></label>
        <label className={styles.field}>供应商实际申请时间<input type="datetime-local" step={1} value={supplierRequestedAt} min={minRequestedAt} max={shanghaiDateTimeInputValue()} required onChange={(event) => setSupplierRequestedAt(event.target.value)} /></label>
        <label className={`${styles.field} ${styles.full}`}>数量差异原因<textarea value={reason} maxLength={2000} required placeholder="记录供应商说明的少交或多交原因" onChange={(event) => setReason(event.target.value)} /></label>
      </div>
      <section className={styles.priceSection}>
        <div className={styles.priceHeader}><div><strong>逐产品拟交付数量</strong><small>必须填写全部产品行，且至少一行与订单数量不同。</small></div></div>
        <div className={styles.tableWrap}><table className={`${styles.table} ${varianceStyles.table}`}><thead><tr><th>产品</th><th>订单数量</th><th>拟交付数量</th><th>差额 / 差异率</th><th>允许范围</th><th>单位</th></tr></thead><tbody>{items.map((item, index) => { const base = productionItemQuantity(item); const proposed = values[item.id] ?? ""; const range = quantityToleranceRange(base, tolerance); return <tr key={item.id}><td>{productionItemDescription(item, index)}</td><td>{base}</td><td><input aria-label={`${productionItemDescription(item, index)}拟交付数量`} inputMode="decimal" maxLength={19} value={proposed} onChange={(event) => setValues((current) => ({ ...current, [item.id]: event.target.value }))} /></td><td><span className={varianceStyles.difference}>{formatSignedDifference(base, proposed)}<small>{formatDifferenceRate(base, proposed)}</small></span></td><td>{range ? `${range.minimum} — ${range.maximum}` : "-"}</td><td>{productionItemUnit(item) || "-"}</td></tr>; })}</tbody></table></div>
      </section>
      <div className={varianceStyles.summary}>所有数量差异都需要审批；批准后，生产完成和实际交付将按批准快照核验。</div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.actions}><button className={styles.secondaryButton} type="button" disabled={saving} onClick={requestClose}>取消</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "保存中..." : "提交待审批"}</button></div>
    </form>}
  </DismissibleLayer>;
}
