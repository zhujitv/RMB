"use client";

import { useRef, useState } from "react";
import styles from "./WorkspaceShell.module.css";

export type ConfirmationDialogState = {
  title: string;
  message?: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "warning" | "danger";
  requireInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputRequiredMessage?: string;
  inputValue?: string;
  inputError?: string;
};

export type ConfirmationResult = {
  confirmed: boolean;
  inputValue?: string;
};

export function useConfirmationDialog() {
  const resolverRef = useRef<((result: ConfirmationResult) => void) | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);

  function requestConfirmation(options: ConfirmationDialogState) {
    if (resolverRef.current) {
      resolverRef.current({ confirmed: false });
      resolverRef.current = null;
    }
    setConfirmation({ ...options, inputValue: "", inputError: "" });
    return new Promise<ConfirmationResult>((resolve) => {
      resolverRef.current = resolve;
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    if (!confirmation) return;
    if (confirmed && confirmation.requireInput && !String(confirmation.inputValue || "").trim()) {
      setConfirmation({ ...confirmation, inputError: confirmation.inputRequiredMessage || "请填写原因后继续。" });
      return;
    }
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setConfirmation(null);
    resolver?.({ confirmed, inputValue: String(confirmation.inputValue || "").trim() });
  }

  function updateConfirmationInput(value: string) {
    setConfirmation((current) => current ? { ...current, inputValue: value, inputError: "" } : current);
  }

  return {
    confirmation,
    requestConfirmation,
    cancelConfirmation: () => resolveConfirmation(false),
    confirmConfirmation: () => resolveConfirmation(true),
    updateConfirmationInput,
  };
}

export function DetailField({
  label,
  value,
  wide = false,
  hidden = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
  hidden?: boolean;
}) {
  if (hidden || !value || value === "-") return null;
  return (
    <div className={`${styles.detailField} ${wide ? styles.detailFieldWide : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PaginationBar({
  total,
  page,
  totalPages,
  loading = false,
  onPage,
}: {
  total: number;
  page: number;
  totalPages: number;
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className={styles.paginationBar}>
      <span>共 {total} 条，当前第 {page} / {totalPages} 页</span>
      <div>
        <button className={styles.secondaryButton} type="button" disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))}>上一页</button>
        <button className={styles.secondaryButton} type="button" disabled={page >= totalPages || loading} onClick={() => onPage(Math.min(totalPages, page + 1))}>下一页</button>
      </div>
    </div>
  );
}

export function ConfirmationDialog({
  state,
  onCancel,
  onConfirm,
  onInputChange,
}: {
  state: ConfirmationDialogState;
  onCancel: () => void;
  onConfirm: () => void;
  onInputChange?: (value: string) => void;
}) {
  const variantClass = state.variant === "danger"
    ? styles.confirmDialogDanger
    : state.variant === "warning"
      ? styles.confirmDialogWarning
      : "";

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label={state.title}>
      <div className={`${styles.confirmDialog} ${variantClass}`}>
        <div className={styles.confirmDialogHeader}>
          <strong>{state.title}</strong>
          {state.message ? <span>{state.message}</span> : null}
        </div>

        {state.details?.length ? (
          <div className={styles.confirmDialogDetails}>
            {state.details.map((detail) => (
              <span key={detail}>{detail}</span>
            ))}
          </div>
        ) : null}

        {state.requireInput ? (
          <label className={styles.confirmDialogInput}>
            {state.inputLabel || "原因"}
            <textarea
              value={state.inputValue || ""}
              onChange={(event) => onInputChange?.(event.target.value)}
              placeholder={state.inputPlaceholder}
              rows={3}
              autoFocus
            />
            {state.inputError ? <small>{state.inputError}</small> : null}
          </label>
        ) : null}

        <div className={styles.confirmDialogActions}>
          <button className={styles.secondaryButton} type="button" onClick={onCancel}>
            {state.cancelLabel || "取消"}
          </button>
          <button className={state.variant === "danger" ? styles.dangerButton : styles.primaryButtonCompact} type="button" onClick={onConfirm}>
            {state.confirmLabel || "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}
