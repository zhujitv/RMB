import { formatDate, formatDateTime } from "../../formatters";
import styles from "./quotations.module.css";
import type { QuotationDecision, QuotationDecisionChannel, QuotationDelivery } from "./types";

type HistoryEntry =
  | { kind: "delivery"; id: string; occurredAt: string; delivery: QuotationDelivery }
  | { kind: "decision"; id: string; occurredAt: string; decision: QuotationDecision };

function deliveryStatus(delivery: QuotationDelivery) {
  if (delivery.status === "SENT") return "发送成功";
  if (delivery.status === "FAILED") return "发送失败";
  return "等待发送";
}

function channelLabel(channel: QuotationDecisionChannel) {
  if (channel === "SYSTEM_EMAIL") return "系统邮件";
  if (channel === "EXTERNAL_EMAIL") return "业务员邮箱／外部邮箱";
  if (channel === "WECHAT") return "微信";
  if (channel === "WHATSAPP") return "WhatsApp";
  if (channel === "PHONE") return "电话";
  return "其他";
}

export function QuotationDeliveryHistory({
  deliveries,
  decisions = [],
}: {
  deliveries: QuotationDelivery[];
  decisions?: QuotationDecision[];
}) {
  const history: HistoryEntry[] = [
    ...deliveries.map((delivery): HistoryEntry => ({
      kind: "delivery",
      id: `delivery-${delivery.id}`,
      occurredAt: delivery.sentAt || delivery.failedAt || delivery.createdAt || "",
      delivery,
    })),
    ...decisions
      .filter((decision) => decision.channel !== "SYSTEM_EMAIL")
      .map((decision): HistoryEntry => ({
        kind: "decision",
        id: `decision-${decision.id}`,
        occurredAt: decision.respondedAt || decision.createdAt || "",
        decision,
      })),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  return (
    <section className={styles.drawerSection}>
      <div className={styles.drawerSectionHeader}>
        <h3>发送与客户确认</h3>
        <small>共 {history.length} 条记录</small>
      </div>
      {history.length ? <div className={styles.deliveryList}>
        {history.map((entry) => entry.kind === "delivery" ? (
          <article className={styles.deliveryItem} key={entry.id}>
            <div>
              <strong>系统邮件 · {deliveryStatus(entry.delivery)}</strong>
              <small>{formatDateTime(entry.occurredAt)}</small>
            </div>
            <span>收件人：{(entry.delivery.recipientEmails || []).join(", ") || "-"}</span>
            <span>发送人：{entry.delivery.sentBy?.name || "-"}</span>
            <span>附件：{entry.delivery.attachmentFileName || "-"}</span>
            {entry.delivery.lastError ? <span className={styles.deliveryError}>{entry.delivery.lastError}</span> : null}
          </article>
        ) : (
          <article className={styles.deliveryItem} key={entry.id}>
            <div>
              <strong>手动登记 · {channelLabel(entry.decision.channel)}</strong>
              <small>客户确认日期：{formatDate(entry.decision.respondedAt)}</small>
            </div>
            <span className={styles.responseBadge}>客户已确认</span>
            <span>登记人：{entry.decision.recordedBy?.name || "-"}</span>
            <span>系统登记时间：{formatDateTime(entry.decision.createdAt)}</span>
            <span>备注：{entry.decision.note || "-"}</span>
          </article>
        ))}
      </div> : <div className={styles.deliveryEmpty}>当前版本还没有邮件发送或客户确认记录。</div>}
    </section>
  );
}
