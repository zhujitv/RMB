"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../WorkspaceShell.module.css";

let activeDismissibleLayerCount = 0;
let previousBodyOverflow = "";

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
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
    const unlockScroll = lockBodyScroll();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      unlockScroll();
    };
  }, []);

  function closeImmediately() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
  }

  function requestClose() {
    if (!dismissible) return;
    if (dismissConfirmMessage && typeof window !== "undefined" && !window.confirm(dismissConfirmMessage)) return;
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 180);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const layer = (
    <div
      className={`${overlayClassName} ${closing ? styles.dialogLayerClosing : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={requestClose}
    >
      <div
        className={`${surfaceClassName} ${closing ? styles.dialogSurfaceClosing : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children({ requestClose, closeImmediately, isClosing: closing })}
      </div>
    </div>
  );

  return portalTarget ? createPortal(layer, portalTarget) : null;
}
