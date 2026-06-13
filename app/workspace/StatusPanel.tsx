"use client";

import styles from "./WorkspaceShell.module.css";

type StatusPanelProps = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function StatusPanel({ title, message, actionLabel, onAction }: StatusPanelProps) {
  return (
    <section className={styles.moduleCard}>
      <div className={styles.statusPanel}>
        <span className={styles.statusIcon} aria-hidden="true">!</span>
        <div>
          <h2>{title}</h2>
          <p>{message}</p>
          {actionLabel && onAction ? (
            <button className={styles.secondaryButton} type="button" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
