"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { useConfirmationDialog } from "../../components";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import { salesExecutionShippingReadiness } from "./shipping-readiness";
import {
  executionNumber,
  type SalesExecutionRow,
  type SalesExecutionShippingResponse,
} from "./types";

export function useSalesExecutionShipping({
  canWrite,
  onSaved,
}: {
  canWrite: boolean;
  onSaved: (execution: SalesExecutionRow, message: string) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const shippingBusyRef = useRef(false);
  const dialog = useConfirmationDialog();
  useWorkspaceTabBusy(starting);

  async function enterShipping(execution: SalesExecutionRow) {
    if (shippingBusyRef.current) return;
    if (!canWrite) {
      setError("当前账号需要同时具备销售执行和应收订单写入权限");
      return;
    }
    const readiness = salesExecutionShippingReadiness(execution);
    if (!readiness.ready) {
      setError(readiness.reason);
      return;
    }
    setError("");
    shippingBusyRef.current = true;
    const result = await dialog.requestConfirmation({
      title: "进入发货",
      message: `确认销售执行单 ${executionNumber(execution) || "未编号"} 已具备发货条件吗？`,
      confirmLabel: "进入发货",
      cancelLabel: "返回检查",
      variant: "warning",
      details: [
        "系统将生成一张关联的应收订单草稿，订单号沿用客户订单号。",
        "本操作不会自动填写实际发货日期或实际发货金额。",
        "生成后不能重复创建，也不能删除关联订单；终止业务时请将订单改为已取消。",
      ],
    });
    if (!result.confirmed) {
      shippingBusyRef.current = false;
      return;
    }
    setStarting(true);
    try {
      const response = await apiJson<SalesExecutionShippingResponse>(
        `/api/sales-executions/${encodeURIComponent(execution.id)}/enter-shipping`,
        {
          method: "POST",
          body: JSON.stringify({ expectedRevision: Number(execution.revision || 1) }),
        },
      );
      const saved = response.execution || response.data;
      if (response.success !== true || !saved || !response.receivableOrder) {
        throw new Error(response.message || "进入发货失败");
      }
      onSaved(saved, response.message || `已生成应收订单草稿 ${response.receivableOrder.orderNo}`);
    } catch (shippingError) {
      setError(shippingError instanceof Error ? shippingError.message : "进入发货失败");
    } finally {
      shippingBusyRef.current = false;
      setStarting(false);
    }
  }

  return {
    confirmation: dialog.confirmation,
    starting,
    error,
    enterShipping,
    clearError: () => setError(""),
    cancelConfirmation: dialog.cancelConfirmation,
    confirmConfirmation: dialog.confirmConfirmation,
  };
}
