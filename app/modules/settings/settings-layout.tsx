import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { UiSwitch } from "../../components";
import styles from "./settings-styles";

export function SettingsPage({
  title,
  description,
  updatedAt,
  status,
  actions,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  updatedAt?: string;
  status?: ReactNode;
  actions?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const content = (
    <>
      <div className={styles.settingsPageHeader}>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
          <div className={styles.settingsPageMeta}>
            {updatedAt ? <span>最后修改：{updatedAt}</span> : null}
            {status ? status : null}
          </div>
        </div>
        {actions ? <div className={styles.settingsHeaderActions}>{actions}</div> : null}
      </div>
      {children}
    </>
  );

  if (onSubmit) {
    return <form className={styles.settingsConfigForm} onSubmit={onSubmit}>{content}</form>;
  }
  return <div className={styles.settingsConfigForm}>{content}</div>;
}

export function SettingsCard({ title, icon, children }: { title: string; icon?: string; children: ReactNode }) {
  return (
    <section className={styles.settingsConfigCard}>
      <div className={styles.settingsCardHeader}>
        {icon ? <span className={styles.settingsHomeIcon}>{icon}</span> : null}
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  );
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.settingsSection}>
      <div className={styles.settingsSectionHeader}>
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  );
}

export function SettingsField({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.settingsField} title={tooltip}>
      <span className={styles.settingsFieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function SettingsSwitch({
  label,
  tooltip,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  tooltip?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div title={tooltip}>
      <UiSwitch label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function SettingsStatusTag({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger" | "muted";
  children: ReactNode;
}) {
  const toneClass = tone === "success"
    ? styles.settingsStatusSuccess
    : tone === "warning"
      ? styles.settingsStatusWarning
      : tone === "danger"
        ? styles.settingsStatusDanger
        : styles.settingsStatusMuted;
  return <span className={`${styles.settingsStatusTag} ${toneClass}`}>● {children}</span>;
}

export function SecretField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  async function copyValue() {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className={styles.settingsSecretField}>
      <input
        value={value}
        type={visible ? "text" : "password"}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <div className={styles.settingsSecretActions}>
        <button type="button" className={styles.secondaryButton} onClick={() => setVisible((current) => !current)}>
          {visible ? "隐藏" : "显示"}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => void copyValue()} disabled={!value}>
          复制
        </button>
      </div>
    </div>
  );
}
