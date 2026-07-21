"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { PAGE_SIZE, type OrderRow } from "./model";
import { orderMatchesFilters } from "./filter-matching";

type OrderEditActionOptions = {
  canWriteOrders: boolean;
  page: number;
  orders: OrderRow[];
  editOrder: OrderRow | null;
  returnDetailOrder: OrderRow | null;
  submittedKeyword: string;
  submittedOrderStatus: string;
  submittedBusinessEntityId: string;
  createOpen: boolean;
  editPanelRef: RefObject<HTMLDivElement | null>;
  setOrders: Dispatch<SetStateAction<OrderRow[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  setDetailOrder: Dispatch<SetStateAction<OrderRow | null>>;
  setEditOrder: Dispatch<SetStateAction<OrderRow | null>>;
  setReturnDetailOrder: Dispatch<SetStateAction<OrderRow | null>>;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useOrderEditActions({
  canWriteOrders,
  page,
  orders,
  editOrder,
  returnDetailOrder,
  submittedKeyword,
  submittedOrderStatus,
  submittedBusinessEntityId,
  createOpen,
  editPanelRef,
  setOrders,
  setTotal,
  setDetailOrder,
  setEditOrder,
  setReturnDetailOrder,
  setCreateOpen,
  setError,
  setNotice,
}: OrderEditActionOptions) {
  function scrollToEditPanel() {
    window.requestAnimationFrame(() => {
      editPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function orderMatchesSubmittedFilters(order: OrderRow) {
    return orderMatchesFilters(order, {
      keyword: submittedKeyword,
      orderStatus: submittedOrderStatus,
      businessEntityId: submittedBusinessEntityId,
    });
  }

  function mergeOrderRow(order: OrderRow, options: { shouldShow?: boolean } = {}) {
    const shouldShow = options.shouldShow ?? orderMatchesSubmittedFilters(order);
    setOrders((current) => {
      const exists = current.some((item) => item.id === order.id);
      if (exists) {
        return shouldShow
          ? current.map((item) => item.id === order.id ? { ...item, ...order } : item)
          : current.filter((item) => item.id !== order.id);
      }
      return page === 1 && shouldShow ? [order, ...current].slice(0, PAGE_SIZE) : current;
    });
    setDetailOrder((current) => current?.id === order.id ? { ...current, ...order } : current);
    setEditOrder((current) => current?.id === order.id ? { ...current, ...order } : current);
    setReturnDetailOrder((current) => current?.id === order.id ? { ...current, ...order } : current);
  }

  function openEditOrder(order: OrderRow | null, options: { returnToDetail?: boolean } = {}) {
    if (!canWriteOrders) {
      setError("权限不足，不能编辑");
      return;
    }
    if (!order?.id) {
      setError("数据加载失败，不能编辑");
      return;
    }
    setError("");
    setNotice("");
    setCreateOpen(false);
    setEditOrder(order);
    setReturnDetailOrder(options.returnToDetail ? order : null);
    setDetailOrder(null);
    scrollToEditPanel();
  }

  async function handleOrderSaved(order?: OrderRow | null) {
    const savedOrder = editOrder;
    const detailToRestore = returnDetailOrder;
    setNotice(savedOrder ? "订单已更新" : "订单已保存");
    setCreateOpen(false);
    setEditOrder(null);
    setReturnDetailOrder(null);
    if (order?.id) {
      const existedInRows = orders.some((item) => item.id === order.id);
      const shouldShow = orderMatchesSubmittedFilters(order);
      mergeOrderRow(order, { shouldShow });
      if (!savedOrder && shouldShow) setTotal((current) => current + 1);
      if (savedOrder && existedInRows && !shouldShow) setTotal((current) => Math.max(0, current - 1));
    }
    if (savedOrder && detailToRestore) {
      setDetailOrder(order?.id ? { ...detailToRestore, ...order } : detailToRestore);
    } else {
      setDetailOrder(null);
    }
  }

  function handleOrderConflictRefreshed(order: OrderRow) {
    const existedInRows = orders.some((item) => item.id === order.id);
    const shouldShow = orderMatchesSubmittedFilters(order);
    mergeOrderRow(order, { shouldShow });
    if (existedInRows && !shouldShow) setTotal((current) => Math.max(0, current - 1));
    if (!existedInRows && page === 1 && shouldShow) setTotal((current) => current + 1);
    setNotice("订单已刷新为服务器最新数据，请在编辑区重新核对后再保存。");
  }

  function handleOrderEditCancel() {
    const detailToRestore = returnDetailOrder;
    setCreateOpen(false);
    setEditOrder(null);
    setReturnDetailOrder(null);
    if (detailToRestore) setDetailOrder(detailToRestore);
  }

  function applyOrderPatch(orderId: string, patch: Partial<OrderRow>) {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...patch } : order));
    setDetailOrder((current) => current && current.id === orderId ? { ...current, ...patch } : current);
    setEditOrder((current) => current && current.id === orderId ? { ...current, ...patch } : current);
  }

  function toggleCreateOrder() {
    if (!canWriteOrders) return;
    setEditOrder(null);
    setReturnDetailOrder(null);
    setDetailOrder(null);
    setCreateOpen((current) => !current);
    window.requestAnimationFrame(() => {
      if (!createOpen) scrollToEditPanel();
    });
  }

  return {
    openEditOrder,
    handleOrderConflictRefreshed,
    handleOrderSaved,
    handleOrderEditCancel,
    applyOrderPatch,
    toggleCreateOrder,
  };
}
