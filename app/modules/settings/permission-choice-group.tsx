import { PermissionSelectItem } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { PermissionOption } from "./types";

export function PermissionChoiceGroup({
  title,
  options,
  values,
  onToggle,
}: {
  title: string;
  options: PermissionOption[];
  values: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <section className={styles.permissionGroup}>
      <div className={styles.permissionGroupHeader}>
        <strong>{title}</strong>
        <span>已选择 {values.length} / {options.length} 项</span>
      </div>
      <div className={styles.permissionOptionGrid}>
        {options.map((option) => (
          <PermissionSelectItem
            key={option.value}
            className={styles.permissionOptionCard}
            label={option.label}
            checked={values.includes(option.value)}
            onChange={() => onToggle(option.value)}
          />
        ))}
      </div>
    </section>
  );
}
