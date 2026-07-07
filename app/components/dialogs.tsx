"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import styles from "../WorkspaceShell.module.css";
import { DismissibleLayer } from "./dismissible-layer";
import type { ConfirmationDialogState, ConfirmationResult } from "./types";
import { mergeClassNames } from "./ui-primitives";

export function useConfirmationDialog() {
  const resolverRef = useRef<((result: ConfirmationResult) => void) | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);

  function requestConfirmation(options: ConfirmationDialogState) {
    if (resolverRef.current) {
      resolverRef.current({ confirmed: false });
      resolverRef.current = null;
    }
    setConfirmation({
      ...options,
      inputValue: options.inputValue || "",
      inputError: "",
      secondaryInputValue: options.secondaryInputValue || "",
      secondaryInputError: "",
    });
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
    resolver?.({
      confirmed,
      inputValue: String(confirmation.inputValue || "").trim(),
      secondaryInputValue: String(confirmation.secondaryInputValue || "").trim(),
    });
  }

  function updateConfirmationInput(value: string) {
    setConfirmation((current) => current ? { ...current, inputValue: value, inputError: "" } : current);
  }

  function updateConfirmationSecondaryInput(value: string) {
    setConfirmation((current) =>
      current
        ? { ...current, secondaryInputValue: value, secondaryInputError: "" }
        : current,
    );
  }

  return {
    confirmation,
    requestConfirmation,
    cancelConfirmation: () => resolveConfirmation(false),
    confirmConfirmation: () => resolveConfirmation(true),
    updateConfirmationInput,
    updateConfirmationSecondaryInput,
  };
}

export function ConfirmationDialog({
  state,
  onCancel,
  onConfirm,
  onInputChange,
  onSecondaryInputChange,
}: {
  state: ConfirmationDialogState;
  onCancel: () => void;
  onConfirm: () => void;
  onInputChange?: (value: string) => void;
  onSecondaryInputChange?: (value: string) => void;
}) {
  const variantClass = state.variant === "danger"
    ? styles.confirmDialogDanger
    : state.variant === "warning"
      ? styles.confirmDialogWarning
      : "";

  return (
    <DismissibleLayer
      ariaLabel={state.title}
      overlayClassName={styles.modalOverlay}
      surfaceClassName={`${styles.confirmDialog} ${variantClass}`}
      dismissible={false}
      onClose={onCancel}
    >
      {() => (
        <>
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
              {state.inputType === "date" || state.inputType === "text" ? (
                <input
                  type={state.inputType}
                  value={state.inputValue || ""}
                  onChange={(event) => onInputChange?.(event.target.value)}
                  placeholder={state.inputPlaceholder}
                  autoFocus
                />
              ) : (
                <textarea
                  value={state.inputValue || ""}
                  onChange={(event) => onInputChange?.(event.target.value)}
                  placeholder={state.inputPlaceholder}
                  rows={3}
                  autoFocus
                />
              )}
              {state.inputError ? <small>{state.inputError}</small> : null}
            </label>
          ) : null}

          {state.secondaryInputLabel ? (
            <label className={styles.confirmDialogInput}>
              {state.secondaryInputLabel}
              {state.secondaryInputType === "date" || state.secondaryInputType === "text" ? (
                <input
                  type={state.secondaryInputType}
                  value={state.secondaryInputValue || ""}
                  onChange={(event) => onSecondaryInputChange?.(event.target.value)}
                  placeholder={state.secondaryInputPlaceholder}
                />
              ) : (
                <textarea
                  value={state.secondaryInputValue || ""}
                  onChange={(event) => onSecondaryInputChange?.(event.target.value)}
                  placeholder={state.secondaryInputPlaceholder}
                  rows={2}
                />
              )}
              {state.secondaryInputError ? <small>{state.secondaryInputError}</small> : null}
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
        </>
      )}
    </DismissibleLayer>
  );
}

export function SideDetailDrawer({
  ariaLabel,
  kicker,
  title,
  subtitle,
  actions,
  children,
  onClose,
  surfaceClassName,
}: {
  ariaLabel: string;
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  surfaceClassName?: string;
}) {
  return (
    <DismissibleLayer
      ariaLabel={ariaLabel}
      overlayClassName={styles.drawerOverlay}
      surfaceClassName={mergeClassNames(styles.sideDrawer, surfaceClassName)}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
        <header className={styles.sideDrawerHeader}>
          <div className={styles.sideDrawerTitle}>
            {kicker ? <span>{kicker}</span> : null}
            <strong>{title}</strong>
            {subtitle ? <small>{subtitle}</small> : null}
          </div>
          <div className={styles.sideDrawerActions}>
            {actions}
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </div>
        </header>
        <div className={styles.sideDrawerBody}>
          {children}
        </div>
        </>
      )}
    </DismissibleLayer>
  );
}
