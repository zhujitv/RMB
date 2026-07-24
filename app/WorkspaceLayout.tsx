"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { MENU_ITEMS } from "./menu";
import type { AuthPayload, MenuItem, User, WorkbenchTodo, WorkbenchTodosState } from "./types";
import { initials } from "./utils";
import styles from "./WorkspaceShell.module.css";
import { WorkspaceTabsBar } from "./workspace/WorkspaceTabsBar";
import type { WorkspaceTab } from "./workspace/workspace-tabs";

type WorkspaceLayoutProps = {
  payload: AuthPayload;
  menus: MenuItem[];
  activeMenu: string;
  activeTabTitle: string;
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelectMenu: (key: string) => void;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onDuplicateActiveTab: () => void;
  onLogout: () => void;
  onPasswordChange: (user: User) => void;
  workbenchTodos: WorkbenchTodosState;
  onRefreshTodos: () => void;
  onOpenTodo: (todo: WorkbenchTodo) => void;
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
  oceanControlTower: ["M4 19h16", "M4 15l4-4 4 3 4-6 4 4", "M7 7h.01", "M12 7h.01", "M17 7h.01"],
  logisticsFees: ["M4 7h16", "M6 11h12", "M6 15h8", "M17 15h1", "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"],
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

function todoDotClass(summary: WorkbenchTodosState["summary"]) {
  if (summary.overdue > 0) return styles.todoDotRed;
  if (summary.todayDue > 0) return styles.todoDotOrange;
  return styles.todoDotBlue;
}

function todoPriorityLabel(priority: WorkbenchTodo["priority"], dueAt?: string | null) {
  if (priority === "urgent") return "紧急";
  if (priority === "important") return "重要";
  return dueAt ? "普通" : "普通";
}

function formatTodoDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function WorkspaceLayout({
  payload,
  menus,
  activeMenu,
  activeTabTitle,
  tabs,
  activeTabId,
  onSelectMenu,
  onActivateTab,
  onCloseTab,
  onDuplicateActiveTab,
  onLogout,
  onPasswordChange,
  workbenchTodos,
  onRefreshTodos,
  onOpenTodo,
  children,
}: WorkspaceLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
  const active = MENU_ITEMS.find((item) => item.key === activeMenu);
  const menuTitle = activeMenu === "welcome"
    ? "工作台首页"
    : activeMenu === "account"
      ? "账户设置"
      : active?.label || "功能模块";
  const topbarTitle = activeTabTitle || menuTitle;
  const avatarText = payload.user.avatarInitials?.trim() || initials(payload.user.name);
  const companyProfile = payload.companyProfile || {};
  const brandName = companyProfile.brandName?.trim() || "NEXTWOOD";
  const systemName = companyProfile.systemName?.trim() || "NEXTWOOD 供应链协同平台";
  const companyName = companyProfile.companyNameZh?.trim() || "浙江莱诺建材有限公司";
  const logoUrl = companyProfile.logoUrl?.trim() || "";
  const footerText = typeof companyProfile.footerText === "string"
    ? companyProfile.footerText.trim()
    : "© 2026 Zhejiang Lainuo Building Materials Co., Ltd.";
  const topTodos = workbenchTodos.todos.slice(0, 10);
  const pendingCount = Number(workbenchTodos.summary?.pending || 0);

  function handleOpenTodo(todo: WorkbenchTodo) {
    setTodoPanelOpen(false);
    onOpenTodo(todo);
  }

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
              className={`${styles.navItem} ${item.parentKey ? styles.navChildItem : ""} ${activeMenu === item.key ? styles.navItemActive : ""}`}
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
          <div className={styles.topbarRight}>
            <div className={styles.todoNavRoot}>
              <button
                className={styles.todoNavButton}
                type="button"
                onClick={() => setTodoPanelOpen((open) => !open)}
                aria-expanded={todoPanelOpen}
              >
                <span className={`${styles.todoDot} ${todoDotClass(workbenchTodos.summary)}`} />
                <span>待办 {pendingCount}</span>
              </button>
              {todoPanelOpen ? (
                <div className={styles.todoPanel}>
                  <div className={styles.todoPanelHeader}>
                    <strong>我的待办</strong>
                    <button type="button" onClick={onRefreshTodos} disabled={workbenchTodos.loading}>
                      {workbenchTodos.loading ? "刷新中" : "刷新"}
                    </button>
                  </div>
                  {workbenchTodos.error ? <div className={styles.todoPanelError}>{workbenchTodos.error}</div> : null}
                  {topTodos.length ? (
                    <div className={styles.todoPanelList}>
                      {topTodos.map((todo) => (
                        <button key={todo.id} type="button" className={styles.todoPanelItem} onClick={() => handleOpenTodo(todo)}>
                          <span className={styles.todoPanelItemTop}>
                            <b>{todo.title}</b>
                            <em>{todoPriorityLabel(todo.priority, todo.dueAt)}</em>
                          </span>
                          <span>{[todo.module, todo.orderNo, todo.customerShortName].filter(Boolean).join(" · ") || "-"}</span>
                          <small>截止：{formatTodoDate(todo.dueAt)} · 负责人：{todo.ownerName || "-"}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.todoPanelEmpty}>{workbenchTodos.loading ? "正在加载待办..." : "暂无待处理事项"}</div>
                  )}
                </div>
              ) : null}
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
          </div>
        </header>
        <WorkspaceTabsBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onDuplicateActive={onDuplicateActiveTab}
        />
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
