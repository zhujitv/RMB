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
        <h2>模块迁移</h2>
        <p>该模块尚未加入 React + TypeScript 工作台。请从左侧选择已开放的功能模块。</p>
      </section>
    );
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <span className={styles.kicker}>按模块迁移中</span>
        <span className={styles.stageBadge}>{stageLabel(descriptor.stage)}</span>
      </div>
      <h2>{descriptor.label}</h2>
      <p>{descriptor.description}</p>
      <div className={styles.migrationPanel}>
        <strong>迁移要点</strong>
        <ul>
          {descriptor.migrationNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
      <p>该模块正在迁移中。当前工作台会优先开放已完成的 React 功能。</p>
    </section>
  );
}

function stageLabel(stage: string) {
  if (stage === "ready") return "已迁移";
  if (stage === "partial") return "部分迁移";
  if (stage === "legacy") return "待迁移";
  return "待迁移";
}
