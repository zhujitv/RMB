"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { availableMenus } from "./menu";
import { LoadingPanel } from "./LoadingPanel";
import { LoginPanel } from "./LoginPanel";
import { PasswordChangePanel } from "./PasswordChangePanel";
import type { User, WorkbenchTodo } from "./types";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceModuleContent } from "./WorkspaceModuleContent";
import styles from "./WorkspaceShell.module.css";
import {
  parseWorkbenchInternalHref,
  readWorkbenchDeepLink,
  removeWorkbenchDeepLink,
} from "../lib/platform/workbench-deep-link";
import {
  ALWAYS_ALLOWED_MENUS,
  normalizeWorkspaceMenuKey,
} from "./workspace-auth-helpers";
import { useWorkspaceAuthController } from "./workspace/use-workspace-auth-controller";
import { WorkspaceTabProvider } from "./workspace/workspace-tab-context";
import type {
  WorkspaceTab,
  WorkspaceTabFocusInput,
  WorkspaceTabPresentationPatch,
} from "./workspace/workspace-tabs";
import { useWorkspaceTabs } from "./workspace/use-workspace-tabs";

type OpenWorkspaceMenu = (
  menuKey: string,
  focus?: WorkspaceTabFocusInput,
  options?: { forceNew?: boolean; title?: string },
) => string;

