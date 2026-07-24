import { apiJson } from "../../api";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import type { DomesticLogisticsActionsContext } from "./domestic-logistics-actions-context";
import {
  ARCHIVE_BUTTON_DISABLED_TOOLTIP,
  PAYLOAD_ARCHIVE_ENDPOINT,
  type DomesticLogisticsDocument,
  type DomesticLogisticsRow,
  type UploadDocumentResponse,
} from "./model";

export function createDomesticLogisticsDocumentActions(context: DomesticLogisticsActionsContext) {
  const {
    selectedArchivableRows, selectedRows, selectedOrderIds, businessScope,
    setRows, setSelectedOrderIds, setError, setNotice, setUploadingKey,
    setUploadProgressByKey, setDeletingDocumentId, setExpandedId,
    setEditingOrderId, requestConfirmation,
  } = context;
  async function archiveSelectedOrders() {
    if (!selectedArchivableRows.length) {
      setError(ARCHIVE_BUTTON_DISABLED_TOOLTIP);
      return false;
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
    if (!confirmationResult.confirmed) return false;
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
      return true;
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "批量归档失败");
      return false;
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


  return { archiveSelectedOrders, uploadDocument, deleteDocument, deleteDomesticLogistics };
}
