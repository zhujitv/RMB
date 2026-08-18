"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { useConfirmationDialog } from "../../components/dialogs";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  customerOrderNumber,
  type SalesExecutionDeleteResponse,
  type SalesExecutionRow,
} from "./types";

export function useSalesExecutionDeletion({
  canDelete,
  onDeleted,
}: {
  canDelete: boolean;
  onDeleted: (executionId: string, message: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const deletingRef = useRef(false);
  const dialog = useConfirmationDialog();
  useWorkspaceTabBusy(deleting);

  async function deleteExecution(execution: SalesExecutionRow) {
    const customerOrderNo = customerOrderNumber(execution);
    if (!canDelete || execution.status !== "VOIDED" || deletingRef.current) return;
    deletingRef.current = true;
    setError("");
    const result = await dialog.requestConfirmation({
      title: "永久删除销售执行",
      message: "该操作不可撤销，将物理删除销售执行、工厂采购、确认、生产、装柜和关联附件数据。",
      details: [
        `客户订单号：${customerOrderNo || "未填写"}`,
        `关联采购单：${execution.purchaseOrders?.length || 0} 张`,
        "操作日志会保留本次删除的摘要和管理员身份。",
      ],
      variant: "danger",
      confirmLabel: "永久删除",
      cancelLabel: "返回",
      requireInput: true,
      inputType: "text",
      inputLabel: `请输入客户订单号 ${customerOrderNo} 确认`,
      inputPlaceholder: customerOrderNo,
      inputExpectedValue: customerOrderNo,
      inputRequiredMessage: "请输入客户订单号后继续。",
      inputMismatchMessage: "输入的客户订单号不一致，无法删除。",
    });
    if (!result.confirmed) {
      deletingRef.current = false;
      return;
    }
    setDeleting(true);
    try {
      const response = await apiJson<SalesExecutionDeleteResponse>(
        `/api/sales-executions/${encodeURIComponent(execution.id)}/permanent`,
        {
          method: "DELETE",
          body: JSON.stringify({
            expectedRevision: Number(execution.revision || 1),
            confirmCustomerOrderNo: result.inputValue,
            reason: "管理员确认永久删除已作废销售执行",
          }),
        },
      );
      if (response.success !== true || response.data?.action !== "deleted") {
        throw new Error(response.message || "销售执行删除失败");
      }
      onDeleted(execution.id, response.message || "销售执行及关联采购数据已永久删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "销售执行删除失败");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return {
    confirmation: dialog.confirmation,
    deleting,
    error,
    deleteExecution,
    clearError: () => setError(""),
    cancelConfirmation: dialog.cancelConfirmation,
    confirmConfirmation: dialog.confirmConfirmation,
    updateConfirmationInput: dialog.updateConfirmationInput,
  };
}
