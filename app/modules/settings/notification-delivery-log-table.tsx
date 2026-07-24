import styles from "../../WorkspaceShell.module.css";
import type { NotificationDeliveryLogRow } from "./types";

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
                <td>{log.templateName || log.type}</td>
                <td>{log.status === "sent" ? "已发送" : log.status === "failed" ? "失败" : log.status}</td>
                <td>{(log.recipientEmails || []).join("，") || "-"}</td>
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
