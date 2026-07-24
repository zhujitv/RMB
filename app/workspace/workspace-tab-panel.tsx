"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import styles from "./workspace-styles";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import type { WorkspaceTab, WorkspaceTabFocusInput, WorkspaceTabPresentationPatch } from "./workspace-tabs";

export type OpenWorkspaceMenu = (
  menuKey: string,
  focus?: WorkspaceTabFocusInput,
  options?: { forceNew?: boolean; title?: string },
) => string;

export function WorkspaceTabPanel({
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
