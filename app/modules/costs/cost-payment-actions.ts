import { apiJson } from "../../api";
import { moneyText } from "../../formatters";
import { uploadFormDataWithProgress, validatePaymentVoucherUploadFile } from "../../utils";
import type { CostActionsContext } from "./cost-actions-context";
import {
  costSupplierName,
  isProductSupplierPaymentEnabled,
  paymentVoucherUploadKey,
} from "./helpers";
import type { CostOrderSummary, CostPaymentResponse, CostRow } from "./model";

export function createCostPaymentActions(
  context: CostActionsContext,
  refreshDocumentCost: (costId: string) => Promise<void>,
) {
  const {
    setRows, setOrderRows, setDetailCost, setDetailOrderSummary, setCostFormDrawer,
    setDocumentCost, setDocumentError, setPaymentSavingId, setCostTypeSavingId,
    setVoucherUploadingKey, setVoucherPreviewCost, setUploadProgressByKey,
    setNotice, costView, page, submittedFilters, archiveScope,
    canManageFactoryPayments, loadCosts, requestConfirmation,
  } = context;
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
    const previousVoucherVersion = [cost.paymentVoucherUploadedAt, cost.updatedAt, cost.paymentVoucherFileName, cost.paymentVoucherUrl].filter(Boolean).join(":");
    setVoucherUploadingKey(key);
    setUploadProgressByKey((current) => ({ ...current, [key]: 0 }));
    setVoucherPreviewCost((current) => current?.id === cost.id ? null : current);
    setDocumentError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadFormDataWithProgress<CostPaymentResponse>(`/api/costs/${encodeURIComponent(cost.id)}/payment-voucher`, formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [key]: progress }));
      });
      const nextCost = result.cost || result.data?.cost;
      if (!nextCost) throw new Error(result.message || "付款凭证上传失败");
      const nextVoucherVersion = [nextCost.paymentVoucherUploadedAt, nextCost.updatedAt, nextCost.paymentVoucherFileName, nextCost.paymentVoucherUrl].filter(Boolean).join(":");
      if (previousVoucherVersion && nextVoucherVersion && previousVoucherVersion === nextVoucherVersion) {
        throw new Error("付款凭证替换失败：系统仍关联旧凭证，请重新上传。");
      }
      setRows((current) => current.map((item) => item.id === nextCost.id ? { ...item, ...nextCost } : item));
      setDetailCost((current) => current?.id === nextCost.id ? { ...current, ...nextCost } : current);
      setDocumentCost((current) => current?.id === nextCost.id ? { ...current, ...nextCost } : current);
      setCostFormDrawer((current) => current?.cost?.id === nextCost.id ? { ...current, cost: { ...current.cost, ...nextCost } } : current);
      await refreshDocumentCost(nextCost.id);
      void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
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


  return {
    updateProductSupplierCostPayment,
    updateCostType,
    uploadPaymentVoucher,
  };
}
