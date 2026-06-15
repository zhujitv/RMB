"use client";

import { moduleDescriptor } from "./modules";
import styles from "./WorkspaceShell.module.css";

type ModulePlaceholderProps = {
  moduleKey: string;
};

export function ModulePlaceholder({ moduleKey }: ModulePlaceholderProps) {
  const descriptor = moduleDescriptor(moduleKey);

  if (!descriptor) {
    return (
      <section className={styles.moduleCard}>
        <h2>功能模块</h2>
        <p>该模块暂未开放。请从左侧选择可用的业务功能。</p>
      </section>
    );
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <span className={styles.kicker}>功能说明</span>
        <span className={styles.stageBadge}>{stageLabel(descriptor.stage)}</span>
      </div>
      <h2>{descriptor.label}</h2>
      <p>{descriptor.description}</p>
      <div className={styles.migrationPanel}>
        <strong>当前能力</strong>
        <ul>
          {descriptor.migrationNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
      <p>请选择左侧菜单进入对应业务模块。</p>
    </section>
  );
}

function stageLabel(stage: string) {
  if (stage === "ready") return "已开放";
  if (stage === "partial") return "已开放";
  if (stage === "legacy") return "待开放";
  return "待开放";
}
