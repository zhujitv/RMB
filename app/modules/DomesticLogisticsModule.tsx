"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, PaginationBar, UiCheckbox, useConfirmationDialog } from "../components";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import { canReadPermission, canWritePermission, uploadFormDataWithProgress, validatePdfUploadFile } from "../utils";
import { ShipsgoControlTowerView } from "./domestic-logistics/control-tower";
import {
  ARCHIVE_BUTTON_DISABLED_TOOLTIP,
  ARCHIVE_BUTTON_RULE,
  ARCHIVE_SCOPE_OPTIONS,
  PAGE_SIZE,
  PAYLOAD_ARCHIVE_ENDPOINT,
  domesticLogisticsCanArchive,
  sanitizeDomesticLogisticsRowsForRender,
  type DomesticLogisticsDocument,
  type DomesticLogisticsInfo,
  type DomesticLogisticsResponse,
  type DomesticLogisticsRow,
  type ShipsgoControlTowerRow,
  type ShipsgoFeatureFlags,
  type ShipsgoTrackingRow,
  type UploadDocumentResponse,
} from "./domestic-logistics/model";
import { DomesticLogisticsRows } from "./domestic-logistics/rows";

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

  async function archiveSelectedOrders() {
    if (!selectedArchivableRows.length) {
      setError(ARCHIVE_BUTTON_DISABLED_TOOLTIP);
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "确认批量归档？",
      message: "归档只改变物流信息列表展示，不会修改审核、发票、付款、成本或利润数据。",
      details: [
        `可归档订单：${selectedArchivableRows.length} 个（审核通过且已上传发票）`,
        selectedRows.length > selectedArchivableRows.length
          ? `已自动跳过不符合条件订单：${selectedRows.length - selectedArchivableRows.length} 个`
          : "",
      ].filter(Boolean),
      confirmLabel: "批量归档",
      cancelLabel: "取消",
    });
    if (!confirmationResult.confirmed) return;
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        archivedCount?: number;
        archivedIds?: string[];
        skippedIds?: string[];
      }>(PAYLOAD_ARCHIVE_ENDPOINT, {
        method: "PATCH",
        body: JSON.stringify({ orderIds: selectedOrderIds }),
      });
      if (result.success !== true) throw new Error(result.message || "批量归档失败");
      setSelectedOrderIds([]);
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || `已归档 ${result.archivedCount || 0} 个订单`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "批量归档失败");
    }
  }

  async function uploadDocument(orderId: string, documentType: string, file: File | null, customsDeclarationId = "") {
    if (!file) return;
    const isCustomsDeclaration = documentType === "CUSTOMS_ENTRY_FORM";
    const uploadKey = (customsDeclarationId || isCustomsDeclaration)
      ? `${orderId}:${documentType}:${customsDeclarationId || "new"}`
      : `${orderId}:${documentType}`;
    setUploadingKey(uploadKey);
    setUploadProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
    setError("");
    setNotice(isCustomsDeclaration ? "正在读取报关单 PDF 文本..." : "");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      const formData = new FormData();
      formData.append("orderId", orderId);
      formData.append("documentType", documentType);
      formData.append("uploadSource", "REACT_DOMESTIC_LOGISTICS");
      if (customsDeclarationId) formData.append("customsDeclarationId", customsDeclarationId);
      formData.append("file", file);
      await uploadFormDataWithProgress<UploadDocumentResponse>("/api/order-documents", formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [uploadKey]: progress }));
      });
      setNotice("上传成功");
      await loadRows(submittedKeyword, businessScope);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[uploadKey];
        return next;
      });
    }
  }

  async function deleteDocument(document: DomesticLogisticsDocument) {
    const confirmationResult = await requestConfirmation({
      title: "确定删除该文件？",
      message: "删除后需要重新上传。",
      details: [`文件：${document.fileName || document.documentTypeLabel || "-"}`],
      confirmLabel: "删除文件",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingDocumentId(document.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/order-documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除失败，请重试");
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || "已删除文件");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败，请重试");
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function deleteDomesticLogistics(row: DomesticLogisticsRow) {
    const id = row.domesticLogisticsInfo?.id;
    if (!id) return;
    const confirmationResult = await requestConfirmation({
      title: "确认删除该物流信息？",
      message: "删除后该订单将恢复为未提交物流信息状态。",
      details: [`订单：${row.orderNo || "-"}`],
      confirmLabel: "删除物流信息",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/domestic-logistics/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除物流信息失败");
      setExpandedId("");
      setEditingOrderId("");
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || "物流信息已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除物流信息失败");
    }
  }

  function updateRowShipsgoTracking(orderId: string, tracking: ShipsgoTrackingRow) {
    setRows((currentRows) => currentRows.map((row) => {
      if (row.id !== orderId && row.orderId !== orderId) return row;
      const currentTrackings = row.shipsgoTrackings || [];
      const nextTrackings = [
        tracking,
        ...currentTrackings.filter((item) => item.id !== tracking.id),
      ];
      return { ...row, shipsgoTrackings: nextTrackings };
    }));
  }

  function removeRowShipsgoTracking(orderId: string, trackingId: string) {
    setRows((currentRows) => currentRows.map((row) => {
      if (row.id !== orderId && row.orderId !== orderId) return row;
      return {
        ...row,
        shipsgoTrackings: (row.shipsgoTrackings || []).filter((item) => item.id !== trackingId),
      };
    }));
  }

  async function createShipsgoTracking(row: DomesticLogisticsRow, payload: { carrierScac?: string } = {}) {
    const busyKey = `${row.id}:shipsgo:create`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>("/api/shipsgo/ocean-trackings", {
        method: "POST",
        body: JSON.stringify({
          orderId: row.id,
          carrierScac: payload.carrierScac || "",
        }),
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "创建大掌櫃跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "大掌櫃跟踪已创建");
    } catch (createError) {
      throw createError instanceof Error ? createError : new Error("创建大掌櫃跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function syncShipsgoTracking(row: DomesticLogisticsRow, trackingId: string) {
    const busyKey = `${trackingId}:shipsgo:sync`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>(`/api/shipsgo/ocean-trackings/${encodeURIComponent(trackingId)}/sync`, {
        method: "POST",
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "同步大掌櫃跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "大掌櫃状态已同步");
      return result.tracking;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "同步大掌櫃跟踪失败";
      setError(message);
      throw new Error(message);
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function recoverShipsgoTracking(row: DomesticLogisticsRow) {
    const busyKey = `${row.id}:shipsgo:recover`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>("/api/shipsgo/ocean-trackings/recover", {
        method: "POST",
        body: JSON.stringify({
          orderId: row.id,
          masterBlNo: row.blNo || row.billOfLadingNo || "",
        }),
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "从大掌櫃同步已有跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "已从大掌櫃同步已有跟踪");
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : "从大掌櫃同步已有跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function deleteShipsgoTracking(row: DomesticLogisticsRow, tracking: ShipsgoTrackingRow) {
    const confirmationResult = await requestConfirmation({
      title: "删除大掌櫃跟踪？",
      message: "删除后该订单将不再显示这条运输跟踪记录。本操作不会调用大掌櫃创建或同步接口。",
      details: [
        `订单：${row.orderNo || "-"}`,
        `Master B/L：${tracking.masterBlNo || tracking.bookingNumber || "-"}`,
      ],
      confirmLabel: "删除跟踪",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    const busyKey = `${tracking.id}:shipsgo:delete`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/shipsgo/ocean-trackings/${encodeURIComponent(tracking.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除大掌櫃跟踪失败");
      removeRowShipsgoTracking(row.id, tracking.id);
      setNotice(result.message || "大掌櫃跟踪已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除大掌櫃跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function openControlTowerOrder(row: ShipsgoControlTowerRow) {
    const value = row.orderNo || row.masterBlNo || row.bookingNumber || "";
    setActiveLogisticsView("list");
    setBusinessScope(row.orderIsArchived ? "archive" : "current");
    setKeyword(value);
    setSubmittedKeyword(value);
    setPage(1);
    setNotice("");
    const nextRows = await loadRows(value, row.orderIsArchived ? "archive" : "current");
    const matched = nextRows.find((item) => (
      item.orderId === row.orderId
      || item.id === row.orderId
      || item.orderNo === row.orderNo
      || item.blNo === row.masterBlNo
      || item.billOfLadingNo === row.masterBlNo
    )) || nextRows[0];
    if (matched) setExpandedId(matched.id);
  }

  return (
    <>
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>物流信息</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => {
            setNotice("");
            void loadRows();
          }}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.moduleViewTabs} role="tablist" aria-label="物流信息视图">
        <button
          className={activeLogisticsView === "list" ? styles.moduleViewTabActive : styles.moduleViewTab}
          type="button"
          role="tab"
          aria-selected={activeLogisticsView === "list"}
          onClick={() => setActiveLogisticsView("list")}
        >
          物流列表
        </button>
        {canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
          <button
            className={activeLogisticsView === "controlTower" ? styles.moduleViewTabActive : styles.moduleViewTab}
            type="button"
            role="tab"
            aria-selected={activeLogisticsView === "controlTower"}
            onClick={() => setActiveLogisticsView("controlTower")}
          >
            运输监控
          </button>
        ) : null}
      </div>

      {activeLogisticsView === "controlTower" && canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
        <ShipsgoControlTowerView
          features={shipsgoFeatures}
          canManage={canManageShipsgoTracking}
          initialKeyword={initialKeyword}
          initialOpenToken={initialOpenToken}
          initialFullScreen={initialControlTowerFullscreen}
          onOpenOrder={openControlTowerOrder}
        />
      ) : (
        <>
      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 柜号 / 物流供应商"
        />
        <select value={businessScope} onChange={(event) => changeBusinessScope(event.target.value)} disabled={loading}>
          {ARCHIVE_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
        {canArchiveDomesticLogistics ? (
          <button
            className={styles.primaryButtonCompact}
            type="button"
            disabled={loading || !selectedArchivableRows.length}
            title={selectedArchivableRows.length ? `批量归档 ${selectedArchivableRows.length} 个审核通过且已上传发票订单` : ARCHIVE_BUTTON_DISABLED_TOOLTIP}
            onClick={archiveSelectedOrders}
            data-rule={ARCHIVE_BUTTON_RULE.allow.join(",")}
          >
            批量归档{selectedArchivableRows.length ? `（${selectedArchivableRows.length}）` : ""}
          </button>
        ) : null}
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}
      <div className={`${styles.tableWrap} ${styles.logisticsCompactTableWrap}`}>
        <table className={`${styles.dataTable} ${styles.logisticsCompactTable}`}>
          <colgroup>
            {canArchiveDomesticLogistics ? <col className={styles.selectionColumn} /> : null}
            <col className={styles.orderNoColumn} />
            <col className={styles.blNoColumn} />
            <col className={styles.customerColumn} />
            <col className={styles.destinationColumn} />
            <col className={styles.cargoColumn} />
            <col className={styles.logisticsStatusColumn} />
            <col className={styles.logisticsExpenseStatusColumn} />
            <col className={styles.detailActionColumn} />
          </colgroup>
          <thead>
            <tr>
              {canArchiveDomesticLogistics ? (
                <th className={styles.selectionColumn}>
                  <UiCheckbox
                    variant="table"
                    label="选择本页可归档订单"
                    checked={allPageArchivableSelected}
                    disabled={!pageArchivableRows.length}
                    title={pageArchivableRows.length ? "选择本页审核通过且已上传发票订单" : ARCHIVE_BUTTON_DISABLED_TOOLTIP}
                    onChange={(event) => togglePageArchivableOrders(event.target.checked)}
                  />
                </th>
              ) : null}
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.blNoColumn}>提单号 / B/L No.</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th className={styles.destinationColumn}>到达地</th>
              <th className={styles.cargoColumn}>运输货物名称</th>
              <th className={styles.logisticsStatusColumn}>物流状态</th>
              <th className={styles.logisticsExpenseStatusColumn}>费用录入状态</th>
              <th className={styles.detailActionColumn}>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={tableColSpan}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : pageRows.length ? pageRows.map((row) => (
              <DomesticLogisticsRows
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId((current) => {
                  const next = current === row.id ? "" : row.id;
                  if (!next) {
                    setEditingOrderId("");
                  }
                  return next;
                })}
                editing={editingOrderId === row.id}
                canEditDomesticLogistics={canEditDomesticLogistics}
                canUploadCustomsDocuments={canUploadCustomsDocuments}
                canDeleteCustomsDocuments={canDeleteCustomsDocuments}
                onEdit={() => {
                  setExpandedId(row.id);
                  setEditingOrderId((current) => current === row.id ? "" : row.id);
                }}
                canCreateLogisticsExpense={canCreateLogisticsExpense}
                currentUserRole={currentUser.role}
                onOpenExpenseStatus={() => openLogisticsExpenseStatus(row)}
                onOpenLogisticsFees={() => {
                  setExpandedId(row.id);
                  setEditingOrderId("");
                  onOpenLogisticsFees?.({
                    billId: row.logisticsExpenseBillId || "",
                    keyword: row.blNo || row.billOfLadingNo || row.orderNo || "",
                  });
                }}
                shipsgoFeatures={shipsgoFeatures}
                shipsgoBusyKey={shipsgoBusyKey}
                canManageShipsgoTracking={canManageShipsgoTracking}
                canDeleteShipsgoTracking={canDeleteShipsgoTracking}
                onCreateShipsgoTracking={(payload) => createShipsgoTracking(row, payload)}
                onSyncShipsgoTracking={(trackingId) => syncShipsgoTracking(row, trackingId)}
                onRecoverShipsgoTracking={() => recoverShipsgoTracking(row)}
                onDeleteShipsgoTracking={(tracking) => deleteShipsgoTracking(row, tracking)}
                onSaved={() => {
                  setNotice("物流信息已保存");
                  setEditingOrderId("");
                  void loadRows(submittedKeyword, businessScope);
                }}
                onCancelEdit={() => setEditingOrderId("")}
                canDeleteDomesticLogistics={canDeleteDomesticLogistics}
                onDeleteDomesticLogistics={() => void deleteDomesticLogistics(row)}
                uploadingKey={uploadingKey}
                uploadProgressByKey={uploadProgressByKey}
                deletingDocumentId={deletingDocumentId}
                onUploadDocument={uploadDocument}
                onDeleteDocument={deleteDocument}
                selectionEnabled={canArchiveDomesticLogistics}
                selected={selectedOrderIds.includes(row.id)}
                selectDisabled={!domesticLogisticsCanArchive(row)}
                colSpan={tableColSpan}
                onSelect={(checked) => toggleOrderSelection(row, checked)}
              />
            )) : (
              <tr>
                <td colSpan={tableColSpan}><div className={styles.emptyState}>未找到匹配的物流信息订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={rows.length} page={page} totalPages={totalPages} onPage={setPage} />
      </>
      )}
    </section>
    {confirmation ? (
      <ConfirmationDialog
        state={confirmation}
        onCancel={cancelConfirmation}
        onConfirm={confirmConfirmation}
        onInputChange={updateConfirmationInput}
      />
    ) : null}
    </>
  );
}
