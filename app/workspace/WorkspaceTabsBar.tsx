"use client";

import { useRef, type KeyboardEvent } from "react";
import type { WorkspaceTab } from "./workspace-tabs";
import styles from "../WorkspaceShell.module.css";
import {
  canDuplicateWorkspaceMenu,
  focusWorkspaceTabAfterAction,
} from "./use-workspace-tabs";

export function WorkspaceTabsBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onDuplicateActive,
}: {
  tabs: WorkspaceTab[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDuplicateActive: () => void;
}) {
  const tabListRef = useRef<HTMLDivElement | null>(null);

  function activeTabElement() {
    return tabListRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]') || null;
  }

  function focusAfterAction(source: HTMLButtonElement | null, preserveConnectedSource: boolean) {
    window.requestAnimationFrame(() => {
      focusWorkspaceTabAfterAction(source, activeTabElement(), preserveConnectedSource);
    });
  }

  function closeAndRestoreFocus(tabId: string, source: HTMLButtonElement) {
    onClose(tabId);
    focusAfterAction(source, true);
  }

  function focusTabAt(index: number) {
    const safeIndex = (index + tabs.length) % tabs.length;
    const tab = tabs[safeIndex];
    if (!tab) return;
    onActivate(tab.id);
    window.requestAnimationFrame(() => document.getElementById(`workspace-tab-${tab.id}`)?.focus());
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number, tab: WorkspaceTab) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTabAt(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTabAt(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTabAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTabAt(tabs.length - 1);
    } else if ((event.key === "Delete" || event.key === "Backspace") && tab.closable) {
      event.preventDefault();
      closeAndRestoreFocus(tab.id, event.currentTarget);
    }
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  return (
    <div className={styles.workspaceTabsBar}>
      <div ref={tabListRef} className={styles.workspaceTabsScroller} role="tablist" aria-label="已打开的业务标签">
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          return (
            <div key={tab.id} role="presentation" className={`${styles.workspaceTabItem} ${active ? styles.workspaceTabItemActive : ""}`}>
              <button
                id={`workspace-tab-${tab.id}`}
                className={styles.workspaceTabButton}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`workspace-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                title={tab.title}
                onClick={() => onActivate(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index, tab)}
              >
                {tab.pinned ? <span className={styles.workspaceTabHomeMark} aria-hidden="true">⌂</span> : null}
                <span className={styles.workspaceTabLabel}>{tab.title}</span>
                {tab.busy ? <span className={styles.workspaceTabBusy} aria-label="操作进行中">●</span> : null}
                {tab.dirty ? <span className={styles.workspaceTabDirty} aria-label="有未保存修改">●</span> : null}
              </button>
              {tab.closable ? (
                <button
                  className={styles.workspaceTabClose}
                  type="button"
                  aria-label={`关闭${tab.title}标签`}
                  title={`关闭${tab.title}`}
                  onClick={(event) => closeAndRestoreFocus(tab.id, event.currentTarget)}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {activeTab && canDuplicateWorkspaceMenu(activeTab.menuKey) ? (
        <button
          className={styles.workspaceTabDuplicate}
          type="button"
          onClick={(event) => {
            onDuplicateActive();
            focusAfterAction(event.currentTarget, false);
          }}
          title="新开一个当前模块标签"
          aria-label="新开当前模块标签"
        >
          <span className={styles.workspaceTabDuplicateIcon} aria-hidden="true">＋</span>
          <span className={styles.workspaceTabDuplicateLabel}>新开</span>
        </button>
      ) : null}
    </div>
  );
}
