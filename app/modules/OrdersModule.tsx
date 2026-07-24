"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import type { CurrencyTotals } from "../../lib/platform/currency-totals";
import { OrdersModuleView } from "./orders/module-view";
import {
  PAGE_SIZE,
  type BusinessEntityOption,
  type OrderRow,
  type OrdersResponse,
} from "./orders/model";
import { useOrderAdminActions } from "./orders/use-order-admin-actions";
import { useOrderEditActions } from "./orders/use-order-edit-actions";
import { useWorkspaceTabBusy, useWorkspaceTabContext, useWorkspaceTabDiscardGuard, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";

type BusinessEntitiesResponse = {
  entities?: BusinessEntityOption[];
};

export function OrdersModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOpenToken = 0,
  onOpenExchangeSettings,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOpenToken?: number;
  onOpenExchangeSettings?: () => void;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<CurrencyTotals | null>(null);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [submittedOrderStatus, setSubmittedOrderStatus] = useState("");
  const [businessEntityId, setBusinessEntityId] = useState("");
  const [submittedBusinessEntityId, setSubmittedBusinessEntityId] = useState("");
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [returnDetailOrder, setReturnDetailOrder] = useState<OrderRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [repairingSalespeople, setRepairingSalespeople] = useState(false);
  const [orderEditDirty, setOrderEditDirty] = useState(false);
  const editPanelRef = useRef<HTMLDivElement | null>(null);
  const listRequestRef = useRef(0);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteOrders = canWritePermission(currentUser, permissions, "orders", ["管理员", "业务员"]);
  const canManageOrderAssignments = currentUser.role === "管理员";
  useWorkspaceTabBusy(Boolean(deletingId) || repairingSalespeople);
  const workspaceTab = useWorkspaceTabContext();
  const confirmDiscardOrderEdit = useWorkspaceTabDiscardGuard("当前订单内容尚未保存，确定放弃吗？");

  async function loadOrders(nextPage = page, nextKeyword = submittedKeyword, nextOrderStatus = submittedOrderStatus, nextBusinessEntityId = submittedBusinessEntityId) {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        workspace: "1",
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextOrderStatus) params.set("orderStatus", nextOrderStatus);
      if (nextBusinessEntityId) params.set("businessEntityId", nextBusinessEntityId);
      const result = await apiJson<OrdersResponse>(`/api/orders?${params}`);
      if (requestId !== listRequestRef.current) return [];
      const data = result.data || {};
      const nextRows = Array.isArray(data.rows) ? data.rows : Array.isArray(result.orders) ? result.orders : [];
      setOrders(nextRows);
      setSummary(data.summary || null);
      setTotal(Number(data.total ?? result.orders?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取应收订单失败");
      }
      return [];
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders(1, "");
    void loadBusinessEntities();
  }, []);

  async function loadBusinessEntities() {
    try {
      const result = await apiJson<BusinessEntitiesResponse>("/api/business-entities");
      setBusinessEntities(Array.isArray(result.entities) ? result.entities : []);
    } catch {
      setBusinessEntities([]);
    }
  }

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, value, submittedOrderStatus, submittedBusinessEntityId);
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setSubmittedOrderStatus(orderStatus);
      setSubmittedBusinessEntityId(businessEntityId);
      setDetailOrder(null);
      setNotice("");
      void loadOrders(1, value, orderStatus, businessEntityId);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, orderStatus, businessEntityId, submittedKeyword]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setSubmittedOrderStatus(orderStatus);
    setSubmittedBusinessEntityId(businessEntityId);
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, value, orderStatus, businessEntityId);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setOrderStatus("");
    setSubmittedOrderStatus("");
    setBusinessEntityId("");
    setSubmittedBusinessEntityId("");
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, "", "", "");
  }

  function gotoPage(nextPage: number) {
    setDetailOrder(null);
    setNotice("");
    void loadOrders(nextPage, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
  }

  const {
    openEditOrder,
    handleOrderConflictRefreshed,
    handleOrderSaved,
    handleOrderEditCancel,
    applyOrderPatch,
    toggleCreateOrder,
  } = useOrderEditActions({
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
  });

  function guardedOpenEditOrder(order: OrderRow | null, options: { returnToDetail?: boolean } = {}) {
    if (editOrder?.id && editOrder.id === order?.id) {
      openEditOrder(editOrder, options);
      return;
    }
    const replacingDraft = Boolean(
      (createOpen || editOrder)
      && (createOpen || editOrder?.id !== order?.id),
    );
    if (replacingDraft && !confirmDiscardOrderEdit()) return;
    openEditOrder(order, options);
  }

  function confirmBeforeBusinessEntityTransfer(orderId: string) {
    if (workspaceTab?.busy) {
      window.alert("当前订单操作正在进行，请完成后再转移业务主体。");
      return false;
    }
    if (!orderEditDirty || editOrder?.id !== orderId) return true;
    if (!window.confirm("当前订单编辑内容尚未保存。继续转移业务主体将放弃这些修改，确定继续吗？")) return false;
    setCreateOpen(false);
    setEditOrder(null);
    setReturnDetailOrder(null);
    setOrderEditDirty(false);
    return true;
  }

  const { deleteOrder, repairMissingSalespeople } = useOrderAdminActions({
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
  });

  const workspaceOrder = editOrder || detailOrder;
  useWorkspaceTabPresentation({
    title: editOrder
      ? `编辑订单 · ${editOrder.orderNo || "未编号"}`
      : createOpen
        ? "新建订单"
        : detailOrder
          ? `订单 · ${detailOrder.orderNo || "未编号"}`
          : "应收订单",
    view: editOrder || createOpen ? "edit" : detailOrder ? "detail" : "list",
    contextKey: editOrder
      ? `edit:${editOrder.id}`
      : createOpen
        ? "create:order"
        : workspaceOrder
          ? `detail:${workspaceOrder.id}`
          : "list:orders",
    ensureListTab: Boolean(editOrder || createOpen || detailOrder),
  });
  useWorkspaceTabReactivation(() => {
    void loadOrders(page, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
  });

  return (
    <OrdersModuleView
      currentUser={currentUser}
      orders={orders}
      summary={summary}
      keyword={keyword}
      orderStatus={orderStatus}
      businessEntityId={businessEntityId}
      businessEntities={businessEntities}
      page={page}
      total={total}
      totalPages={totalPages}
      detailOrder={detailOrder}
      loading={loading}
      error={error}
      notice={notice}
      createOpen={createOpen}
      editOrder={editOrder}
      deletingId={deletingId}
      repairingSalespeople={repairingSalespeople}
      canWriteOrders={canWriteOrders}
      canManageOrderAssignments={canManageOrderAssignments}
      confirmation={confirmation}
      editPanelRef={editPanelRef}
      onSetKeyword={setKeyword}
      onSetOrderStatus={setOrderStatus}
      onSetBusinessEntityId={setBusinessEntityId}
      onSubmitSearch={submitSearch}
      onResetSearch={resetSearch}
      onRefresh={() => {
        setNotice("");
        void loadOrders(page, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
      }}
      onToggleCreate={() => {
        if ((createOpen || editOrder) && !confirmDiscardOrderEdit()) return;
        toggleCreateOrder();
      }}
      onRepairSalespeople={() => void repairMissingSalespeople()}
      onOrderConflictRefreshed={handleOrderConflictRefreshed}
      onOrderEditDirtyChange={setOrderEditDirty}
      onOrderSaved={(order) => void handleOrderSaved(order)}
      onOrderEditCancel={() => {
        if (!confirmDiscardOrderEdit()) return;
        handleOrderEditCancel();
      }}
      onPage={gotoPage}
      onSetDetailOrder={setDetailOrder}
      onEditOrder={guardedOpenEditOrder}
      onDeleteOrder={(order) => {
        if ((createOpen || editOrder) && !confirmDiscardOrderEdit()) return;
        void deleteOrder(order);
      }}
      onBusinessEntityTransferred={applyOrderPatch}
      onBeforeBusinessEntityTransfer={confirmBeforeBusinessEntityTransfer}
      onOpenExchangeSettings={onOpenExchangeSettings}
      onCancelConfirmation={cancelConfirmation}
      onConfirmConfirmation={confirmConfirmation}
      onUpdateConfirmationInput={updateConfirmationInput}
    />
  );
}
