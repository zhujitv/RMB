"use client";

import styles from "./WorkspaceShell.module.css";

type LoadingPanelProps = {
  message: string;
  detail?: string;
};

export function LoadingPanel({ message, detail = "正在同步权限数据..." }: LoadingPanelProps) {
  return (
    <main className={styles.loadingScreen}>
      <div className={styles.loadingCard}>
        <span className={styles.loadingDot} />
        <strong>{message}</strong>
        <p>{detail}</p>
      </div>
    </main>
  );
}
