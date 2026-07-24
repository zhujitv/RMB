"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  createInitialWorkspaceTabsState,
  createWorkspaceTab,
  hasWorkspaceTabFocus,
  safeWorkspaceResetMenu,
  workspaceTabsReducer,
  type WorkspaceTabFocusInput,
  type WorkspaceTabPresentationPatch,
} from "./workspace-tabs";

export type WorkspaceTabFocusable = {
  isConnected: boolean;
  focus: () => void;
};

export function canDuplicateWorkspaceMenu(menuKey: string) {
  return menuKey !== "welcome" && menuKey !== "account";
}

export function shouldReuseWorkspaceBaseTab(
  menuKey: string,
  focus: WorkspaceTabFocusInput = {},
  forceNew = false,
) {
  return !canDuplicateWorkspaceMenu(menuKey) || (!forceNew && !hasWorkspaceTabFocus(focus));
}

export function focusWorkspaceTabAfterAction<T extends WorkspaceTabFocusable>(
  source: T | null,
  activeTab: T | null,
  preserveConnectedSource: boolean,
) {
  const target = preserveConnectedSource && source?.isConnected
    ? source
    : activeTab || (source?.isConnected ? source : null);
  target?.focus();
  return target;
}

export function useWorkspaceTabs({ allowedMenuKeys }: { allowedMenuKeys: Set<string> }) {
  const [state, dispatch] = useReducer(workspaceTabsReducer, undefined, createInitialWorkspaceTabsState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tabSequenceRef = useRef(0);

  const createTab = useCallback((menuKey: string, focus: WorkspaceTabFocusInput = {}, title?: string) => {
    tabSequenceRef.current += 1;
    return createWorkspaceTab({
      id: `workspace:${menuKey}:${Date.now().toString(36)}:${tabSequenceRef.current}`,
      menuKey,
      title,
      focus: { ...focus, token: focus.token || Date.now() },
    });
  }, []);

  const allowedSignature = useMemo(
    () => [...allowedMenuKeys].sort().join("|"),
    [allowedMenuKeys],
  );

  useEffect(() => {
    dispatch({ type: "prune", allowedMenuKeys: allowedSignature ? allowedSignature.split("|") : [] });
  }, [allowedSignature]);

  const openTab = useCallback((
    menuKey: string,
    focus: WorkspaceTabFocusInput = {},
    options: { forceNew?: boolean; title?: string } = {},
  ) => {
    if (!allowedMenuKeys.has(menuKey)) return "";
    const reuseBase = shouldReuseWorkspaceBaseTab(menuKey, focus, Boolean(options.forceNew));
    const reusable = reuseBase
      ? stateRef.current.tabs.find((tab) => (
        tab.menuKey === menuKey
        && ["home", "list", "report", "account"].includes(tab.view)
        && !hasWorkspaceTabFocus(tab.focus)
      ))
      : null;
    if (reusable) {
      dispatch({ type: "activate", tabId: reusable.id });
      return reusable.id;
    }
    const tab = createTab(menuKey, focus, options.title);
    dispatch({ type: "open", tab, reuseBase });
    return tab.id;
  }, [allowedMenuKeys, createTab]);

  const resetTabs = useCallback((menuKey = "welcome") => {
    const safeMenuKey = safeWorkspaceResetMenu(menuKey, allowedMenuKeys);
    const initialState = createInitialWorkspaceTabsState();
    if (safeMenuKey === "welcome") {
      dispatch({ type: "reset", state: initialState });
      return;
    }
    const tab = createTab(safeMenuKey);
    dispatch({
      type: "reset",
      state: { tabs: [...initialState.tabs, tab], activeTabId: tab.id },
    });
  }, [allowedMenuKeys, createTab]);

  const activateTab = useCallback((tabId: string) => {
    dispatch({ type: "activate", tabId });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    if (!tab || !tab.closable) return false;
    if (tab.busy) {
      if (typeof window !== "undefined") window.alert(`“${tab.title}”仍有操作正在进行，请完成后再关闭。`);
      return false;
    }
    if (tab.dirty && typeof window !== "undefined" && !window.confirm(`“${tab.title}”中有未保存修改，确定关闭该标签吗？`)) return false;
    dispatch({ type: "close", tabId });
    return true;
  }, []);

  const duplicateActiveTab = useCallback(() => {
    const current = stateRef.current;
    const activeTab = current.tabs.find((tab) => tab.id === current.activeTabId);
    if (!activeTab || !canDuplicateWorkspaceMenu(activeTab.menuKey)) return "";
    const tab = createTab(activeTab.menuKey);
    dispatch({ type: "open", tab, reuseBase: false });
    return tab.id;
  }, [createTab]);

  const updateTab = useCallback((
    tabId: string,
    patch: WorkspaceTabPresentationPatch,
    ensureListTab = false,
  ) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === tabId);
    const nextView = patch.view || currentTab?.view;
    const fallbackListTab = ensureListTab && currentTab && nextView && !["home", "list", "report", "account"].includes(nextView)
      ? { ...createTab(currentTab.menuKey), autoFallbackFor: currentTab.id }
      : undefined;
    dispatch({ type: "update", tabId, patch, fallbackListTab });
  }, [createTab]);

  useEffect(() => {
    if (!state.tabs.some((tab) => tab.dirty || tab.busy)) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [state.tabs]);

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab: state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0],
    hasDirtyTabs: state.tabs.some((tab) => tab.dirty),
    hasBusyTabs: state.tabs.some((tab) => tab.busy),
    openTab,
    resetTabs,
    activateTab,
    closeTab,
    duplicateActiveTab,
    updateTab,
  };
}
