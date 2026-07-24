"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../workspace/workspace-styles";
import { useWorkspaceTabContext } from "../workspace/workspace-tab-context";

let activeDismissibleLayerCount = 0;
let previousBodyOverflow = "";

export function createDismissibleLayerStack() {
  const layers: Array<{ id: symbol; active: boolean }> = [];

  return {
    mount(id: symbol) {
      if (!layers.some((layer) => layer.id === id)) layers.push({ id, active: false });
    },
    setActive(id: symbol, active: boolean) {
      const layer = layers.find((item) => item.id === id);
      if (layer) layer.active = active;
    },
    unmount(id: symbol) {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index >= 0) layers.splice(index, 1);
    },
    at(index: number) {
      return layers.filter((layer) => layer.active).at(index)?.id;
    },
    isTopActive(id: symbol) {
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (layers[index]?.active) return layers[index]?.id === id;
      }
      return false;
    },
  };
}

const activeLayerStack = createDismissibleLayerStack();
const WORKSPACE_DIALOG_FOCUS_SELECTOR = [
  "[autofocus]",
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function focusWorkspaceDialogSurface(surface: HTMLElement, activeElement: Element | null) {
  if (activeElement && surface.contains(activeElement)) return false;
  const focusTarget = surface.querySelector<HTMLElement>(WORKSPACE_DIALOG_FOCUS_SELECTOR) || surface;
  focusTarget.focus({ preventScroll: true });
  return true;
}

export function restoreWorkspaceDialogFocus(target: HTMLElement | null) {
  if (!target?.isConnected || target.closest("[hidden], [aria-hidden='true']")) return false;
  target.focus({ preventScroll: true });
  return true;
}

function lockBodyScroll() {
  if (typeof document === "undefined") return () => undefined;
  if (activeDismissibleLayerCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeDismissibleLayerCount += 1;
  return () => {
    activeDismissibleLayerCount = Math.max(0, activeDismissibleLayerCount - 1);
    if (activeDismissibleLayerCount === 0) {
      document.body.style.overflow = previousBodyOverflow;
      previousBodyOverflow = "";
    }
  };
}

export function DismissibleLayer({
  ariaLabel,
  overlayClassName,
  surfaceClassName,
  onClose,
  children,
  dismissible = true,
  dismissConfirmMessage = "",
}: {
  ariaLabel: string;
  overlayClassName: string;
  surfaceClassName: string;
  onClose: () => void;
  children: (controls: { requestClose: () => void; closeImmediately: () => void; isClosing: boolean }) => ReactNode;
  dismissible?: boolean;
  dismissConfirmMessage?: string;
}) {
  const [closing, setClosing] = useState(false);
  const [defaultPortalTarget, setDefaultPortalTarget] = useState<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layerIdRef = useRef(Symbol("dismissible-layer"));
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const shouldCaptureRestoreFocusRef = useRef(true);
  const activeRef = useRef(false);
  const workspaceTab = useWorkspaceTabContext();
  const inWorkspace = Boolean(workspaceTab);
  const workspaceTabId = workspaceTab?.tabId;
  const isActive = workspaceTab?.isActive ?? true;
  const portalTarget = workspaceTab ? workspaceTab.portalTarget : defaultPortalTarget;
  const workspaceDrawer = Boolean(workspaceTab && overlayClassName === styles.drawerOverlay);
  const workspaceModal = Boolean(workspaceTab && !workspaceDrawer);
  const effectiveDismissConfirmMessage = dismissConfirmMessage || (
    workspaceDrawer && workspaceTab?.dirty
      ? "当前标签有未保存的修改，确定关闭吗？"
      : ""
  );

  if (
    shouldCaptureRestoreFocusRef.current
    && inWorkspace
    && isActive
    && typeof document !== "undefined"
  ) {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    shouldCaptureRestoreFocusRef.current = false;
  }

  useEffect(() => {
    if (!workspaceTab) setDefaultPortalTarget(document.body);
  }, [workspaceTab]);

  useEffect(() => {
    const layerId = layerIdRef.current;
    activeLayerStack.mount(layerId);
    return () => activeLayerStack.unmount(layerId);
  }, []);

  useEffect(() => {
    activeRef.current = isActive;
    activeLayerStack.setActive(layerIdRef.current, isActive);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const unlockScroll = lockBodyScroll();
    return unlockScroll;
  }, [isActive]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!inWorkspace || !isActive || !portalTarget) return;
    const surface = surfaceRef.current;
    if (!surface || !activeLayerStack.isTopActive(layerIdRef.current)) return;
    focusWorkspaceDialogSurface(surface, document.activeElement);
  }, [inWorkspace, isActive, portalTarget, workspaceTabId]);

  useEffect(() => () => {
    if (!inWorkspace || !activeRef.current) return;
    restoreWorkspaceDialogFocus(restoreFocusRef.current);
  }, [inWorkspace, workspaceTabId]);

  const closeImmediately = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (!dismissible) return;
    if (closing) return;
    if (workspaceTab?.busy) {
      if (typeof window !== "undefined") window.alert("当前操作正在进行，请完成后再关闭。");
      return;
    }
    if (effectiveDismissConfirmMessage && typeof window !== "undefined" && !window.confirm(effectiveDismissConfirmMessage)) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setClosing(false);
      onClose();
    }, 180);
  }, [closing, dismissible, effectiveDismissConfirmMessage, onClose, workspaceTab?.busy]);

  useEffect(() => {
    if (!isActive) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && activeLayerStack.at(-1) === layerIdRef.current) {
        event.preventDefault();
        requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActive, requestClose]);

  const layer = (
    <div
      className={`${overlayClassName} ${workspaceTab ? styles.workspaceTabDialogLayer : ""} ${closing ? styles.dialogLayerClosing : ""}`}
      role="dialog"
      aria-modal={isActive && !workspaceTab ? "true" : undefined}
      aria-hidden={!isActive}
      aria-label={ariaLabel}
      onClick={requestClose}
    >
      <div
        ref={surfaceRef}
        className={`${surfaceClassName} ${workspaceDrawer ? styles.workspaceTabDialogDrawerSurface : ""} ${workspaceModal ? styles.workspaceTabDialogModalSurface : ""} ${closing ? styles.dialogSurfaceClosing : ""}`}
        tabIndex={workspaceTab ? -1 : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {children({ requestClose, closeImmediately, isClosing: closing })}
      </div>
    </div>
  );

  return portalTarget ? createPortal(layer, portalTarget) : null;
}
