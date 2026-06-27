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

const NAV_ICONS: Record<string, string[]> = {
  welcome: ["M3 11 12 3l9 8", "M5 10v10h14V10", "M9 20v-6h6v6"],
  dashboard: ["M3 3v18h18", "M18 17V9", "M13 17V5", "M8 17v-3"],
  orders: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
  payments: ["M21 8V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7", "M17 14h.01"],
  costs: ["m16 16 2 2 4-4", "M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14", "m3.3 7 8.7 5 8.7-5", "M12 22V12"],
  profit: ["m22 7-8.5 8.5-5-5L2 17", "M16 7h6v6"],
  domesticLogistics: ["M10 17h4V5H2v12h3", "M14 17h1V9h4l3 4v4h-2", "M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "M18 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"],
  taxRefund: ["M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.5L10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z", "m9 13 2 2 4-4"],
  reports: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M8 13h8", "M8 17h8", "M12 9v8"],
  manual: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z", "M8 7h8", "M8 11h6"],
  settings: ["M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.35 1.1V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.1-.35H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .35-1.1V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15.4 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.32.36.7.6 1.1.6H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z"],
};

function NavIcon({ menuKey }: { menuKey: string }) {
  return (
    <svg className={styles.navIcon} aria-hidden="true" viewBox="0 0 24 24">
      {(NAV_ICONS[menuKey] || NAV_ICONS.manual).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const active = MENU_ITEMS.find((item) => item.key === activeMenu);
  const topbarTitle = activeMenu === "welcome"
    ? "工作台首页"
    : activeMenu === "account"
      ? "账户设置"
      : active?.label || "功能模块";
  const avatarText = payload.user.avatarInitials?.trim() || initials(payload.user.name);
  const companyProfile = payload.companyProfile || {};
  const brandName = companyProfile.brandName?.trim() || "NEXTWOOD";
  const systemName = companyProfile.systemName?.trim() || "NEXTWOOD 供应链协同平台";
  const companyName = companyProfile.companyNameZh?.trim() || "浙江莱诺建材有限公司";
  const logoUrl = companyProfile.logoUrl?.trim() || "";
  const footerText = typeof companyProfile.footerText === "string"
    ? companyProfile.footerText.trim()
    : "© 2026 Zhejiang Lainuo Building Materials Co., Ltd.";

  return (
    <div className={styles.appShell}>
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="关闭导航菜单"
          className={styles.mobileNavBackdrop}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <aside className={`${styles.sidebar} ${mobileNavOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brandBlock}>
          {logoUrl ? <img className={styles.brandLogo} src={logoUrl} alt={`${brandName} logo`} /> : null}
          <strong>{brandName}</strong>
          <span className={styles.brandPlatform}>{systemName}</span>
          <span className={styles.brandCompany}>{companyName}</span>
        </div>
        <nav className={styles.navList} aria-label="功能菜单">
          <button
            className={`${styles.navItem} ${activeMenu === "welcome" ? styles.navItemActive : ""}`}
            type="button"
            onClick={() => {
              onSelectMenu("welcome");
              setMobileNavOpen(false);
            }}
          >
            <NavIcon menuKey="welcome" />
            <span>工作台首页</span>
          </button>
          {menus.map((item) => (
            <button
              key={item.key}
              className={`${styles.navItem} ${activeMenu === item.key ? styles.navItemActive : ""}`}
              type="button"
              onClick={() => {
                onSelectMenu(item.key);
                setMobileNavOpen(false);
              }}
            >
              <NavIcon menuKey={item.key} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        {footerText ? <div className={styles.sidebarFooter}>{footerText}</div> : null}
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.topbarTitleRow}>
            <button
              type="button"
              className={styles.mobileMenuButton}
              aria-label="打开导航菜单"
              onClick={() => setMobileNavOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <div>
              <h1>{topbarTitle}</h1>
            </div>
          </div>
          <div className={styles.accountArea}>
            <button className={styles.accountButton} type="button" onClick={() => setMenuOpen((open) => !open)}>
              <span className={styles.avatar}>{avatarText}</span>
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
