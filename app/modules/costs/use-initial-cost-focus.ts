"use client";

import { useEffect, useRef } from "react";

export function useInitialCostFocus({
  costId,
  openToken,
  openCost,
}: {
  costId: string;
  openToken: number;
  openCost: (costId: string) => Promise<unknown>;
}) {
  const handledFocusRef = useRef("");

  useEffect(() => {
    const targetId = costId.trim();
    if (!openToken || !targetId) return;
    const focusKey = `${openToken}:${targetId}`;
    if (handledFocusRef.current === focusKey) return;
    handledFocusRef.current = focusKey;
    void openCost(targetId);
  }, [costId, openCost, openToken]);
}
