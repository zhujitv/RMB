import { MENU_ITEMS } from "../menu";
import type { SettingsTabKey } from "../modules/settings/types";

export const WORKSPACE_HOME_TAB_ID = "workspace:welcome";

export type WorkspaceTabView = "home" | "list" | "detail" | "edit" | "report" | "account";

export type WorkspaceTabFocus = {
  keyword: string;
  action: string;
  orderId: string;
  costId: string;
  paymentId: string;
  quotationId: string;
  executionId: string;
  purchaseOrderId: string;
  billId: string;
  requestId: string;
  settingsTab: SettingsTabKey | "";
  token: number;
};

export type WorkspaceTab = {
  id: string;
  menuKey: string;
  title: string;
  view: WorkspaceTabView;
  contextKey: string;
  focus: WorkspaceTabFocus;
  pinned: boolean;
  closable: boolean;
  dirty: boolean;
  busy: boolean;
  autoFallbackFor?: string;
};

export type WorkspaceTabsState = {
  tabs: WorkspaceTab[];
  activeTabId: string;
};

export type WorkspaceTabPresentationPatch = {
  title?: string;
  view?: WorkspaceTabView;
  contextKey?: string;
  dirty?: boolean;
  busy?: boolean;
};

export type WorkspaceTabsAction =
  | { type: "open"; tab: WorkspaceTab; reuseBase: boolean }
  | { type: "activate"; tabId: string }
  | { type: "close"; tabId: string }
  | { type: "update"; tabId: string; patch: WorkspaceTabPresentationPatch; fallbackListTab?: WorkspaceTab }
  | { type: "reset"; state: WorkspaceTabsState }
  | { type: "prune"; allowedMenuKeys: string[] };

export type WorkspaceTabFocusInput = Partial<Omit<WorkspaceTabFocus, "token">> & { token?: number };

const SPECIAL_TITLES: Record<string, string> = {
  welcome: "工作台首页",
  account: "账户设置",
};

export function workspaceMenuTitle(menuKey: string) {
  return SPECIAL_TITLES[menuKey] || MENU_ITEMS.find((item) => item.key === menuKey)?.label || "功能模块";
}

export function workspaceBaseView(menuKey: string): WorkspaceTabView {
  if (menuKey === "welcome") return "home";
  if (menuKey === "account") return "account";
  if (menuKey === "reports") return "report";
  return "list";
}

export function isWorkspaceBaseView(view: WorkspaceTabView) {
  return view === "home" || view === "list" || view === "report" || view === "account";
}

export function createWorkspaceTabFocus(input: WorkspaceTabFocusInput = {}): WorkspaceTabFocus {
  return {
    keyword: input.keyword?.trim() || "",
    action: input.action?.trim() || "",
    orderId: input.orderId?.trim() || "",
    costId: input.costId?.trim() || "",
    paymentId: input.paymentId?.trim() || "",
    quotationId: input.quotationId?.trim() || "",
    executionId: input.executionId?.trim() || "",
    purchaseOrderId: input.purchaseOrderId?.trim() || "",
    billId: input.billId?.trim() || "",
    requestId: input.requestId?.trim() || "",
    settingsTab: input.settingsTab || "",
    token: Number(input.token || 0),
  };
}

export function hasWorkspaceTabFocus(focus: WorkspaceTabFocusInput = {}) {
  return Boolean(
    focus.keyword?.trim()
    || focus.action?.trim()
    || focus.orderId?.trim()
    || focus.costId?.trim()
    || focus.paymentId?.trim()
    || focus.quotationId?.trim()
    || focus.executionId?.trim()
    || focus.purchaseOrderId?.trim()
    || focus.billId?.trim()
    || focus.requestId?.trim()
    || focus.settingsTab,
  );
}

export function createWorkspaceTab({
  id,
  menuKey,
  title,
  focus,
}: {
  id: string;
  menuKey: string;
  title?: string;
  focus?: WorkspaceTabFocusInput;
}): WorkspaceTab {
  const view = workspaceBaseView(menuKey);
  const normalizedFocus = createWorkspaceTabFocus(focus);
  const activatedFocus = hasWorkspaceTabFocus(normalizedFocus) && !normalizedFocus.token
    ? { ...normalizedFocus, token: Date.now() }
    : normalizedFocus;
  return {
    id,
    menuKey,
    title: title?.trim() || workspaceMenuTitle(menuKey),
    view,
    contextKey: `${view}:${menuKey}`,
    focus: activatedFocus,
    pinned: menuKey === "welcome",
    closable: menuKey !== "welcome",
    dirty: false,
    busy: false,
  };
}

export function createInitialWorkspaceTabsState(): WorkspaceTabsState {
  const home = createWorkspaceTab({ id: WORKSPACE_HOME_TAB_ID, menuKey: "welcome" });
  return { tabs: [home], activeTabId: home.id };
}

