import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import { moneyText } from "../../formatters";
import { uploadFormDataWithProgress, validatePaymentVoucherUploadFile, validatePdfUploadFile } from "../../utils";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { recalculateOrderSummary } from "./cost-table";
import { canDeleteCost, costSupplierName, costUploadKey, hasPaymentVoucher, isProductSupplierPaymentEnabled, paymentVoucherUploadKey } from "./helpers";
import type {
  CostBatchVoidResponse,
  CostDeleteResponse,
  CostDetailResponse,
  CostDocument,
  CostFormDrawerState,
  CostInvoiceGroupRow,
  CostOrderSummary,
  CostPaymentResponse,
  CostRow,
  CostView,
} from "./model";

type CostActionsParams = {
  rows: CostRow[];
  setRows: Dispatch<SetStateAction<CostRow[]>>;
  setOrderRows: Dispatch<SetStateAction<CostOrderSummary[]>>;
  setDetailCost: Dispatch<SetStateAction<CostRow | null>>;
  setDetailOrderSummary: Dispatch<SetStateAction<CostOrderSummary | null>>;
  setDetailInvoiceGroup: Dispatch<SetStateAction<CostInvoiceGroupRow | null>>;
  setCostFormDrawer: Dispatch<SetStateAction<CostFormDrawerState | null>>;
  setDocumentCost: Dispatch<SetStateAction<CostRow | null>>;
  setDocumentLoading: Dispatch<SetStateAction<boolean>>;
  setDocumentError: Dispatch<SetStateAction<string>>;
  setUploadingKey: Dispatch<SetStateAction<string>>;
  setPaymentSavingId: Dispatch<SetStateAction<string>>;
  setCostTypeSavingId: Dispatch<SetStateAction<string>>;
  setVoucherUploadingKey: Dispatch<SetStateAction<string>>;
  setVoucherPreviewCost: Dispatch<SetStateAction<CostRow | null>>;
  setUploadProgressByKey: Dispatch<SetStateAction<Record<string, number>>>;
  setDeletingDocumentId: Dispatch<SetStateAction<string>>;
  setDeletingId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  costView: CostView;
  page: number;
  submittedFilters: Record<string, string>;
  archiveScope: string;
  canManageFactoryPayments: boolean;
  loadCosts: (nextPage?: number, nextFilters?: any, nextArchiveScope?: string, nextView?: CostView, options?: { silent?: boolean }) => Promise<void>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
};

