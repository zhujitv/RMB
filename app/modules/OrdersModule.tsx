"use client";

import { useRef, useState } from "react";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import { useWorkspaceTabBusy, useWorkspaceTabContext, useWorkspaceTabDiscardGuard, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";
import { type OrderRow } from "./orders/model";
import { OrdersModuleView } from "./orders/module-view";
import { useOrderAdminActions } from "./orders/use-order-admin-actions";
import { useOrderEditActions } from "./orders/use-order-edit-actions";
import { useOrdersList } from "./orders/use-orders-list";

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
  const {
    orders, setOrders,
    summary,
    keyword, setKeyword,
    submittedKeyword,
    orderStatus, setOrderStatus,
    submittedOrderStatus,
    businessEntityId, setBusinessEntityId,
    submittedBusinessEntityId,
    businessEntities,
    page,
    total, setTotal,
    totalPages,
    detailOrder, setDetailOrder,
    loading,
    error, setError,
    notice, setNotice,
    loadOrders,
    submitSearch,
    resetSearch,
    gotoPage,
  } = useOrdersList({ initialKeyword, initialOpenToken });
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [returnDetailOrder, setReturnDetailOrder] = useState<OrderRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [repairingSalespeople, setRepairingSalespeople] = useState(false);
  const [orderEditDirty, setOrderEditDirty] = useState(false);
  const editPanelRef = useRef<HTMLDivElement | null>(null);
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
