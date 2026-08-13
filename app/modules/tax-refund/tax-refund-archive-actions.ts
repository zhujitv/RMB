import { apiJson } from "../../api";
import { downloadBlob } from "../../utils";
import { normalizedMissingLabels, taxTargetKeyFromMissingLabel, zipFileNameFromResponse } from "./helpers";
import type { TaxRefundDetail, TaxRefundRow } from "./model";
import type { TaxRefundMutationsContext } from "./tax-refund-mutations-context";

export function createTaxRefundArchiveActions(context: TaxRefundMutationsContext) {
  const {
    currentUser, detailOrderId, requestConfirmation, setCancelingArchiveId,
    setDetail, setDetailError, setDetailOrderId, setDetailRow, setError,
    setNotice, setPackageDownloadingId, setRefreshingCompletenessId,
    setSubmittingTaxId, openMissingTarget, patchDetailForOrder, patchRowsForOrder,
  } = context;
  async function downloadPackage(row: TaxRefundRow) {
    setPackageDownloadingId(row.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/tax-refunds/package?orderId=${encodeURIComponent(row.id)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data && typeof data.message === "string" ? data.message : "下载退税资料包失败");
      }
      const blob = await response.blob();
      downloadBlob(blob, zipFileNameFromResponse(response, row));
      setNotice("退税资料包已开始下载");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "下载退税资料包失败");
    } finally {
      setPackageDownloadingId("");
    }
  }

  async function submitTaxRefund(row: TaxRefundRow) {
    const completeness = row.documentCompleteness || {};
    const completed = Number(completeness.completed || 0);
    const total = Number(completeness.total || 0);
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const missingLabels = normalizedMissingLabels(completeness);
    let submitPayload: Record<string, unknown> = { status: "SUBMITTED" };

    if (total <= 0 || percent < 100) {
      let allowForceSubmit = false;
      if (currentUser.role === "管理员") {
        const settingsResult = await apiJson<{ settings?: { allowAdminIncompleteTaxSubmit?: boolean } }>("/api/exchange-rates/settings").catch(() => null);
        allowForceSubmit = settingsResult?.settings?.allowAdminIncompleteTaxSubmit === true;
      }
      if (!allowForceSubmit) {
        const result = await requestConfirmation({
          title: "资料尚未完整，无法提交退税",
          message: `当前完整度：${completed}/${total || 0}（${percent}%）。请先补齐缺失资料后再提交。`,
          details: missingLabels,
          confirmLabel: "查看缺失资料",
          cancelLabel: "关闭",
          variant: "warning",
        });
        if (result.confirmed) {
          await openMissingTarget(row, taxTargetKeyFromMissingLabel(missingLabels[0] || ""));
        }
        return;
      }
      const forceResult = await requestConfirmation({
        title: "确认强制提交退税并归档？",
        message: `当前完整度：${completed}/${total || 0}（${percent}%）。提交前仍会强制检查全部有效物流费用已审核、发票齐全且成本资料一致；尚未付款不影响归档。归档后历史数据可继续查询，利润分析不受影响。`,
        details: [
          `订单：${row.orderNo || "-"}`,
          `提单号：${row.blNo || "-"}`,
          ...(missingLabels.length ? [`缺失资料：${missingLabels.join(" / ")}`] : []),
        ],
        requireInput: true,
        inputLabel: "强制提交原因",
        inputPlaceholder: "例如：税务局要求先申报，发票后补",
        inputRequiredMessage: "强制提交退税必须填写原因。",
        confirmLabel: "确认强制提交并归档",
        cancelLabel: "取消",
        variant: "warning",
      });
      if (!forceResult.confirmed) {
        return;
      }
      submitPayload = { status: "SUBMITTED", forceSubmit: true, forceReason: forceResult.inputValue?.trim() };
    } else {
      const submitResult = await requestConfirmation({
        title: "确认提交退税并归档？",
        message: "系统将再次检查全部有效物流费用已审核、发票齐全且成本资料一致；尚未付款不影响归档。提交成功后业务进入档案，历史费用和单据保留，利润分析不受影响。",
        details: [
          `订单：${row.orderNo || "-"}`,
          `提单号：${row.blNo || "-"}`,
        ],
        confirmLabel: "确认提交并归档",
        cancelLabel: "取消",
        variant: "default",
      });
      if (!submitResult.confirmed) return;
    }

    setSubmittingTaxId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify(submitPayload),
      });
      if (result.success !== true) throw new Error(result.message || "提交退税失败");
      if (result.order) patchRowsForOrder(row.id, result.order);
      if (detailOrderId === row.id) {
        setDetailOrderId("");
        setDetailRow(null);
        setDetail(null);
      }
      setNotice(result.message || "退税资料已提交并归档");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交退税失败");
    } finally {
      setSubmittingTaxId("");
    }
  }

  async function updateTaxRefundStatus(row: TaxRefundRow, status: string) {
    if (status === "SUBMITTED") {
      await submitTaxRefund(row);
      return;
    }
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (result.success !== true) throw new Error(result.message || "退税状态更新失败");
      if (result.order) patchDetailForOrder(row.id, result.order);
      setNotice(result.message || "退税状态已更新");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "退税状态更新失败");
    }
  }

  async function refreshCompleteness(row: TaxRefundRow) {
    setRefreshingCompletenessId(row.id);
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "refreshCompleteness" }),
      });
      if (result.success !== true || !result.order) throw new Error(result.message || "重新计算完整度失败");
      patchDetailForOrder(row.id, result.order);
      setNotice(result.message || "退税完整度已重新计算");
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : "重新计算完整度失败";
      if (detailOrderId === row.id) setDetailError(message);
      else setError(message);
    } finally {
      setRefreshingCompletenessId("");
    }
  }

  async function cancelTaxRefundArchive(row: TaxRefundRow) {
    const result = await requestConfirmation({
      title: "确认取消归档？",
      message: "取消归档后，该订单将重新回到当前退税资料列表。",
      details: [`订单：${row.orderNo || "-"}`],
      confirmLabel: "确认取消归档",
      cancelLabel: "返回",
      variant: "warning",
    });
    if (!result.confirmed) return;
    setCancelingArchiveId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ cancelArchive: true, status: "NOT_READY" }),
      });
      if (result.success !== true) throw new Error(result.message || "取消归档失败");
      if (result.order) patchRowsForOrder(row.id, result.order);
      if (detailOrderId === row.id) {
        setDetailOrderId("");
        setDetailRow(null);
        setDetail(null);
      }
      setNotice(result.message || "退税资料已取消归档");
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "取消归档失败");
    } finally {
      setCancelingArchiveId("");
    }
  }


  return {
    downloadPackage,
    submitTaxRefund,
    updateTaxRefundStatus,
    refreshCompleteness,
    cancelTaxRefundArchive,
  };
}
