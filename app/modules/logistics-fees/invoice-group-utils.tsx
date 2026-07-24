import styles from "../../WorkspaceShell.module.css";
import type { LogisticsExpenseMutationResult, LogisticsInvoiceGroupSummary } from "./model";

export function logisticsCurrencySummaryText(group: LogisticsInvoiceGroupSummary) {
  const summary = group.currencyTotals;
  if (!summary) return "-";
  const values = [
    summary.cnyActual ? `CNY ${Number(summary.cnyActual).toFixed(2)}` : "",
    ...(summary.foreignTotals || []).map(
      (item) => `${item.currency} ${Number(item.amount || 0).toFixed(2)}`,
    ),
  ].filter(Boolean);
  return values.length ? values.join(" / ") : "-";
}

export function logisticsApiErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message
    .replace(/。服务器返回非JSON响应，请查看服务端日志。?/g, "")
    .trim() || fallback;
}

export function logisticsOcrResultMessage(result: LogisticsExpenseMutationResult) {
  const parts = [result.message, result.error]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join("：") : "OCR校验结果已更新";
}

export function OcrWaitingInline() {
  return (
    <div className={styles.logisticsInvoiceOcrWaiting}>
      <span className={styles.logisticsInvoiceOcrSpinner} aria-hidden="true" />
      <span>正在识别，请勿关闭页面</span>
    </div>
  );
}

export function ButtonSpinnerText({ text }: { text: string }) {
  return (
    <span className={styles.logisticsInvoiceOcrButtonLoading}>
      <span className={styles.logisticsInvoiceOcrSpinner} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}
