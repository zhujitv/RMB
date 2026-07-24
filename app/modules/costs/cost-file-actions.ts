import { apiJson } from "../../api";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import type { CostActionsContext } from "./cost-actions-context";
import { costUploadKey } from "./helpers";
import type { CostDetailResponse, CostDocument, CostInvoiceGroupRow, CostRow } from "./model";

export function createCostFileActions(context: CostActionsContext) {
  const {
    rows, setRows, setDetailCost, setDetailOrderSummary, setDetailInvoiceGroup,
    setCostFormDrawer, setDocumentCost, setDocumentLoading, setDocumentError,
    setUploadingKey, setVoucherPreviewCost, setUploadProgressByKey,
    setDeletingDocumentId, setNotice, costView, page, submittedFilters,
    archiveScope, loadCosts, requestConfirmation,
  } = context;
  async function fetchCostDetail(id: string) {
    const result = await apiJson<CostDetailResponse>(`/api/costs/${encodeURIComponent(id)}`);
    const cost = result.cost || result.data?.cost;
    if (!cost) throw new Error(result.message || "未找到成本详情");
    setRows((current) => current.map((item) => item.id === cost.id ? { ...item, ...cost } : item));
    setDetailCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setDocumentCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setVoucherPreviewCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setCostFormDrawer((current) => current?.cost?.id === cost.id ? { ...current, cost: { ...current.cost, ...cost } } : current);
    return cost;
  }

  async function openCostDocuments(id: string) {
    const cached = rows.find((cost) => cost.id === id) || null;
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setDocumentCost(cached);
    setDocumentLoading(true);
    setDocumentError("");
    try {
      const cost = await fetchCostDetail(id);
      setDocumentCost(cost);
    } catch (detailError) {
      setDocumentError(detailError instanceof Error ? detailError.message : "读取成本资料失败");
    } finally {
      setDocumentLoading(false);
    }
  }

  function openInvoiceGroupDocuments(group: CostInvoiceGroupRow) {
    if (group.groupType === "LOGISTICS_BILL" || (group.costs || []).length !== 1) {
      setDetailCost(null);
      setDetailOrderSummary(null);
      setCostFormDrawer(null);
      setDocumentCost(null);
      setDetailInvoiceGroup(group);
      return;
    }
    const costId = group.costs?.[0]?.id;
    if (costId) void openCostDocuments(costId);
  }

  async function refreshDocumentCost(costId: string) {
    try {
      const freshCost = await fetchCostDetail(costId);
      setDocumentCost(freshCost);
    } catch (detailError) {
      setDocumentError(detailError instanceof Error ? detailError.message : "刷新成本资料失败");
    }
  }

  async function uploadCostDocument(cost: CostRow, documentType: string, file: File | null) {
    if (!file) return;
    const validationError = validatePdfUploadFile(file);
    if (validationError) {
      setDocumentError(validationError);
      return;
    }
    if (!cost.orderId) {
      setDocumentError("该成本未关联订单，不能上传资料。");
      return;
    }
    if (!cost.supplierId) {
      setDocumentError("该成本未关联供应商，不能上传供应商资料。");
      return;
    }
    const key = costUploadKey(cost, documentType);
    setUploadingKey(key);
    setUploadProgressByKey((current) => ({ ...current, [key]: 0 }));
    setDocumentError("");
    try {
      const formData = new FormData();
      formData.append("orderId", cost.orderId);
      formData.append("documentType", documentType);
      formData.append("costId", cost.id);
      formData.append("supplierId", cost.supplierId);
      formData.append("relatedModule", "SUPPLIER");
      formData.append("uploadSource", "REACT_COSTS");
      formData.append("file", file);
      await uploadFormDataWithProgress("/api/order-documents", formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [key]: progress }));
      });
      await refreshDocumentCost(cost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
      setNotice("上传成功");
    } catch (uploadError) {
      setDocumentError(uploadError instanceof Error ? uploadError.message : "资料上传失败");
    } finally {
      setUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }


  async function deleteCostDocument(cost: CostRow, document: CostDocument) {
    const confirmationResult = await requestConfirmation({
      title: "确认删除该资料？",
      message: "删除后该文件不会继续参与资料完整度统计。",
      details: [`文件：${document.fileName || "-"}`],
      confirmLabel: "删除资料",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingDocumentId(document.id);
    setDocumentError("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/order-documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
      });
      if (result.success === false) throw new Error(result.message || "删除资料失败");
      await refreshDocumentCost(cost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
      setNotice("资料已删除");
    } catch (deleteError) {
      setDocumentError(deleteError instanceof Error ? deleteError.message : "删除资料失败");
    } finally {
      setDeletingDocumentId("");
    }
  }


  return {
    fetchCostDetail,
    openCostDocuments,
    openInvoiceGroupDocuments,
    refreshDocumentCost,
    uploadCostDocument,
    deleteCostDocument,
  };
}
