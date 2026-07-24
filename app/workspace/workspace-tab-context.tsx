"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import type { WorkspaceTabPresentationPatch, WorkspaceTabView } from "./workspace-tabs";

export type WorkspaceTabContextValue = {
  tabId: string;
  isActive: boolean;
  dirty: boolean;
  busy: boolean;
  portalTarget: HTMLElement | null;
  updatePresentation: (patch: WorkspaceTabPresentationPatch & { ensureListTab?: boolean }) => void;
  reportDirty: (sourceId: string, dirty: boolean | null) => void;
  reportBusy: (sourceId: string, busy: boolean | null) => void;
};

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null);

export function WorkspaceTabProvider({ value, children }: { value: WorkspaceTabContextValue; children: ReactNode }) {
  return <WorkspaceTabContext.Provider value={value}>{children}</WorkspaceTabContext.Provider>;
}

export function useWorkspaceTabContext() {
  return useContext(WorkspaceTabContext);
}

export function useWorkspaceTabPresentation({
  title,
  view,
  contextKey,
  ensureListTab = false,
}: {
  title: string;
  view: WorkspaceTabView;
  contextKey: string;
  ensureListTab?: boolean;
}) {
  const workspaceTab = useWorkspaceTabContext();
  useEffect(() => {
    workspaceTab?.updatePresentation({ title, view, contextKey, ensureListTab });
  }, [contextKey, ensureListTab, title, view, workspaceTab?.updatePresentation]);
}

export function useWorkspaceTabDirty(dirty: boolean) {
  const workspaceTab = useWorkspaceTabContext();
  const sourceId = useId();
  useEffect(() => {
    if (!workspaceTab) return;
    const key = `explicit:${sourceId}`;
    workspaceTab.reportDirty(key, dirty);
    return () => workspaceTab.reportDirty(key, null);
  }, [dirty, sourceId, workspaceTab?.reportDirty]);
}

export function useWorkspaceTabBusy(busy: boolean) {
  const workspaceTab = useWorkspaceTabContext();
  const sourceId = useId();
  useEffect(() => {
    if (!workspaceTab) return;
    const key = `busy:${sourceId}`;
    workspaceTab.reportBusy(key, busy);
    return () => workspaceTab.reportBusy(key, null);
  }, [busy, sourceId, workspaceTab?.reportBusy]);
}

export function useWorkspaceTabActive() {
  return useWorkspaceTabContext()?.isActive ?? true;
}

export function useWorkspaceTabDiscardGuard(message = "当前内容有未保存修改，确定放弃吗？") {
  const workspaceTab = useWorkspaceTabContext();
  return useCallback(() => {
    if (workspaceTab?.busy) {
      if (typeof window !== "undefined") window.alert("当前操作正在进行，请完成后再继续。");
      return false;
    }
    if (workspaceTab?.dirty && typeof window !== "undefined" && !window.confirm(message)) return false;
    return true;
  }, [message, workspaceTab?.busy, workspaceTab?.dirty]);
}

export function useWorkspaceTabReactivation(onReactivate: () => void) {
  const workspaceTab = useWorkspaceTabContext();
  const isActive = workspaceTab?.isActive ?? true;
  const wasActiveRef = useRef(isActive);
  const callbackRef = useRef(onReactivate);
  callbackRef.current = onReactivate;

  useEffect(() => {
    if (isActive && !wasActiveRef.current && !workspaceTab?.dirty && !workspaceTab?.busy) callbackRef.current();
    wasActiveRef.current = isActive;
  }, [isActive, workspaceTab?.busy, workspaceTab?.dirty]);
}
