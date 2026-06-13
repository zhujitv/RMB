"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { MENU_ITEMS } from "./menu";
import type { AuthPayload, MenuItem, User } from "./types";
import { initials } from "./utils";
import styles from "./WorkspaceShell.module.css";

type WorkspaceLayoutProps = {
  payload: AuthPayload;
  menus: MenuItem[];
  activeMenu: string;
  onSelectMenu: (key: string) => void;
  onLogout: () => void;
  onPasswordChange: (user: User) => void;
  children: ReactNode;
};

export function WorkspaceLayout({
  payload,
  menus,
  activeMenu,
  onSelectMenu,
  onLogout,
  onPasswordChange,
  children,
}: WorkspaceLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const active = MENU_ITEMS.find((item) => item.key === activeMenu);

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <strong>NEXTWOOD</strong>
          <span>供应链协同平台</span>
        </div>
        <nav className={styles.navList} aria-label="功能菜单">
          <button
            className={`${styles.navItem} ${activeMenu === "welcome" ? styles.navItemActive : ""}`}
            type="button"
            onClick={() => onSelectMenu("welcome")}
          >
            工作台首页
          </button>
          {menus.map((item) => (
            <button
              key={item.key}
              className={`${styles.navItem} ${activeMenu === item.key ? styles.navItemActive : ""}`}
              type="button"
              onClick={() => onSelectMenu(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div>
            <span className={styles.kicker}>React + TypeScript Migration</span>
            <h1>{activeMenu === "welcome" ? "工作台首页" : active?.label || "模块迁移"}</h1>
          </div>
          <div className={styles.accountArea}>
            <button className={styles.accountButton} type="button" onClick={() => setMenuOpen((open) => !open)}>
              <span className={styles.avatar}>{initials(payload.user.name)}</span>
              <span>{payload.user.name}</span>
            </button>
            {menuOpen ? (
              <div className={styles.accountMenu}>
                <strong>{payload.user.name}</strong>
                <span>{payload.user.role}</span>
                <button type="button" onClick={() => onSelectMenu("account")}>账户设置</button>
                <button type="button" onClick={() => onPasswordChange(payload.user)}>安全设置</button>
                <button type="button" onClick={onLogout}>退出登录</button>
              </div>
            ) : null}
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
