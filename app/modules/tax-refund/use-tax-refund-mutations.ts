import type { Dispatch, SetStateAction } from "react";
import { apiJson } from "../../api";
import type { User } from "../../types";
import { downloadBlob, uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import { normalizedMissingLabels, taxTargetKeyFromMissingLabel, uploadScopeKey, zipFileNameFromResponse } from "./helpers";
import type { TaxDocument, TaxRefundDetail, TaxRefundMode, TaxRefundRow, UploadDocumentResponse, UploadScope } from "./model";

type Setter<T> = Dispatch<SetStateAction<T>>;

type ConfirmationRequest = (options: {
  title: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "warning" | "danger";
  requireInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputRequiredMessage?: string;
}) => Promise<{ confirmed: boolean; inputValue?: string }>;

type TaxRefundMutationsContext = {
  currentUser: User;
  detail: TaxRefundDetail | null;
  detailOrderId: string;
  detailRow: TaxRefundRow | null;
  mode: TaxRefundMode;
  page: number;
  submittedKeyword: string;
  requestConfirmation: ConfirmationRequest;
  onOpenDomesticLogistics?: (keyword: string) => void;
  setCancelingArchiveId: Setter<string>;
  setDeletingDocumentId: Setter<string>;
  setDetail: Setter<TaxRefundDetail | null>;
  setDetailError: Setter<string>;
  setDetailOrderId: Setter<string>;
  setDetailRow: Setter<TaxRefundRow | null>;
  setError: Setter<string>;
  setNotice: Setter<string>;
  setPackageDownloadingId: Setter<string>;
  setRefreshingCompletenessId: Setter<string>;
  setSubmittingTaxId: Setter<string>;
  setUploadProgressByKey: Setter<Record<string, number>>;
  setUploadingKey: Setter<string>;
  loadRows: (...args: any[]) => Promise<TaxRefundRow[]>;
  fetchDetail: (orderId: string) => Promise<void>;
  openMissingTarget: (row: TaxRefundRow, targetKey: string) => Promise<void>;
  patchDetailForOrder: (orderId: string, patch: Partial<TaxRefundDetail>) => void;
  patchRowsForOrder: (orderId: string, patch: Partial<TaxRefundDetail>) => void;
  patchUploadedDocument: (orderId: string, document: TaxDocument) => void;
};

export function useTaxRefundMutations(context: TaxRefundMutationsContext) {
  const {
    currentUser,
    detail,
    detailOrderId,
    detailRow,
    mode,
    page,
    submittedKeyword,
    requestConfirmation,
    onOpenDomesticLogistics,
    setCancelingArchiveId,
    setDeletingDocumentId,
    setDetail,
    setDetailError,
    setDetailOrderId,
    setDetailRow,
    setError,
    setNotice,
    setPackageDownloadingId,
    setRefreshingCompletenessId,
    setSubmittingTaxId,
    setUploadProgressByKey,
    setUploadingKey,
    loadRows,
    fetchDetail,
    openMissingTarget,
    patchDetailForOrder,
    patchRowsForOrder,
    patchUploadedDocument,
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
        message: `当前完整度：${completed}/${total || 0}（${percent}%）。提交前仍会强制检查全部有效物流费用已审核、发票齐全并完成付款。归档后历史数据可继续查询，利润分析不受影响。`,
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
        message: "系统将再次检查全部有效物流费用已审核、发票齐全并完成付款。提交成功后业务进入档案，历史费用和单据保留，利润分析不受影响。",
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

async function uploadDocument(orderId: string, documentType: string, file: File | null, scope: UploadScope = {}) {
    if (!file) return;
    const uploadKey = uploadScopeKey(orderId, documentType, scope);
    const isCustomsDeclaration = documentType === "CUSTOMS_ENTRY_FORM";
    setUploadingKey(uploadKey);
    setUploadProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      const formData = new FormData();
      formData.append("orderId", orderId);
      formData.append("documentType", documentType);
      formData.append("uploadSource", "REACT_TAX_REFUND");
      if (scope.costId) formData.append("costId", scope.costId);
      if (scope.supplierId) formData.append("supplierId", scope.supplierId);
      formData.append("file", file);
      const data = await uploadFormDataWithProgress<UploadDocumentResponse>("/api/order-documents", formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [uploadKey]: progress }));
      });
      const uploadedDocument = data.document || data.data;
      if (uploadedDocument?.id) {
        patchUploadedDocument(orderId, uploadedDocument);
      }
      if (isCustomsDeclaration) {
        patchCustomsPdfTextParse(orderId, uploadedDocument?.customsPdfTextParse);
      }
      setNotice(isCustomsDeclaration ? customsUploadNotice(uploadedDocument?.customsPdfTextParse) : "上传成功");
      if (detailOrderId === orderId) void fetchDetail(orderId);
    } catch (uploadError) {
      setDetailError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[uploadKey];
        return next;
      });
    }
  }

