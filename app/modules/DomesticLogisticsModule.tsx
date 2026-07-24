"use client";

import { useEffect, useState } from "react";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import {
  useWorkspaceTabBusy,
  useWorkspaceTabContext,
  useWorkspaceTabDiscardGuard,
  useWorkspaceTabPresentation,
  useWorkspaceTabReactivation,
} from "../workspace/workspace-tab-context";
import { createDomesticLogisticsNavigationActions } from "./domestic-logistics/domestic-logistics-navigation-actions";
import { domesticLogisticsPermissions } from "./domestic-logistics/domestic-logistics-permissions";
import {
  type DomesticLogisticsInfo,
  type DomesticLogisticsRow,
} from "./domestic-logistics/model";
import { DomesticLogisticsModuleView } from "./domestic-logistics/module-view";
import { useDomesticLogisticsActions } from "./domestic-logistics/use-domestic-logistics-actions";
import { useDomesticLogisticsListState } from "./domestic-logistics/use-domestic-logistics-list-state";

export function DomesticLogisticsModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOpenToken = 0,
  initialView = "list",
  initialControlTowerFullscreen = false,
  onOpenLogisticsFees,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOpenToken?: number;
  initialView?: "list" | "controlTower";
  initialControlTowerFullscreen?: boolean;
  onOpenLogisticsFees?: (focus: { keyword?: string; billId?: string }) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [businessScope, setBusinessScope] = useState("current");
  const [expandedId, setExpandedId] = useState("");
  const [notice, setNotice] = useState("");
  const [activeLogisticsView, setActiveLogisticsView] = useState<"list" | "controlTower">(initialView);
  const [editingOrderId, setEditingOrderId] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [shipsgoBusyKey, setShipsgoBusyKey] = useState("");
  const [controlTowerSyncingId, setControlTowerSyncingId] = useState("");
  const [archiving, setArchiving] = useState(false);
  const {
    rows, setRows, page, setPage, total, totalPages, loading, error, setError,
    shipsgoFeatures, selectedOrderIds, setSelectedOrderIds, selectedRows,
    selectedArchivableRows, pageArchivableRows, allPageArchivableSelected,
    loadRows, toggleOrderSelection, togglePageArchivableOrders,
  } = useDomesticLogisticsListState(submittedKeyword, businessScope);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const {
    canDeleteDomesticLogistics, canArchiveDomesticLogistics, canEditDomesticLogistics,
    canUploadCustomsDocuments, canDeleteCustomsDocuments, canCreateLogisticsExpense,
    canViewShipsgoControlTower, canManageShipsgoTracking, canDeleteShipsgoTracking,
  } = domesticLogisticsPermissions(currentUser, permissions);
  useWorkspaceTabBusy(Boolean(uploadingKey || deletingDocumentId || shipsgoBusyKey || controlTowerSyncingId || archiving));
  const workspaceTab = useWorkspaceTabContext();
  const confirmDiscardLogisticsEdit = useWorkspaceTabDiscardGuard("当前物流信息尚未保存，确定放弃吗？");

  useEffect(() => {
    const value = initialKeyword.trim();
    if (value) return;
    void loadRows("", businessScope, 1);
  }, []);

  useEffect(() => {
    setActiveLogisticsView(initialView);
  }, [initialView]);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setNotice("");
    void loadRows(value, businessScope, 1).then((nextRows) => {
      const matched = nextRows.find((row) => (
        row.orderNo === value
        || row.blNo === value
        || row.billOfLadingNo === value
        || row.id === value
        || row.orderId === value
      )) || nextRows[0];
      if (!matched) return;
      setExpandedId(matched.id);
      if (canEditDomesticLogistics) setEditingOrderId(matched.id);
    });
  }, [initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    if (editingOrderId && workspaceTab?.dirty) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setPage(1);
      setExpandedId("");
      setEditingOrderId("");
      setNotice("");
      void loadRows(value, businessScope, 1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, businessScope, editingOrderId, workspaceTab?.dirty]);

  const pageRows = rows;
  const tableColSpan = canArchiveDomesticLogistics ? 9 : 8;

  const {
    submitSearch, resetSearch, changeBusinessScope, gotoPage, openLogisticsExpenseStatus,
  } = createDomesticLogisticsNavigationActions({
    keyword, submittedKeyword, businessScope, editingOrderId,
    confirmDiscardEdit: confirmDiscardLogisticsEdit,
    setKeyword, setSubmittedKeyword, setBusinessScope, setPage, setExpandedId,
    setEditingOrderId, setSelectedOrderIds, setNotice, loadRows, onOpenLogisticsFees,
  });

  function mergeDomesticLogisticsInfo(row: DomesticLogisticsRow, info?: DomesticLogisticsInfo | null) {
    if (!info) return;
    setRows((current) => current.map((item) => (
      item.id === row.id || item.orderId === row.id
        ? {
          ...item,
          domesticLogisticsInfo: { ...(item.domesticLogisticsInfo || {}), ...info },
          logisticsStatus: "已提交",
          submittedAt: info.submittedAt || item.submittedAt,
        }
        : item
    )));
  }

  const {
    archiveSelectedOrders,
    uploadDocument,
    deleteDocument,
    deleteDomesticLogistics,
    createShipsgoTracking,
    syncShipsgoTracking,
    recoverShipsgoTracking,
    deleteShipsgoTracking,
    openControlTowerOrder,
  } = useDomesticLogisticsActions({
    selectedArchivableRows,
    selectedRows,
    selectedOrderIds,
    submittedKeyword,
    businessScope,
    setRows,
    setSelectedOrderIds,
    setError,
    setNotice,
    setUploadingKey,
    setUploadProgressByKey,
    setDeletingDocumentId,
    setExpandedId,
    setEditingOrderId,
    setShipsgoBusyKey,
    setActiveLogisticsView,
    setBusinessScope,
    setKeyword,
    setSubmittedKeyword,
    setPage,
    loadRows,
    requestConfirmation,
  });

  const workspaceLogisticsRow = rows.find((row) => row.id === (editingOrderId || expandedId));
  useWorkspaceTabPresentation({
    title: activeLogisticsView === "controlTower"
      ? "运输监控"
      : workspaceLogisticsRow
        ? `${editingOrderId ? "编辑物流" : "物流详情"} · ${workspaceLogisticsRow.orderNo || workspaceLogisticsRow.blNo || "未编号"}`
        : "物流信息",
    view: activeLogisticsView === "controlTower"
      ? "list"
      : editingOrderId
        ? "edit"
        : expandedId
          ? "detail"
          : "list",
    contextKey: activeLogisticsView === "controlTower"
      ? "list:ocean-control-tower"
      : editingOrderId
        ? `edit:${editingOrderId}`
        : expandedId
          ? `detail:${expandedId}`
          : "list:domestic-logistics",
    ensureListTab: activeLogisticsView !== "controlTower" && Boolean(editingOrderId || expandedId),
  });
  useWorkspaceTabReactivation(() => {
    void loadRows(submittedKeyword, businessScope, page);
  });

  async function archiveSelectedOrdersSafely() {
    if (editingOrderId && !confirmDiscardLogisticsEdit()) return;
    setArchiving(true);
    try {
      const archived = await archiveSelectedOrders();
      if (archived) setEditingOrderId("");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <DomesticLogisticsModuleView
      loading={loading}
      error={error}
      notice={notice}
      keyword={keyword}
      submittedKeyword={submittedKeyword}
      businessScope={businessScope}
      page={page}
      totalPages={totalPages}
      expandedId={expandedId}
      editingOrderId={editingOrderId}
      activeLogisticsView={activeLogisticsView}
      shipsgoFeatures={shipsgoFeatures}
      pageRows={pageRows}
      rowsLength={total}
      selectedOrderIds={selectedOrderIds}
      selectedArchivableRows={selectedArchivableRows}
      pageArchivableRows={pageArchivableRows}
      allPageArchivableSelected={allPageArchivableSelected}
      tableColSpan={tableColSpan}
      currentUserRole={currentUser.role}
      canArchiveDomesticLogistics={canArchiveDomesticLogistics}
      canEditDomesticLogistics={canEditDomesticLogistics}
      canDeleteDomesticLogistics={canDeleteDomesticLogistics}
      canUploadCustomsDocuments={canUploadCustomsDocuments}
      canDeleteCustomsDocuments={canDeleteCustomsDocuments}
      canCreateLogisticsExpense={canCreateLogisticsExpense}
      canViewShipsgoControlTower={canViewShipsgoControlTower}
      canManageShipsgoTracking={canManageShipsgoTracking}
      canDeleteShipsgoTracking={canDeleteShipsgoTracking}
      initialKeyword={initialKeyword}
      initialOpenToken={initialOpenToken}
      initialControlTowerFullscreen={initialControlTowerFullscreen}
      uploadingKey={uploadingKey}
      uploadProgressByKey={uploadProgressByKey}
      deletingDocumentId={deletingDocumentId}
      shipsgoBusyKey={shipsgoBusyKey}
      controlTowerSyncingId={controlTowerSyncingId}
      archiving={archiving}
      confirmation={confirmation}
      setNotice={setNotice}
      setKeyword={setKeyword}
      onPageChange={gotoPage}
      setExpandedId={setExpandedId}
      setEditingOrderId={setEditingOrderId}
      setActiveLogisticsView={setActiveLogisticsView}
      setControlTowerSyncingId={setControlTowerSyncingId}
      confirmDiscardEdit={confirmDiscardLogisticsEdit}
      loadRows={loadRows}
      submitSearch={submitSearch}
      resetSearch={resetSearch}
      changeBusinessScope={changeBusinessScope}
      archiveSelectedOrders={archiveSelectedOrdersSafely}
      togglePageArchivableOrders={togglePageArchivableOrders}
      toggleOrderSelection={toggleOrderSelection}
      openLogisticsExpenseStatus={openLogisticsExpenseStatus}
      createShipsgoTracking={createShipsgoTracking}
      syncShipsgoTracking={syncShipsgoTracking}
      recoverShipsgoTracking={recoverShipsgoTracking}
      deleteShipsgoTracking={deleteShipsgoTracking}
      openControlTowerOrder={openControlTowerOrder}
      deleteDomesticLogistics={deleteDomesticLogistics}
      onSaveDomesticLogisticsInfo={mergeDomesticLogisticsInfo}
      uploadDocument={uploadDocument}
      deleteDocument={deleteDocument}
      onOpenLogisticsFees={onOpenLogisticsFees}
      cancelConfirmation={cancelConfirmation}
      confirmConfirmation={confirmConfirmation}
      updateConfirmationInput={updateConfirmationInput}
    />
  );

}
