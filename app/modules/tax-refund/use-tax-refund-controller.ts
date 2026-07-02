import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api";
import { useConfirmationDialog } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../../types";
import { canWritePermission, downloadBlob, PDF_UPLOAD_MAX_SIZE_LABEL, uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
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
} from "./helpers";
import {
  PAGE_SIZE,
  type BusinessEntityOption,
  type CustomsFilePickerState,
  type CustomsRecognitionResponse,
  type CustomsRecognitionResult,
  type ManualShippingDraft,
  type ManualShippingForm,
  type TaxDocument,
  type TaxRefundDetail,
  type TaxRefundDetailResponse,
  type TaxRefundDetailTab,
  type TaxRefundMode,
  type TaxRefundResponse,
  type TaxRefundRow,
  type UploadDocumentResponse,
  type UploadScope,
} from "./model";

export type TaxRefundModuleProps = {
  currentUser: User;
  permissions?: PermissionSnapshot;
  features?: {
    enabled?: boolean;
    companyHsLibraryEnabled?: boolean;
    calculationEnabled?: boolean;
    addCompanyHsFromOcrEnabled?: boolean;
  };
  initialKeyword?: string;
  initialAction?: string;
  initialOpenToken?: number;
  onOpenDomesticLogistics?: (keyword: string) => void;
  onOpenSupplierDocuments?: (keyword: string) => void;
};

