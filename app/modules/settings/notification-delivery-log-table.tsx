import styles from "../../WorkspaceShell.module.css";
import type { NotificationDeliveryLogRow } from "./types";

function deliveryTypeLabel(log: NotificationDeliveryLogRow) {
  if (log.type === "FACTORY_PURCHASE_ORDER_DISPATCH_SMS") return "采购订单短信通知";
  return log.templateName || log.type;
}

function deliveryStatusLabel(log: NotificationDeliveryLogRow) {
  if (String(log.channel || "EMAIL").toUpperCase() === "SMS") {
    const labels: Record<string, string> = {
      SUBMITTED: "腾讯云已受理",
      RETRYING: "待自动重试",
      FAILED: "失败",
      UNKNOWN: "发送结果未知",
      CANCELLED: "已取消",
      SENDING: "发送中",
    };
    return labels[String(log.status || "").toUpperCase()] || log.status;
  }
  return log.status === "sent" ? "已发送" : log.status === "failed" ? "失败" : log.status;
}

function deliveryRecipients(log: NotificationDeliveryLogRow) {
  return [...(log.recipientEmails || []), ...(log.recipientPhones || [])].join("，") || "-";
}

export function NotificationDeliveryLogTable({ logs }: { logs: NotificationDeliveryLogRow[] }) {
  return (
    <section className={styles.documentGroupCard}>
      <strong>最近发送记录</strong>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>状态</th>
              <th>收件人</th>
              <th>标题</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {logs.length ? logs.map((log) => (
              <tr key={log.id}>
                <td>{log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</td>
                <td>{deliveryTypeLabel(log)}</td>
                <td>{deliveryStatusLabel(log)}</td>
                <td>{deliveryRecipients(log)}</td>
                <td>{log.subject || "-"}</td>
                <td>{log.errorMessage || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={6}>暂无发送记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
