"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, PaginationBar, useConfirmationDialog } from "../components";
import { formatDate, formatDateTime } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission, downloadBlob } from "../utils";

type DocumentCompleteness = {
  completed?: number;
  total?: number;
  missingLabels?: string[];
  missing?: string[];
  export?: { missingTypes?: string[] };
  customs?: { missingTypes?: string[] };
  domesticLogistics?: { missing?: unknown[] };
  supplier?: {
    missing?: Array<{
      costId?: string;
      supplierId?: string;
      supplierName?: string;
      documentType?: string;
      missingFactoryCost?: boolean;
    }>;
  };
  logistics?: {
    missing?: Array<{
      costId?: string;
      supplierId?: string;
      supplierName?: string;
      documentType?: string;
      invoiceLabel?: string;
      costType?: string;
      label?: string;
      missingCost?: boolean;
    }>;
  };
};

type TaxRefundRow = {
  id: string;
  orderNo?: string;
  blNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  currency?: string;
  customsDeclarationNo?: string;
  customsDeclarationDate?: string | null;
  customsParseStatusLabel?: string;
  customsParseSourceLabel?: string;
  customsParseMessage?: string;
  declarationDate?: string | null;
  taxRefundStatus?: string;
  taxRefundStatusLabel?: string;
  taxArchived?: boolean;
  taxRefundArchivedByName?: string;
  taxRefundArchivedAt?: string | null;
  taxRefundArchiveRemark?: string;
  taxSubmittedByName?: string;
  taxSubmittedAt?: string | null;
  documentCompleteness?: DocumentCompleteness;
};

type TaxDocument = {
  id: string;
  costId?: string;
  supplierId?: string;
  documentType?: string;
  documentTypeLabel?: string;
  relatedModule?: string;
  supplierName?: string;
  costType?: string;
  fileName?: string;
  fileSize?: number;
  uploadStatus?: string;
  uploadStatusLabel?: string;
  uploadedByName?: string;
  uploadedAt?: string;
};

type TaxCost = {
  id: string;
  supplierId?: string;
  supplierName?: string;
  supplierNameSnapshot?: string;
  vendorName?: string;
  supplierType?: string;
  costType?: string;
  documents?: TaxDocument[];
};

type UploadScope = {
  costId?: string;
  supplierId?: string;
};

type DomesticLogisticsInfo = {
  archiveStatusLabel?: string;
  remarkText?: string;
  exportInvoiceRemark?: string;
  submittedByName?: string;
  submittedAt?: string;
};

type TaxRefundDetail = TaxRefundRow & {
  documents?: TaxDocument[];
  costs?: TaxCost[];
  domesticLogisticsInfo?: DomesticLogisticsInfo | null;
};

type TaxRefundResponse = {
  orders: TaxRefundRow[];
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
};

type TaxRefundDetailResponse = {
  order: TaxRefundDetail;
};

type ShippingDocumentDraftItem = {
  typeKey?: string;
  label?: string;
  emailLabel?: string;
  documentId?: string;
  fileName?: string;
  originalFilename?: string;
  exists?: boolean;
};

type ManualShippingDraft = {
  customerShortName?: string;
  orderNo?: string;
  billOfLadingNo?: string;
  blNo?: string;
  customsDeclarationDate?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  language?: string;
  languageLabel?: string;
  subject?: string;
  body?: string;
  documents?: ShippingDocumentDraftItem[];
  missingLabels?: string[];
  attachmentCount?: number;
  canSendWithIncomplete?: boolean;
  incompleteMessage?: string;
};

type ManualShippingForm = {
  recipientEmails: string;
  ccEmails: string;
  emailLanguage: string;
  emailSubject: string;
  emailBody: string;
};

type TaxRefundMode = "current" | "archive";