export function safeWorkspaceResetMenu(menuKey: string, allowedMenuKeys: Set<string>) {
  return allowedMenuKeys.has(menuKey) ? menuKey : "welcome";
}

function sameTabState(left: WorkspaceTab, right: WorkspaceTab) {
  return left.title === right.title
    && left.view === right.view
    && left.contextKey === right.contextKey
    && left.dirty === right.dirty
    && left.busy === right.busy;
}

export function workspaceTabsReducer(state: WorkspaceTabsState, action: WorkspaceTabsAction): WorkspaceTabsState {
  if (action.type === "open") {
    const reusable = action.reuseBase
      ? state.tabs.find((tab) => (
        tab.menuKey === action.tab.menuKey
        && isWorkspaceBaseView(tab.view)
        && !hasWorkspaceTabFocus(tab.focus)
      ))
      : null;
    if (reusable) {
      return reusable.id === state.activeTabId ? state : { ...state, activeTabId: reusable.id };
    }
    return {
      tabs: [...state.tabs, action.tab],
      activeTabId: action.tab.id,
    };
  }

  if (action.type === "activate") {
    if (action.tabId === state.activeTabId || !state.tabs.some((tab) => tab.id === action.tabId)) return state;
    return { ...state, activeTabId: action.tabId };
  }

  if (action.type === "close") {
    const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
    if (index < 0 || state.tabs[index]?.pinned) return state;
    const closingTab = state.tabs[index];
    const nextTabs = state.tabs.filter((tab) => tab.id !== action.tabId);
    if (state.activeTabId !== action.tabId) return { ...state, tabs: nextTabs };
    const relatedBaseTab = nextTabs.find((tab) => (
      tab.menuKey === closingTab?.menuKey && isWorkspaceBaseView(tab.view)
    ));
    const fallback = relatedBaseTab || nextTabs[Math.min(index, nextTabs.length - 1)] || nextTabs[0];
    return {
      tabs: nextTabs,
      activeTabId: fallback?.id || WORKSPACE_HOME_TAB_ID,
    };
  }

  if (action.type === "update") {
    const currentTab = state.tabs.find((tab) => tab.id === action.tabId);
    if (!currentTab) return state;
    const contextChanged = Boolean(action.patch.contextKey && action.patch.contextKey !== currentTab.contextKey);
    const updatedTab: WorkspaceTab = {
      ...currentTab,
      ...action.patch,
      dirty: contextChanged ? false : action.patch.dirty ?? currentTab.dirty,
    };
    let nextTabs = state.tabs.map((tab) => tab.id === action.tabId ? updatedTab : tab);
    if (isWorkspaceBaseView(updatedTab.view)) {
      const activeAutomaticBase = nextTabs.find((tab) => (
        tab.id === state.activeTabId
        && tab.id !== updatedTab.id
        && tab.menuKey === updatedTab.menuKey
        && Boolean(tab.autoFallbackFor)
        && isWorkspaceBaseView(tab.view)
      ));
      nextTabs = nextTabs.filter((tab) => {
        if (activeAutomaticBase && tab.id === updatedTab.id) return false;
        if (tab.id === activeAutomaticBase?.id) return true;
        return !(
          tab.id !== updatedTab.id
          && tab.menuKey === updatedTab.menuKey
          && Boolean(tab.autoFallbackFor)
          && isWorkspaceBaseView(tab.view)
        );
      });
    }
    if (action.fallbackListTab) {
      const hasBaseTab = nextTabs.some((tab) => (
        tab.id !== action.tabId
        && tab.menuKey === updatedTab.menuKey
        && isWorkspaceBaseView(tab.view)
      ));
      if (!hasBaseTab && !isWorkspaceBaseView(updatedTab.view)) {
        nextTabs = [...nextTabs, action.fallbackListTab];
      }
    }
    if (nextTabs.length === state.tabs.length && sameTabState(currentTab, updatedTab)) return state;
    const activeTabId = nextTabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : nextTabs.some((tab) => tab.id === updatedTab.id)
        ? updatedTab.id
        : WORKSPACE_HOME_TAB_ID;
    return { ...state, tabs: nextTabs, activeTabId };
  }

  if (action.type === "reset") return action.state;

  const allowed = new Set(["welcome", "account", ...action.allowedMenuKeys]);
  const nextTabs = state.tabs.filter((tab) => allowed.has(tab.menuKey));
  const safeTabs = nextTabs.some((tab) => tab.id === WORKSPACE_HOME_TAB_ID)
    ? nextTabs
    : [createWorkspaceTab({ id: WORKSPACE_HOME_TAB_ID, menuKey: "welcome" }), ...nextTabs];
  const activeTabId = safeTabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : WORKSPACE_HOME_TAB_ID;
  if (safeTabs.length === state.tabs.length && activeTabId === state.activeTabId) return state;
  return { tabs: safeTabs, activeTabId };
}
