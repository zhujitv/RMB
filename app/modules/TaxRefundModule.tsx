"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, PaginationBar, useConfirmationDialog } from "../components";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission, downloadBlob, PDF_UPLOAD_MAX_SIZE_LABEL, uploadFormDataWithProgress, validatePdfUploadFile } from "../utils";
import {
  CustomsFilePickerDialog,
  ManualShippingDocumentsDialog,
  SupplierDocumentRequestDialog,
  TaxRefundDetailDrawer,
} from "./tax-refund/detail-components";
import {
  customsEntryDocuments,
  manualShippingTemplate,
  normalizedMissingLabels,
  taxMissingTargets,
  taxRefundHasPackageContent,
  taxRefundRowPatchFromDetail,
  taxRowStatus,
  taxTargetKeyFromMissingLabel,
  taxTargetDomId,
  uploadScopeKey,
  upsertTaxDocument,
  zipFileNameFromResponse,
} from "./tax-refund/helpers";
import {
  PAGE_SIZE,
  TAX_FACTORY_UPLOAD_TYPES,
  TAX_REFUND_STATUS_OPTIONS,
  type CustomsFilePickerState,
  type CustomsRecognitionResponse,
  type CustomsRecognitionResult,
  type ManualShippingDraft,
  type ManualShippingForm,
  type SupplierDocumentRequestForm,
  type SupplierOption,
  type TaxDocument,
  type TaxRefundDetail,
  type TaxRefundDetailResponse,
  type TaxRefundMode,
  type TaxRefundResponse,
  type TaxRefundRow,
  type UploadDocumentResponse,
  type UploadScope,
} from "./tax-refund/model";
import { TaxRefundTableRow } from "./tax-refund/table-row";

