"use client";

import { useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import { productionQuantityMaximum, productionQuantityUnits } from "../production-progress-quantity";
import styles from "./offline-confirmation.module.css";
import progressStyles from "./offline-production-progress.module.css";
import {
  OFFLINE_FACTORY_CHANNELS,
  shanghaiDateTimeInputValue,
  shanghaiDateTimeIso,
  type OfflineFactoryConfirmationChannel,
} from "./offline-confirmation-values";
import {
  formatProductionPercent,
  formatProductionQuantity,
  productionItemDescription,
  productionItemQuantity,
  productionItemUnit,
} from "./production-progress-presentation";
import type { FactoryPurchaseOrder, PurchaseOrderItem } from "./types";

function numeric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

function initialQuantities(order: FactoryPurchaseOrder) {
  const current = new Map((order.productionProgress?.items || []).map((item) => [item.purchaseOrderItemId, item.completedQuantity]));
  return Object.fromEntries((order.items || []).flatMap((item) => item.id ? [[String(item.id), String(current.get(String(item.id)) || "0")]] : []));
}

export function PurchaseOrderOfflineProductionProgress({
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
  const canRecord = canManage
    && order.status === "ACCEPTED"
    && order.productionStatus === "IN_PRODUCTION"
    && !order.productionProgress?.allCompleted;
  if (!canRecord) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)}>代录生产进度</button>
    {open ? <OfflineProductionProgressDialog executionId={executionId} order={order} onChanged={onChanged} onSaved={onSaved} onClose={() => setOpen(false)} /> : null}
  </>;
}

