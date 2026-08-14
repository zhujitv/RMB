"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { useConfirmationDialog } from "../../components";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import { customerOrderNumber, type SalesExecutionResponse, type SalesExecutionRow } from "./types";

export function useSalesExecutionDispatch({
  canWrite,
  onSaved,
}: {
  canWrite: boolean;
  onSaved: (execution: SalesExecutionRow, message: string) => void;
}) {
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState("");
  const dispatchBusyRef = useRef(false);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
  } = useConfirmationDialog();
  useWorkspaceTabBusy(dispatching);

  async function dispatchExecution(execution: SalesExecutionRow) {
    if (dispatchBusyRef.current) return;
    if (!canWrite || execution.status !== "DRAFT") {
      setDispatchError("只有草稿销售执行单可以正式下发。");
      return;
    }
    const orders = (execution.purchaseOrders || []).filter((order) => order.status !== "VOIDED");
    if (!orders.length) {
      setDispatchError("请先完成工厂分配并保存采购草稿，再正式下发。");
      return;
    }
    setDispatchError("");
    dispatchBusyRef.current = true;
    const result = await requestConfirmation({
      title: "正式下发工厂",
      message: `确认将客户订单 ${customerOrderNumber(execution) || "未填写客户订单号"} 的 ${orders.length} 张采购单正式下发给工厂吗？`,
      variant: "warning",
      confirmLabel: "确认下发",
      cancelLabel: "返回检查",
      details: [
        "下发后销售内容和工厂分配将锁定，不能继续编辑。",
        "采购单价为空的项目会保持“待供应商回填”，不会按 0 元计算。",
        "供应商后续可以接受订单、申请改期或拒绝订单。",
      ],
    });
    if (!result.confirmed) {
      dispatchBusyRef.current = false;
      return;
    }
    setDispatching(true);
    try {
      const response = await apiJson<SalesExecutionResponse>(`/api/sales-executions/${encodeURIComponent(execution.id)}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: Number(execution.revision || 1) }),
      });
      const saved = response.execution || response.data;
      if (response.success !== true || !saved) throw new Error(response.message || "销售执行单下发失败");
      onSaved(saved, response.message || "销售执行单已正式下发工厂");
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : "销售执行单下发失败");
    } finally {
      dispatchBusyRef.current = false;
      setDispatching(false);
    }
  }

  return {
    confirmation,
    dispatching,
    dispatchError,
    dispatchExecution,
    clearDispatchError: () => setDispatchError(""),
    cancelConfirmation,
    confirmConfirmation,
  };
}