const PAGE_SIZE = 20;
const TAX_EXPORT_UPLOAD_TYPES = [
  { value: "BILL_OF_LADING", label: "提单" },
  { value: "COMMERCIAL_INVOICE", label: "商业发票" },
  { value: "PACKING_LIST", label: "装箱单" },
  { value: "EXPORT_INVOICE", label: "出口发票" },
  { value: "SALES_CONTRACT", label: "销售合同" },
];
const TAX_CUSTOMS_UPLOAD_TYPES = [
  { value: "CUSTOMS_ENTRY_FORM", label: "报关单" },
  { value: "RELEASE_NOTICE", label: "放行通知书" },
  { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
];
const TAX_FACTORY_UPLOAD_TYPES = [
  { value: "SUPPLIER_PURCHASE_CONTRACT", label: "工厂采购合同" },
  { value: "SUPPLIER_INVOICE", label: "工厂增值税发票" },
];
const TAX_LOGISTICS_INVOICE_COST_TYPES = ["报关费", "拖车费", "国内物流费", "国内拖车费", "港杂费", "海运费"];
const TAX_REFUND_STATUS_OPTIONS = [
  { value: "", label: "全部退税状态" },
  { value: "NOT_READY", label: "资料不完整" },
  { value: "READY", label: "资料完整待提交" },
  { value: "PROBLEM", label: "资料异常" },
  { value: "SUBMITTED", label: "已提交退税" },
];

export function TaxRefundModule({
  currentUser,
  permissions,
  onOpenDomesticLogistics,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
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
  const [expandedRowId, setExpandedRowId] = useState("");
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
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
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

  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "业务员", "财务", "成本录入员"]);
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
      const pagination = result.pagination || {};
      setRows(Array.isArray(result.orders) ? result.orders : []);
      setTotal(Number(pagination.total || result.orders?.length || 0));
      setPage(Number(pagination.page || nextPage));
      setTotalPages(Math.max(1, Number(pagination.totalPages || 1)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取退税资料失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows(1, "");
  }, []);

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
    setExpandedRowId("");
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
    setExpandedRowId("");
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
    setExpandedRowId("");
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(1, "", mode, "", "", "");
  }

  function gotoPage(nextPage: number) {
    setExpandedRowId("");
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setNotice("");
    void loadRows(nextPage, submittedKeyword, mode, declarationStartMonth, declarationEndMonth, statusFilter);
  }

  async function fetchDetail(orderId: string) {
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await apiJson<TaxRefundDetailResponse>(`/api/tax-refunds/${encodeURIComponent(orderId)}`);
      setDetail(result.order || null);
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "读取退税资料详情失败");
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadDetail(row: TaxRefundRow) {
    setDetailRow(row);
    setDetailOrderId(row.id);
    setDetail(null);
    await fetchDetail(row.id);
  }

  async function openMissingTarget(row: TaxRefundRow, targetKey: string) {
    setPendingDetailTarget(targetKey || "tax-detail-top");
    await loadDetail(row);
  }

  function closeDetailDrawer() {
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setDetailError("");
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
        message: `当前完整度：${completed}/${total || 0}（${percent}%）。归档后，该订单将从当前退税资料、成本管理、国内物流信息和经营待处理列表中隐藏，但仍可在退税档案和报表中心查询。`,
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
        message: "归档后，该订单将从当前退税资料、成本管理、国内物流信息和经营待处理列表中隐藏，但仍可在退税档案和报表中心查询。",
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
    setUploadingKey(uploadKey);
    setDetailError("");
    setError("");
    setNotice("");
    try {
      if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
        throw new Error("只能上传 PDF 文件");
      }
      const formData = new FormData();
      formData.append("orderId", orderId);
      formData.append("documentType", documentType);
      formData.append("uploadSource", "REACT_TAX_REFUND");
      if (scope.costId) formData.append("costId", scope.costId);
      if (scope.supplierId) formData.append("supplierId", scope.supplierId);
      formData.append("file", file);
      const response = await fetch("/api/order-documents", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success !== true) {
        throw new Error(typeof data?.message === "string" ? data.message : "文件上传失败");
      }
      await fetchDetail(orderId);
      await loadRows(page, submittedKeyword, mode);
      setNotice("资料文件已上传");
    } catch (uploadError) {
      setDetailError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
    }
  }

  async function deleteDocument(orderId: string, document: TaxDocument) {
    const result = await requestConfirmation({
      title: "确认删除文件？",
      message: "删除后该文件不会参与退税资料完整度统计。",
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
      if (result.success !== true) throw new Error(result.message || "删除文件失败");
      await fetchDetail(orderId);
      await loadRows(page, submittedKeyword, mode);
      setNotice(result.message || "资料文件已删除");
    } catch (deleteError) {
      setDetailError(deleteError instanceof Error ? deleteError.message : "删除文件失败");
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
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>业务模块</span>
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
          placeholder="搜索订单号 / 提单号 / 客户 / 供应商"
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

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户简称</th>
              <th>申报日期</th>
              <th>总体完整度</th>
              <th>退税状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : rows.length ? rows.map((row) => {
              const rowStatus = taxRowStatus(row);
              return (
                <TaxRefundTableRow
                  key={row.id}
                  row={row}
                  expanded={expandedRowId === row.id}
                  packageDownloading={packageDownloadingId === row.id}
                  onToggle={() => setExpandedRowId((current) => (current === row.id ? "" : row.id))}
                  onViewDetail={() => void loadDetail(row)}
                  onDownloadPackage={() => void downloadPackage(row)}
                  onSubmitTaxRefund={() => void submitTaxRefund(row)}
                  onCancelArchive={() => void cancelTaxRefundArchive(row)}
                  onUpdateStatus={(status) => void updateTaxRefundStatus(row, status)}
                  onOpenMissingTarget={(label) => void openMissingTarget(row, label)}
                  canSubmitTaxRefund={canManageTaxRefund && mode === "current" && !row.taxArchived && rowStatus === "READY"}
                  canCancelArchive={canCancelArchive && (mode === "archive" || row.taxArchived || rowStatus === "SUBMITTED")}
                  canUpdateStatus={canManageTaxRefund && mode === "current" && !row.taxArchived && rowStatus !== "SUBMITTED"}
                  submittingTax={submittingTaxId === row.id}
                  cancelingArchive={cancelingArchiveId === row.id}
                />
              );
            }) : (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>未找到匹配的退税资料订单</div></td>
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
          deletingDocumentId={deletingDocumentId}
          canSendShippingDocuments={canSendShippingDocuments}
          onClose={closeDetailDrawer}
          onDownloadPackage={() => void downloadPackage(detailRow)}
          onSubmitTaxRefund={() => void submitTaxRefund(detailRow)}
          onCancelArchive={() => void cancelTaxRefundArchive(detailRow)}
          onCustomsSaved={async (orderId) => {
            await fetchDetail(orderId);
            await loadRows(page, submittedKeyword, mode);
            setNotice("报关单信息已保存");
          }}
          onUpload={uploadDocument}
          onDelete={deleteDocument}
          onOpenManualShippingDocuments={openManualShippingDocuments}
          onOpenDomesticLogistics={() => {
            const keywordValue = (detail?.orderNo || detailRow?.orderNo || detailRow.id || "").trim();
            if (keywordValue) onOpenDomesticLogistics?.(keywordValue);
          }}
          currentUserRole={currentUser.role}
          canWriteDocuments={canWriteDocuments}
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

function TaxRefundTableRow({
  row,
  expanded,
  packageDownloading,
  onToggle,
  onViewDetail,
  onDownloadPackage,
  onSubmitTaxRefund,
  onCancelArchive,
  onUpdateStatus,
  onOpenMissingTarget,
  canSubmitTaxRefund,
  canCancelArchive,
  canUpdateStatus,
  submittingTax,
  cancelingArchive,
}: {
  row: TaxRefundRow;
  expanded: boolean;
  packageDownloading: boolean;
  onToggle: () => void;
  onViewDetail: () => void;
  onDownloadPackage: () => void;
  onSubmitTaxRefund: () => void;
  onCancelArchive: () => void;
  onUpdateStatus: (status: string) => void;
  onOpenMissingTarget: (label: string) => void;
  canSubmitTaxRefund: boolean;
  canCancelArchive: boolean;
  canUpdateStatus: boolean;
  submittingTax: boolean;
  cancelingArchive: boolean;
}) {
  const completeness = row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const declarationDate = formatDate(row.customsDeclarationDate || row.declarationDate);
  const missingTargets = taxMissingTargets(completeness);
  const missingLabels = missingTargets.map((target) => target.label);
  const currentStatus = taxRowStatus(row);
  const canDownloadPackage = taxRefundHasPackageContent(row);

  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{row.orderNo || "-"}</strong></td>
        <td title={row.customerFullName || row.customerName || ""}>{row.customerShortName || row.customerName || "-"}</td>
        <td>{declarationDate}</td>
        <td><span className={`${styles.statusPill} ${completenessClass(percent)}`}>{percent}%</span></td>
        <td onClick={(event) => event.stopPropagation()}>
          {canUpdateStatus ? (
            <select
              value={currentStatus}
              onChange={(event) => onUpdateStatus(event.target.value)}
              disabled={submittingTax}
            >
              {TAX_REFUND_STATUS_OPTIONS.filter((option) => option.value).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : (
            <span className={`${styles.statusPill} ${statusClass(currentStatus)}`}>{row.taxRefundStatusLabel || taxStatusLabel(currentStatus)}</span>
          )}
        </td>
        <td>
          <button
            className={styles.rowDetailButton}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {expanded ? "收起" : "详情"}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={6}>
            <div className={`${styles.detailCard} ${styles.taxDropdownMenu}`}>
              <div className={styles.taxDropdownActions}>
                <button className={styles.primaryButtonCompact} type="button" onClick={onViewDetail}>
                  查看资料
                </button>
                <button className={styles.secondaryButton} type="button" disabled={packageDownloading || !canDownloadPackage} onClick={onDownloadPackage}>
                  {packageDownloading ? "下载中..." : "下载资料包"}
                </button>
                {canSubmitTaxRefund ? (
                  <button className={styles.primaryButtonCompact} type="button" disabled={submittingTax} onClick={onSubmitTaxRefund}>
                    {submittingTax ? "提交中..." : "提交退税"}
                  </button>
                ) : null}
                {canCancelArchive ? (
                  <button className={styles.secondaryButton} type="button" disabled={cancelingArchive} onClick={onCancelArchive}>
                    {cancelingArchive ? "处理中..." : "取消归档"}
                  </button>
                ) : null}
              </div>
              <div className={styles.taxDropdownGrid}>
                <div>
                  <strong>退税资料菜单</strong>
                  <div className={styles.taxDropdownMeta}>
                    <span>订单号：{row.orderNo || "-"}</span>
                    <span>提单号：{row.blNo || "-"}</span>
                    <span>申报日期：{declarationDate}</span>
                  </div>
                </div>
                <div className={styles.taxDropdownSummary}>
                  <span className={`${styles.statusPill} ${missingLabels.length ? styles.statusWarning : styles.statusSuccess}`}>
                    {missingLabels.length ? `${missingLabels.length} 项待处理` : "资料已完整"}
                  </span>
                </div>
              </div>
              {missingLabels.length ? (
                <div className={styles.taxDropdownMissing}>
                  <span>缺失资料</span>
                  <div className={styles.missingChipList}>
                    {missingTargets.map((target) => (
                      <button
                        key={`${target.targetKey}:${target.label}`}
                        className={styles.missingChipButton}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenMissingTarget(target.targetKey);
                        }}
                      >
                        {target.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TaxRefundDetailDrawer({
  row,
  detail,
  loading,
  error,
  readOnly,
  packageDownloading,
  submittingTax,
  cancelingArchive,
  uploadingKey,
  deletingDocumentId,
  canSendShippingDocuments,
  onClose,
  onDownloadPackage,
  onSubmitTaxRefund,
  onCancelArchive,
  onCustomsSaved,
  onUpload,
  onDelete,
  onOpenManualShippingDocuments,
  onOpenDomesticLogistics,
  currentUserRole,
  canWriteDocuments,
}: {
  row: TaxRefundRow;
  detail: TaxRefundDetail | null;
  loading: boolean;
  error: string;
  readOnly: boolean;
  packageDownloading: boolean;
  submittingTax: boolean;
  cancelingArchive: boolean;
  uploadingKey: string;
  deletingDocumentId: string;
  canSendShippingDocuments: boolean;
  onClose: () => void;
  onDownloadPackage: () => void;
  onSubmitTaxRefund: () => void;
  onCancelArchive: () => void;
  onCustomsSaved: (orderId: string) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onOpenManualShippingDocuments: (order: TaxRefundDetail) => void;
  onOpenDomesticLogistics?: () => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
}) {
  const displayCustomer = row.customerFullName || row.customerName || row.customerShortName || "-";

  return (
    <div className={styles.drawerOverlay} role="dialog" aria-modal="true" aria-label="退税资料详情">
      <aside className={styles.taxRefundDrawer}>
        <header className={styles.taxRefundDrawerHeader}>
          <div className={styles.taxRefundDrawerTitle}>
            <span>退税资料详情</span>
            <strong>{row.orderNo || "-"} · {displayCustomer}</strong>
            <small>提单号：{row.blNo || "-"}</small>
          </div>
          <div className={styles.taxRefundDrawerActions}>
            <button className={styles.secondaryButton} type="button" disabled={packageDownloading} onClick={onDownloadPackage}>
              {packageDownloading ? "下载中..." : "下载资料包"}
            </button>
            {readOnly ? (
              <button className={styles.secondaryButton} type="button" disabled={cancelingArchive} onClick={onCancelArchive}>
                {cancelingArchive ? "处理中..." : "取消归档"}
              </button>
            ) : (
              <button className={styles.secondaryButton} type="button" disabled={submittingTax} onClick={onSubmitTaxRefund}>
                {submittingTax ? "提交中..." : "提交退税并归档"}
              </button>
            )}
            <button className={styles.ghostButton} type="button" onClick={onClose}>关闭</button>
          </div>
        </header>
        <div className={styles.taxRefundDrawerBody}>
          <TaxRefundDetailPanel
            detail={detail}
            loading={loading}
            error={error}
            fallback={row}
            uploadingKey={uploadingKey}
            deletingDocumentId={deletingDocumentId}
            readOnly={readOnly}
            onCustomsSaved={onCustomsSaved}
            onUpload={onUpload}
            onDelete={onDelete}
            canSendShippingDocuments={canSendShippingDocuments}
            onOpenManualShippingDocuments={onOpenManualShippingDocuments}
            onOpenDomesticLogistics={onOpenDomesticLogistics}
            currentUserRole={currentUserRole}
            canWriteDocuments={canWriteDocuments}
          />
        </div>
      </aside>
    </div>
  );
}

function TaxRefundDetailPanel({
  detail,
  loading,
  error,
  fallback,
  uploadingKey,
  deletingDocumentId,
  readOnly,
  onCustomsSaved,
  onUpload,
  onDelete,
  canSendShippingDocuments,
  onOpenManualShippingDocuments,
  onOpenDomesticLogistics,
  currentUserRole,
  canWriteDocuments,
}: {
  detail: TaxRefundDetail | null;
  loading: boolean;
  error: string;
  fallback: TaxRefundRow;
  uploadingKey: string;
  deletingDocumentId: string;
  readOnly: boolean;
  onCustomsSaved: (orderId: string) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  canSendShippingDocuments: boolean;
  onOpenManualShippingDocuments: (order: TaxRefundDetail) => void;
  onOpenDomesticLogistics?: () => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
}) {
  if (loading) return <div className={styles.emptyState}>资料详情加载中...</div>;
  if (error) return <div className={styles.inlineError}>{error}</div>;
  if (!detail) return <div className={styles.emptyState}>点击查看资料后加载详情</div>;

  const groups = groupDocuments(detail.documents || []);
  const domesticRemark = detail.domesticLogisticsInfo?.exportInvoiceRemark || detail.domesticLogisticsInfo?.remarkText || "";
  const factoryCosts = factorySupplierCosts(detail.costs || []);
  const showTaxArchiveRecord = Boolean(
    detail.taxRefundStatus === "SUBMITTED"
    || fallback.taxRefundStatus === "SUBMITTED"
    || detail.taxArchived
    || fallback.taxArchived,
  );

  return (
    <div className={styles.taxDetailPanel} id={taxTargetDomId("tax-detail-top")}>
      <div className={styles.documentGroupGrid}>
        {showTaxArchiveRecord ? (
          <div className={styles.documentGroupCard}>
            <strong>提交记录</strong>
            <div className={styles.detailGrid}>
              <DetailField label="提交人" value={detail.taxSubmittedByName || fallback.taxSubmittedByName || "-"} />
              <DetailField label="提交时间" value={formatDateTime(detail.taxSubmittedAt || fallback.taxSubmittedAt)} />
              <DetailField label="归档人" value={detail.taxRefundArchivedByName || fallback.taxRefundArchivedByName || "-"} />
              <DetailField label="归档时间" value={formatDateTime(detail.taxRefundArchivedAt || fallback.taxRefundArchivedAt)} />
              {(detail.taxRefundArchiveRemark || fallback.taxRefundArchiveRemark) ? (
                <DetailField label="备注" value={detail.taxRefundArchiveRemark || fallback.taxRefundArchiveRemark || "-"} wide />
              ) : null}
            </div>
          </div>
        ) : null}
        <div className={styles.documentGroupCard}>
          <strong>基础信息</strong>
          <div className={styles.detailGrid}>
            <DetailField label="客户全称" value={detail.customerFullName || detail.customerName || fallback.customerFullName || fallback.customerName || "-"} wide />
            <DetailField label="订单号" value={detail.orderNo || fallback.orderNo || "-"} />
            <DetailField label="提单号" value={detail.blNo || fallback.blNo || "-"} />
            <DetailField label="币种" value={detail.currency || fallback.currency || "-"} />
            <DetailField label="申报日期" value={formatDate(detail.customsDeclarationDate || detail.declarationDate || fallback.customsDeclarationDate || fallback.declarationDate)} />
            <DetailField label="国内物流信息" value={detail.domesticLogisticsInfo?.archiveStatusLabel || (domesticRemark ? "已提交" : "未提交")} />
          </div>
        </div>
        <div className={styles.documentGroupCard} id={taxTargetDomId("domestic-logistics")}>
          <strong>出口发票备注</strong>
          <div className={styles.exportInvoiceRemarkText}>
            {domesticRemark || "暂无出口发票备注，请前往国内物流信息维护。"}
          </div>
          {onOpenDomesticLogistics ? (
            <button className={styles.secondaryButton} type="button" onClick={onOpenDomesticLogistics}>
              去维护国内物流信息
            </button>
          ) : null}
        </div>
        {canSendShippingDocuments ? (
          <div className={styles.documentGroupCard}>
            <strong>清关资料发送</strong>
            <span className={styles.mutedText}>向客户发送商业发票、装箱单和报关单。发送前可临时调整收件邮箱、抄送、语言、标题和正文。</span>
            <button className={styles.secondaryButton} type="button" onClick={() => onOpenManualShippingDocuments(detail)}>
              手动发送清关资料
            </button>
          </div>
        ) : null}
        <CustomsRecognitionForm detail={detail} readOnly={readOnly} onSaved={onCustomsSaved} />
        <div className={styles.documentGroupCard}>
          <strong>出口资料上传</strong>
          {TAX_EXPORT_UPLOAD_TYPES.map((documentType) => (
            <TaxUploadItem
              key={documentType.value}
              targetKey={taxDocumentTargetKey(documentType.value)}
              orderId={detail.id}
              type={documentType.value}
              label={documentType.label}
              documents={(detail.documents || []).filter((document) => document.documentType === documentType.value && document.uploadStatus === "SUCCESS")}
              uploading={uploadingKey === `${detail.id}:${documentType.value}`}
              deletingDocumentId={deletingDocumentId}
              canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, documentType.value, readOnly)}
              canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          ))}
        </div>
        <div className={styles.documentGroupCard}>
          <strong>报关资料上传</strong>
          {TAX_CUSTOMS_UPLOAD_TYPES.map((documentType) => (
            <TaxUploadItem
              key={documentType.value}
              targetKey={taxDocumentTargetKey(documentType.value)}
              orderId={detail.id}
              type={documentType.value}
              label={documentType.label}
              documents={(detail.documents || []).filter((document) => document.documentType === documentType.value && document.uploadStatus === "SUCCESS")}
              uploading={uploadingKey === `${detail.id}:${documentType.value}`}
              deletingDocumentId={deletingDocumentId}
              canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, documentType.value, readOnly)}
              canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          ))}
        </div>
        <div className={styles.documentGroupCard} id={taxTargetDomId("factory-section")}>
          <strong>工厂资料上传</strong>
          {factoryCosts.length ? factoryCosts.map((cost) => (
            <FactoryCostUploadGroup
              key={cost.id}
              orderId={detail.id}
              cost={cost}
              documents={detail.documents || []}
              uploadingKey={uploadingKey}
              deletingDocumentId={deletingDocumentId}
              currentUserRole={currentUserRole}
              canWriteDocuments={canWriteDocuments}
              readOnly={readOnly}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          )) : <span className={styles.mutedText}>暂未录入工厂供应商成本</span>}
        </div>
        <div className={styles.documentGroupCard} id={taxTargetDomId("logistics-section")}>
          <strong>物流资料上传</strong>
          {logisticsInvoiceCosts(detail.costs || []).length ? logisticsInvoiceCosts(detail.costs || []).map((cost) => (
            <LogisticsInvoiceUploadItem
              key={cost.id}
              orderId={detail.id}
              cost={cost}
              documents={detail.documents || []}
              uploadingKey={uploadingKey}
              deletingDocumentId={deletingDocumentId}
              currentUserRole={currentUserRole}
              canWriteDocuments={canWriteDocuments}
              readOnly={readOnly}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          )) : <span className={styles.mutedText}>暂未录入需要发票的物流费用</span>}
        </div>
        {Object.entries(groups).filter(([groupName]) => !["出口资料", "报关资料", "工厂资料", "物流资料"].includes(groupName)).map(([groupName, documents]) => (
          <div className={styles.documentGroupCard} key={groupName}>
            <strong>{groupName}</strong>
            {documents.length ? documents.map((document) => (
              <div className={styles.fileListItem} key={document.id}>
                <div>
                  <span>{document.documentTypeLabel || document.documentType || "资料"}</span>
                  <small>{document.fileName || "-"} ｜ {document.uploadedByName || "-"} ｜ {formatDate(document.uploadedAt)}</small>
                </div>
                <div>
                  <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/preview`} target="_blank" rel="noreferrer">预览</a>
                  <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
                </div>
              </div>
            )) : <span className={styles.mutedText}>暂未上传</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualShippingDocumentsDialog({
  order,
  draft,
  form,
  loading,
  sending,
  message,
  onClose,
  onSubmit,
  onChange,
  onLanguageChange,
}: {
  order: TaxRefundDetail;
  draft: ManualShippingDraft | null;
  form: ManualShippingForm | null;
  loading: boolean;
  sending: boolean;
  message: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (form: ManualShippingForm) => void;
  onLanguageChange: (language: string) => void;
}) {
  function setField<K extends keyof ManualShippingForm>(key: K, value: ManualShippingForm[K]) {
    if (!form) return;
    onChange({ ...form, [key]: value });
  }

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="手动发送清关资料">
      <div className={styles.shippingDocsDialog}>
        <div className={styles.modalHeader}>
          <div>
            <strong>手动发送清关资料</strong>
            <span>{order.orderNo || "-"} · {order.customerFullName || order.customerName || "-"}</span>
          </div>
          <button className={styles.ghostButton} type="button" onClick={onClose} disabled={sending}>关闭</button>
        </div>

        {loading ? (
          <div className={styles.emptyState}>正在生成清关资料邮件...</div>
        ) : form && draft ? (
          <form className={styles.shippingDocsForm} onSubmit={onSubmit}>
            {message ? <div className={styles.inlineError}>{message}</div> : null}
            <div className={styles.documentGroupCard}>
              <strong>将发送的资料清单</strong>
              <div className={styles.shippingDocsList}>
                {(draft.documents || []).map((item) => (
                  <span key={item.typeKey || item.label} className={item.exists ? styles.shippingDocReady : styles.shippingDocMissing}>
                    {item.exists ? "✓" : "!"} {item.label || item.emailLabel || "-"}
                    {item.fileName ? ` · ${item.fileName}` : ""}
                  </span>
                ))}
              </div>
              {(draft.missingLabels || []).length ? (
                <small className={styles.mutedText}>当前资料不完整，缺少：{(draft.missingLabels || []).join("、")}。发送前会再次确认。</small>
              ) : null}
            </div>

            <div className={styles.shippingDocsFormGrid}>
              <label>
                收件邮箱
                <textarea
                  value={form.recipientEmails}
                  onChange={(event) => setField("recipientEmails", event.target.value)}
                  rows={3}
                  required
                />
              </label>
              <label>
                抄送邮箱
                <textarea
                  value={form.ccEmails}
                  onChange={(event) => setField("ccEmails", event.target.value)}
                  rows={3}
                />
              </label>
              <label>
                邮件语言
                <select value={form.emailLanguage} onChange={(event) => onLanguageChange(event.target.value)}>
                  <option value="EN">English</option>
                  <option value="RU">Русский</option>
                </select>
              </label>
              <label className={styles.shippingDocsWideField}>
                邮件标题
                <input value={form.emailSubject} onChange={(event) => setField("emailSubject", event.target.value)} required />
              </label>
              <label className={styles.shippingDocsWideField}>
                邮件正文
                <textarea value={form.emailBody} onChange={(event) => setField("emailBody", event.target.value)} rows={9} required />
              </label>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={sending}>取消</button>
              <button className={styles.primaryButtonCompact} type="submit" disabled={sending}>
                {sending ? "发送中..." : "发送清关资料"}
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.inlineError}>{message || "清关资料发送信息生成失败"}</div>
        )}
      </div>
    </div>
  );
}

function TaxUploadItem({
  targetKey,
  orderId,
  type,
  label,
  documents,
  uploading,
  deletingDocumentId,
  scope,
  canUpload,
  canDelete,
  onUpload,
  onDelete,
}: {
  targetKey?: string;
  orderId: string;
  type: string;
  label: string;
  documents: TaxDocument[];
  uploading: boolean;
  deletingDocumentId: string;
  scope?: UploadScope;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  return (
    <div className={styles.fileListItem} id={targetKey ? taxTargetDomId(targetKey) : undefined}>
      <div>
        <span>{label}</span>
        <small>{documents.length ? `已上传 ${documents.length} 个文件` : "暂未上传"}</small>
        {documents.map((document) => (
          <small key={document.id}>
            {document.fileName || "-"} ｜ {document.uploadedByName || "-"} ｜ {formatDate(document.uploadedAt)}
          </small>
        ))}
      </div>
      <div>
        {canUpload ? (
          <label className={styles.secondaryButton}>
            {uploading ? "上传中..." : "选择PDF"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={uploading}
              hidden
              onChange={(event) => {
                onUpload(orderId, type, event.target.files?.[0] || null, scope);
                event.currentTarget.value = "";
              }}
            />
          </label>
        ) : (
          <button className={styles.secondaryButton} type="button" disabled title="无权限操作">
            无权限操作
          </button>
        )}
        {documents.map((document) => (
          <span key={document.id} className={styles.fileListItemActions}>
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/preview`} target="_blank" rel="noreferrer">预览</a>
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
            {canDelete ? (
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={deletingDocumentId === document.id}
                onClick={() => onDelete(orderId, document)}
              >
                {deletingDocumentId === document.id ? "删除中..." : "删除"}
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function CustomsRecognitionForm({
  detail,
  readOnly,
  onSaved,
}: {
  detail: TaxRefundDetail;
  readOnly: boolean;
  onSaved: (orderId: string) => Promise<void>;
}) {
  const [customsDeclarationNo, setCustomsDeclarationNo] = useState(detail.customsDeclarationNo || "");
  const [customsDeclarationDate, setCustomsDeclarationDate] = useState(detail.customsDeclarationDate || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setCustomsDeclarationNo(detail.customsDeclarationNo || "");
    setCustomsDeclarationDate(detail.customsDeclarationDate || "");
    setMessage("");
  }, [detail.id, detail.customsDeclarationNo, detail.customsDeclarationDate]);

  async function saveCustomsRecognition() {
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/tax-refunds/${encodeURIComponent(detail.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "updateCustomsRecognition",
          customsDeclarationNo: customsDeclarationNo.trim(),
          customsDeclarationDate,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "报关单信息保存失败");
      setMessage(result.message || "报关单信息已保存");
      await onSaved(detail.id);
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "报关单信息保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.customsFormCard}>
      <div className={styles.customsFormHeader}>
        <div>
          <strong>报关单信息</strong>
          <span>请手工填写报关单关键信息。</span>
        </div>
        <span className={styles.statusPill}>手工维护</span>
      </div>
      <div className={styles.customsFormGrid}>
        <label>
          <span>报关单号</span>
          <input
            value={customsDeclarationNo}
            disabled={readOnly || saving}
            onChange={(event) => setCustomsDeclarationNo(event.target.value)}
            placeholder="请输入报关单号"
          />
        </label>
        <label>
          <span>申报日期</span>
          <input
            type="date"
            value={customsDeclarationDate}
            disabled={readOnly || saving}
            onChange={(event) => setCustomsDeclarationDate(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.customsFormActions}>
        {message ? <span>{message}</span> : <span>保存后将同步更新退税资料列表的申报日期。</span>}
        {readOnly ? null : (
          <button className={styles.primaryButtonCompact} type="button" disabled={saving} onClick={saveCustomsRecognition}>
            {saving ? "保存中..." : "保存报关单信息"}
          </button>
        )}
      </div>
    </div>
  );
}

function FactoryCostUploadGroup({
  orderId,
  cost,
  documents,
  uploadingKey,
  deletingDocumentId,
  currentUserRole,
  canWriteDocuments,
  readOnly,
  onUpload,
  onDelete,
}: {
  orderId: string;
  cost: TaxCost;
  documents: TaxDocument[];
  uploadingKey: string;
  deletingDocumentId: string;
  currentUserRole: string;
  canWriteDocuments: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商";
  const scope = { costId: cost.id, supplierId: cost.supplierId || "" };
  return (
    <div className={styles.documentGroupCard}>
      <strong>{supplierName}</strong>
      <span className={styles.mutedText}>{cost.costType || "工厂成本"}</span>
      {TAX_FACTORY_UPLOAD_TYPES.map((documentType) => (
        <TaxUploadItem
          key={`${cost.id}-${documentType.value}`}
          targetKey={factoryDocumentTargetKey(cost.id, documentType.value)}
          orderId={orderId}
          type={documentType.value}
          label={documentType.label}
          documents={documents.filter((document) => (
            document.documentType === documentType.value
            && document.uploadStatus === "SUCCESS"
            && document.costId === cost.id
          ))}
          uploading={uploadingKey === uploadScopeKey(orderId, documentType.value, scope)}
          deletingDocumentId={deletingDocumentId}
          scope={scope}
          canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, documentType.value, readOnly)}
          canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
          onUpload={onUpload}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function LogisticsInvoiceUploadItem({
  orderId,
  cost,
  documents,
  uploadingKey,
  deletingDocumentId,
  currentUserRole,
  canWriteDocuments,
  readOnly,
  onUpload,
  onDelete,
}: {
  orderId: string;
  cost: TaxCost;
  documents: TaxDocument[];
  uploadingKey: string;
  deletingDocumentId: string;
  currentUserRole: string;
  canWriteDocuments: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商";
  const scope = { costId: cost.id, supplierId: cost.supplierId || "" };
  return (
    <TaxUploadItem
      targetKey={logisticsDocumentTargetKey(cost.id)}
      orderId={orderId}
      type="SUPPLIER_INVOICE"
      label={`${logisticsInvoiceLabel(cost)} / ${supplierName}`}
      documents={documents.filter((document) => (
        document.documentType === "SUPPLIER_INVOICE"
        && document.uploadStatus === "SUCCESS"
        && document.costId === cost.id
      ))}
      uploading={uploadingKey === uploadScopeKey(orderId, "SUPPLIER_INVOICE", scope)}
      deletingDocumentId={deletingDocumentId}
      scope={scope}
      canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, "SUPPLIER_INVOICE", readOnly)}
      canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
      onUpload={onUpload}
      onDelete={onDelete}
    />
  );
}

function normalizedMissingLabels(completeness: DocumentCompleteness) {
  const labels = completeness.missingLabels || completeness.missing || [];
  return labels.map((label) => String(label || "").trim()).filter(Boolean);
}

function taxMissingTargets(completeness: DocumentCompleteness) {
  const targets: Array<{ label: string; targetKey: string }> = [];
  const pushTarget = (label: string, targetKey: string) => {
    const normalizedLabel = String(label || "").trim();
    if (!normalizedLabel) return;
    const key = `${targetKey}:${normalizedLabel}`;
    if (targets.some((target) => `${target.targetKey}:${target.label}` === key)) return;
    targets.push({ label: normalizedLabel, targetKey });
  };

  (completeness.export?.missingTypes || []).forEach((documentType) => {
    pushTarget(taxDocumentTypeLabel(documentType), taxDocumentTargetKey(documentType));
  });
  (completeness.customs?.missingTypes || []).forEach((documentType) => {
    pushTarget(taxDocumentTypeLabel(documentType), taxDocumentTargetKey(documentType));
  });
  (completeness.domesticLogistics?.missing || []).forEach(() => {
    pushTarget("国内物流信息", "domestic-logistics");
  });
  (completeness.supplier?.missing || []).forEach((item) => {
    if (item.missingFactoryCost) {
      pushTarget("缺少工厂供应商成本记录", "factory-section");
      return;
    }
    const documentLabel = taxSupplierDocumentLabel(item.documentType || "");
    pushTarget(item.supplierName ? `${item.supplierName}${documentLabel}` : documentLabel, "factory-section");
  });
  (completeness.logistics?.missing || []).forEach((item) => {
    if (item.missingCost) {
      pushTarget(item.label || item.invoiceLabel || "未录入物流费用", "logistics-section");
      return;
    }
    const targetKey = item.costId ? logisticsDocumentTargetKey(item.costId) : "logistics-section";
    pushTarget(item.invoiceLabel || item.label || logisticsDocumentLabel(item.documentType || "", item.costType || ""), targetKey);
  });

  if (!targets.length) {
    normalizedMissingLabels(completeness).forEach((label) => {
      pushTarget(label, taxTargetKeyFromMissingLabel(label));
    });
  }
  return targets;
}

function taxRowStatus(row: TaxRefundRow) {
  if (row.taxRefundStatus) return row.taxRefundStatus;
  const completeness = row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  return total > 0 && completed >= total ? "READY" : "NOT_READY";
}

function taxDocumentTargetKey(documentType: string) {
  return `tax-document-${documentType}`;
}

function taxDocumentTypeLabel(documentType: string) {
  return [...TAX_EXPORT_UPLOAD_TYPES, ...TAX_CUSTOMS_UPLOAD_TYPES].find((type) => type.value === documentType)?.label
    || documentType
    || "资料";
}

function taxSupplierDocumentLabel(documentType: string) {
  return TAX_FACTORY_UPLOAD_TYPES.find((type) => type.value === documentType)?.label
    || (documentType === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂采购合同" : "")
    || (documentType === "SUPPLIER_INVOICE" ? "工厂增值税发票" : "")
    || "工厂资料";
}

function logisticsDocumentLabel(documentType: string, costType: string) {
  if (documentType === "SUPPLIER_INVOICE") return logisticsInvoiceLabel({ costType });
  return documentType || "物流资料";
}

function taxTargetKeyFromMissingLabel(label: string) {
  const text = String(label || "").trim();
  const documentLabelMap: Array<[string, string]> = [
    ["提单", "BILL_OF_LADING"],
    ["商业发票", "COMMERCIAL_INVOICE"],
    ["装箱单", "PACKING_LIST"],
    ["箱单", "PACKING_LIST"],
    ["出口发票", "EXPORT_INVOICE"],
    ["销售合同", "SALES_CONTRACT"],
    ["报关单", "CUSTOMS_ENTRY_FORM"],
    ["货物报关单", "CUSTOMS_ENTRY_FORM"],
    ["放行通知书", "RELEASE_NOTICE"],
    ["报关委托书", "CUSTOMS_POWER_OF_ATTORNEY"],
  ];
  const matchedDocument = documentLabelMap.find(([keyword]) => text.includes(keyword));
  if (matchedDocument) return taxDocumentTargetKey(matchedDocument[1]);
  if (text.includes("国内物流")) return "domestic-logistics";
  if (text.includes("工厂") || text.includes("采购合同") || text.includes("增值税") || text.includes("进项发票")) {
    return "factory-section";
  }
  if (
    text.includes("报关费")
    || text.includes("拖车费")
    || text.includes("港杂费")
    || text.includes("海运费")
    || text.includes("物流")
  ) {
    return "logistics-section";
  }
  return "tax-detail-top";
}

function factoryDocumentTargetKey(costId: string, documentType: string) {
  return `tax-factory-${costId}-${documentType}`;
}

function logisticsDocumentTargetKey(costId: string) {
  return `tax-logistics-${costId}-SUPPLIER_INVOICE`;
}

function taxTargetDomId(key: string) {
  return `tax-target-${String(key || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function factorySupplierCosts(costs: TaxCost[]) {
  return costs.filter((cost) => (
    cost.id
    && cost.supplierId
    && (
      cost.supplierType === "工厂供应商"
      || ["工厂货款", "原材料货款", "采购货款", "产品货款"].includes(cost.costType || "")
    )
  ));
}

function logisticsInvoiceCosts(costs: TaxCost[]) {
  return costs.filter((cost) => (
    cost.id
    && cost.supplierId
    && !factorySupplierCosts([cost]).length
    && TAX_LOGISTICS_INVOICE_COST_TYPES.includes(cost.costType || "")
  ));
}

function logisticsInvoiceLabel(cost: Pick<TaxCost, "costType">) {
  if (["拖车费", "国内物流费", "国内拖车费"].includes(cost.costType || "")) return "拖车费发票";
  if (cost.costType === "报关费") return "报关费发票";
  if (cost.costType === "港杂费") return "港杂费发票";
  if (cost.costType === "海运费") return "海运费发票";
  return "物流发票";
}

function canUploadTaxDocument(role: string, canWriteDocuments: boolean, documentType: string, readOnly?: boolean) {
  if (readOnly || !canWriteDocuments) return false;
  if (documentType === "EXPORT_INVOICE") return ["管理员", "财务"].includes(role);
  if (TAX_CUSTOMS_UPLOAD_TYPES.some((type) => type.value === documentType)) {
    return ["管理员", "业务员", "物流供应商", "物流资料录入员"].includes(role);
  }
  if (TAX_EXPORT_UPLOAD_TYPES.some((type) => type.value === documentType)) return ["管理员", "业务员"].includes(role);
  return true;
}

function canDeleteTaxDocument(canWriteDocuments: boolean, readOnly?: boolean) {
  return !readOnly && canWriteDocuments;
}

function uploadScopeKey(orderId: string, documentType: string, scope: UploadScope = {}) {
  return [orderId, documentType, scope.costId || "", scope.supplierId || ""].join(":");
}

function zipFileNameFromResponse(response: Response, row: TaxRefundRow) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) return plainMatch[1];
  const orderNo = String(row.orderNo || "订单").replace(/[\\/:*?"<>|]/g, "_");
  return `退税资料_${orderNo}.zip`;
}

function groupDocuments(documents: TaxDocument[]) {
  const groups: Record<string, TaxDocument[]> = {
    出口资料: [],
    报关资料: [],
    工厂资料: [],
    物流资料: [],
    其他资料: [],
  };
  documents.forEach((document) => {
    const type = document.documentType || "";
    if (["BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "SALES_CONTRACT", "EXPORT_INVOICE"].includes(type)) {
      groups.出口资料.push(document);
    } else if (["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY"].includes(type)) {
      groups.报关资料.push(document);
    } else if (["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"].includes(type) && document.relatedModule === "SUPPLIER" && !document.costType?.includes("费")) {
      groups.工厂资料.push(document);
    } else if (document.relatedModule === "SUPPLIER" || ["CUSTOMS_FEE_INVOICE", "TRUCKING_FEE_INVOICE"].includes(type)) {
      groups.物流资料.push(document);
    } else {
      groups.其他资料.push(document);
    }
  });
  return groups;
}

function manualShippingTemplate(draft: ManualShippingDraft, language: string): Pick<ManualShippingForm, "emailSubject" | "emailBody"> {
  const normalizedLanguage = String(language || "EN").toUpperCase();
  const orderNo = draft.orderNo || "-";
  const billOfLadingNo = draft.billOfLadingNo || draft.blNo || "-";
  const customsDeclarationDate = draft.customsDeclarationDate || "-";
  const labels = (draft.documents || [])
    .filter((item) => item.exists)
    .map((item) => item.emailLabel || item.label)
    .filter(Boolean) as string[];
  if (normalizedLanguage === "RU") {
    return {
      emailSubject: `Отгрузочные документы по заказу ${orderNo} / коносамент ${billOfLadingNo}`,
      emailBody: [
        "Здравствуйте!",
        "",
        `Во вложении направляем отгрузочные документы по заказу ${orderNo}.`,
        "",
        "Документы во вложении:",
        ...(labels.length ? labels : ["Commercial Invoice", "Packing List", "Customs Declaration"]).map((label) => `- ${label}`),
        "",
        `Номер коносамента: ${billOfLadingNo}`,
        `Дата декларации: ${customsDeclarationDate}`,
        "",
        "Пожалуйста, проверьте документы и сообщите нам, если потребуется дополнительная информация.",
        "",
        "С уважением,",
        "Zhejiang Lainuo Building Materials Co., Ltd.",
      ].join("\n"),
    };
  }
  return {
    emailSubject: `Shipping Documents for Order ${orderNo} / B/L ${billOfLadingNo}`,
    emailBody: [
      "Dear Customer,",
      "",
      "Please find attached the shipping documents for your customs clearance:",
      "",
      ...labels.map((label) => `- ${label}`),
      "",
      "This email also serves as the shipment notification.",
      "",
      "Best regards,",
      "NEXTWOOD",
    ].join("\n"),
  };
}

function completenessClass(percent: number) {
  if (percent >= 100) return styles.statusSuccess;
  if (percent >= 50) return styles.statusWarning;
  return styles.statusDanger;
}

function taxStatusLabel(status = "") {
  return TAX_REFUND_STATUS_OPTIONS.find((option) => option.value === status)?.label || status || "-";
}

function taxRefundHasPackageContent(row: TaxRefundRow) {
  return Number(row.documentCompleteness?.completed || 0) > 0;
}

function statusClass(status = "") {
  if (status === "READY") return styles.statusSuccess;
  if (status === "PROBLEM") return styles.statusDanger;
  if (status === "SUBMITTED") return "";
  return styles.statusWarning;
}
