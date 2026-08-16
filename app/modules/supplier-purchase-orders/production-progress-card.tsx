"use client";

import { formatDate } from "./presentation";
import { quantitiesEqual } from "../delivery-quantity-variance";
import { productionQuantityMaximum } from "../production-progress-quantity";
import styles from "./production-progress-card.module.css";
import type { SupplierPurchaseOrderDto } from "./types";
import { useSupplierProductionProgress } from "./use-supplier-production-progress";

function formatQuantity(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return String(value || "0");
  return parsed.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function percent(value: number) {
  return `${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
}

export function ProductionProgressCard({
  canWrite,
  detail,
  disabled,
  onSaved,
}: {
  canWrite: boolean;
  detail: SupplierPurchaseOrderDto;
  disabled: boolean;
  onSaved: (saved: SupplierPurchaseOrderDto, message: string) => void;
}) {
  const progress = detail.productionProgress;
  const form = useSupplierProductionProgress({ canWrite, detail, disabled, onSaved });
  const itemById = new Map(detail.items.map((item) => [item.id, item]));
  const currentById = new Map(progress.items.map((item) => [item.purchaseOrderItemId, item]));
  const editable = canWrite
    && detail.status === "ACCEPTED"
    && detail.productionStatus === "IN_PRODUCTION"
    && !progress.allCompleted;

  if (!["IN_PRODUCTION", "COMPLETED"].includes(detail.productionStatus) && !progress.history.length) {
    return null;
  }

  return (
    <section className={styles.card} aria-labelledby="supplier-production-progress-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>生产进度</p>
          <h3 id="supplier-production-progress-title">逐项填报累计完成数量</h3>
          <p className={styles.hint}>每次填写截至当前的累计数量，不能低于上次记录，也不能超过当前允许上限。</p>
        </div>
        <div className={styles.overall}>
          <strong>{percent(progress.percent)}</strong>
          <span>{progress.latestReportedAt ? `最后填报 ${formatDate(progress.latestReportedAt, true)}` : "尚未填报"}</span>
        </div>
      </div>

      <progress className={styles.progress} max={100} value={progress.percent} aria-label={`当前综合生产进度 ${percent(progress.percent)}`} />

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>产品</th><th>生产目标</th><th>上次累计</th><th>本次累计</th><th>进度</th><th>快捷操作</th></tr>
          </thead>
          <tbody>
            {detail.items.map((item, index) => {
              const current = currentById.get(item.id);
              const completed = current?.completedQuantity || "0";
              const target = current?.targetQuantity || item.quantity;
              const maximum = productionQuantityMaximum(target, completed);
              const rowPercent = Number(target) > 0
                ? Math.min(100, (Number(form.values[item.id] || 0) / Number(target)) * 100)
                : 0;
              return (
                <tr key={item.id}>
                  <td><strong>{item.productDescription || `产品 ${index + 1}`}</strong><small>{item.unit || "-"}</small></td>
                  <td>{formatQuantity(target)} {item.unit}{!quantitiesEqual(target, item.quantity) ? <small>订单 {formatQuantity(item.quantity)}</small> : null}{!quantitiesEqual(maximum, target) ? <small>当前允许上限 {formatQuantity(maximum)}</small> : null}</td>
                  <td>{formatQuantity(completed)} {item.unit}</td>
                  <td>
                    {editable ? (
                      <input
                        aria-label={`${item.productDescription || `产品 ${index + 1}`}累计完成数量`}
                        inputMode="decimal"
                        maxLength={20}
                        value={form.values[item.id] ?? "0"}
                        disabled={disabled || form.submitting}
                        onChange={(event) => form.setQuantity(item.id, event.target.value)}
                      />
                    ) : `${formatQuantity(completed)} ${item.unit}`}
                  </td>
                  <td><span className={styles.rowPercent}>{percent(rowPercent)}</span></td>
                  <td>{editable ? <button type="button" disabled={disabled || form.submitting} onClick={() => form.fillItem(item.id, target)}>本行完成</button> : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div className={styles.formFooter}>
          <label>
            本次进度说明（选填）
            <textarea maxLength={2000} value={form.remark} disabled={disabled || form.submitting} placeholder="例如：已完成主体生产，正在包装" onChange={(event) => form.setRemark(event.target.value)} />
          </label>
          <div className={styles.submitArea}>
            <span>本次填写后的预计综合进度：<strong>{percent(form.draftPercent)}</strong></span>
            <div className={styles.buttons}>
              <button type="button" className={styles.secondary} disabled={disabled || form.submitting} onClick={form.fillAll}>全部填满</button>
              <button type="button" className={styles.primary} disabled={disabled || form.submitting || Boolean(form.validationError)} onClick={() => void form.submit()}>
                {form.submitting ? "正在提交..." : "提交本次进度"}
              </button>
            </div>
          </div>
          {form.error ? <p className={styles.error} role="alert">{form.error}</p> : null}
          {!form.error && form.validationError ? <p className={styles.validation}>{form.validationError}</p> : null}
        </div>
      ) : progress.allCompleted && detail.productionStatus === "IN_PRODUCTION" ? (
        <p className={styles.completeHint}>所有产品累计数量已达到当前生产目标，请在下方确认整单生产完成。</p>
      ) : null}

      <div className={styles.historyHeader}>
        <h4>填报历史</h4>
        <span>{progress.history.length} 次</span>
      </div>
      {progress.history.length ? (
        <ol className={styles.history}>
          {[...progress.history].reverse().map((report) => (
            <li key={report.id}>
              <div className={styles.historyMeta}>
                <strong>第 {report.sequence} 次 · 综合进度 {percent(report.percent)}</strong>
                <time>{formatDate(report.reportedAt, true)}</time>
              </div>
              <p>{report.source === "INTERNAL_OFFLINE" ? `${report.supplierContact || "供应商联系人"} · 内部代录` : report.supplierContact || report.reportedBy.name || "供应商"}{report.remark ? `：${report.remark}` : " · 无补充说明"}</p>
              <ul>
                {report.items.map((reportItem) => {
                  const item = itemById.get(reportItem.purchaseOrderItemId);
                  return (
                    <li key={reportItem.purchaseOrderItemId}>
                      <span>{item?.productDescription || "产品"}</span>
                      <strong>+{formatQuantity(reportItem.incrementQuantity)}，累计 {formatQuantity(reportItem.completedQuantity)} / {formatQuantity(reportItem.targetQuantity || reportItem.allocatedQuantity)} {item?.unit || ""}</strong>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      ) : <p className={styles.empty}>尚无生产进度填报记录。</p>}
    </section>
  );
}
