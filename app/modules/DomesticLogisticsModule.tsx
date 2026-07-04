"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canReadPermission, canWritePermission } from "../utils";
import { DomesticLogisticsModuleView } from "./domestic-logistics/module-view";
import { useDomesticLogisticsActions } from "./domestic-logistics/use-domestic-logistics-actions";
import {
  PAGE_SIZE,
  domesticLogisticsCanArchive,
  sanitizeDomesticLogisticsRowsForRender,
  type DomesticLogisticsResponse,
  type DomesticLogisticsRow,
  type ShipsgoFeatureFlags,
} from "./domestic-logistics/model";

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
  const [rows, setRows] = useState<DomesticLogisticsRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [businessScope, setBusinessScope] = useState("current");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shipsgoFeatures, setShipsgoFeatures] = useState<ShipsgoFeatureFlags>({ enabled: false });
  const [activeLogisticsView, setActiveLogisticsView] = useState<"list" | "controlTower">(initialView);
  const [editingOrderId, setEditingOrderId] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [shipsgoBusyKey, setShipsgoBusyKey] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canDeleteDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员"]);
  const canArchiveDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员"]);
  const canEditDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员", "物流供应商", "物流资料录入员"]);
  const canUploadCustomsDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "业务员", "物流供应商", "物流资料录入员"])
    && canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员", "物流供应商", "物流资料录入员"]);
  const canDeleteCustomsDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员"]);
  const canCreateLogisticsExpense = canWritePermission(currentUser, permissions, "logistics", ["管理员", "物流供应商"]);
  const canViewShipsgoControlTower = canReadPermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员", "物流供应商", "物流资料录入员"]);
  const canManageShipsgoTracking = ["管理员", "业务员"].includes(currentUser.role)
    && canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员"]);
  const canDeleteShipsgoTracking = currentUser.role === "管理员"
    && canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员"]);

  async function loadRows(nextKeyword = submittedKeyword, nextBusinessScope = businessScope) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ businessScope: nextBusinessScope });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<DomesticLogisticsResponse>(`/api/domestic-logistics?${params}`);
      const nextRows = sanitizeDomesticLogisticsRowsForRender(Array.isArray(result.rows) ? result.rows : []);
      setRows(nextRows);
      setShipsgoFeatures(result.shipsgo || { enabled: false });
      setSelectedOrderIds((current) => current.filter((orderId) => nextRows.some((row) => row.id === orderId)));
      if (result.error) setError(result.error || "读取资料失败");
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取物流信息失败");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const value = initialKeyword.trim();
    if (value) return;
    void loadRows("");
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
    void loadRows(value, businessScope).then((nextRows) => {
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
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setPage(1);
      setExpandedId("");
      setEditingOrderId("");
      setNotice("");
      void loadRows(value, businessScope);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, businessScope]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedOrderIds.includes(row.id)), [rows, selectedOrderIds]);
  const selectedArchivableRows = useMemo(() => selectedRows.filter(domesticLogisticsCanArchive), [selectedRows]);
  const pageArchivableRows = useMemo(() => pageRows.filter(domesticLogisticsCanArchive), [pageRows]);
  const allPageArchivableSelected = pageArchivableRows.length > 0
    && pageArchivableRows.every((row) => selectedOrderIds.includes(row.id));
  const tableColSpan = canArchiveDomesticLogistics ? 9 : 8;

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setSelectedOrderIds([]);
    setNotice("");
    void loadRows(value, businessScope);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setBusinessScope("current");
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setSelectedOrderIds([]);
    setNotice("");
    void loadRows("", "current");
  }

  function changeBusinessScope(nextBusinessScope: string) {
    setBusinessScope(nextBusinessScope);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setSelectedOrderIds([]);
    setNotice("");
    void loadRows(submittedKeyword, nextBusinessScope);
  }

  function openLogisticsExpenseStatus(row: DomesticLogisticsRow) {
    const status = row.logisticsExpenseStatus || "未录入";
    setExpandedId(row.id);
    setEditingOrderId("");
    const keywordValue = row.blNo || row.billOfLadingNo || row.orderNo || "";
    setNotice(status === "未录入" || !row.logisticsExpenseBillId ? "已切换到物流费用页面，可在新页面新增物流费用。" : "已切换到物流费用页面并定位对应账单。");
    onOpenLogisticsFees?.({
      billId: row.logisticsExpenseBillId || "",
      keyword: keywordValue,
    });
  }

  function toggleOrderSelection(row: DomesticLogisticsRow, checked: boolean) {
    if (!domesticLogisticsCanArchive(row)) return;
    setSelectedOrderIds((current) => {
      if (checked) return Array.from(new Set([...current, row.id]));
      return current.filter((orderId) => orderId !== row.id);
    });
  }

  function togglePageArchivableOrders(checked: boolean) {
    const pageArchivableIds = pageArchivableRows.map((row) => row.id);
    setSelectedOrderIds((current) => {
      if (checked) return Array.from(new Set([...current, ...pageArchivableIds]));
      return current.filter((orderId) => !pageArchivableIds.includes(orderId));
    });
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
      rowsLength={rows.length}
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
      confirmation={confirmation}
      setNotice={setNotice}
      setKeyword={setKeyword}
      setPage={setPage}
      setExpandedId={setExpandedId}
      setEditingOrderId={setEditingOrderId}
      setActiveLogisticsView={setActiveLogisticsView}
      loadRows={loadRows}
      submitSearch={submitSearch}
      resetSearch={resetSearch}
      changeBusinessScope={changeBusinessScope}
      archiveSelectedOrders={archiveSelectedOrders}
      togglePageArchivableOrders={togglePageArchivableOrders}
      toggleOrderSelection={toggleOrderSelection}
      openLogisticsExpenseStatus={openLogisticsExpenseStatus}
      createShipsgoTracking={createShipsgoTracking}
      syncShipsgoTracking={syncShipsgoTracking}
      recoverShipsgoTracking={recoverShipsgoTracking}
      deleteShipsgoTracking={deleteShipsgoTracking}
      openControlTowerOrder={openControlTowerOrder}
      deleteDomesticLogistics={deleteDomesticLogistics}
      uploadDocument={uploadDocument}
      deleteDocument={deleteDocument}
      onOpenLogisticsFees={onOpenLogisticsFees}
      cancelConfirmation={cancelConfirmation}
      confirmConfirmation={confirmConfirmation}
      updateConfirmationInput={updateConfirmationInput}
    />
  );

}