export function useCostDocumentActions({
  rows,
  setRows,
  setOrderRows,
  setDetailCost,
  setDetailOrderSummary,
  setDetailInvoiceGroup,
  setCostFormDrawer,
  setDocumentCost,
  setDocumentLoading,
  setDocumentError,
  setUploadingKey,
  setPaymentSavingId,
  setCostTypeSavingId,
  setVoucherUploadingKey,
  setVoucherPreviewCost,
  setUploadProgressByKey,
  setDeletingDocumentId,
  setDeletingId,
  setError,
  setNotice,
  costView,
  page,
  submittedFilters,
  archiveScope,
  canManageFactoryPayments,
  loadCosts,
  requestConfirmation,
}: CostActionsParams) {
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

  async function updateProductSupplierCostPayment(cost: CostRow, paid: boolean, paidAt: string) {
    if (!isProductSupplierPaymentEnabled(cost)) {
      setDocumentError("付款信息仅适用于产品供应商货款。");
      return;
    }
    if (!canManageFactoryPayments) {
      setDocumentError("只有管理员或财务可以维护产品供应商货款付款信息。");
      return;
    }
    if (!paid) {
      const confirmationResult = await requestConfirmation({
        title: "取消付款状态",
        message: "确认取消该产品供应商货款的已付款状态吗？",
        details: [`供应商：${costSupplierName(cost)}`, `成本：${moneyText(cost.currency, cost.amount, cost.amountCny)}`],
        confirmLabel: "取消付款",
        cancelLabel: "返回",
        variant: "danger",
      });
      if (!confirmationResult.confirmed) return;
    }
    setPaymentSavingId(cost.id);
    setDocumentError("");
    try {
      const result = await apiJson<CostPaymentResponse>(`/api/costs/${encodeURIComponent(cost.id)}/payment`, {
        method: "PATCH",
        body: JSON.stringify({
          paid,
          paidAt: paid ? paidAt : null,
        }),
      });
      const nextCost = result.cost || result.data?.cost;
      if (!nextCost) throw new Error(result.message || "更新付款信息失败");
      await refreshDocumentCost(nextCost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
      setNotice(paid ? "已标记付款" : "已取消付款状态");
    } catch (paymentError) {
      setDocumentError(paymentError instanceof Error ? paymentError.message : "更新付款信息失败");
    } finally {
      setPaymentSavingId("");
    }
  }

  async function updateCostType(cost: CostRow, costType: string, reason: string) {
    const nextCostType = costType.trim();
    const changeReason = reason.trim();
    if (!nextCostType) {
      setDocumentError("请选择成本类型。");
      return;
    }
    if (nextCostType === (cost.costType || "")) return;
    if (!changeReason) {
      setDocumentError("请填写修改原因。");
      return;
    }
    setCostTypeSavingId(cost.id);
    setDocumentError("");
    try {
      const result = await apiJson<{
        success?: boolean;
        ok?: boolean;
        message?: string;
        cost?: CostRow;
        orderSummary?: CostOrderSummary | null;
        data?: { cost?: CostRow; orderSummary?: CostOrderSummary | null };
      }>(`/api/costs/${encodeURIComponent(cost.id)}/cost-type`, {
        method: "PATCH",
        body: JSON.stringify({ costType: nextCostType, reason: changeReason }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "更新成本类型失败");
      const nextCost = result.cost || result.data?.cost;
      if (!nextCost) throw new Error(result.message || "更新成本类型失败");
      const nextOrderSummary = result.orderSummary || result.data?.orderSummary || null;
      setRows((current) => current.map((item) => item.id === nextCost.id ? { ...item, ...nextCost } : item));
      setDetailCost((current) => current?.id === nextCost.id ? { ...current, ...nextCost } : current);
      setDocumentCost((current) => current?.id === nextCost.id ? { ...current, ...nextCost } : current);
      setVoucherPreviewCost((current) => current?.id === nextCost.id ? { ...current, ...nextCost } : current);
      setCostFormDrawer((current) => current?.cost?.id === nextCost.id ? { ...current, cost: { ...current.cost, ...nextCost } } : current);
      if (nextOrderSummary) {
        setOrderRows((current) => current.map((item) => (
          item.id === nextOrderSummary.id || item.orderId === nextOrderSummary.orderId
            ? { ...item, ...nextOrderSummary }
            : item
        )));
        setDetailOrderSummary((current) => current && (current.id === nextOrderSummary.id || current.orderId === nextOrderSummary.orderId)
          ? { ...current, ...nextOrderSummary }
          : current);
      }
      await refreshDocumentCost(nextCost.id);
      void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
      setNotice("成本类型已更新");
    } catch (updateError) {
      setDocumentError(updateError instanceof Error ? updateError.message : "更新成本类型失败");
    } finally {
      setCostTypeSavingId("");
    }
  }

  async function uploadPaymentVoucher(cost: CostRow, file: File | null) {
    if (!file) return;
    if (!isProductSupplierPaymentEnabled(cost)) {
      setDocumentError("付款凭证仅适用于产品供应商货款。");
      return;
    }
    if (!canManageFactoryPayments) {
      setDocumentError("只有管理员或财务可以上传产品供应商货款付款凭证。");
      return;
    }
    const validationError = validatePaymentVoucherUploadFile(file);
    if (validationError) {
      setDocumentError(validationError);
      return;
    }
    const key = paymentVoucherUploadKey(cost);
    setVoucherUploadingKey(key);
    setUploadProgressByKey((current) => ({ ...current, [key]: 0 }));
    setDocumentError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadFormDataWithProgress<CostPaymentResponse>(`/api/costs/${encodeURIComponent(cost.id)}/payment-voucher`, formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [key]: progress }));
      });
      const nextCost = result.cost || result.data?.cost;
      if (!nextCost) throw new Error(result.message || "付款凭证上传失败");
      await refreshDocumentCost(nextCost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
      setNotice("付款凭证已上传");
    } catch (uploadError) {
      setDocumentError(uploadError instanceof Error ? uploadError.message : "付款凭证上传失败");
    } finally {
      setVoucherUploadingKey("");
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

  function applyDeletedCost(cost: CostRow, orderSummary?: CostOrderSummary | null) {
    const nextOrderSummary = orderSummary || null;
    setRows((current) => current.filter((item) => item.id !== cost.id));
    setOrderRows((current) => {
      if (nextOrderSummary) {
        const exists = current.some((item) => item.id === nextOrderSummary.id || item.orderId === nextOrderSummary.orderId);
        if (!exists) return current;
        return current.map((item) => (
          item.id === nextOrderSummary.id || item.orderId === nextOrderSummary.orderId
            ? { ...item, ...nextOrderSummary }
            : item
        ));
      }
      return current.map((item) => (
        item.id === cost.orderId || item.orderId === cost.orderId
          ? recalculateOrderSummary(item, item.costs?.filter((row) => row.id !== cost.id) || [])
          : item
      ));
    });
    setDetailOrderSummary((current) => {
      if (!current) return current;
      if (nextOrderSummary && (current.id === nextOrderSummary.id || current.orderId === nextOrderSummary.orderId)) {
        return { ...current, ...nextOrderSummary };
      }
      if (current.id === cost.orderId || current.orderId === cost.orderId) {
        return recalculateOrderSummary(current, current.costs?.filter((row) => row.id !== cost.id) || []);
      }
      return current;
    });
    setDetailCost((current) => current?.id === cost.id ? null : current);
    setDocumentCost((current) => current?.id === cost.id ? null : current);
    setVoucherPreviewCost((current) => current?.id === cost.id ? null : current);
    setCostFormDrawer((current) => current?.cost?.id === cost.id ? null : current);
  }

  function lifecycleDetails(cost: CostRow, actionText: string) {
    return [
      `订单：${cost.orderNo || "-"}`,
      `成本：${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} ${moneyText(cost.currency, cost.amount, cost.amountCny)}`,
      `处理方式：${actionText}`,
      ...(!canDeleteCost(cost) && Array.isArray(cost.deleteBlockedReasons) && cost.deleteBlockedReasons.length
        ? [`不能删除原因：${cost.deleteBlockedReasons.join("；")}`]
        : []),
    ];
  }

  async function voidCost(cost: CostRow) {
    const confirmationResult = await requestConfirmation({
      title: "作废成本",
      message: "确认作废这条成本明细吗？作废后将从成本统计、利润分析、退税计算、待办和报表中排除，但保留金额、附件、付款凭证和操作日志。",
      details: lifecycleDetails(cost, "作废，不做物理删除"),
      confirmLabel: "作废成本",
      cancelLabel: "取消",
      variant: "danger",
      requireInput: true,
      inputLabel: "作废原因",
      inputPlaceholder: "请填写作废原因",
      inputRequiredMessage: "作废原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostDeleteResponse>(`/api/costs/${encodeURIComponent(cost.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ action: "void", reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "作废成本失败");
      applyDeletedCost(cost, result.orderSummary);
      setNotice(result.message || "成本明细已作废");
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "作废成本失败");
    } finally {
      setDeletingId("");
    }
  }

  async function deleteCost(cost: CostRow) {
    if (!canDeleteCost(cost)) {
      await voidCost(cost);
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "删除成本",
      message: "确认删除这条成本明细吗？删除后将影响该订单成本合计和利润分析，且不可恢复。",
      details: lifecycleDetails(cost, "物理删除"),
      confirmLabel: "删除成本",
      cancelLabel: "取消",
      variant: "danger",
      requireInput: true,
      inputLabel: "删除原因",
      inputPlaceholder: "请填写删除原因",
      inputRequiredMessage: "删除原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostDeleteResponse>(`/api/costs/${encodeURIComponent(cost.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ action: "delete", reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "删除成本失败");
      applyDeletedCost(cost, result.orderSummary);
      setNotice(result.message || "成本明细已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除成本失败");
    } finally {
      setDeletingId("");
    }
  }

  async function restoreCost(cost: CostRow) {
    const confirmationResult = await requestConfirmation({
      title: "恢复作废成本",
      message: "确认恢复这条已作废成本吗？恢复后将重新参与成本统计、利润分析、退税完整度、待办和报表。",
      details: lifecycleDetails(cost, "恢复为有效成本"),
      confirmLabel: "恢复成本",
      cancelLabel: "取消",
      variant: "warning",
      requireInput: true,
      inputLabel: "恢复原因",
      inputPlaceholder: "请填写恢复原因",
      inputRequiredMessage: "恢复原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostDeleteResponse>(`/api/costs/${encodeURIComponent(cost.id)}/restore`, {
        method: "POST",
        body: JSON.stringify({ reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "恢复成本失败");
      applyDeletedCost(cost, result.orderSummary);
      setNotice(result.message || "成本明细已恢复");
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复成本失败");
    } finally {
      setDeletingId("");
    }
  }

  async function batchVoidCosts(costs: CostRow[]) {
    const targetCosts = costs.filter((cost) => cost.id);
    if (!targetCosts.length) return;
    const confirmationResult = await requestConfirmation({
      title: "批量作废成本",
      message: `确认作废选中的 ${targetCosts.length} 条成本明细吗？作废后不参与利润、退税、待办和报表。`,
      details: targetCosts.slice(0, 5).map((cost) => `${cost.orderNo || "-"} · ${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} · ${moneyText(cost.currency, cost.amount, cost.amountCny)}`),
      confirmLabel: "批量作废",
      cancelLabel: "取消",
      variant: "danger",
      requireInput: true,
      inputLabel: "作废原因",
      inputPlaceholder: "请填写批量作废原因",
      inputRequiredMessage: "作废原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId("__batch_void__");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostBatchVoidResponse>("/api/costs/batch-void", {
        method: "POST",
        body: JSON.stringify({ ids: targetCosts.map((cost) => cost.id), reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "批量作废成本失败");
      const ids = new Set(targetCosts.map((cost) => cost.id));
      setRows((current) => current.filter((row) => !ids.has(row.id)));
      setDetailCost((current) => current && ids.has(current.id) ? null : current);
      setDocumentCost((current) => current && ids.has(current.id) ? null : current);
      void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
      setNotice(`已作废 ${result.voidedCount || 0} 条成本${result.skippedCount ? `，跳过 ${result.skippedCount} 条` : ""}`);
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : "批量作废成本失败");
    } finally {
      setDeletingId("");
    }
  }

  return {
    fetchCostDetail,
    openCostDocuments,
    openInvoiceGroupDocuments,
    refreshDocumentCost,
    uploadCostDocument,
    updateCostType,
    updateProductSupplierCostPayment,
    uploadPaymentVoucher,
    deleteCostDocument,
    voidCost,
    deleteCost,
    restoreCost,
    batchVoidCosts,
  };
}
