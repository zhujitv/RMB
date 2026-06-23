"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import { formatAmount, formatCny } from "./formatters";
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

function mergeClassNames(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

const checkboxInputType = "checkbox" as const;
const radioInputType = "radio" as const;
const fileInputType = "file" as const;
const dateInputType = "date" as const;

export function UiInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={mergeClassNames(styles.uiInput, className)} />;
}

export function UiDatePicker({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...props} type={dateInputType} className={mergeClassNames(styles.uiInput, styles.uiDatePicker, className)} />;
}

export function UiSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={mergeClassNames(styles.uiSelect, className)}>{children}</select>;
}

export function UiButton({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const variantClass = variant === "primary"
    ? styles.primaryButtonCompact
    : variant === "danger"
      ? styles.dangerButton
      : variant === "ghost"
        ? styles.ghostButton
        : styles.secondaryButton;

  return <button {...props} className={mergeClassNames(variantClass, className)} />;
}

export function MoneyAmount({
  currency = "CNY",
  amount,
  amountCny,
  prefix = "",
  className,
}: {
  currency?: string;
  amount?: unknown;
  amountCny?: unknown;
  prefix?: string;
  className?: string;
}) {
  const normalizedCurrency = String(currency || "CNY").toUpperCase();
  const hasAmount = amount !== "" && amount != null;
  const primaryAmount = Number(hasAmount ? amount : amountCny || 0);
  const cnyAmount = Number(amountCny ?? amount ?? 0);
  const showForeignAmount = normalizedCurrency !== "CNY" && hasAmount && Number.isFinite(primaryAmount);

  if (!showForeignAmount) {
    return (
      <div className={mergeClassNames(styles.amountCell, styles.amountCellSingle, className)}>
        <div className={styles.currencyAmount}>{prefix}{formatCny(cnyAmount)}</div>
      </div>
    );
  }

  return (
    <div className={mergeClassNames(styles.amountCell, className)}>
      <div className={styles.currencyAmount}>{prefix}{normalizedCurrency} {formatAmount(primaryAmount)}</div>
      <div className={styles.cnyAmount}>≈ {formatCny(cnyAmount)}</div>
    </div>
  );
}

export function UiCheckbox({
  label,
  description,
  variant = "card",
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  description?: ReactNode;
  variant?: "card" | "compact" | "inline" | "table";
}) {
  if (variant === "table") {
    return (
      <label className={mergeClassNames(styles.uiTableCheckboxLabel, className)}>
        <input {...props} type={checkboxInputType} className={styles.tableCheckbox} />
        <span className={styles.srOnly}>{label}</span>
      </label>
    );
  }

  const rootClass = variant === "inline"
    ? styles.uiInlineChoice
    : variant === "compact"
      ? styles.uiCompactChoice
      : styles.uiChoiceCard;

  return (
    <label className={mergeClassNames(rootClass, props.checked ? styles.uiChoiceCardChecked : "", className)}>
      <input {...props} type={checkboxInputType} className={styles.uiChoiceInput} />
      <span className={styles.uiChoiceCheck} aria-hidden="true">✓</span>
      <span className={styles.uiChoiceText}>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function UiOptionCard(props: Omit<Parameters<typeof UiCheckbox>[0], "variant">) {
  return <UiCheckbox {...props} variant="card" />;
}

export function UiRadio({
  label,
  description,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={mergeClassNames(styles.uiChoiceCard, props.checked ? styles.uiChoiceCardChecked : "", className)}>
      <input {...props} type={radioInputType} className={styles.uiChoiceInput} />
      <span className={styles.uiChoiceCheck} aria-hidden="true">✓</span>
      <span className={styles.uiChoiceText}>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

export function UiSwitch({
  label,
  description,
  checked,
  disabled = false,
  className,
  onChange,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={mergeClassNames(styles.uiSwitch, checked ? styles.uiSwitchOn : "", className)}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.uiSwitchText}>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className={styles.uiSwitchControl} aria-hidden="true">
        <span className={styles.uiSwitchState}>{checked ? "ON" : "OFF"}</span>
        <span className={styles.uiSwitchTrack}>
          <span className={styles.uiSwitchThumb} />
        </span>
      </span>
    </button>
  );
}

export function UiFileUpload({
  label = "上传PDF文件",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={mergeClassNames(styles.uiFileUpload, className)}>
      <span>{label}</span>
      <input {...props} type={fileInputType} className={styles.uiFileUploadInput} />
    </label>
  );
}

export function UiTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ key: string; label: ReactNode; disabled?: boolean }>;
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={mergeClassNames(styles.uiTabs, className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={value === tab.key}
          className={value === tab.key ? styles.uiTabActive : ""}
          disabled={tab.disabled}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
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

export function DismissibleLayer({
  ariaLabel,
  overlayClassName,
  surfaceClassName,
  onClose,
  children,
  dismissible = true,
  dismissConfirmMessage = "",
}: {
  ariaLabel: string;
  overlayClassName: string;
  surfaceClassName: string;
  onClose: () => void;
  children: (controls: { requestClose: () => void; closeImmediately: () => void; isClosing: boolean }) => ReactNode;
  dismissible?: boolean;
  dismissConfirmMessage?: string;
}) {
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function closeImmediately() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
  }

  function requestClose() {
    if (!dismissible) return;
    if (dismissConfirmMessage && typeof window !== "undefined" && !window.confirm(dismissConfirmMessage)) return;
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 180);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div
      className={`${overlayClassName} ${closing ? styles.dialogLayerClosing : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={requestClose}
    >
      <div
        className={`${surfaceClassName} ${closing ? styles.dialogSurfaceClosing : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children({ requestClose, closeImmediately, isClosing: closing })}
      </div>
    </div>
  );
}