function customsUploadNotice(parseResult: TaxDocument["customsPdfTextParse"] | undefined) {
    if (!parseResult) return "报关单已上传，正在读取报关单信息。";
    const declarationNoMessage = parseResult.customsDeclarationNo ? "已读取：报关单号" : "未读取到报关单号，请手动填写";
    const declarationDateMessage = parseResult.customsDeclarationDate ? "已读取：申报日期" : "未读取到申报日期，请手动填写";
    return `报关单已上传，${declarationNoMessage}；${declarationDateMessage}`;
  }

function patchCustomsPdfTextParse(orderId: string, parseResult: TaxDocument["customsPdfTextParse"] | undefined) {
    if (!parseResult) return;
    const patch: Partial<TaxRefundDetail> = {};
    if (parseResult.customsDeclarationNo) patch.customsDeclarationNo = parseResult.customsDeclarationNo;
    if (parseResult.customsDeclarationDate) {
      patch.customsDeclarationDate = parseResult.customsDeclarationDate;
      patch.declarationDate = parseResult.customsDeclarationDate;
    }
    if (Object.keys(patch).length) patchDetailForOrder(orderId, patch);
  }

async function deleteDocument(orderId: string, document: TaxDocument) {
    const result = await requestConfirmation({
      title: "确定删除该文件？",
      message: "删除后需要重新上传。",
      details: [document.fileName || document.documentTypeLabel || "-"],
      confirmLabel: "删除文件",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!result.confirmed) return;
    setDeletingDocumentId(document.id);
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/order-documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除失败，请重试");
      setDetail((current) => {
        if (!current || current.id !== orderId) return current;
        const nextDetail: TaxRefundDetail = {
          ...current,
          documents: (current.documents || []).filter((item) => item.id !== document.id),
        };
        if (document.documentType === "CUSTOMS_ENTRY_FORM") {
          nextDetail.customsDeclarationNo = "";
          nextDetail.customsDeclarationDate = "";
          nextDetail.declarationDate = "";
        }
        return nextDetail;
      });
      if (document.documentType === "CUSTOMS_ENTRY_FORM") {
        patchRowsForOrder(orderId, {
          customsDeclarationNo: "",
          customsDeclarationDate: "",
          declarationDate: "",
        });
      }
      if (detailOrderId === orderId) void fetchDetail(orderId);
      setNotice(result.message || "已删除文件");
    } catch (deleteError) {
      setDetailError(deleteError instanceof Error ? deleteError.message : "删除失败，请重试");
    } finally {
      setDeletingDocumentId("");
    }
  }

function refreshRows() {
    setNotice("");
    void loadRows(page);
  }

async function handleCustomsSaved(orderId: string, order?: TaxRefundDetail | null) {
    if (order) {
      patchDetailForOrder(orderId, order);
    }
    setNotice("报关单信息已保存");
  }

function openDomesticLogisticsFromDetail() {
    const keywordValue = (detail?.orderNo || detailRow?.orderNo || detailRow?.id || "").trim();
    if (keywordValue) onOpenDomesticLogistics?.(keywordValue);
  }

  return {
    downloadPackage,
    submitTaxRefund,
    updateTaxRefundStatus,
    refreshCompleteness,
    cancelTaxRefundArchive,
    uploadDocument,
    deleteDocument,
    refreshRows,
    handleCustomsSaved,
    openDomesticLogisticsFromDetail,
  };
}