function OfflineProductionProgressDialog({
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
  const initialReportedAt = useRef(shanghaiDateTimeInputValue()).current;
  const [values, setValues] = useState<Record<string, string>>(() => initialQuantities(order));
  const initialValues = useRef(values).current;
  const [channel, setChannel] = useState<OfflineFactoryConfirmationChannel | "">("");
  const [supplierContact, setSupplierContact] = useState("");
  const [supplierReportedAt, setSupplierReportedAt] = useState(initialReportedAt);
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const items = (order.items || []).filter((item): item is PurchaseOrderItem & { id: string } => Boolean(item.id));
  const progressById = new Map((order.productionProgress?.items || []).map((item) => [item.purchaseOrderItemId, item]));
  const latestReport = order.productionProgress?.history.at(-1);
  const minReportedAt = minimumDateTimeInput(latestReport?.supplierReportedAt || order.productionStartedAt);
  const maxReportedAt = shanghaiDateTimeInputValue();
  const dirty = Boolean(channel || supplierContact.trim() || remark.trim())
    || supplierReportedAt !== initialReportedAt
    || items.some((item) => values[item.id] !== initialValues[item.id]);
  const draftPercent = items.length ? items.reduce((sum, item) => {
    const total = numeric(progressById.get(item.id)?.targetQuantity || productionItemQuantity(item));
    return sum + (total > 0 ? Math.min(1, numeric(values[item.id]) / total) : 0);
  }, 0) / items.length * 100 : 0;
  useWorkspaceTabBusy(saving);

  function validate() {
    if (!channel) return "请选择供应商反馈渠道";
    if (!supplierContact.trim()) return "请填写供应商实际联系人";
    const reportedIso = shanghaiDateTimeIso(supplierReportedAt);
    if (!reportedIso) return "请选择供应商实际反馈时间";
    const reportedTime = new Date(reportedIso).getTime();
    if (reportedTime > Date.now()) return "供应商实际反馈时间不能晚于当前时间";
    if (order.productionStartedAt && reportedTime < new Date(order.productionStartedAt).getTime()) return "供应商实际反馈时间不能早于开始生产时间";
    if (latestReport?.supplierReportedAt && reportedTime < new Date(latestReport.supplierReportedAt).getTime()) return "供应商实际反馈时间不能早于上次填报时间";
    let changed = false;
    for (const [index, item] of items.entries()) {
      const value = String(values[item.id] ?? "").trim();
      const completedUnits = productionQuantityUnits(value);
      if (completedUnits === null) return `第 ${index + 1} 行累计完成数量格式错误，最多保留 4 位小数`;
      const progressItem = progressById.get(item.id);
      const previous = progressItem?.completedQuantity || "0";
      const previousUnits = productionQuantityUnits(previous) || BigInt(0);
      const maximumUnits = productionQuantityUnits(productionQuantityMaximum(progressItem?.targetQuantity || productionItemQuantity(item), previous)) || BigInt(0);
      if (completedUnits < previousUnits) return `第 ${index + 1} 行累计完成数量不能小于上次填报数量`;
      if (completedUnits > maximumUnits) return `第 ${index + 1} 行累计完成数量不能超过当前允许上限`;
      if (completedUnits !== previousUnits) changed = true;
    }
    return changed ? "" : "请至少更新一项累计完成数量";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const validationMessage = validate();
    if (validationMessage) { setError(validationMessage); return; }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/offline-production-progress`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: Number(order.revision || 1),
            channel,
            supplierContact: supplierContact.trim(),
            supplierReportedAt: shanghaiDateTimeIso(supplierReportedAt),
            remark: remark.trim(),
            items: items.map((item) => ({ purchaseOrderItemId: item.id, completedQuantity: String(values[item.id]).trim() })),
          }),
        },
      );
      if (!result.success) throw new Error(result.message || "线下生产进度登记失败");
      try {
        await onChanged();
      } catch {
        onSaved(`${result.message || "供应商线下生产进度已登记"}；详情刷新失败，请重新打开执行单查看`);
        onClose();
        return;
      }
      onSaved(result.message || "供应商线下生产进度已登记");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "线下生产进度登记失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function setQuantity(itemId: string, value: string) {
    setError("");
    setValues((current) => ({ ...current, [itemId]: value }));
  }

  return <DismissibleLayer ariaLabel="代录供应商生产进度" overlayClassName={shell.modalOverlay} surfaceClassName={`${styles.dialog} ${progressStyles.dialog}`} onClose={onClose} dismissible={!saving} dismissConfirmMessage={dirty ? "线下生产进度尚未保存，确定关闭吗？" : ""}>
    {({ requestClose }) => <form className={styles.form} onSubmit={submit} inert={saving} aria-busy={saving}>
      <header className={styles.header}><div><h2>代录供应商生产进度</h2><p>{order.poNo || order.purchaseOrderNo || "工厂采购单"} · 按供应商实际反馈记录累计完成数量</p></div></header>
      <div className={styles.context}>系统会同时保留供应商实际反馈时间与内部登记时间；累计数量不能回退或超过当前允许上限。</div>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>反馈渠道<select autoFocus value={channel} required onChange={(event) => setChannel(event.target.value as OfflineFactoryConfirmationChannel | "")}><option value="">请选择</option>{OFFLINE_FACTORY_CHANNELS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label className={styles.field}>供应商实际联系人<input value={supplierContact} maxLength={100} required placeholder="姓名或可识别联系人" onChange={(event) => setSupplierContact(event.target.value)} /></label>
        <label className={styles.field}>供应商实际反馈时间<input type="datetime-local" step={1} value={supplierReportedAt} min={minReportedAt} max={maxReportedAt} required onChange={(event) => setSupplierReportedAt(event.target.value)} /><small className={styles.hint}>按中国标准时间填写，不是内部录入时间。</small></label>
        <label className={`${styles.field} ${styles.full}`}>进度说明（选填）<textarea value={remark} maxLength={2000} placeholder="例如：供应商反馈主体已完成，正在包装" onChange={(event) => setRemark(event.target.value)} /></label>
      </div>
      <section className={styles.priceSection}>
        <div className={styles.priceHeader}><div><strong>逐产品累计完成数量</strong><small>默认带出上次累计量，本次只需更新发生变化的产品。</small></div><button className={progressStyles.fillAll} type="button" disabled={saving} onClick={() => setValues(Object.fromEntries(items.map((item) => [item.id, productionQuantityMaximum(progressById.get(item.id)?.targetQuantity || productionItemQuantity(item), progressById.get(item.id)?.completedQuantity || "0")])))}>全部填满</button></div>
        <div className={styles.tableWrap}><table className={`${styles.table} ${progressStyles.table}`}><thead><tr><th>产品</th><th>生产目标 / 当前允许上限</th><th>上次累计</th><th>本次累计</th><th>单位</th></tr></thead><tbody>{items.map((item, index) => { const progressItem = progressById.get(item.id); const target = progressItem?.targetQuantity || productionItemQuantity(item); const maximum = productionQuantityMaximum(target, progressItem?.completedQuantity || "0"); return <tr key={item.id}><td>{productionItemDescription(item, index)}</td><td>{formatProductionQuantity(target)}{maximum !== target ? ` / ${formatProductionQuantity(maximum)}` : ""}</td><td>{formatProductionQuantity(progressItem?.completedQuantity)}</td><td><input aria-label={`${productionItemDescription(item, index)}累计完成数量`} inputMode="decimal" maxLength={20} value={values[item.id] ?? "0"} onChange={(event) => setQuantity(item.id, event.target.value)} /></td><td>{productionItemUnit(item) || "-"}</td></tr>; })}</tbody></table></div>
      </section>
      <div className={progressStyles.summary}>本次填写后的预计综合进度：<strong>{formatProductionPercent(draftPercent)}</strong></div>
      {error ? <div className={styles.error} role="alert" aria-live="assertive">{error}</div> : null}
      <div className={styles.actions}><button className={styles.secondaryButton} type="button" disabled={saving} onClick={requestClose}>取消</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "保存中..." : "保存生产进度"}</button></div>
    </form>}
  </DismissibleLayer>;
}
