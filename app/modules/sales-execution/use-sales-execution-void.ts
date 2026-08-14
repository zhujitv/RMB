"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { useConfirmationDialog } from "../../components/dialogs";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import { customerOrderNumber, type SalesExecutionResponse, type SalesExecutionRow } from "./types";

export function useSalesExecutionVoid({
  canWrite,
  onSaved,
}: {
  canWrite: boolean;
  onSaved: (execution: SalesExecutionRow, message: string) => void;
}) {
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState("");
  const voidingBusyRef = useRef(false);
  const dialog = useConfirmationDialog();
  useWorkspaceTabBusy(voiding);

  async function voidExecution(execution: SalesExecutionRow) {
    if (voidingBusyRef.current) return;
    if (!canWrite || !["DRAFT", "DISPATCHED"].includes(String(execution.status || ""))) {
      setError("当前销售执行单不能作废。");
      return;
    }
    if (execution.receivableOrder || execution.shippingStartedAt) {
      setError("该销售执行单已进入发货，请在应收订单中保留记录并改为已取消。");
      return;
    }
    setError("");
    voidingBusyRef.current = true;
    const result = await dialog.requestConfirmation({
      title: "作废销售执行单",
      message: `确认作废客户订单 ${customerOrderNumber(execution) || "未填写客户订单号"} 吗？`,
      variant: "danger",
      confirmLabel: "确认作废",
      cancelLabel: "返回检查",
      requireInput: true,
      inputLabel: "作废原因",
      inputPlaceholder: "请说明取消或终止原因",
      inputRequiredMessage: "请填写作废原因后继续。",
      details: [
        "关联的未作废工厂采购单将一并作废，尚未发送的下发邮件将停止。",
        "已有采购付款或费用调整时，必须先完成冲销；已进入发货后不能作废。",
        "销售执行、采购单和操作审计记录都会保留。",
      ],
    });
    if (!result.confirmed) {
      voidingBusyRef.current = false;
      return;
    }
    setVoiding(true);
    try {
      const response = await apiJson<SalesExecutionResponse>(`/api/sales-executions/${encodeURIComponent(execution.id)}`, {
        method: "DELETE",
        body: JSON.stringify({
          reason: result.inputValue,
          expectedRevision: Number(execution.revision || 1),
        }),
      });
      const saved = response.execution || response.data;
      if (response.success !== true || !saved) throw new Error(response.message || "作废销售执行单失败");
      onSaved(saved, response.message || "销售执行单已作废");
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "作废销售执行单失败");
    } finally {
      voidingBusyRef.current = false;
      setVoiding(false);
    }
  }

  return {
    confirmation: dialog.confirmation,
    voiding,
    error,
    voidExecution,
    clearError: () => setError(""),
    cancelConfirmation: dialog.cancelConfirmation,
    confirmConfirmation: dialog.confirmConfirmation,
    updateConfirmationInput: dialog.updateConfirmationInput,
  };
}
