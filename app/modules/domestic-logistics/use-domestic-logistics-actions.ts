import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import {
  ARCHIVE_BUTTON_DISABLED_TOOLTIP,
  PAYLOAD_ARCHIVE_ENDPOINT,
  type DomesticLogisticsDocument,
  type DomesticLogisticsResponse,
  type DomesticLogisticsRow,
  type ShipsgoControlTowerRow,
  type ShipsgoTrackingRow,
  type UploadDocumentResponse,
} from "./model";

type DomesticLogisticsActionsParams = {
  selectedArchivableRows: DomesticLogisticsRow[];
  selectedRows: DomesticLogisticsRow[];
  selectedOrderIds: string[];
  submittedKeyword: string;
  businessScope: string;
  setRows: Dispatch<SetStateAction<DomesticLogisticsRow[]>>;
  setSelectedOrderIds: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setUploadingKey: Dispatch<SetStateAction<string>>;
  setUploadProgressByKey: Dispatch<SetStateAction<Record<string, number>>>;
  setDeletingDocumentId: Dispatch<SetStateAction<string>>;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setEditingOrderId: Dispatch<SetStateAction<string>>;
  setShipsgoBusyKey: Dispatch<SetStateAction<string>>;
  setActiveLogisticsView: Dispatch<SetStateAction<"list" | "controlTower">>;
  setBusinessScope: Dispatch<SetStateAction<string>>;
  setKeyword: Dispatch<SetStateAction<string>>;
  setSubmittedKeyword: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  loadRows: (nextKeyword?: string, nextBusinessScope?: string, nextPage?: number) => Promise<DomesticLogisticsRow[]>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
};

export function useDomesticLogisticsActions({
  selectedArchivableRows,
  selectedRows,
  selectedOrderIds,
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
}: DomesticLogisticsActionsParams) {
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
      const archivedIds = new Set(result.archivedIds || selectedArchivableRows.map((row) => row.id));
      setRows((currentRows) => {
        if (businessScope === "current") return currentRows.filter((row) => !archivedIds.has(row.id));
        return currentRows.map((row) => (
          archivedIds.has(row.id) ? { ...row, isArchived: true } : row
        ));
      });
      setSelectedOrderIds((currentIds) => currentIds.filter((id) => !archivedIds.has(id)));
      setNotice(result.message || `已归档 ${result.archivedCount || 0} 个订单`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "批量归档失败");
    }
  }

  async function uploadDocument(orderId: string, documentType: string, file: File | null) {
    if (!file) return;
    const isCustomsDeclaration = documentType === "CUSTOMS_ENTRY_FORM";
    const uploadKey = `${orderId}:${documentType}`;
    setUploadingKey(uploadKey);
    setUploadProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
    setError("");
    setNotice(isCustomsDeclaration ? "正在识别报关单信息..." : "");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      const formData = new FormData();
      formData.append("orderId", orderId);
      formData.append("documentType", documentType);
      formData.append("uploadSource", "REACT_DOMESTIC_LOGISTICS");
      formData.append("file", file);
      const result = await uploadFormDataWithProgress<UploadDocumentResponse>("/api/order-documents", formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [uploadKey]: progress }));
      });
      const document = result.document || result.data;
      if (document?.id) {
        setRows((currentRows) => currentRows.map((row) => {
          if (row.id !== orderId && row.orderId !== orderId) return row;
          const existingDocuments = row.documents || [];
          const nextDocuments = [
            document,
            ...existingDocuments.filter((item) => item.id !== document.id && item.documentType !== document.documentType),
          ];
          return { ...row, documents: nextDocuments };
        }));
      }
      setNotice("上传成功");
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
      setRows((currentRows) => currentRows.map((row) => ({
        ...row,
        documents: (row.documents || []).filter((item) => item.id !== document.id),
      })));
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
      setRows((currentRows) => currentRows.map((currentRow) => {
        if (currentRow.id !== row.id && currentRow.orderId !== row.orderId) return currentRow;
        return {
          ...currentRow,
          domesticLogisticsInfo: null,
          logisticsStatus: "未录入",
          submittedAt: null,
          archiveEligible: false,
        };
      }));
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
      if (result.success !== true || !result.tracking) throw new Error(result.message || "创建海运跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "海运跟踪已创建");
    } catch (createError) {
      throw createError instanceof Error ? createError : new Error("创建海运跟踪失败");
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
      if (result.success !== true || !result.tracking) throw new Error(result.message || "同步海运跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "海运状态已同步");
      return result.tracking;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "同步海运跟踪失败";
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
      if (result.success !== true || !result.tracking) throw new Error(result.message || "同步已有海运跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "已同步已有海运跟踪");
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : "同步已有海运跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function deleteShipsgoTracking(row: DomesticLogisticsRow, tracking: ShipsgoTrackingRow) {
    const confirmationResult = await requestConfirmation({
      title: "删除海运跟踪？",
      message: "删除后该订单将不再显示这条运输跟踪记录。本操作不会调用第三方创建或同步接口。",
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
      if (result.success !== true) throw new Error(result.message || "删除海运跟踪失败");
      removeRowShipsgoTracking(row.id, tracking.id);
      setNotice(result.message || "海运跟踪已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除海运跟踪失败");
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
    const nextRows = await loadRows(value, row.orderIsArchived ? "archive" : "current", 1);
    const matched = nextRows.find((item) => (
      item.orderId === row.orderId
      || item.id === row.orderId
      || item.orderNo === row.orderNo
      || item.blNo === row.masterBlNo
      || item.billOfLadingNo === row.masterBlNo
    )) || nextRows[0];
    if (matched) setExpandedId(matched.id);
  }

  return {
    archiveSelectedOrders,
    uploadDocument,
    deleteDocument,
    deleteDomesticLogistics,
    createShipsgoTracking,
    syncShipsgoTracking,
    recoverShipsgoTracking,
    deleteShipsgoTracking,
    openControlTowerOrder,
  };
}
