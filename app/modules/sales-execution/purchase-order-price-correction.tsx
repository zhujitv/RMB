"use client";

import { useMemo, useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDateTime } from "../../formatters";
import styles from "./purchase-order-actions.module.css";
import { numeric, type FactoryPurchaseOrder } from "./types";

function itemLabel(item: NonNullable<FactoryPurchaseOrder["items"]>[number], index: number) {
  const name = String(item.productDescription || item.productNameSnapshot || `第 ${index + 1} 行`).trim();
  const unitPrice = String(item.effectivePurchaseUnitPrice ?? item.purchaseUnitPrice ?? "-");
  return `${index + 1}. ${name}（当前单价 ${unitPrice}）`;
}

function priceText(order: FactoryPurchaseOrder, itemId: string) {
  const item = (order.items || []).find((candidate) => candidate.id === itemId);
  return item ? String(item.effectivePurchaseUnitPrice ?? item.purchaseUnitPrice ?? "") : "";
}

function productName(order: FactoryPurchaseOrder, itemId: string) {
  const item = (order.items || []).find((candidate) => candidate.id === itemId);
  return String(item?.productDescription || item?.productNameSnapshot || "产品行");
}

function statusText(status?: string | null) {
  if (status === "APPROVED") return "已通过";
  if (status === "REJECTED") return "已驳回";
  return "待管理员审核";
}

function requestKey(ref: { current: { fingerprint: string; key: string } | null }, fingerprint: string) {
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: `factory-price-correction-${Date.now()}-${crypto.randomUUID()}` };
  }
  return ref.current.key;
}

function unavailableReason(order: FactoryPurchaseOrder, activePayments: unknown[], canManage: boolean, itemCount: number) {
  if (!canManage) return "没有采购价格更正权限";
  if (!itemCount) return "该采购单没有产品行，不能申请采购价格更正";
  if (order.status !== "ACCEPTED") return "工厂采购单确认接受后，才可以申请采购价格更正";
  if (order.settlement) return "该采购单已进入最终应付确认，不能申请采购价格更正";
  if (activePayments.length) return "已有付款记录，采购价格需走财务冲销或补差流程";
  return "";
}

export function PurchaseOrderPriceCorrection({
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
  const items = order.items || [];
  const corrections = order.priceCorrections || [];
  const activePayments = (order.payments || []).filter((payment) => payment.status === "CONFIRMED");
  const reasonUnavailable = unavailableReason(order, activePayments, canManage, items.length);
  const available = !reasonUnavailable;
  const showEntry = canManage && items.length > 0 && order.status !== "DRAFT";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [itemId, setItemId] = useState(items[0]?.id || "");
  const [newUnitPrice, setNewUnitPrice] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const selectedCurrent = useMemo(() => priceText(order, itemId), [order, itemId]);

  if (!showEntry && !corrections.length) return null;

  function openForm() {
    const first = items[0]?.id || "";
    const selected = itemId || first;
    setItemId(selected);
    setNewUnitPrice(priceText(order, selected));
    setReason("");
    setError("");
    setOpen((value) => !value);
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const payload = { purchaseOrderItemId: itemId, newUnitPrice, reason };
      await apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/price-corrections`, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          idempotencyKey: requestKey(requestRef, JSON.stringify(payload)),
        }),
      });
      requestRef.current = null;
      setOpen(false);
      onSaved("采购价格更正申请已提交，等待管理员审核");
      await onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交采购价格更正申请失败");
    } finally {
      setBusy(false);
    }
  }

  async function review(correctionId: string, action: "APPROVE" | "REJECT") {
    const reviewRemark = action === "REJECT"
      ? window.prompt("请输入驳回原因")
      : window.prompt("可填写审核备注，留空则直接通过") || "";
    if (action === "REJECT" && !reviewRemark?.trim()) return;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/price-corrections/${encodeURIComponent(correctionId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action, reviewRemark: reviewRemark?.trim() || "" }),
      });
      onSaved(action === "APPROVE" ? "采购价格更正已通过，差额已进入结算调整" : "采购价格更正已驳回");
      await onChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "审核采购价格更正失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {showEntry ? (
        <button type="button" disabled={busy || !available} title={reasonUnavailable || undefined} onClick={openForm}>采购价格更正申请</button>
      ) : null}
      {showEntry && !available ? <span className={styles.warning}>{reasonUnavailable}</span> : null}
      {open ? (
        <div className={styles.entryGrid}>
          <label className={styles.wide}>产品行
            <select value={itemId} onChange={(event) => {
              const next = event.target.value;
              setItemId(next);
              setNewUnitPrice(priceText(order, next));
            }}>
              {items.map((item, index) => (
                <option key={item.id || index} value={item.id || ""}>{itemLabel(item, index)}</option>
              ))}
            </select>
          </label>
          <label>当前单价
            <input value={selectedCurrent || "-"} readOnly />
          </label>
          <label>正确单价
            <input inputMode="decimal" value={newUnitPrice} onChange={(event) => setNewUnitPrice(event.target.value)} />
          </label>
          <label className={styles.wide}>更正原因
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：PV271 原录入单价错误，供应商确认价应按合同价更正" />
          </label>
          <button type="button" disabled={busy || numeric(newUnitPrice) <= 0 || !reason.trim() || newUnitPrice === selectedCurrent} onClick={submit}>提交申请</button>
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
        </div>
      ) : null}
      {corrections.length ? (
        <div className={styles.ledgerList}>
          <strong>采购价格更正</strong>
          {corrections.map((correction) => (
            <span key={correction.id}>
              {productName(order, String(correction.purchaseOrderItemId || ""))}
              · {statusText(correction.status)}
              · {correction.oldUnitPrice} → {correction.newUnitPrice}
              · {Number(correction.deltaAmount || 0) >= 0 ? "+" : "-"}{formatCurrencyAmount(correction.currency || order.purchaseCurrency || "CNY", Math.abs(numeric(correction.deltaAmount)))}
              {correction.requestedBy?.name ? ` · 申请人 ${correction.requestedBy.name}` : ""}
              {correction.requestedAt ? ` · ${formatDateTime(correction.requestedAt)}` : ""}
              {correction.status === "PENDING" && canManage ? (
                <>
                  <button type="button" disabled={busy} onClick={() => review(correction.id, "APPROVE")}>通过</button>
                  <button type="button" disabled={busy} onClick={() => review(correction.id, "REJECT")}>驳回</button>
                </>
              ) : null}
              {correction.reviewRemark ? ` · ${correction.reviewRemark}` : ""}
            </span>
          ))}
          {error && !open ? <span className={styles.error} role="alert">{error}</span> : null}
        </div>
      ) : null}
    </>
  );
}
