import { formatDate, formatDateTime } from "../../formatters";
import { quantitiesEqual } from "../delivery-quantity-variance";
import { factoryConfirmationChannelLabel, factoryConfirmationSourceLabel } from "./offline-confirmation-values";
import styles from "./purchase-order-production-progress.module.css";
import {
  confirmedDeliveryDate,
  daysFromToday,
  deliveryTimingLabel,
  formatProductionPercent,
  formatProductionQuantity,
  productionItemDescription,
  productionItemQuantity,
  productionItemUnit,
} from "./production-progress-presentation";
import type { FactoryPurchaseOrder } from "./types";

export function PurchaseOrderProductionProgressSummary({ order }: { order: FactoryPurchaseOrder }) {
  const progress = order.productionProgress;
  if (!progress || (!["IN_PRODUCTION", "COMPLETED"].includes(String(order.productionStatus)) && !progress.history.length)) return null;

  const items = order.items || [];
  const itemById = new Map(items.map((item) => [String(item.id || ""), item]));
  const progressById = new Map(progress.items.map((item) => [item.purchaseOrderItemId, item]));
  const latest = progress.history.at(-1);
  const updateAge = daysFromToday(progress.latestReportedAt);
  const startAge = daysFromToday(order.productionStartedAt);
  const daysWithoutUpdate = updateAge === null && startAge !== null ? Math.max(0, -startAge) : updateAge === null ? null : Math.max(0, -updateAge);
  const needsFollowUp = order.productionStatus === "IN_PRODUCTION" && daysWithoutUpdate !== null && daysWithoutUpdate > 7;

  return (
    <section className={styles.card} aria-labelledby={`production-progress-${order.id}`}>
      <div className={styles.header}>
        <div>
          <strong id={`production-progress-${order.id}`}>供应商生产进度</strong>
          <small>逐产品累计完成数量与供应商填报历史</small>
        </div>
        {needsFollowUp ? <span className={styles.followUp}>需跟进</span> : null}
      </div>

      <div className={styles.metrics}>
        <div><span>综合进度</span><strong>{formatProductionPercent(progress.percent)}</strong></div>
        <div data-tone={(daysFromToday(confirmedDeliveryDate(order)) || 0) < 0 ? "danger" : "normal"}><span>确认交期</span><strong>{deliveryTimingLabel(order)}</strong><small>{formatDate(confirmedDeliveryDate(order))}</small></div>
        <div data-tone={needsFollowUp ? "warning" : "normal"}><span>最后填报</span><strong>{progress.latestReportedAt ? `${daysWithoutUpdate || 0} 天前` : "尚未填报"}</strong><small>{progress.latestReportedAt ? formatDateTime(progress.latestReportedAt) : order.productionStartedAt ? `开工于 ${formatDateTime(order.productionStartedAt)}` : "-"}</small></div>
      </div>
      <progress className={styles.progress} max={100} value={progress.percent} aria-label={`综合生产进度 ${formatProductionPercent(progress.percent)}`} />

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>产品</th><th>累计完成</th><th>生产目标</th><th>行进度</th></tr></thead>
          <tbody>
            {items.map((item, index) => {
              const itemProgress = progressById.get(String(item.id || ""));
              const unit = productionItemUnit(item);
              const target = itemProgress?.targetQuantity || productionItemQuantity(item);
              return <tr key={String(item.id || index)}><td>{productionItemDescription(item, index)}</td><td><strong>{formatProductionQuantity(itemProgress?.completedQuantity)} {unit}</strong></td><td>{formatProductionQuantity(target)} {unit}{!quantitiesEqual(target, productionItemQuantity(item)) ? <small>订单 {formatProductionQuantity(productionItemQuantity(item))}</small> : null}</td><td>{formatProductionPercent(itemProgress?.percent)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.historyHeader}><strong>进度历史</strong><span>{progress.history.length} 次</span></div>
      {progress.history.length ? <ol className={styles.history}>
        {[...progress.history].reverse().map((report) => (
          <li key={report.id}>
            <div className={styles.historyTitle}><strong>第 {report.sequence} 次 · {formatProductionPercent(report.percent)}</strong><time>实际反馈 {formatDateTime(report.supplierReportedAt)}</time></div>
            <div className={styles.attribution}>
              <span>{factoryConfirmationSourceLabel(report.source)}</span>
              <span>{factoryConfirmationChannelLabel(report.channel)}</span>
              <span>供应商联系人：{report.supplierContact || "未记录"}</span>
              <span>系统记录：{formatDateTime(report.recordedAt)}</span>
              {report.source === "INTERNAL_OFFLINE" ? <span>代录人：{report.reportedBy.name || "-"}</span> : null}
            </div>
            {report.remark ? <p>{report.remark}</p> : null}
            <ul>{report.items.map((reportItem) => {
              const item = itemById.get(reportItem.purchaseOrderItemId);
              return <li key={reportItem.purchaseOrderItemId}><span>{item ? productionItemDescription(item) : "产品"}</span><strong>+{formatProductionQuantity(reportItem.incrementQuantity)}，累计 {formatProductionQuantity(reportItem.completedQuantity)} / {formatProductionQuantity(reportItem.targetQuantity || reportItem.allocatedQuantity)} {item ? productionItemUnit(item) : ""}</strong></li>;
            })}</ul>
          </li>
        ))}
      </ol> : <p className={styles.empty}>尚无填报记录。</p>}
    </section>
  );
}