function WorkspaceTabPanel({
  tab,
  active,
  onUpdate,
  children,
}: {
  tab: WorkspaceTab;
  active: boolean;
  onUpdate: (tabId: string, patch: WorkspaceTabPresentationPatch, ensureListTab?: boolean) => void;
  children: ReactNode;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const dirtySourcesRef = useRef(new Map<string, boolean>());
  const busySourcesRef = useRef(new Map<string, boolean>());
  const dirtyContextKeyRef = useRef(tab.contextKey);
  const lastReportedDirtyRef = useRef(tab.dirty);
  const lastReportedBusyRef = useRef(tab.busy);
  if (dirtyContextKeyRef.current !== tab.contextKey) {
    dirtyContextKeyRef.current = tab.contextKey;
    dirtySourcesRef.current.clear();
    busySourcesRef.current.clear();
    lastReportedDirtyRef.current = tab.dirty;
    lastReportedBusyRef.current = tab.busy;
  }
  const updatePresentation = useCallback((
    patch: WorkspaceTabPresentationPatch & { ensureListTab?: boolean },
  ) => {
    const { ensureListTab = false, ...presentation } = patch;
    onUpdate(tab.id, presentation, ensureListTab);
  }, [onUpdate, tab.id]);
  const reportDirty = useCallback((sourceId: string, dirty: boolean | null) => {
    if (dirty === null) dirtySourcesRef.current.delete(sourceId);
    else dirtySourcesRef.current.set(sourceId, dirty);
    const nextDirty = [...dirtySourcesRef.current.values()].some(Boolean);
    if (nextDirty === lastReportedDirtyRef.current) return;
    lastReportedDirtyRef.current = nextDirty;
    onUpdate(tab.id, { dirty: nextDirty });
  }, [onUpdate, tab.contextKey, tab.id]);
  const reportBusy = useCallback((sourceId: string, busy: boolean | null) => {
    if (busy === null) busySourcesRef.current.delete(sourceId);
    else busySourcesRef.current.set(sourceId, busy);
    const nextBusy = [...busySourcesRef.current.values()].some(Boolean);
    if (nextBusy === lastReportedBusyRef.current) return;
    lastReportedBusyRef.current = nextBusy;
    onUpdate(tab.id, { busy: nextBusy });
  }, [onUpdate, tab.contextKey, tab.id]);
  const contextValue = useMemo(() => ({
    tabId: tab.id,
    isActive: active,
    dirty: tab.dirty,
    busy: tab.busy,
    portalTarget,
    updatePresentation,
    reportDirty,
    reportBusy,
  }), [active, portalTarget, reportBusy, reportDirty, tab.busy, tab.dirty, tab.id, updatePresentation]);

  function handlePotentialEdit(event: SyntheticEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const hasExplicitTracker = [...dirtySourcesRef.current.keys()].some((key) => key.startsWith("explicit:"));
    if (hasExplicitTracker) return;
    if (tab.view === "edit" || target.closest("[data-workspace-dirty-scope]")) {
      reportDirty("captured-edit", true);
    }
  }

  return (
    <WorkspaceTabProvider value={contextValue}>
      <section
        id={`workspace-panel-${tab.id}`}
        className={styles.workspaceTabPanel}
        role="tabpanel"
        aria-labelledby={`workspace-tab-${tab.id}`}
        aria-hidden={!active}
        hidden={!active}
        onInputCapture={handlePotentialEdit}
        onChangeCapture={handlePotentialEdit}
      >
        {children}
        <div ref={setPortalTarget} className={styles.workspaceTabPortalHost} />
      </section>
    </WorkspaceTabProvider>
  );
}

export function WorkspaceShell() {
  const [workspaceResetRequest, setWorkspaceResetRequest] = useState({ menuKey: "welcome", token: 0 });
  const workspaceAuth = useWorkspaceAuthController({
    setActiveMenu: (menuKey) => setWorkspaceResetRequest({ menuKey, token: Date.now() }),
  });
  const {
    auth,
    bootWarnings,
    loginBusy,
    registerBusy,
    registerOpen,
    registerMessage,
    passwordBusy,
    publicCompanyProfile,
    workbenchTodos,
    setAuth,
    setRegisterOpen,
    handleLogin,
    handleRegister,
    handleChangePassword,
    handleLogout,
    loadWorkbenchTodos,
    updateCurrentUser,
    updateCompanyProfile,
  } = workspaceAuth;
  const payload = auth.status === "ready" ? auth.payload : null;
  const activeCompanyProfile = payload?.companyProfile || publicCompanyProfile;
  const menus = useMemo(() => payload ? availableMenus(payload.user, payload.permissions) : [], [payload]);
  const allowedMenuKeys = useMemo(() => new Set([...ALWAYS_ALLOWED_MENUS, ...menus.map((item) => item.key)]), [menus]);
  const workspaceTabs = useWorkspaceTabs({ allowedMenuKeys });
  const activeTab = workspaceTabs.activeTab;
  const activeMenu = activeTab?.menuKey || "welcome";

  useEffect(() => {
    if (!workspaceResetRequest.token) return;
    workspaceTabs.resetTabs(normalizeWorkspaceMenuKey(workspaceResetRequest.menuKey));
  }, [workspaceResetRequest.token]);

  const openWorkspaceMenu: OpenWorkspaceMenu = useCallback((menuKey, focus = {}, options = {}) => {
    const normalizedMenuKey = normalizeWorkspaceMenuKey(menuKey);
    if (menuKey === "logisticsReview") {
      return workspaceTabs.openTab("logisticsFees", focus, { ...options, forceNew: true });
    }
    return workspaceTabs.openTab(normalizedMenuKey, focus, options);
  }, [workspaceTabs.openTab]);

  const openWorkbenchHref = useCallback((href: string, fallbackOrderNo = "") => {
    const parsed = parseWorkbenchInternalHref(href);
    if (!parsed) return false;
    const path = parsed.pathname.replace(/^\/+/, "");
    const keyword = parsed.searchParams.get("keyword") || fallbackOrderNo;
    if (path === "orders") return Boolean(openWorkspaceMenu("orders", { keyword }));
    if (path === "payments") return Boolean(openWorkspaceMenu("payments", { keyword }));
    if (path === "costs") return Boolean(openWorkspaceMenu("costs", { keyword }));
    if (path === "profit") return Boolean(openWorkspaceMenu("profit", { keyword }));
    if (path === "domestic-logistics") return Boolean(openWorkspaceMenu("domesticLogistics", { keyword }));
    if (path === "customer-communication") {
      return Boolean(openWorkspaceMenu("customerCommunication", {
        keyword,
        orderId: parsed.searchParams.get("orderId") || "",
      }));
    }
    if (path === "ocean-control-tower") return Boolean(openWorkspaceMenu("oceanControlTower", { keyword }));
    if (path === "logistics-fees") {
      return Boolean(openWorkspaceMenu("logisticsFees", {
        keyword,
        billId: parsed.searchParams.get("billId") || "",
      }));
    }
    if (path === "supplier-documents") {
      return Boolean(openWorkspaceMenu("supplierDocuments", {
        keyword,
        requestId: parsed.searchParams.get("requestId") || "",
      }));
    }
    if (path === "tax-refund") {
      return Boolean(openWorkspaceMenu("taxRefund", {
        keyword,
        action: parsed.searchParams.get("action") || "",
      }));
    }
    return false;
  }, [openWorkspaceMenu]);

  const openWorkbenchTodo = useCallback((todo: WorkbenchTodo) => {
    openWorkbenchHref(todo.action?.href || "", todo.orderNo || "");
  }, [openWorkbenchHref]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    const deepLink = readWorkbenchDeepLink(window.location.href);
    if (!deepLink.present) return;
    if (deepLink.target) openWorkbenchHref(`${deepLink.target.pathname}${deepLink.target.search}`);
    window.history.replaceState(
      window.history.state,
      "",
      removeWorkbenchDeepLink(window.location.href),
    );
  }, [auth.status, openWorkbenchHref]);

  useEffect(() => {
    document.title = activeCompanyProfile?.systemName?.trim() || "NEXTWOOD 供应链协同平台";
  }, [activeCompanyProfile?.systemName]);

  function confirmDiscardWorkspace() {
    if (workspaceTabs.hasBusyTabs) {
      window.alert("当前仍有保存、上传或发送操作正在进行，请完成后再继续。");
      return false;
    }
    if (!workspaceTabs.hasDirtyTabs) return true;
    return window.confirm("当前有标签包含未保存修改，继续后这些内容将丢失。确定继续吗？");
  }

  function confirmPasswordChange(accountTabId: string, hasCurrentTabUnsavedChanges = false) {
    const otherTabs = workspaceTabs.tabs.filter((tab) => tab.id !== accountTabId);
    if (otherTabs.some((tab) => tab.busy)) {
      window.alert("其他标签仍有保存、上传或发送操作正在进行，请完成后再修改密码。");
      return false;
    }
    const hasUnsavedChanges = hasCurrentTabUnsavedChanges || otherTabs.some((tab) => tab.dirty);
    return window.confirm(hasUnsavedChanges
      ? "修改密码后将退出登录并关闭所有标签，其他未保存修改也会丢失。确定继续吗？"
      : "修改密码后将退出当前登录并关闭所有标签，确定继续吗？");
  }

  function handleWorkspacePasswordChange(user: User) {
    if (!confirmDiscardWorkspace()) return;
    setAuth({ status: "password-change", user });
  }

  async function handleWorkspaceLogout() {
    if (!confirmDiscardWorkspace()) return;
    await handleLogout();
  }

  if (auth.status === "loading") return <LoadingPanel message={auth.message} />;

  if (auth.status === "guest") {
    return (
      <LoginPanel
        message={auth.message}
        companyProfile={publicCompanyProfile}
        loginBusy={loginBusy}
        registerBusy={registerBusy}
        registerOpen={registerOpen}
        registerMessage={registerMessage}
        onRegisterToggle={setRegisterOpen}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    );
  }

  if (auth.status === "password-change") {
    return (
      <PasswordChangePanel
        user={auth.user}
        message={auth.message}
        busy={passwordBusy}
        onSubmit={handleChangePassword}
        onLogout={handleLogout}
      />
    );
  }

  if (!payload) return <LoadingPanel message="正在加载工作台..." />;

  return (
    <WorkspaceLayout
      payload={payload}
      menus={menus}
      activeMenu={activeMenu}
      activeTabTitle={activeTab?.title || "工作台首页"}
      tabs={workspaceTabs.tabs}
      activeTabId={workspaceTabs.activeTabId}
      onSelectMenu={(menuKey) => openWorkspaceMenu(menuKey)}
      onActivateTab={workspaceTabs.activateTab}
      onCloseTab={(tabId) => { workspaceTabs.closeTab(tabId); }}
      onDuplicateActiveTab={() => { workspaceTabs.duplicateActiveTab(); }}
      onLogout={() => { void handleWorkspaceLogout(); }}
      onPasswordChange={handleWorkspacePasswordChange}
      workbenchTodos={workbenchTodos}
      onRefreshTodos={() => void loadWorkbenchTodos({ refresh: true })}
      onOpenTodo={openWorkbenchTodo}
    >
      {workspaceTabs.tabs.map((tab) => (
        <WorkspaceTabPanel
          key={tab.id}
          tab={tab}
          active={tab.id === workspaceTabs.activeTabId}
          onUpdate={workspaceTabs.updateTab}
        >
          <WorkspaceModuleContent
            payload={payload}
            menus={menus}
            activeMenu={tab.menuKey}
            allowedMenuKeys={allowedMenuKeys}
            workbenchTodos={workbenchTodos}
            bootWarnings={bootWarnings}
            focus={tab.focus}
            setAuth={setAuth}
            openWorkspaceMenu={openWorkspaceMenu}
            loadWorkbenchTodos={loadWorkbenchTodos}
            openWorkbenchTodo={openWorkbenchTodo}
            updateCurrentUser={updateCurrentUser}
            updateCompanyProfile={updateCompanyProfile}
            confirmSessionEnd={(hasCurrentTabUnsavedChanges) => (
              confirmPasswordChange(tab.id, hasCurrentTabUnsavedChanges)
            )}
          />
        </WorkspaceTabPanel>
      ))}
    </WorkspaceLayout>
  );
}
