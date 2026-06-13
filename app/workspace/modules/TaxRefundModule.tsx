"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { formatDate } from "../formatters";
import styles from "../WorkspaceShell.module.css";

type DocumentCompleteness = {
  completed?: number;
  total?: number;
  missingLabels?: string[];
  missing?: string[];
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

export function TaxRefundModule() {
  const [mode, setMode] = useState<TaxRefundMode>("current");
  const [rows, setRows] = useState<TaxRefundRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detail, setDetail] = useState<TaxRefundDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [packageDownloadingId, setPackageDownloadingId] = useState("");
  const [submittingTaxId, setSubmittingTaxId] = useState("");
  const [cancelingArchiveId, setCancelingArchiveId] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    setExpandedId("");
    setDetailOrderId("");
    setDetail(null);
    setKeyword("");
    setSubmittedKeyword("");
    void loadRows(1, "", nextMode);
  }

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setExpandedId("");
    setDetailOrderId("");
    setDetail(null);
    void loadRows(1, value, mode);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setExpandedId("");
    setDetailOrderId("");
    setDetail(null);
    void loadRows(1, "", mode);
  }

  function gotoPage(nextPage: number) {
    setExpandedId("");
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
    setExpandedId(row.id);
    if (detailOrderId === row.id && detail) {
      setDetailOrderId("");
      setDetail(null);
      return;
    }
    setDetailOrderId(row.id);
    setDetail(null);
    await fetchDetail(row.id);
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
        setDetail(null);
      }
      setExpandedId("");
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
        setDetail(null);
      }
      setExpandedId("");
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
              <TaxRefundRows
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId((current) => current === row.id ? "" : row.id)}
                detailActive={detailOrderId === row.id}
                detail={detailOrderId === row.id ? detail : null}
                detailLoading={detailOrderId === row.id && detailLoading}
                detailError={detailOrderId === row.id ? detailError : ""}
                onViewDetail={() => void loadDetail(row)}
                packageDownloading={packageDownloadingId === row.id}
                onDownloadPackage={() => void downloadPackage(row)}
                submittingTax={submittingTaxId === row.id}
                onSubmitTaxRefund={() => void submitTaxRefund(row)}
                readOnly={mode === "archive" || Boolean(row.taxArchived)}
                cancelingArchive={cancelingArchiveId === row.id}
                onCancelArchive={() => void cancelTaxRefundArchive(row)}
                uploadingKey={uploadingKey}
                deletingDocumentId={deletingDocumentId}
                onCustomsSaved={async (orderId) => {
                  await fetchDetail(orderId);
                  await loadRows(page, submittedKeyword, mode);
                }}
                onUpload={uploadDocument}
                onDelete={deleteDocument}
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
    </section>
  );
}

