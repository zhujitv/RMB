"use client";

import styles from "./WorkspaceShell.module.css";

type LoadingPanelProps = {
  message: string;
  detail?: string;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export function LoadingPanel({
  message,
  detail = "正在同步权限数据...",
  loading = true,
  actionLabel,
  onAction,
}: LoadingPanelProps) {
  return (
    <main className={styles.loadingScreen}>
      <div className={styles.loadingCard}>
        {loading ? <span className={styles.loadingDot} /> : null}
        <strong>{message}</strong>
        <p>{detail}</p>
        {actionLabel && onAction ? (
          <div className={styles.loadingActions}>
            <button className={styles.primaryButton} type="button" onClick={onAction}>{actionLabel}</button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
