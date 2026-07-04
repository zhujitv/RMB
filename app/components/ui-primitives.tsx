"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import styles from "../WorkspaceShell.module.css";

export function mergeClassNames(...classNames: Array<string | false | null | undefined>) {
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
  return <PermissionSelectItem {...props} />;
}

export function PermissionSelectItem(props: Omit<Parameters<typeof UiCheckbox>[0], "variant">) {
  return <UiCheckbox {...props} variant="card" />;
}

export function CheckboxOptionRow({
  label,
  description,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={mergeClassNames(styles.checkboxOptionRow, props.checked ? styles.checkboxOptionRowChecked : "", className)}>
      <input {...props} type={checkboxInputType} className={styles.checkboxOptionInput} />
      <span className={styles.checkboxBox} aria-hidden="true">✓</span>
      <span className={styles.checkboxContent}>
        <span className={styles.checkboxTitle}>{label}</span>
        {description ? <span className={styles.checkboxDesc}>{description}</span> : null}
      </span>
    </label>
  );
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
