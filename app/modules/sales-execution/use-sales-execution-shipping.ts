"use client";

import { useRef, useState } from "react";
import { apiJson } from "../../api";
import { useConfirmationDialog } from "../../components";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import { salesExecutionShippingReadiness } from "./shipping-readiness";
import {
  customerOrderNumber,
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
    const finalizing = Boolean(execution.receivableOrder);
    const result = await dialog.requestConfirmation({
      title: finalizing ? "确认装柜完成" : "进入发货并创建应收",
      message: finalizing
        ? `确认客户订单 ${customerOrderNumber(execution) || "未填写客户订单号"} 的柜号、实装数量和放行状态均已核对完成吗？`
        : `确认客户订单 ${customerOrderNumber(execution) || "未填写客户订单号"} 已完成生产并创建应收订单吗？柜号可在提柜后补充。`,
      confirmLabel: finalizing ? "确认并锁定" : "创建应收订单",
      cancelLabel: "返回检查",
      variant: "warning",
      details: finalizing ? [
        "系统将按所有已放行集装箱汇总各供应商实装数量并锁定。",
        "供应商货款将以最终实装数量为准，留仓数量不计入货款。",
        "确认后不能再修改柜总单或装柜结果。",
      ] : [
        "系统将先生成关联的应收订单草稿，订单号沿用客户订单号。",
        "此时不要求柜号，也不会锁定装柜信息；提柜后可继续补充。",
        "本操作不会自动填写实际发货日期或实际发货金额。",
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
