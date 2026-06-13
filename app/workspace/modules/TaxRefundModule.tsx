"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { formatDate } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import type { User } from "../types";

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
type MissingTarget = {
  key: string;
  label: string;
  title?: string;
};

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

export function TaxRefundModule({ currentUser }: { currentUser: User }) {
  const [mode, setMode] = useState<TaxRefundMode>("current");
  const [rows, setRows] = useState<TaxRefundRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detailRow, setDetailRow] = useState<TaxRefundRow | null>(null);
  const [detail, setDetail] = useState<TaxRefundDetail | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canSendShippingDocuments = ["管理员", "业务员"].includes(currentUser.role);

  async function loadRows(nextPage = page, nextKeyword = submittedKeyword, nextMode = mode) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        mode: nextMode,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
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

  function switchMode(nextMode: TaxRefundMode) {
    setMode(nextMode);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setKeyword("");
    setSubmittedKeyword("");
    void loadRows(1, "", nextMode);
  }

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    void loadRows(1, value, mode);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    void loadRows(1, "", mode);
  }

  function gotoPage(nextPage: number) {
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    void loadRows(nextPage, submittedKeyword, mode);
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

  function closeDetailDrawer() {
    setDetailRow(null);
    setDetailOrderId("");
    setDetail(null);
    setDetailError("");
  }

  async function downloadPackage(row: TaxRefundRow) {
    setPackageDownloadingId(row.id);
    setError("");
    try {
      const response = await fetch(`/api/tax-refunds/package?orderId=${encodeURIComponent(row.id)}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data && typeof data.message === "string" ? data.message : "下载退税资料包失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = zipFileNameFromResponse(response, row);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
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

    if (total <= 0 || percent < 100) {
      const missingText = missingLabels.length ? `\n\n缺失资料：${missingLabels.join(" / ")}` : "";
      window.alert(`资料尚未完整，无法提交退税。\n\n当前完整度：${completed}/${total || 0}（${percent}%）${missingText}\n\n请先补齐缺失资料后再提交。`);
      return;
    }

    if (!window.confirm(`确认提交退税并归档该订单吗？\n\n订单：${row.orderNo || "-"}\n提单号：${row.blNo || "-"}\n\n归档后，该订单将从当前退税资料、成本管理、国内物流信息和经营待处理列表中隐藏，但仍可在退税档案和报表中心查询。`)) {
      return;
    }

    setSubmittingTaxId(row.id);
    setError("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "SUBMITTED" }),
      });
      if (result.success !== true) throw new Error(result.message || "提交退税失败");
      window.alert(result.message || "退税资料已提交并归档");
      if (detailOrderId === row.id) {
        setDetailOrderId("");
        setDetailRow(null);
        setDetail(null);
      }
      await loadRows(page, submittedKeyword, mode);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交退税失败");
    } finally {
      setSubmittingTaxId("");
    }
  }

  async function cancelTaxRefundArchive(row: TaxRefundRow) {
    if (!window.confirm(`确认取消归档该订单吗？\n\n订单：${row.orderNo || "-"}\n\n取消归档后，该订单将重新回到当前退税资料列表。`)) {
      return;
    }
    setCancelingArchiveId(row.id);
    setError("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/tax-refunds/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ cancelArchive: true, status: "NOT_READY" }),
      });
      if (result.success !== true) throw new Error(result.message || "取消归档失败");
      window.alert(result.message || "退税资料已取消归档");
      if (detailOrderId === row.id) {
        setDetailOrderId("");
        setDetailRow(null);
        setDetail(null);
      }
      await loadRows(page, submittedKeyword, mode);
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
    } catch (uploadError) {
      setDetailError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
    }
  }

  async function deleteDocument(orderId: string, document: TaxDocument) {
    if (!window.confirm(`确认删除文件？\n\n${document.fileName || document.documentTypeLabel || "-"}`)) return;
    setDeletingDocumentId(document.id);
    setDetailError("");
    setError("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/order-documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除文件失败");
      await fetchDetail(orderId);
      await loadRows(page, submittedKeyword, mode);
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
    if ((manualShippingDraft.missingLabels || []).length && !window.confirm("当前资料不完整，是否仍然发送？")) return;
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
      window.alert(result.message || "清关资料发送成功");
      await fetchDetail(manualShippingOrder.id);
      await loadRows(page, submittedKeyword, mode);
      closeManualShippingDocuments();
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
          <span className={styles.kicker}>React 迁移模块</span>
          <h2>退税资料</h2>
        </div>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => loadRows(page)}>
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
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}

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
            ) : rows.length ? rows.map((row) => (
              <TaxRefundTableRow
                key={row.id}
                row={row}
                onViewDetail={() => void loadDetail(row)}
              />
            )) : (
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
          }}
          onUpload={uploadDocument}
          onDelete={deleteDocument}
          onOpenManualShippingDocuments={openManualShippingDocuments}
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
    </section>
  );
}

function TaxRefundTableRow({
  row,
  onViewDetail,
}: {
  row: TaxRefundRow;
  onViewDetail: () => void;
}) {
  const completeness = row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const declarationDate = formatDate(row.customsDeclarationDate || row.declarationDate);

  return (
    <tr className={styles.clickableRow} onClick={onViewDetail}>
      <td><strong>{row.orderNo || "-"}</strong></td>
      <td title={row.customerFullName || row.customerName || ""}>{row.customerShortName || row.customerName || "-"}</td>
      <td>{declarationDate}</td>
      <td><span className={`${styles.statusPill} ${completenessClass(percent)}`}>{percent}%</span></td>
      <td><span className={`${styles.statusPill} ${statusClass(row.taxRefundStatus)}`}>{row.taxRefundStatusLabel || row.taxRefundStatus || "-"}</span></td>
      <td>
        <button
          className={styles.rowDetailButton}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewDetail();
          }}
        >
          查看资料
        </button>
      </td>
    </tr>
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
}) {
  const completeness = detail?.documentCompleteness || row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const missingLabels = normalizedMissingLabels(completeness);
  const displayCustomer = row.customerShortName && row.customerFullName
    ? `${row.customerShortName} / ${row.customerFullName}`
    : (row.customerFullName || row.customerName || row.customerShortName || "-");
  const missingBadgeText = missingLabels.length ? `缺失资料：${missingLabels.length}项待处理` : "资料完整";

  return (
    <div className={styles.drawerOverlay} role="dialog" aria-modal="true" aria-label="退税资料详情">
      <aside className={styles.taxRefundDrawer}>
        <header className={styles.taxRefundDrawerHeader}>
          <div className={styles.taxRefundDrawerTitle}>
            <span>退税资料详情</span>
            <strong>{row.orderNo || "-"} · {displayCustomer}</strong>
            <small>提单号：{row.blNo || "-"} ｜ 完整度：{percent}%（{completed}/{total || 0}）</small>
          </div>
          <div className={styles.taxRefundDrawerActions}>
            <span className={`${styles.taxMissingBadge} ${missingLabels.length ? "" : styles.taxMissingBadgeComplete}`}>{missingBadgeText}</span>
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
}) {
  if (loading) return <div className={styles.emptyState}>资料详情加载中...</div>;
  if (error) return <div className={styles.inlineError}>{error}</div>;
  if (!detail) return <div className={styles.emptyState}>点击查看资料后加载详情</div>;

  const completeness = detail.documentCompleteness || fallback.documentCompleteness || {};
  const groups = groupDocuments(detail.documents || []);
  const domesticRemark = detail.domesticLogisticsInfo?.exportInvoiceRemark || detail.domesticLogisticsInfo?.remarkText || "";
  const factoryCosts = factorySupplierCosts(detail.costs || []);
  const missingTargets = taxMissingTargets(detail, fallback);

  return (
    <div className={styles.taxDetailPanel} id={taxTargetDomId("tax-detail-top")}>
      <div className={styles.documentGroupGrid}>
        <div className={styles.documentGroupCard}>
          <strong>基础信息</strong>
          <div className={styles.detailGrid}>
            <DetailField label="客户全称" value={detail.customerFullName || detail.customerName || fallback.customerFullName || fallback.customerName || "-"} wide />
            <DetailField label="订单号" value={detail.orderNo || fallback.orderNo || "-"} />
            <DetailField label="提单号" value={detail.blNo || fallback.blNo || "-"} />
            <DetailField label="币种" value={detail.currency || fallback.currency || "-"} />
            <DetailField label="申报日期" value={formatDate(detail.customsDeclarationDate || detail.declarationDate || fallback.customsDeclarationDate || fallback.declarationDate)} />
            <DetailField label="资料完整度" value={`${Number(completeness.completed || 0)}/${Number(completeness.total || 0)}`} />
            <DetailField label="国内物流信息" value={detail.domesticLogisticsInfo?.archiveStatusLabel || (domesticRemark ? "已提交" : "未提交")} />
          </div>
        </div>
        <div className={styles.documentGroupCard} id={taxTargetDomId("domestic-logistics")}>
          <strong>出口发票备注</strong>
          <div className={styles.exportInvoiceRemarkText}>
            {domesticRemark || "暂无出口发票备注，请前往国内物流信息维护。"}
          </div>
        </div>
        <div className={styles.documentGroupCard}>
          <strong>缺失资料汇总</strong>
          {missingTargets.length ? (
            <div className={styles.missingChipList}>
              {missingTargets.map((target) => (
                <button
                  className={styles.missingChipButton}
                  key={target.key}
                  title={target.title || target.label}
                  type="button"
                  onClick={() => scrollToTaxTarget(target.key)}
                >
                  {target.label}
                </button>
              ))}
            </div>
          ) : (
            <span className={styles.statusPill + " " + styles.statusSuccess}>资料已完整</span>
          )}
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
              readOnly={readOnly}
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
              readOnly={readOnly}
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
  readOnly,
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
  readOnly?: boolean;
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
        {readOnly ? (
          <button className={styles.secondaryButton} type="button" disabled title="无权限操作">
            无权限操作
          </button>
        ) : (
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
        )}
        {documents.map((document) => (
          <span key={document.id} className={styles.fileListItemActions}>
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/preview`} target="_blank" rel="noreferrer">预览</a>
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
            {readOnly ? null : (
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={deletingDocumentId === document.id}
                onClick={() => onDelete(orderId, document)}
              >
                {deletingDocumentId === document.id ? "删除中..." : "删除"}
              </button>
            )}
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
          <strong>报关单手工填写</strong>
          <span>请手工填写报关单关键信息。</span>
        </div>
        <span className={styles.statusPill}>{detail.customsParseSourceLabel || detail.customsParseStatusLabel || "手工维护"}</span>
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
  readOnly,
  onUpload,
  onDelete,
}: {
  orderId: string;
  cost: TaxCost;
  documents: TaxDocument[];
  uploadingKey: string;
  deletingDocumentId: string;
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
          readOnly={readOnly}
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
  readOnly,
  onUpload,
  onDelete,
}: {
  orderId: string;
  cost: TaxCost;
  documents: TaxDocument[];
  uploadingKey: string;
  deletingDocumentId: string;
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
      readOnly={readOnly}
      onUpload={onUpload}
      onDelete={onDelete}
    />
  );
}

function normalizedMissingLabels(completeness: DocumentCompleteness) {
  const labels = completeness.missingLabels || completeness.missing || [];
  return labels.map((label) => String(label || "").trim()).filter(Boolean);
}

function taxMissingTargets(detail: TaxRefundDetail, fallback: TaxRefundRow): MissingTarget[] {
  const completeness = detail.documentCompleteness || fallback.documentCompleteness || {};
  const costs = detail.costs || [];
  const targets: MissingTarget[] = [];

  (completeness.export?.missingTypes || []).forEach((type) => {
    targets.push({
      key: taxDocumentTargetKey(type),
      label: documentTypeLabel(type),
      title: documentTypeLabel(type),
    });
  });
  (completeness.customs?.missingTypes || []).forEach((type) => {
    targets.push({
      key: taxDocumentTargetKey(type),
      label: documentTypeLabel(type),
      title: documentTypeLabel(type),
    });
  });
  (completeness.domesticLogistics?.missing || []).forEach(() => {
    targets.push({
      key: "domestic-logistics",
      label: "国内物流信息",
      title: "国内物流信息",
    });
  });
  (completeness.supplier?.missing || []).forEach((item) => {
    if (item.missingFactoryCost) {
      targets.push({ key: "factory-section", label: "缺少工厂供应商成本记录", title: "请先在成本管理中录入工厂供应商成本" });
      return;
    }
    if (!item.documentType) return;
    const cost = costs.find((row) => row.id && row.supplierId === item.supplierId) || factorySupplierCosts(costs)[0];
    targets.push({
      key: cost?.id ? factoryDocumentTargetKey(cost.id, item.documentType) : "factory-section",
      label: missingSupplierDocumentLabel(item.documentType),
      title: item.supplierName ? `${item.supplierName}${missingSupplierDocumentLabel(item.documentType)}` : missingSupplierDocumentLabel(item.documentType),
    });
  });
  (completeness.logistics?.missing || []).forEach((item) => {
    if (item.missingCost) {
      targets.push({
        key: logisticsCostTypeTargetKey(costs, item.costType || item.label || ""),
        label: item.label || "未录入对应费用",
        title: item.label || "未录入对应费用",
      });
      return;
    }
    targets.push({
      key: item.costId ? logisticsDocumentTargetKey(item.costId) : logisticsCostTypeTargetKey(costs, item.costType || item.invoiceLabel || ""),
      label: item.invoiceLabel || item.label || "物流资料",
      title: `${item.costType || "物流资料"} / ${item.supplierName || "-"} / ${item.invoiceLabel || item.label || "物流资料"}`,
    });
  });

  normalizedMissingLabels(completeness).forEach((label) => {
    if (!targets.some((target) => target.label === label)) {
      targets.push({ key: missingLabelTargetKey(label, detail), label, title: label });
    }
  });

  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.key}:${target.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function documentTypeLabel(type: string) {
  const match = [...TAX_EXPORT_UPLOAD_TYPES, ...TAX_CUSTOMS_UPLOAD_TYPES, ...TAX_FACTORY_UPLOAD_TYPES].find((item) => item.value === type);
  if (match) return match.label;
  if (type === "CUSTOMS_DECLARATION") return "报关单";
  if (type === "CUSTOMS_FEE_INVOICE") return "报关费发票";
  if (type === "TRUCKING_FEE_INVOICE") return "拖车费发票";
  return type || "资料";
}

function missingSupplierDocumentLabel(type: string) {
  if (type === "SUPPLIER_PURCHASE_CONTRACT") return "工厂合同";
  if (type === "SUPPLIER_INVOICE") return "工厂发票";
  return documentTypeLabel(type);
}

function taxDocumentTargetKey(documentType: string) {
  return `tax-document-${documentType}`;
}

function factoryDocumentTargetKey(costId: string, documentType: string) {
  return `tax-factory-${costId}-${documentType}`;
}

function logisticsDocumentTargetKey(costId: string) {
  return `tax-logistics-${costId}-SUPPLIER_INVOICE`;
}

function logisticsCostTypeTargetKey(costs: TaxCost[], text: string) {
  const normalizedText = String(text || "");
  const cost = logisticsInvoiceCosts(costs).find((item) => {
    const costType = item.costType || "";
    if (normalizedText.includes("拖车") || normalizedText.includes("国内物流")) return ["拖车费", "国内物流费", "国内拖车费"].includes(costType);
    if (normalizedText.includes("报关")) return costType === "报关费";
    if (normalizedText.includes("港杂")) return costType === "港杂费";
    if (normalizedText.includes("海运")) return costType === "海运费";
    return costType && normalizedText.includes(costType);
  });
  return cost?.id ? logisticsDocumentTargetKey(cost.id) : "logistics-section";
}

function missingLabelTargetKey(label: string, detail: TaxRefundDetail) {
  const text = String(label || "");
  const documentMap: Array<[string, string]> = [
    ["提单", "BILL_OF_LADING"],
    ["商业发票", "COMMERCIAL_INVOICE"],
    ["装箱单", "PACKING_LIST"],
    ["箱单", "PACKING_LIST"],
    ["出口发票", "EXPORT_INVOICE"],
    ["销售合同", "SALES_CONTRACT"],
    ["货物报关单", "CUSTOMS_ENTRY_FORM"],
    ["报关单", "CUSTOMS_ENTRY_FORM"],
    ["放行通知书", "RELEASE_NOTICE"],
    ["报关委托书", "CUSTOMS_POWER_OF_ATTORNEY"],
  ];
  const documentMatch = documentMap.find(([keyword]) => text.includes(keyword));
  if (documentMatch) return taxDocumentTargetKey(documentMatch[1]);
  if (text.includes("国内物流") || text.includes("物流信息")) return "domestic-logistics";
  if (text.includes("工厂合同") || text.includes("采购合同")) {
    const cost = factorySupplierCosts(detail.costs || [])[0];
    return cost?.id ? factoryDocumentTargetKey(cost.id, "SUPPLIER_PURCHASE_CONTRACT") : "factory-section";
  }
  if (text.includes("工厂发票") || text.includes("增值税发票") || text.includes("进项发票")) {
    const cost = factorySupplierCosts(detail.costs || [])[0];
    return cost?.id ? factoryDocumentTargetKey(cost.id, "SUPPLIER_INVOICE") : "factory-section";
  }
  if (text.includes("报关费") || text.includes("拖车") || text.includes("港杂") || text.includes("海运")) {
    return logisticsCostTypeTargetKey(detail.costs || [], text);
  }
  return "tax-detail-top";
}

function taxTargetDomId(key: string) {
  return `tax-target-${String(key || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function scrollToTaxTarget(key: string) {
  const target = document.getElementById(taxTargetDomId(key));
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove(styles.taxTargetHighlight);
  window.setTimeout(() => {
    target.classList.add(styles.taxTargetHighlight);
    window.setTimeout(() => target.classList.remove(styles.taxTargetHighlight), 1500);
  }, 80);
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

function logisticsInvoiceLabel(cost: TaxCost) {
  if (["拖车费", "国内物流费", "国内拖车费"].includes(cost.costType || "")) return "拖车费发票";
  if (cost.costType === "报关费") return "报关费发票";
  if (cost.costType === "港杂费") return "港杂费发票";
  if (cost.costType === "海运费") return "海运费发票";
  return "物流发票";
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

function statusClass(status = "") {
  if (status === "READY") return styles.statusSuccess;
  if (status === "PROBLEM") return styles.statusDanger;
  if (status === "SUBMITTED") return "";
  return styles.statusWarning;
}
