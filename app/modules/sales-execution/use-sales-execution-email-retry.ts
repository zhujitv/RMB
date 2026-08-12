"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import type { SalesExecutionResponse, SalesExecutionRow } from "./types";

export function useSalesExecutionEmailRetry({
  canWrite,
  execution,
  onSaved,
}: {
  canWrite: boolean;
  execution: SalesExecutionRow | null;
  onSaved: (execution: SalesExecutionRow, message: string) => void;
}) {
  const [retryingPurchaseOrderId, setRetryingPurchaseOrderId] = useState("");
  const [error, setError] = useState("");
  const retryBusyRef = useRef(false);

  async function retry(purchaseOrderId: string) {
    const executionId = execution?.id || "";
    if (!canWrite || !executionId || retryBusyRef.current) return;
    const purchaseOrder = execution?.purchaseOrders?.find((order) => order.id === purchaseOrderId);
    if (!purchaseOrder?.dispatchVersionNumber) {
      setError("采购单下发版本缺失，请刷新后重试");
      return;
    }
    retryBusyRef.current = true;
    setRetryingPurchaseOrderId(purchaseOrderId);
    setError("");
    try {
      const result = await apiJson<SalesExecutionResponse>(
        `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(purchaseOrderId)}/dispatch-email/retry`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: Number(execution?.revision || 1),
            dispatchVersionNumber: Number(purchaseOrder.dispatchVersionNumber),
          }),
        },
      );
      const saved = result.execution || result.data;
      if (!saved) throw new Error(result.message || "重试邮件失败");
      onSaved(saved, result.message || "已重新提交工厂采购单邮件");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试邮件失败");
    } finally {
      retryBusyRef.current = false;
      setRetryingPurchaseOrderId("");
    }
  }

  return {
    error,
    retry,
    retrying: Boolean(retryingPurchaseOrderId),
    retryingPurchaseOrderId,
    clearError: () => setError(""),
  };
}