export function TaxRefundModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialAction = "",
  initialOpenToken = 0,
  onOpenDomesticLogistics,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialAction?: string;
  initialOpenToken?: number;
  onOpenDomesticLogistics?: (keyword: string) => void;
}) {
  const [mode, setMode] = useState<TaxRefundMode>("current");
  const [rows, setRows] = useState<TaxRefundRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [declarationStartMonth, setDeclarationStartMonth] = useState("");
  const [declarationEndMonth, setDeclarationEndMonth] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detailRow, setDetailRow] = useState<TaxRefundRow | null>(null);
  const [detail, setDetail] = useState<TaxRefundDetail | null>(null);
  const [pendingDetailTarget, setPendingDetailTarget] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [packageDownloadingId, setPackageDownloadingId] = useState("");
  const [submittingTaxId, setSubmittingTaxId] = useState("");
  const [cancelingArchiveId, setCancelingArchiveId] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [recognizingDocumentId, setRecognizingDocumentId] = useState("");
  const [recognitionStatusByDocument, setRecognitionStatusByDocument] = useState<Record<string, string>>({});
  const [customsFilePicker, setCustomsFilePicker] = useState<CustomsFilePickerState>(null);
  const [manualShippingOrder, setManualShippingOrder] = useState<TaxRefundDetail | null>(null);
  const [manualShippingDraft, setManualShippingDraft] = useState<ManualShippingDraft | null>(null);
  const [manualShippingForm, setManualShippingForm] = useState<ManualShippingForm | null>(null);
  const [manualShippingLoading, setManualShippingLoading] = useState(false);
  const [manualShippingSending, setManualShippingSending] = useState(false);
  const [manualShippingMessage, setManualShippingMessage] = useState("");
  const [supplierDocumentForm, setSupplierDocumentForm] = useState<SupplierDocumentRequestForm | null>(null);
  const [supplierDocumentSending, setSupplierDocumentSending] = useState(false);
  const [supplierDocumentSubmitProgress, setSupplierDocumentSubmitProgress] = useState(0);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailRequestTokenRef = useRef(0);

  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "业务员", "财务"]);
  const canSendShippingDocuments = ["管理员", "业务员"].includes(currentUser.role);
  const canManageTaxRefund = canWritePermission(currentUser, permissions, "taxRefund", ["管理员", "财务"]);
  const canCancelArchive = currentUser.role === "管理员";

  async function loadRows(
    nextPage = page,
    nextKeyword = submittedKeyword,
    nextMode = mode,
    nextStartMonth = declarationStartMonth,
    nextEndMonth = declarationEndMonth,
    nextStatus = statusFilter,
  ) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        mode: nextMode,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStartMonth) params.set("declarationStartMonth", nextStartMonth);
      if (nextEndMonth) params.set("declarationEndMonth", nextEndMonth);
      if (nextStatus) params.set("status", nextStatus);
      const result = await apiJson<TaxRefundResponse>(`/api/tax-refunds?${params}`);
      const nextRows = Array.isArray(result.orders) ? result.orders : [];
      const pagination = result.pagination || {};
      setRows(nextRows);
      setTotal(Number(pagination.total || nextRows.length || 0));
      setPage(Number(pagination.page || nextPage));
      setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
      if (result.error) setError(result.error || "读取资料失败");
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取退税资料失败");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows(1, "");
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setNotice("");
    void (async () => {
      const nextStatus = initialAction === "submitTaxArchive" ? "READY" : statusFilter;
      if (initialAction === "submitTaxArchive") setStatusFilter("READY");
      const nextRows = await loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, nextStatus);
      if (initialAction !== "submitTaxArchive") return;
      const matched = nextRows.find((row) => row.orderNo === value) || nextRows[0];
      if (matched) await loadDetail(matched);
    })();
  }, [initialAction, initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setDetailRow(null);
      setDetailOrderId("");
      setDetail(null);
      setNotice("");
      void loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, statusFilter);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter]);

  useEffect(() => {
    if (!detail || !pendingDetailTarget || detailLoading) return;
    const targetId = taxTargetDomId(pendingDetailTarget);
    const timer = window.setTimeout(() => {
      const target = document.getElementById(targetId);
      if (!target) {
        setPendingDetailTarget("");
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add(styles.taxTargetHighlight);
      window.setTimeout(() => target.classList.remove(styles.taxTargetHighlight), 1500);
      setPendingDetailTarget("");
    }, 120);
    return () => window.clearTimeout(timer);
  }, [detail, detailLoading, pendingDetailTarget]);

  function switchMode(nextMode: TaxRefundMode) {
    setMode(nextMode);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setKeyword("");
    setSubmittedKeyword("");
    setDeclarationStartMonth("");
    setDeclarationEndMonth("");
    setStatusFilter("");
    setNotice("");
    void loadRows(1, "", nextMode, "", "", "");
  }

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, statusFilter);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setDeclarationStartMonth("");
    setDeclarationEndMonth("");
    setStatusFilter("");
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, "", mode, "", "", "");
  }

  function gotoPage(nextPage: number) {
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(nextPage, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter);
  }

  async function fetchDetail(orderId: string) {
    const requestToken = detailRequestTokenRef.current + 1;
    detailRequestTokenRef.current = requestToken;
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await apiJson<TaxRefundDetailResponse>(`/api/tax-refunds/${encodeURIComponent(orderId)}`);
      if (detailRequestTokenRef.current === requestToken) {
        const nextDetail = result.order || null;
        setDetail(nextDetail);
        if (nextDetail) patchRowsForOrder(orderId, nextDetail);
      }
    } catch (loadError) {
      if (detailRequestTokenRef.current === requestToken) {
        setDetailError(loadError instanceof Error ? loadError.message : "读取退税资料详情失败");
      }
    } finally {
      if (detailRequestTokenRef.current === requestToken) {
        setDetailLoading(false);
      }
    }
  }

  async function loadDetail(row: TaxRefundRow) {
    setDetailRow(row);
    setDetailOrderId(row.id);
    setDetail(null);
    await fetchDetail(row.id);
  }

  function patchRowsForOrder(orderId: string, patch: Partial<TaxRefundDetail>) {
    const rowPatch = taxRefundRowPatchFromDetail(patch);
    if (!Object.keys(rowPatch).length) return;
    setRows((current) => current.map((row) => (row.id === orderId ? { ...row, ...rowPatch } : row)));
    setDetailRow((current) => (current?.id === orderId ? { ...current, ...rowPatch } : current));
  }

  function patchDetailForOrder(orderId: string, patch: Partial<TaxRefundDetail>) {
    setDetail((current) => {
      if (!current || current.id !== orderId) return current;
      return {
        ...current,
        ...patch,
        documents: patch.documents || current.documents,
        costs: patch.costs || current.costs,
      };
    });
    patchRowsForOrder(orderId, patch);
  }

  function patchUploadedDocument(orderId: string, document: TaxDocument) {
    if (!document.id) return;
    setDetail((current) => {
      if (!current || current.id !== orderId) return current;
      return {
        ...current,
        documents: upsertTaxDocument(current.documents || [], document),
      };
    });
  }

  function patchCustomsRecognition(orderId: string, result: CustomsRecognitionResult | null | undefined) {
    if (!result) return;
    if (result.order) {
      patchDetailForOrder(orderId, result.order);
      return;
    }
    if (!result.applied) return;
    patchDetailForOrder(orderId, {
      ...(result.customsDeclarationNo !== undefined ? { customsDeclarationNo: result.customsDeclarationNo || "" } : {}),
      ...(result.customsDeclarationDate !== undefined ? {
        customsDeclarationDate: result.customsDeclarationDate || "",
        declarationDate: result.customsDeclarationDate || "",
      } : {}),
      ...(result.customsParseStatus !== undefined ? { customsParseStatusLabel: result.customsParseStatusLabel || result.customsParseStatus || "" } : {}),
      ...(result.customsParseMessage !== undefined ? { customsParseMessage: result.customsParseMessage || "" } : {}),
    });
  }

  async function openMissingTarget(row: TaxRefundRow, targetKey: string) {
    setPendingDetailTarget(targetKey || "tax-detail-top");
    await loadDetail(row);
  }

  function closeDetailDrawer() {
    detailRequestTokenRef.current += 1;
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
    setPendingDetailTarget("");
    setRecognitionStatusByDocument({});
    setCustomsFilePicker(null);
    setManualShippingOrder(null);
    setManualShippingDraft(null);
    setManualShippingForm(null);
    setManualShippingMessage("");
  }

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

  function setDocumentRecognitionStatus(documentId: string, status: string) {
    if (!documentId) return;
    setRecognitionStatusByDocument((current) => ({ ...current, [documentId]: status }));
  }

  function customsRecognitionStatusText(result: CustomsRecognitionResult | null | undefined) {
    if (!result) return "";
    if (result.customsParseStatus === "FAILED") return "未识别成功，请手工填写报关单号和申报日期";
    const missing: string[] = [];
    if (!result.customsDeclarationNo) missing.push("未识别到报关单号");
    if (!result.customsDeclarationDate) missing.push("未识别到申报日期");
    if (missing.length) return missing.join(" / ");
    return "识别成功";
  }

  async function recognizeCustomsDocument(order: TaxRefundDetail, document?: TaxDocument) {
    const recognitionKey = document?.id || order.id;
    setRecognizingDocumentId(recognitionKey);
    setDocumentRecognitionStatus(recognitionKey, "识别中...");
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const response = await apiJson<CustomsRecognitionResponse>(`/api/tax-refund/${encodeURIComponent(order.id)}/recognize-customs-declaration`, {
        method: "POST",
      });
      const result = response.data || response.customsRecognition;
      if (!result) throw new Error(response.message || "报关单识别失败");
      const statusText = customsRecognitionStatusText(result);
      setDocumentRecognitionStatus(result.documentId || recognitionKey, statusText);
      patchCustomsRecognition(order.id, result);
      if (!result.customsDeclarationNo && !result.customsDeclarationDate) {
        setNotice(response.message || result.customsParseMessage || "未识别成功，请手工填写报关单号和申报日期");
        return;
      }
      setDocumentRecognitionStatus(result.documentId || recognitionKey, statusText || "识别成功");
      setNotice(response.message || "报关单信息已自动回填，并同步更新退税资料列表申报日期。");
    } catch (recognizeError) {
      const message = recognizeError instanceof Error ? recognizeError.message : "未识别成功，请手工填写报关单号和申报日期";
      setDocumentRecognitionStatus(recognitionKey, message);
      setDetailError(message);
    } finally {
      setRecognizingDocumentId("");
    }
  }

  async function handleUploadedCustomsRecognition(orderId: string, document: TaxDocument, result: CustomsRecognitionResult | null | undefined) {
    if (!result?.attempted || !document.id) {
      setNotice("上传成功");
      return;
    }
    const statusText = customsRecognitionStatusText(result);
    setDocumentRecognitionStatus(document.id, statusText);
    patchCustomsRecognition(orderId, result);
    setNotice("上传成功");
  }

  function recognizeFromUploadedCustoms(order: TaxRefundDetail) {
    const documents = customsEntryDocuments(order.documents || []);
    if (documents.length === 1) {
      void recognizeCustomsDocument(order, documents[0]);
      return;
    }
    if (documents.length > 1) {
      setCustomsFilePicker({ order, documents });
      return;
    }
    void recognizeCustomsDocument(order);
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
        message: `当前完整度：${completed}/${total || 0}（${percent}%）。归档后，该订单将从当前退税资料、成本管理、物流信息和经营待处理列表中隐藏，但仍可在退税档案和报表中心查询。`,
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
        message: "归档后，该订单将从当前退税资料、成本管理、物流信息和经营待处理列表中隐藏，但仍可在退税档案和报表中心查询。",
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
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify(submitPayload),
      });
      if (result.success !== true) throw new Error(result.message || "提交退税失败");
      if (detailOrderId === row.id) {
        setDetailOrderId("");
        setDetailRow(null);
        setDetail(null);
      }
      await loadRows(page, submittedKeyword, mode);
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
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (result.success !== true) throw new Error(result.message || "退税状态更新失败");
      await loadRows(page, submittedKeyword, mode);
      if (detailOrderId === row.id) await fetchDetail(row.id);
      setNotice(result.message || "退税状态已更新");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "退税状态更新失败");
      await loadRows(page, submittedKeyword, mode);
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
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ cancelArchive: true, status: "NOT_READY" }),
      });
      if (result.success !== true) throw new Error(result.message || "取消归档失败");
      if (detailOrderId === row.id) {
        setDetailOrderId("");
        setDetailRow(null);
        setDetail(null);
      }
      await loadRows(page, submittedKeyword, mode);
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
    setNotice(isCustomsDeclaration ? "识别中..." : "");
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
      if (isCustomsDeclaration && uploadedDocument?.id) {
        await handleUploadedCustomsRecognition(orderId, uploadedDocument, uploadedDocument.customsRecognition || data.customsRecognition || null);
      } else {
        setNotice("上传成功");
      }
      if (detailOrderId === orderId) await fetchDetail(orderId);
    } catch (uploadError) {
      setDetailError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[uploadKey];
        return next;
      });
      setRecognizingDocumentId("");
    }
  }

  async function openSupplierDocumentRequest(order: TaxRefundDetail) {
    setSupplierDocumentForm({
      order,
      suppliers: [],
      supplierId: "",
      requiredDocumentTypes: TAX_FACTORY_UPLOAD_TYPES.map((type) => type.value),
      dueDate: "",
      message: "",
      templateFile: null,
      loadingSuppliers: true,
      error: "",
    });
    try {
      const data = await apiJson<{ suppliers?: SupplierOption[] }>("/api/suppliers/available?type=factory");
      const suppliers = (data.suppliers || []).filter((supplier) => supplier.allowFactoryDocumentUpload);
      setSupplierDocumentForm((current) => current && current.order.id === order.id
        ? {
            ...current,
            suppliers,
            supplierId: current.supplierId || suppliers[0]?.id || "",
            loadingSuppliers: false,
            error: suppliers.length ? "" : "暂无已开启资料回传权限的产品供应商，请先到系统设置开启。",
          }
        : current);
    } catch (loadError) {
      setSupplierDocumentForm((current) => current && current.order.id === order.id
        ? {
            ...current,
            loadingSuppliers: false,
            error: loadError instanceof Error ? loadError.message : "读取产品供应商失败",
          }
        : current);
    }
  }

  async function submitSupplierDocumentRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierDocumentForm) return;
    if (!supplierDocumentForm.supplierId) {
      setSupplierDocumentForm({ ...supplierDocumentForm, error: "请选择产品供应商" });
      return;
    }
    if (!supplierDocumentForm.requiredDocumentTypes.length) {
      setSupplierDocumentForm({ ...supplierDocumentForm, error: "请至少选择一种回传资料" });
      return;
    }
    setSupplierDocumentSending(true);
    setSupplierDocumentSubmitProgress(0);
    setSupplierDocumentForm({ ...supplierDocumentForm, error: "" });
    try {
      const formData = new FormData();
      formData.append("orderId", supplierDocumentForm.order.id);
      formData.append("supplierId", supplierDocumentForm.supplierId);
      formData.append("requiredDocumentTypes", supplierDocumentForm.requiredDocumentTypes.join(","));
      formData.append("dueDate", supplierDocumentForm.dueDate);
      formData.append("message", supplierDocumentForm.message);
      if (supplierDocumentForm.templateFile) {
        formData.append("templateFile", supplierDocumentForm.templateFile);
      }
      const data = await uploadFormDataWithProgress<{ success?: boolean; message?: string; error?: string }>(
        "/api/supplier-document-requests",
        formData,
        setSupplierDocumentSubmitProgress,
      );
      setSupplierDocumentForm(null);
      setNotice(data.message || "已通知供应商回传资料");
      if (detailOrderId === supplierDocumentForm.order.id) await fetchDetail(supplierDocumentForm.order.id);
    } catch (submitError) {
      setSupplierDocumentForm((current) => current
        ? { ...current, error: submitError instanceof Error ? submitError.message : "创建供应商资料回传任务失败" }
        : current);
    } finally {
      setSupplierDocumentSending(false);
      setSupplierDocumentSubmitProgress(0);
    }
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
          nextDetail.customsParseStatusLabel = "";
          nextDetail.customsParseSourceLabel = "";
          nextDetail.customsParseMessage = "";
        }
        return nextDetail;
      });
      setRecognitionStatusByDocument((current) => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      if (document.documentType === "CUSTOMS_ENTRY_FORM") {
        patchRowsForOrder(orderId, {
          customsDeclarationNo: "",
          customsDeclarationDate: "",
          declarationDate: "",
          customsParseStatusLabel: "",
          customsParseSourceLabel: "",
          customsParseMessage: "",
        });
      }
      if (detailOrderId === orderId) await fetchDetail(orderId);
      setNotice(result.message || "已删除文件");
    } catch (deleteError) {
      setDetailError(deleteError instanceof Error ? deleteError.message : "删除失败，请重试");
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function openManualShippingDocuments(order: TaxRefundDetail) {
    setManualShippingOrder(order);
    setManualShippingDraft(null);
    setManualShippingForm(null);
    setManualShippingMessage("");
    setManualShippingLoading(true);
    try {
      const result = await apiJson<{ success?: boolean; message?: string; data?: ManualShippingDraft }>(`/api/tax-refunds/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "prepareManualShippingDocuments" }),
      });
      if (result.success !== true || !result.data) throw new Error(result.message || "读取清关资料发送信息失败");
      const draft = result.data;
      setManualShippingDraft(draft);
      setManualShippingForm({
        recipientEmails: (draft.recipientEmails || []).join("\n"),
        ccEmails: (draft.ccEmails || []).join("\n"),
        emailLanguage: String(draft.language || "EN").toUpperCase(),
        emailSubject: draft.subject || "",
        emailBody: draft.body || "",
      });
    } catch (loadError) {
      setManualShippingMessage(loadError instanceof Error ? loadError.message : "读取清关资料发送信息失败");
    } finally {
      setManualShippingLoading(false);
    }
  }

  function closeManualShippingDocuments() {
    if (manualShippingSending) return;
    setManualShippingOrder(null);
    setManualShippingDraft(null);
    setManualShippingForm(null);
    setManualShippingMessage("");
  }

  function updateManualShippingLanguage(language: string) {
    if (!manualShippingDraft || !manualShippingForm) return;
    setManualShippingForm({
      ...manualShippingForm,
      ...manualShippingTemplate(manualShippingDraft, language),
      emailLanguage: language,
    });
  }

  async function sendManualShippingDocuments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualShippingOrder || !manualShippingDraft || !manualShippingForm) return;
    if ((manualShippingDraft.missingLabels || []).length) {
      const result = await requestConfirmation({
        title: "当前资料不完整，是否仍然发送？",
        message: "清关资料缺失时仍可手动发送，但建议先确认客户是否接受。",
        details: manualShippingDraft.missingLabels || [],
        confirmLabel: "仍然发送",
        cancelLabel: "返回补充资料",
        variant: "warning",
      });
      if (!result.confirmed) return;
    }
    setManualShippingSending(true);
    setManualShippingMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/tax-refunds/${encodeURIComponent(manualShippingOrder.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "sendManualShippingDocuments",
          recipientEmails: manualShippingForm.recipientEmails,
          ccEmails: manualShippingForm.ccEmails,
          emailLanguage: manualShippingForm.emailLanguage,
          emailSubject: manualShippingForm.emailSubject,
          emailBody: manualShippingForm.emailBody,
          confirmIncomplete: true,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "手动发送清关资料失败");
      await fetchDetail(manualShippingOrder.id);
      await loadRows(page, submittedKeyword, mode);
      closeManualShippingDocuments();
      setNotice(result.message || "清关资料发送成功");
    } catch (sendError) {
      setManualShippingMessage(sendError instanceof Error ? sendError.message : "手动发送清关资料失败");
    } finally {
      setManualShippingSending(false);
    }
  }

  return (
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>退税资料</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => {
            setNotice("");
            void loadRows(page);
          }}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.listToolbar}>
        <button
          className={mode === "current" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          onClick={() => switchMode("current")}
          disabled={loading && mode === "current"}
        >
          当前资料
        </button>
        <button
          className={mode === "archive" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          onClick={() => switchMode("archive")}
          disabled={loading && mode === "archive"}
        >
          退税档案
        </button>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 报关单号 / 提单号"
        />
        <input
          type="month"
          value={declarationStartMonth}
          onChange={(event) => setDeclarationStartMonth(event.target.value)}
          title="申报开始月份"
        />
        <input
          type="month"
          value={declarationEndMonth}
          onChange={(event) => setDeclarationEndMonth(event.target.value)}
          title="申报结束月份"
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          {TAX_REFUND_STATUS_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={`${styles.tableWrap} ${styles.taxRefundTableWrap}`}>
        <table className={`${styles.dataTable} ${styles.taxRefundTable}`}>
          <colgroup>
            <col className={styles.taxRefundOrderNoColumn} />
            <col className={styles.taxRefundBlNoColumn} />
            <col className={styles.taxRefundCustomerColumn} />
            <col className={styles.taxRefundDateColumn} />
            <col className={styles.taxRefundCompletenessColumn} />
            <col className={styles.taxRefundStatusColumn} />
            <col className={styles.taxRefundActionColumn} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.taxRefundOrderNoColumn}>订单号</th>
              <th className={styles.taxRefundBlNoColumn}>提单号</th>
              <th className={styles.taxRefundCustomerColumn}>客户简称</th>
              <th className={styles.taxRefundDateColumn}>申报日期</th>
              <th className={styles.taxRefundCompletenessColumn}>总体完整度</th>
              <th className={styles.taxRefundStatusColumn}>退税状态</th>
              <th className={styles.taxRefundActionColumn}>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : rows.length ? rows.map((row) => {
              const rowStatus = taxRowStatus(row);
              return (
                <TaxRefundTableRow
                  key={row.id}
                  row={row}
                  onViewDetail={() => void loadDetail(row)}
                  onSubmitTaxRefund={() => void submitTaxRefund(row)}
                  onCancelArchive={() => void cancelTaxRefundArchive(row)}
                  onUpdateStatus={(status) => void updateTaxRefundStatus(row, status)}
                  canSubmitTaxRefund={canManageTaxRefund && mode === "current" && !row.taxArchived && rowStatus === "READY"}
                  canCancelArchive={canCancelArchive && (mode === "archive" || row.taxArchived || rowStatus === "SUBMITTED")}
                  canUpdateStatus={canManageTaxRefund && mode === "current" && !row.taxArchived && rowStatus !== "SUBMITTED"}
                  submittingTax={submittingTaxId === row.id}
                />
              );
            }) : (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>未找到匹配的退税资料订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={gotoPage} />
      {detailRow ? (
        <TaxRefundDetailDrawer
          row={detailRow}
          detail={detailOrderId === detailRow.id ? detail : null}
          loading={detailOrderId === detailRow.id && detailLoading}
          error={detailOrderId === detailRow.id ? detailError : ""}
          readOnly={mode === "archive" || Boolean(detailRow.taxArchived)}
          packageDownloading={packageDownloadingId === detailRow.id}
          submittingTax={submittingTaxId === detailRow.id}
          cancelingArchive={cancelingArchiveId === detailRow.id}
          uploadingKey={uploadingKey}
          uploadProgressByKey={uploadProgressByKey}
          deletingDocumentId={deletingDocumentId}
          recognizingDocumentId={recognizingDocumentId}
          recognitionStatusByDocument={recognitionStatusByDocument}
          canSendShippingDocuments={canSendShippingDocuments}
          onClose={closeDetailDrawer}
          onDownloadPackage={() => void downloadPackage(detailRow)}
          onSubmitTaxRefund={() => void submitTaxRefund(detailRow)}
          onCancelArchive={() => void cancelTaxRefundArchive(detailRow)}
          onCustomsSaved={async (orderId, order) => {
            if (order) {
              patchDetailForOrder(orderId, order);
            }
            setNotice("报关单信息已保存");
          }}
          onUpload={uploadDocument}
          onDelete={deleteDocument}
          onRecognizeCustomsDocument={recognizeCustomsDocument}
          onRecognizeFromUploadedCustoms={recognizeFromUploadedCustoms}
          onOpenManualShippingDocuments={openManualShippingDocuments}
          canCreateSupplierDocumentRequest={canManageTaxRefund && mode === "current" && !detailRow.taxArchived}
          onOpenSupplierDocumentRequest={openSupplierDocumentRequest}
          onOpenDomesticLogistics={() => {
            const keywordValue = (detail?.orderNo || detailRow?.orderNo || detailRow.id || "").trim();
            if (keywordValue) onOpenDomesticLogistics?.(keywordValue);
          }}
          currentUserRole={currentUser.role}
          canWriteDocuments={canWriteDocuments}
        />
      ) : null}
      {customsFilePicker ? (
        <CustomsFilePickerDialog
          state={customsFilePicker}
          recognizingDocumentId={recognizingDocumentId}
          onClose={() => setCustomsFilePicker(null)}
          onSelect={(order, document) => {
            setCustomsFilePicker(null);
            void recognizeCustomsDocument(order, document);
          }}
        />
      ) : null}
      {manualShippingOrder ? (
        <ManualShippingDocumentsDialog
          order={manualShippingOrder}
          draft={manualShippingDraft}
          form={manualShippingForm}
          loading={manualShippingLoading}
          sending={manualShippingSending}
          message={manualShippingMessage}
          onClose={closeManualShippingDocuments}
          onSubmit={sendManualShippingDocuments}
          onChange={setManualShippingForm}
          onLanguageChange={updateManualShippingLanguage}
        />
      ) : null}
      {supplierDocumentForm ? (
        <SupplierDocumentRequestDialog
          form={supplierDocumentForm}
          sending={supplierDocumentSending}
          submitProgress={supplierDocumentSubmitProgress}
          onClose={() => setSupplierDocumentForm(null)}
          onChange={setSupplierDocumentForm}
          onSubmit={submitSupplierDocumentRequest}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={cancelConfirmation}
          onConfirm={confirmConfirmation}
          onInputChange={updateConfirmationInput}
        />
      ) : null}
    </section>
  );
}