function TaxRefundRows({
  row,
  expanded,
  detailActive,
  detail,
  detailLoading,
  detailError,
  onToggle,
  onViewDetail,
  packageDownloading,
  onDownloadPackage,
  submittingTax,
  onSubmitTaxRefund,
  readOnly,
  cancelingArchive,
  onCancelArchive,
  uploadingKey,
  deletingDocumentId,
  onCustomsSaved,
  onUpload,
  onDelete,
}: {
  row: TaxRefundRow;
  expanded: boolean;
  detailActive: boolean;
  detail: TaxRefundDetail | null;
  detailLoading: boolean;
  detailError: string;
  onToggle: () => void;
  onViewDetail: () => void;
  packageDownloading: boolean;
  onDownloadPackage: () => void;
  submittingTax: boolean;
  onSubmitTaxRefund: () => void;
  readOnly: boolean;
  cancelingArchive: boolean;
  onCancelArchive: () => void;
  uploadingKey: string;
  deletingDocumentId: string;
  onCustomsSaved: (orderId: string) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const completeness = row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const missingLabels = useMemo(() => normalizedMissingLabels(completeness), [completeness]);
  const declarationDate = formatDate(row.customsDeclarationDate || row.declarationDate);

  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{row.orderNo || "-"}</strong></td>
        <td title={row.customerFullName || row.customerName || ""}>{row.customerShortName || row.customerName || "-"}</td>
        <td>{declarationDate}</td>
        <td><span className={`${styles.statusPill} ${completenessClass(percent)}`}>{percent}%</span></td>
        <td><span className={`${styles.statusPill} ${statusClass(row.taxRefundStatus)}`}>{row.taxRefundStatusLabel || row.taxRefundStatus || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={6}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                <button
                  className={styles.primaryButtonCompact}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewDetail();
                  }}
                >
                  {detailActive ? "收起资料" : "查看资料"}
                </button>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  disabled={packageDownloading}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownloadPackage();
                  }}
                >
                  {packageDownloading ? "下载中..." : "下载资料包"}
                </button>
                {readOnly ? (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={cancelingArchive}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelArchive();
                    }}
                  >
                    {cancelingArchive ? "处理中..." : "取消归档"}
                  </button>
                ) : (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={submittingTax}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSubmitTaxRefund();
                    }}
                  >
                    {submittingTax ? "提交中..." : "提交退税并归档"}
                  </button>
                )}
              </div>
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={row.customerFullName || row.customerName || "-"} wide />
                <DetailField label="订单号" value={row.orderNo || "-"} />
                <DetailField label="提单号" value={row.blNo || "-"} />
                <DetailField label="申报日期" value={declarationDate} />
                <DetailField label="总体完整度" value={`${percent}%（${completed}/${total || 0}）`} />
                <DetailField label="缺失资料" value={missingLabels.length ? `${missingLabels.length} 项待处理` : "已完整"} />
                <DetailField label="缺失资料汇总" value={missingLabels.length ? missingLabels.join(" / ") : "无"} wide />
              </div>
              {detailActive ? (
                  <TaxRefundDetailPanel
                    detail={detail}
                    loading={detailLoading}
                    error={detailError}
                    fallback={row}
                    uploadingKey={uploadingKey}
                    deletingDocumentId={deletingDocumentId}
                    readOnly={readOnly}
                    onCustomsSaved={onCustomsSaved}
                    onUpload={onUpload}
                    onDelete={onDelete}
                  />
                ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
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
}) {
  if (loading) return <div className={styles.emptyState}>资料详情加载中...</div>;
  if (error) return <div className={styles.inlineError}>{error}</div>;
  if (!detail) return <div className={styles.emptyState}>点击查看资料后加载详情</div>;

  const completeness = detail.documentCompleteness || fallback.documentCompleteness || {};
  const groups = groupDocuments(detail.documents || []);
  const domesticRemark = detail.domesticLogisticsInfo?.exportInvoiceRemark || detail.domesticLogisticsInfo?.remarkText || "";
  const missingLabels = normalizedMissingLabels(completeness);
  const factoryCosts = factorySupplierCosts(detail.costs || []);

  return (
    <div className={styles.taxDetailPanel}>
      <div className={styles.detailGrid}>
        <DetailField label="订单号" value={detail.orderNo || fallback.orderNo || "-"} />
        <DetailField label="提单号" value={detail.blNo || fallback.blNo || "-"} />
        <DetailField label="币种" value={detail.currency || fallback.currency || "-"} />
        <DetailField label="资料完整度" value={`${Number(completeness.completed || 0)}/${Number(completeness.total || 0)}`} />
        <DetailField label="国内物流信息" value={detail.domesticLogisticsInfo?.archiveStatusLabel || (domesticRemark ? "已提交" : "未提交")} />
        <DetailField label="缺失资料" value={missingLabels.length ? missingLabels.join(" / ") : "无"} wide />
        <DetailField label="出口发票备注" value={domesticRemark || "暂无出口发票备注，请前往国内物流信息维护。"} wide />
      </div>

      <div className={styles.documentGroupGrid}>
        <CustomsRecognitionForm detail={detail} readOnly={readOnly} onSaved={onCustomsSaved} />
        <div className={styles.documentGroupCard}>
          <strong>出口资料上传</strong>
          {TAX_EXPORT_UPLOAD_TYPES.map((documentType) => (
            <TaxUploadItem
              key={documentType.value}
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
        <div className={styles.documentGroupCard}>
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

function TaxUploadItem({
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
    <div className={styles.fileListItem}>
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
        {readOnly ? null : (
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
          <strong>报关单信息</strong>
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
