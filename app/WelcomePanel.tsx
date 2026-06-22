"use client";

import type { AuthPayload, MenuItem } from "./types";
import styles from "./WorkspaceShell.module.css";

type WelcomePanelProps = {
  payload: AuthPayload;
  menus: MenuItem[];
  onSelectMenu: (key: string) => void;
};

export function WelcomePanel({ payload, menus, onSelectMenu }: WelcomePanelProps) {
  const systemName = payload.companyProfile?.systemName?.trim() || "NEXTWOOD 供应链协同平台";

  return (
    <section className={styles.welcomeCard}>
      <span className={styles.kicker}>Welcome</span>
      <h2>欢迎使用 {systemName}</h2>
      <p>当前用户：{payload.user.name} / {payload.user.role}</p>
      <p>{payload.permissions?.scopeText || payload.scopeText || "请选择左侧功能模块开始操作。"}</p>
      <div className={styles.quickGrid}>
        {menus.slice(0, 6).map((item) => (
          <button key={item.key} type="button" onClick={() => onSelectMenu(item.key)}>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
