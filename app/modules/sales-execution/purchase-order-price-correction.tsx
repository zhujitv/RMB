"use client";

import { useMemo, useRef, useState } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDateTime } from "../../formatters";
import styles from "./purchase-order-actions.module.css";
import { numeric, type FactoryPurchaseOrder, type PurchaseOrderItem } from "./types";
import {
  BIG_ZERO, centsText, correctionCanReview, correctionSettlementNotice, formatDeltaCents, formatPrice,
  formatQuantity, formatRecordedDelta, groupCorrections, groupSettlementSnapshot, groupStatus, itemCorrectionQuantity,
  itemCurrentPrice, itemName, priceCorrectionDeltaCents, productName, requestKey, settlementStatusText, unavailableReason,
} from "./purchase-order-price-correction-helpers";

type PriceDrafts = Record<string, string>;

export function PurchaseOrderPriceCorrection({
  executionId,
  order,
  canRequest,
  canReview,
  onChanged,
  onSaved,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  canRequest: boolean;
  canReview: boolean;
  onChanged: () => void | Promise<void>;
  onSaved: (message: string) => void;
}) {
  const items = order.items || [];
  const corrections = order.priceCorrections || [];
  const activePayments = (order.payments || []).filter((payment) => payment.status === "CONFIRMED");
  const reasonUnavailable = unavailableReason(order, canRequest, items.length);
  const settlementNotice = correctionSettlementNotice(order, activePayments.length);
  const available = !reasonUnavailable;
  const showEntry = canRequest && items.length > 0 && order.status !== "DRAFT";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<PriceDrafts>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const pendingItemIds = useMemo(() => new Set(
    corrections.filter((correction) => correction.status === "PENDING").map((correction) => String(correction.purchaseOrderItemId || "")),
  ), [corrections]);
  const correctionGroups = useMemo(() => groupCorrections(corrections), [corrections]);
  const selectedRows = useMemo(() => items.flatMap((item) => {
    const id = String(item.id || "");
    if (!id || !selectedItemIds.includes(id)) return [];
    const currentPrice = itemCurrentPrice(item);
    const quantity = itemCorrectionQuantity(item);
    const newUnitPrice = priceDrafts[id] || "";
    return [{
      id,
      newUnitPrice,
      currentPrice,
      quantity,
      validPrice: /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(newUnitPrice) && Number(newUnitPrice) > 0,
      deltaCents: priceCorrectionDeltaCents(quantity, currentPrice, newUnitPrice),
    }];
  }), [items, priceDrafts, selectedItemIds]);
  const correctionTotals = useMemo(() => selectedRows.reduce((total, row) => {
    const delta = row.deltaCents || BIG_ZERO;
    if (delta > BIG_ZERO) total.increase += delta;
    if (delta < BIG_ZERO) total.decrease += -delta;
    total.net += delta;
    return total;
  }, { increase: BIG_ZERO, decrease: BIG_ZERO, net: BIG_ZERO }), [selectedRows]);
  const selectedRowsValid = selectedRows.length > 0 && selectedRows.every((row) => (
    row.validPrice && row.deltaCents !== null && row.deltaCents !== BIG_ZERO
  ));
  const currency = order.purchaseCurrency || order.currency || "CNY";

  if (!showEntry && !corrections.length) return null;

  function openForm() {
    setSelectedItemIds([]);
    setPriceDrafts({});
    setReason("");
    setError("");
    setOpen((value) => !value);
  }

  function toggleItem(item: PurchaseOrderItem, checked: boolean) {
    const id = String(item.id || "");
    if (!id) return;
    setSelectedItemIds((current) => checked
      ? [...new Set([...current, id])]
      : current.filter((candidate) => candidate !== id));
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const payload = {
        items: selectedRows.map((row) => ({ purchaseOrderItemId: row.id, newUnitPrice: row.newUnitPrice })),
        reason: reason.trim(),
      };
      await apiJson(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/price-corrections`, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          idempotencyKey: requestKey(requestRef, JSON.stringify(payload)),
        }),
      });
      requestRef.current = null;
      setOpen(false);
      onSaved(order.settlement
        ? "批量采购价格更正申请已提交，审核通过后将生成一版结算更正凭证"
        : "批量采购价格更正申请已提交，等待管理员整批审核");
      await onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交批量采购价格更正申请失败");
    } finally {
      setBusy(false);
    }
  }

  async function review(correctionId: string, action: "APPROVE" | "REJECT", isBatch: boolean) {
    const reviewRemark = action === "REJECT"
      ? window.prompt(isBatch ? "请输入整批驳回原因" : "请输入驳回原因")
      : window.prompt(isBatch ? "可填写整批审核备注，留空则直接通过" : "可填写审核备注，留空则直接通过") || "";
    if (action === "REJECT" && !reviewRemark?.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiJson<{
        correction?: { status?: string | null };
        corrections?: Array<{ status?: string | null }>;
      }>(`/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/price-corrections/${encodeURIComponent(correctionId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action, reviewRemark: reviewRemark?.trim() || "" }),
      });
      const expectedStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
      if (String(result.correction?.status || "") !== expectedStatus) {
        throw new Error(`采购价格更正审核结果未生效，预期状态为 ${expectedStatus}`);
      }
      if (result.corrections?.some((correction) => String(correction.status || "") !== expectedStatus)) {
        throw new Error("批量采购价格更正未全部完成审核，请刷新后核对");
      }
      onSaved(action === "APPROVE"
        ? order.settlement
          ? `${isBatch ? "批量" : "采购"}价格更正已通过，结算更正凭证已生成`
          : `${isBatch ? "批量" : "采购"}价格更正已通过，差额已进入结算调整`
        : `${isBatch ? "批量" : "采购"}价格更正已驳回`);
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
        <button type="button" disabled={busy || !available} title={reasonUnavailable || undefined} onClick={openForm}>批量采购价格更正申请</button>
      ) : null}
      {showEntry && !available ? <span className={styles.warning}>{reasonUnavailable}</span> : null}
      {showEntry && available && settlementNotice ? <span className={styles.warning}>{settlementNotice}</span> : null}
      {open ? (
        <div className={`${styles.entryGrid} ${styles.priceCorrectionForm}`}>
          <div className={styles.priceCorrectionHeading}>
            <div>
              <strong>批量采购价格更正</strong>
              <small>勾选所有需要更正的产品行，填写正确单价后一次提交、整批审核。</small>
            </div>
            <span>已选 {selectedRows.length} 行</span>
          </div>
          <div className={styles.priceCorrectionTableWrap}>
            <table className={styles.priceCorrectionTable}>
              <thead>
                <tr>
                  <th>选择</th>
                  <th>产品</th>
                  <th>更正数量</th>
                  <th>当前单价</th>
                  <th>正确单价</th>
                  <th>预计差额</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const id = String(item.id || "");
                  const checked = selectedItemIds.includes(id);
                  const hasPending = pendingItemIds.has(id);
                  const currentPrice = itemCurrentPrice(item);
                  const draftPrice = priceDrafts[id] ?? "";
                  const deltaCents = priceCorrectionDeltaCents(itemCorrectionQuantity(item), currentPrice, draftPrice);
                  return (
                    <tr key={id || index} data-selected={checked ? "true" : "false"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!id || hasPending}
                          aria-label={`选择${itemName(item, index)}`}
                          onChange={(event) => toggleItem(item, event.target.checked)}
                        />
                      </td>
                      <td><strong>{itemName(item, index)}</strong>{hasPending ? <small>已有待审核更正</small> : null}</td>
                      <td>{formatQuantity(itemCorrectionQuantity(item))} {item.unitSnapshot || ""}</td>
                      <td>{formatPrice(currentPrice)}</td>
                      <td>
                        <input
                          inputMode="decimal"
                          value={draftPrice}
                          disabled={!checked}
                          placeholder="0.000"
                          aria-label={`${itemName(item, index)}正确单价`}
                          onChange={(event) => setPriceDrafts((current) => ({ ...current, [id]: event.target.value }))}
                          onBlur={() => setPriceDrafts((current) => ({ ...current, [id]: String(current[id] || "").trim() }))}
                        />
                      </td>
                      <td className={deltaCents !== null && deltaCents > BIG_ZERO ? styles.priceIncrease : deltaCents !== null && deltaCents < BIG_ZERO ? styles.priceDecrease : undefined}>
                        {checked && deltaCents !== null ? formatDeltaCents(currency, deltaCents) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.priceCorrectionTotals} aria-label="批量价格更正汇总">
            <div><span>增加合计</span><strong className={styles.priceIncrease}>{formatCurrencyAmount(currency, centsText(correctionTotals.increase))}</strong></div>
            <div><span>扣减合计</span><strong className={styles.priceDecrease}>{formatCurrencyAmount(currency, centsText(correctionTotals.decrease))}</strong></div>
            <div><span>净差额</span><strong>{formatDeltaCents(currency, correctionTotals.net)}</strong></div>
          </div>
          <label className={styles.wide}>统一更正原因
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：PV271 多个产品原录入单价错误，按供应商确认合同价整批更正" />
          </label>
          <button type="button" disabled={busy || !selectedRowsValid || !reason.trim()} onClick={submit}>提交整批申请</button>
          {!selectedRows.length ? <small className={styles.priceCorrectionHint}>请至少勾选一个产品行。</small> : null}
          {selectedRows.length > 0 && !selectedRowsValid ? <small className={styles.priceCorrectionHint}>每个已选产品都必须填写大于 0 且不同于当前单价的正确单价。</small> : null}
          {error ? <div className={styles.error} role="alert">{error}</div> : null}
        </div>
      ) : null}
      {correctionGroups.length ? (
        <div className={styles.priceCorrectionLedger}>
          <strong>采购价格更正记录</strong>
          {correctionGroups.map((group) => {
            const first = group.corrections[0];
            const settlementSnapshot = groupSettlementSnapshot(group);
            const totalDelta = group.corrections.reduce((sum, correction) => sum + numeric(correction.deltaAmount), 0);
            const pendingReview = group.corrections.length > 0 && group.corrections.every((correction) => correctionCanReview(correction, canReview));
            const isBatch = Boolean(group.batchId);
            return (
              <section key={group.key} className={styles.priceCorrectionBatch}>
                <header>
                  <div>
                    <strong>{isBatch ? `批量更正 · ${group.corrections.length} 行` : "单项更正"}</strong>
                    <small>{groupStatus(group)}{first?.requestedBy?.name ? ` · 申请人 ${first.requestedBy.name}` : ""}{first?.requestedAt ? ` · ${formatDateTime(first.requestedAt)}` : ""}</small>
                  </div>
                  <b className={totalDelta > 0 ? styles.priceIncrease : totalDelta < 0 ? styles.priceDecrease : undefined}>{formatRecordedDelta(first?.currency || currency, totalDelta)}</b>
                </header>
                <div className={styles.priceCorrectionHistoryWrap}>
                  <table className={styles.priceCorrectionHistoryTable}>
                    <thead><tr><th>#</th><th>产品</th><th>数量</th><th>原单价</th><th>正确单价</th><th>差额</th></tr></thead>
                    <tbody>
                      {group.corrections.map((correction, index) => (
                        <tr key={correction.id}>
                          <td>{correction.batchLineNo || index + 1}</td>
                          <td>{productName(order, String(correction.purchaseOrderItemId || ""))}</td>
                          <td>{formatQuantity(correction.quantity)}</td>
                          <td>{formatPrice(correction.oldUnitPrice)}</td>
                          <td>{formatPrice(correction.newUnitPrice)}</td>
                          <td>{formatRecordedDelta(correction.currency || currency, correction.deltaAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>统一原因：{first?.reason || "-"}</p>
                {settlementSnapshot ? (
                  <p>
                    结算更正：最终应付 {formatCurrencyAmount(settlementSnapshot.currency || currency, settlementSnapshot.settlementFinalPayableBefore || 0)} → {formatCurrencyAmount(settlementSnapshot.currency || currency, settlementSnapshot.settlementFinalPayableAfter || 0)}
                    {settlementSnapshot.settlementStatusAfter ? ` · ${settlementStatusText(settlementSnapshot.settlementStatusBefore)} → ${settlementStatusText(settlementSnapshot.settlementStatusAfter)}` : ""}
                    {settlementSnapshot.settlementRevisionAfter ? ` · 结算版本 V${settlementSnapshot.settlementRevisionBefore} → V${settlementSnapshot.settlementRevisionAfter}` : ""}
                  </p>
                ) : null}
                {first?.reviewRemark ? <p>审核备注：{first.reviewRemark}</p> : null}
                {pendingReview ? (
                  <div className={styles.priceCorrectionReviewActions}>
                    <button type="button" disabled={busy} onClick={() => review(first.id, "APPROVE", isBatch)}>{isBatch ? "整批通过" : "通过"}</button>
                    <button type="button" disabled={busy} onClick={() => review(first.id, "REJECT", isBatch)}>{isBatch ? "整批驳回" : "驳回"}</button>
                  </div>
                ) : null}
              </section>
            );
          })}
          {error && !open ? <span className={styles.error} role="alert">{error}</span> : null}
        </div>
      ) : null}
    </>
  );
}