export function useTaxRefundController({
  currentUser,
  permissions,
  features,
  initialKeyword = "",
  initialAction = "",
  initialOpenToken = 0,
  onOpenDomesticLogistics,
}: TaxRefundModuleProps) {

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
  const [businessEntityId, setBusinessEntityId] = useState("");
  const [businessEntitySortDirection, setBusinessEntitySortDirection] = useState<"" | "asc" | "desc">("");
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detailRow, setDetailRow] = useState<TaxRefundRow | null>(null);
  const [detail, setDetail] = useState<TaxRefundDetail | null>(null);
  const [pendingDetailTarget, setPendingDetailTarget] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailActiveTab, setDetailActiveTab] = useState<TaxRefundDetailTab>("basic");
  const [detailLoadedSections, setDetailLoadedSections] = useState<Record<TaxRefundDetailTab, boolean>>({
    basic: false,
    calculation: false,
    "export-documents": false,
    "customs-documents": false,
    "factory-documents": false,
    "logistics-documents": false,
  });
  const [detailSectionLoading, setDetailSectionLoading] = useState<Record<TaxRefundDetailTab, boolean>>({
    basic: false,
    calculation: false,
    "export-documents": false,
    "customs-documents": false,
    "factory-documents": false,
    "logistics-documents": false,
  });
  const [detailError, setDetailError] = useState("");
  const [packageDownloadingId, setPackageDownloadingId] = useState("");
  const [submittingTaxId, setSubmittingTaxId] = useState("");
  const [cancelingArchiveId, setCancelingArchiveId] = useState("");
  const [refreshingCompletenessId, setRefreshingCompletenessId] = useState("");
  const [calculatingTaxRefundId, setCalculatingTaxRefundId] = useState("");
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
  const taxRefundCalculationEnabled = !features || (features.enabled !== false && features.calculationEnabled !== false);
  const canCreateCompanyHsFromOcr = currentUser.role === "管理员"
    && (!features || (
      features.enabled !== false
      && features.companyHsLibraryEnabled !== false
      && features.addCompanyHsFromOcrEnabled !== false
    ));

  async function loadRows(
    nextPage = page,
    nextKeyword = submittedKeyword,
    nextMode = mode,
    nextStartMonth = declarationStartMonth,
    nextEndMonth = declarationEndMonth,
    nextStatus = statusFilter,
    nextBusinessEntityId = businessEntityId,
    nextBusinessEntitySortDirection = businessEntitySortDirection,
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
      if (nextBusinessEntityId) params.set("businessEntityId", nextBusinessEntityId);
      if (nextBusinessEntitySortDirection) params.set("businessEntitySortDirection", nextBusinessEntitySortDirection);
      const result = await apiJson<TaxRefundResponse>(`/api/tax-refund/list?${params}`);
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
    void loadBusinessEntities();
  }, []);

  async function loadBusinessEntities() {
    try {
      const result = await apiJson<{ entities?: BusinessEntityOption[] }>("/api/business-entities");
      setBusinessEntities(Array.isArray(result.entities) ? result.entities : []);
    } catch {
      setBusinessEntities([]);
    }
  }

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setNotice("");
    void (async () => {
      const nextStatus = initialAction === "submitTaxArchive" ? "READY" : statusFilter;
      if (initialAction === "submitTaxArchive") setStatusFilter("READY");
      const nextRows = await loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, nextStatus, businessEntityId, businessEntitySortDirection);
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
      void loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId, businessEntitySortDirection);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId, businessEntitySortDirection]);

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
    setBusinessEntityId("");
    setBusinessEntitySortDirection("");
    setNotice("");
    void loadRows(1, "", nextMode, "", "", "", "", "");
  }

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, value, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId, businessEntitySortDirection);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setDeclarationStartMonth("");
    setDeclarationEndMonth("");
    setStatusFilter("");
    setBusinessEntityId("");
    setBusinessEntitySortDirection("");
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, "", mode, "", "", "", "", "");
  }

  function gotoPage(nextPage: number) {
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(nextPage, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId, businessEntitySortDirection);
  }

  function toggleBusinessEntitySort() {
    const nextDirection = businessEntitySortDirection === "asc" ? "desc" : "asc";
    setBusinessEntitySortDirection(nextDirection);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter, businessEntityId, nextDirection);
  }

  function resetDetailSectionState() {
    setDetailLoadedSections({
      basic: false,
      calculation: false,
      "export-documents": false,
      "customs-documents": false,
      "factory-documents": false,
      "logistics-documents": false,
    });
    setDetailSectionLoading({
      basic: false,
      calculation: false,
      "export-documents": false,
      "customs-documents": false,
      "factory-documents": false,
      "logistics-documents": false,
    });
  }

  function detailSectionPath(tab: TaxRefundDetailTab) {
    return tab;
  }

  async function fetchDetailSection(orderId: string, section: TaxRefundDetailTab, options: { replace?: boolean } = {}) {
    const requestToken = detailRequestTokenRef.current;
    setDetailError("");
    setDetailSectionLoading((current) => ({ ...current, [section]: true }));
    if (section === "basic") setDetailLoading(true);
    try {
      const result = await apiJson<TaxRefundDetailResponse>(`/api/tax-refund/${encodeURIComponent(orderId)}/${detailSectionPath(section)}`);
      if (detailRequestTokenRef.current === requestToken) {
        const nextDetail = result.order || null;
        if (nextDetail) {
          if (options.replace) {
            setDetail(nextDetail);
          } else {
            patchDetailForOrder(orderId, nextDetail);
          }
          patchRowsForOrder(orderId, nextDetail);
          setDetailLoadedSections((current) => ({ ...current, [section]: true }));
        }
      }
    } catch (loadError) {
      if (detailRequestTokenRef.current === requestToken) {
        setDetailError(loadError instanceof Error ? loadError.message : "读取退税资料详情失败");
      }
    } finally {
      if (detailRequestTokenRef.current === requestToken) {
        setDetailSectionLoading((current) => ({ ...current, [section]: false }));
        if (section === "basic") setDetailLoading(false);
      }
    }
  }

  async function fetchDetail(orderId: string) {
    await fetchDetailSection(orderId, "basic");
    if (detailActiveTab !== "basic") await fetchDetailSection(orderId, detailActiveTab);
  }

  async function loadDetail(row: TaxRefundRow) {
    detailRequestTokenRef.current += 1;
    setDetailRow(row);
    setDetailOrderId(row.id);
    setDetail({ ...row });
    setDetailActiveTab("basic");
    resetDetailSectionState();
    await fetchDetailSection(row.id, "basic");
  }

  function selectDetailTab(tab: TaxRefundDetailTab) {
    setDetailActiveTab(tab);
    const orderId = detailOrderId || detailRow?.id || "";
    if (!orderId || detailLoadedSections[tab] || detailSectionLoading[tab]) return;
    void fetchDetailSection(orderId, tab);
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
      const mergeById = <T extends { id?: string }>(existing: T[] = [], incoming: T[] = []) => {
        if (!incoming.length) return existing;
        const next = new Map(existing.map((item) => [item.id || Math.random().toString(36), item]));
        incoming.forEach((item) => {
          const key = item.id || Math.random().toString(36);
          const existing = next.get(key) || ({} as T);
          next.set(key, { ...existing, ...item });
        });
        return [...next.values()];
      };
      return {
        ...current,
        ...patch,
        documents: patch.documents ? mergeById(current.documents || [], patch.documents) : current.documents,
        costs: patch.costs ? mergeById(current.costs || [], patch.costs) : current.costs,
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
    setDetailActiveTab("basic");
    resetDetailSectionState();
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

  async function recalculateTaxRefund(row: TaxRefundRow) {
    setCalculatingTaxRefundId(row.id);
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "recalculateTaxRefund" }),
      });
      if (result.success !== true || !result.order) throw new Error(result.message || "退税金额重新计算失败");
      patchDetailForOrder(row.id, result.order);
      setNotice(result.message || "退税金额已重新计算");
    } catch (calcError) {
      const message = calcError instanceof Error ? calcError.message : "退税金额重新计算失败";
      if (detailOrderId === row.id) setDetailError(message);
      else setError(message);
    } finally {
      setCalculatingTaxRefundId("");
    }
  }

  async function saveCustomsDeclarationItems(orderId: string, items: NonNullable<TaxRefundDetail["customsDeclarationItems"]>) {
    setCalculatingTaxRefundId(orderId);
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "confirmCustomsDeclarationItems", items }),
      });
      if (result.success !== true || !result.order) throw new Error(result.message || "报关商品明细保存失败");
      patchDetailForOrder(orderId, result.order);
      setNotice(result.message || "报关商品明细已保存");
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : "报关商品明细保存失败");
    } finally {
      setCalculatingTaxRefundId("");
    }
  }

  async function createCompanyHsFromDeclarationItem(orderId: string, payload: Record<string, unknown>) {
    setCalculatingTaxRefundId(orderId);
    setDetailError("");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "createCompanyHsFromDeclarationItem", ...payload }),
      });
      if (result.success !== true || !result.order) throw new Error(result.message || "新增企业HS编码失败");
      patchDetailForOrder(orderId, result.order);
      setNotice(result.message || "企业HS编码已新增，退税金额已重新计算");
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : "新增企业HS编码失败");
    } finally {
      setCalculatingTaxRefundId("");
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
        try {
          const extractResult = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(orderId)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "extractCustomsDeclarationItems", documentId: uploadedDocument.id }),
          });
          if (extractResult.order) patchDetailForOrder(orderId, extractResult.order);
          setNotice(extractResult.message || "报关商品明细已识别，请确认");
        } catch (extractError) {
          setNotice(extractError instanceof Error ? `上传成功，报关商品明细识别失败：${extractError.message}` : "上传成功，报关商品明细识别失败，请人工录入。");
        }
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

  function selectCustomsFile(order: TaxRefundDetail, document: TaxDocument) {
    setCustomsFilePicker(null);
    void recognizeCustomsDocument(order, document);
  }

  return {
    mode,
    rows,
    total,
    page,
    totalPages,
    loading,
    error,
    notice,
    keyword,
    declarationStartMonth,
    declarationEndMonth,
    statusFilter,
    businessEntityId,
    businessEntitySortDirection,
    businessEntities,
    canManageTaxRefund,
    canCancelArchive,
    taxRefundCalculationEnabled,
    canCreateCompanyHsFromOcr,
    canWriteDocuments,
    canSendShippingDocuments,
    submittingTaxId,
    detailRow,
    detail,
    detailOrderId,
    detailLoading,
    detailActiveTab,
    detailLoadedSections,
    detailSectionLoading,
    detailError,
    packageDownloadingId,
    cancelingArchiveId,
    refreshingCompletenessId,
    calculatingTaxRefundId,
    uploadingKey,
    uploadProgressByKey,
    deletingDocumentId,
    recognizingDocumentId,
    recognitionStatusByDocument,
    customsFilePicker,
    manualShippingOrder,
    manualShippingDraft,
    manualShippingForm,
    manualShippingLoading,
    manualShippingSending,
    manualShippingMessage,
    confirmation,
    readOnly: mode === "archive" || Boolean(detailRow?.taxArchived),
    refreshRows,
    switchMode,
    setKeyword,
    setDeclarationStartMonth,
    setDeclarationEndMonth,
    setStatusFilter,
    setBusinessEntityId,
    toggleBusinessEntitySort,
    submitSearch,
    resetSearch,
    gotoPage,
    loadDetail,
    selectDetailTab,
    submitTaxRefund,
    cancelTaxRefundArchive,
    refreshCompleteness,
    recalculateTaxRefund,
    saveCustomsDeclarationItems,
    createCompanyHsFromDeclarationItem,
    updateTaxRefundStatus,
    closeDetailDrawer,
    downloadPackage,
    handleCustomsSaved,
    uploadDocument,
    deleteDocument,
    recognizeCustomsDocument,
    recognizeFromUploadedCustoms,
    openManualShippingDocuments,
    openDomesticLogisticsFromDetail,
    closeCustomsFilePicker: () => setCustomsFilePicker(null),
    selectCustomsFile,
    closeManualShippingDocuments,
    sendManualShippingDocuments,
    setManualShippingForm,
    updateManualShippingLanguage,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
    currentUserRole: currentUser.role,
  };
}
