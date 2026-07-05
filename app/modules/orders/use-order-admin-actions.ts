"use client";

import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type { OrderRow } from "./model";

type RequestConfirmation = (options: ConfirmationDialogState) => Promise<ConfirmationResult>;

type OrderAdminActionOptions = {
  canWriteOrders: boolean;
  canManageOrderAssignments: boolean;
  requestConfirmation: RequestConfirmation;
  page: number;
  submittedKeyword: string;
  submittedOrderStatus: string;
  submittedBusinessEntityId: string;
  loadOrders: (page: number, keyword: string, orderStatus: string, businessEntityId: string) => Promise<OrderRow[]>;
  setDeletingId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setDetailOrder: Dispatch<SetStateAction<OrderRow | null>>;
  setEditOrder: Dispatch<SetStateAction<OrderRow | null>>;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setRepairingSalespeople: Dispatch<SetStateAction<boolean>>;
};

export function useOrderAdminActions({
  canWriteOrders,
  canManageOrderAssignments,
  requestConfirmation,
  page,
  submittedKeyword,
  submittedOrderStatus,
  submittedBusinessEntityId,
  loadOrders,
  setDeletingId,
  setError,
  setNotice,
  setDetailOrder,
  setEditOrder,
  setCreateOpen,
  setRepairingSalespeople,
}: OrderAdminActionOptions) {
  async function deleteOrder(order: OrderRow) {
    if (!canWriteOrders) {
      setError("当前账号没有权限删除应收订单");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "确认删除该订单？",
      message: "删除后不会物理清除数据，但会从当前业务列表隐藏。",
      details: [`订单：${order.orderNo || "-"}`],
      confirmLabel: "删除订单",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(order.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/orders/${encodeURIComponent(order.id)}`,
        { method: "DELETE" },
      );
      if (result.success === false) throw new Error(result.message || "删除应收订单失败");
      setDetailOrder(null);
      setEditOrder(null);
      setCreateOpen(false);
      await loadOrders(page, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
      setNotice(result.message || "订单已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除应收订单失败");
    } finally {
      setDeletingId("");
    }
  }

  async function repairMissingSalespeople() {
    if (!canManageOrderAssignments) return;
    const confirmationResult = await requestConfirmation({
      title: "确认修正历史订单业务员归属？",
      message: "系统只处理业务员为空的历史订单，不会覆盖已经明确分配过业务员的订单。",
      details: [
        "优先使用客户资料中的负责业务员。",
        "客户未配置时，才使用业务员创建人作为兜底。",
      ],
      confirmLabel: "开始修正",
      cancelLabel: "取消",
    });
    if (!confirmationResult.confirmed) return;
    setRepairingSalespeople(true);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        data?: { scanned?: number; repaired?: number; unresolved?: number };
      }>("/api/orders/salesperson-repair", { method: "POST" });
      if (result.success === false) throw new Error(result.message || "修正历史订单业务员失败");
      const stats = result.data || {};
      setNotice(result.message || `历史订单业务员修正完成：扫描 ${stats.scanned || 0} 条，修复 ${stats.repaired || 0} 条，无法修复 ${stats.unresolved || 0} 条。`);
      await loadOrders(page, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : "修正历史订单业务员失败");
    } finally {
      setRepairingSalespeople(false);
    }
  }

  return {
    deleteOrder,
    repairMissingSalespeople,
  };
}
