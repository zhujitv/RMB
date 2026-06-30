import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import { PdfPreviewButton } from "../../components";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { UPLOAD_REPLACE_TEXT } from "../../uploadTexts";
import { PDF_UPLOAD_ACCEPT } from "../../utils";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { canDeleteTaxDocument, canRecognizeTaxCustoms, canUploadTaxDocument, customsRecognitionStatusTextFromResult, documentMatchesFactoryCostSlot, factoryDocumentTargetKey, formatFactoryCostAmount, latestTaxDocument, logisticsDocumentTargetKey, logisticsInvoiceDocumentsForCost, logisticsInvoiceLabel, taxDocumentTargetKey, taxTargetDomId, uploadScopeKey } from "./helpers";
import { TAX_CUSTOMS_UPLOAD_TYPES, TAX_FACTORY_UPLOAD_TYPES, type DocumentCompleteness, type TaxCost, type TaxDocument, type TaxRefundDetail, type UploadScope } from "./model";

export function TaxUploadItem({
  targetKey,
  orderId,
  type,
  label,
  documents,
  uploading,
  uploadProgress = 0,
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
  uploadProgress?: number;
  deletingDocumentId: string;
  scope?: UploadScope;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  return (
    <FileUploadCard
      targetKey={targetKey}
      orderId={orderId}
      type={type}
      label={label}
      document={latestTaxDocument(documents)[0] || null}
      uploading={uploading}
      uploadProgress={uploadProgress}
      deletingDocumentId={deletingDocumentId}
      scope={scope}
      canUpload={canUpload}
      canDelete={canDelete}
      canPreviewOrDownload
      onUpload={onUpload}
      onDelete={onDelete}
    />
  );
}

export function FileUploadCard({
  targetKey,
  orderId,
  type,
  label,
  order,
  document,
  uploading,
  uploadProgress = 0,
  deletingDocumentId,
  recognizingDocumentId = "",
  recognitionStatus = "-",
  scope,
  canUpload,
  canDelete,
  canPreviewOrDownload,
  canRecognize = false,
  onUpload,
  onDelete,
  onRecognize,
}: {
  targetKey?: string;
  orderId: string;
  type: string;
  label: string;
  order?: TaxRefundDetail;
  document: TaxDocument | null;
  uploading: boolean;
  uploadProgress?: number;
  deletingDocumentId: string;
  recognizingDocumentId?: string;
  recognitionStatus?: string;
  scope?: UploadScope;
  canUpload: boolean;
  canDelete: boolean;
  canPreviewOrDownload: boolean;
  canRecognize?: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onRecognize?: (order: TaxRefundDetail, document: TaxDocument) => void;
}) {
  const uploaded = Boolean(document);
  const deleting = Boolean(document?.id && deletingDocumentId === document.id);
  const recognizing = Boolean(document?.id && recognizingDocumentId === document.id);
  const statusText = recognizing ? "识别中..." : recognitionStatus;
  return (
    <div className={styles.fileUploadCard} id={targetKey ? taxTargetDomId(targetKey) : undefined}>
      <div className={styles.fileUploadHeader}>
        <strong>{label}</strong>
        <span>{uploaded ? "已上传 1 个文件" : "暂未上传"}</span>
      </div>
      {document ? (
        <div className={styles.fileUploadFile}>
          <div className={styles.fileUploadFileName} title={document.fileName || "-"}>
            {document.fileName || "-"}
          </div>
          <div className={styles.fileUploadMeta}>
            <span>上传人：{document.uploadedByName || "-"}</span>
            <span>上传时间：{formatDateTime(document.uploadedAt)}</span>
          </div>
          <div className={styles.fileUploadStatus}>识别状态：{statusText || "-"}</div>
          <div className={styles.fileUploadActions}>
            <span className={styles.fileUploadActionLabel}>操作：</span>
            {canPreviewOrDownload ? (
              <>
                <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
                <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
              </>
            ) : null}
            {canDelete ? (
              <button
                className={styles.fileDangerButton}
                type="button"
                disabled={deleting}
                onClick={() => onDelete(orderId, document)}
              >
                {deleting ? "删除中..." : "删除"}
              </button>
            ) : null}
            {canRecognize && order && onRecognize ? (
              <button
                className={styles.fileActionButton}
                type="button"
                disabled={recognizing}
                onClick={() => onRecognize(order, document)}
              >
                {recognizing ? "识别中..." : "重新识别报关单"}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.fileUploadEmpty}>暂未上传</div>
      )}
      {canUpload ? (
        <>
          <label className={`${styles.secondaryButton} ${styles.fileUploadButton}`}>
            {uploading ? "上传中..." : UPLOAD_REPLACE_TEXT}
            <input
              type="file"
              accept={PDF_UPLOAD_ACCEPT}
              disabled={uploading}
              hidden
              onChange={(event) => {
                onUpload(orderId, type, event.target.files?.[0] || null, scope);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {uploading ? <UploadProgressInline progress={uploadProgress} /> : null}
        </>
      ) : (
        <button className={`${styles.secondaryButton} ${styles.fileUploadButton}`} type="button" disabled title="无权限操作">
          无权限操作
        </button>
      )}
    </div>
  );
}

export function UploadProgressInline({ progress }: { progress: number }) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress || 0)));
  return (
    <span className={styles.invoiceUploadStatus} data-status="uploading">
      <span className={styles.invoiceUploadProgressBar}>
        <span style={{ width: `${safeProgress}%` }} />
      </span>
      <span>状态：上传中 {safeProgress}%</span>
    </span>
  );
}

export function CustomsRecognitionForm({
  detail,
  readOnly,
  recognizing,
  canRecognize,
  onSaved,
  onRecognizeFromUploadedCustoms,
}: {
  detail: TaxRefundDetail;
  readOnly: boolean;
  recognizing: boolean;
  canRecognize: boolean;
  onSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onRecognizeFromUploadedCustoms: (order: TaxRefundDetail) => void;
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
      const result = await apiJson<{ success?: boolean; message?: string; order?: TaxRefundDetail }>(`/api/tax-refunds/${encodeURIComponent(detail.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "updateCustomsRecognition",
          customsDeclarationNo: customsDeclarationNo.trim(),
          customsDeclarationDate,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "报关单信息保存失败");
      setMessage(result.message || "报关单信息已保存");
      await onSaved(detail.id, result.order || null);
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
          <div className={styles.inlineActionGroup}>
            {canRecognize ? (
              <button className={styles.secondaryButton} type="button" disabled={saving || recognizing} onClick={() => onRecognizeFromUploadedCustoms(detail)}>
                {recognizing ? "识别中..." : "重新识别报关单"}
              </button>
            ) : null}
            <button className={styles.primaryButtonCompact} type="button" disabled={saving} onClick={saveCustomsRecognition}>
              {saving ? "保存中..." : "保存报关单信息"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CustomsUploadCard({
  order,
  documents,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  recognizingDocumentId,
  recognitionStatusByDocument,
  currentUserRole,
  canWriteDocuments,
  canRecognizeCustoms,
  readOnly,
  onUpload,
  onDelete,
  onRecognize,
}: {
  order: TaxRefundDetail;
  documents: TaxDocument[];
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  recognizingDocumentId: string;
  recognitionStatusByDocument: Record<string, string>;
  currentUserRole: string;
  canWriteDocuments: boolean;
  canRecognizeCustoms: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onRecognize: (order: TaxRefundDetail, document: TaxDocument) => void;
}) {
  const canPreviewOrDownload = ["管理员", "财务", "物流资料录入员", "物流供应商"].includes(currentUserRole);
  return (
    <div className={styles.customsUploadCard} id={taxTargetDomId("customs-documents")}>
      <strong>报关资料上传</strong>
      <div className={styles.fileUploadGrid}>
        {TAX_CUSTOMS_UPLOAD_TYPES.map((documentType) => {
          const matchedDocuments = documents.filter((document) => (
            document.documentType === documentType.value && document.uploadStatus === "SUCCESS"
          ));
          const document = latestTaxDocument(matchedDocuments)[0] || null;
          const canUpload = canUploadTaxDocument(currentUserRole, canWriteDocuments, documentType.value, readOnly);
          const canDelete = canDeleteTaxDocument(canWriteDocuments, readOnly);
          const uploading = uploadingKey === uploadScopeKey(order.id, documentType.value);
          const canRecognize = documentType.value === "CUSTOMS_ENTRY_FORM" && canRecognizeCustoms;
          const recognitionStatus = document
            ? recognitionStatusByDocument[document.id] || customsRecognitionStatusTextFromResult(document.customsRecognition) || "-"
            : "-";
          return (
            <FileUploadCard
              key={documentType.value}
              targetKey={taxDocumentTargetKey(documentType.value)}
              orderId={order.id}
              type={documentType.value}
              label={documentType.label}
              order={order}
              document={document}
              uploading={uploading}
              uploadProgress={uploadProgressByKey[uploadScopeKey(order.id, documentType.value)] || 0}
              deletingDocumentId={deletingDocumentId}
              recognizingDocumentId={recognizingDocumentId}
              recognitionStatus={recognitionStatus}
              canUpload={canUpload}
              canDelete={canDelete}
              canPreviewOrDownload={canPreviewOrDownload}
              canRecognize={canRecognize}
              onUpload={onUpload}
              onDelete={onDelete}
              onRecognize={onRecognize}
            />
          );
        })}
      </div>
    </div>
  );
}

export function DocumentFileTable({
  orderId,
  order,
  documents,
  deletingDocumentId,
  recognizingDocumentId,
  recognitionStatusByDocument,
  canPreviewOrDownload,
  canDelete,
  canRecognize,
  onDelete,
  onRecognize,
}: {
  orderId: string;
  order?: TaxRefundDetail;
  documents: TaxDocument[];
  deletingDocumentId: string;
  recognizingDocumentId: string;
  recognitionStatusByDocument: Record<string, string>;
  canPreviewOrDownload: boolean;
  canDelete: boolean;
  canRecognize: boolean;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onRecognize?: (order: TaxRefundDetail, document: TaxDocument) => void;
}) {
  const showRecognize = Boolean(canRecognize && order && onRecognize);
  if (!documents.length) {
    return <div className={styles.emptyState}>暂未上传</div>;
  }
  return (
    <div className={styles.documentFileTableWrap}>
      <table className={styles.documentFileTable}>
        <thead>
          <tr>
            <th>文件名</th>
            <th>上传人</th>
            <th>上传时间</th>
            <th>识别状态</th>
            <th>预览</th>
            <th>下载</th>
            <th>删除</th>
            {showRecognize ? <th>重新识别</th> : null}
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const recognizing = recognizingDocumentId === document.id;
            const recognitionStatus = recognizing
              ? "识别中..."
              : recognitionStatusByDocument[document.id] || "-";
            return (
              <tr key={document.id}>
                <td title={document.fileName || "-"}>{document.fileName || "-"}</td>
                <td>{document.uploadedByName || "-"}</td>
                <td>{formatDateTime(document.uploadedAt)}</td>
                <td><span className={styles.recognitionStatus}>{recognitionStatus}</span></td>
                <td>
                  {canPreviewOrDownload ? (
                    <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
                  ) : <span className={styles.mutedText}>-</span>}
                </td>
                <td>
                  {canPreviewOrDownload ? (
                    <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
                  ) : <span className={styles.mutedText}>-</span>}
                </td>
                <td>
                  {canDelete ? (
                    <button
                      className={styles.fileDangerButton}
                      type="button"
                      disabled={deletingDocumentId === document.id}
                      onClick={() => onDelete(orderId, document)}
                    >
                      {deletingDocumentId === document.id ? "删除中..." : "删除"}
                    </button>
                  ) : <span className={styles.mutedText}>-</span>}
                </td>
                {showRecognize ? (
                  <td>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={recognizing}
                      onClick={() => onRecognize?.(order as TaxRefundDetail, document)}
                    >
                      {recognizing ? "识别中..." : "重新识别报关单"}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FactoryCostUploadGroup({
  orderId,
  cost,
  documents,
  sameSupplierFactoryCostCount,
  displayIndex,
  uploadingKey,
  uploadProgressByKey,
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
  sameSupplierFactoryCostCount: number;
  displayIndex: number;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canWriteDocuments: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商";
  const scope = { costId: cost.id, supplierId: cost.supplierId || "" };
  const amountText = formatFactoryCostAmount(cost);
  const costLabel = sameSupplierFactoryCostCount > 1 ? `工厂货款 ${displayIndex}` : (logisticsCostTypeLabel(cost.costType || "") || cost.costType || "工厂成本");
  return (
    <div className={styles.documentGroupCard}>
      <strong>{sameSupplierFactoryCostCount > 1 ? `${supplierName} / ${costLabel}` : supplierName}</strong>
      <span className={styles.mutedText}>
        {[sameSupplierFactoryCostCount > 1 ? (logisticsCostTypeLabel(cost.costType || "") || cost.costType || "工厂成本") : costLabel, amountText].filter(Boolean).join(" · ")}
      </span>
      {TAX_FACTORY_UPLOAD_TYPES.map((documentType) => (
        <TaxUploadItem
          key={`${cost.id}-${documentType.value}`}
          targetKey={factoryDocumentTargetKey(cost.id, documentType.value)}
          orderId={orderId}
          type={documentType.value}
          label={documentType.label}
          documents={documents.filter((document) => (
            document.documentType === documentType.value
            && documentMatchesFactoryCostSlot(document, cost, sameSupplierFactoryCostCount)
          ))}
          uploading={uploadingKey === uploadScopeKey(orderId, documentType.value, scope)}
          uploadProgress={uploadProgressByKey[uploadScopeKey(orderId, documentType.value, scope)] || 0}
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

export function LogisticsInvoiceUploadItem({
  orderId,
  cost,
  documents,
  completeness,
  uploadingKey,
  uploadProgressByKey,
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
  completeness: DocumentCompleteness;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canWriteDocuments: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商";
  const scope = { costId: cost.id, supplierId: cost.supplierId || "" };
  const matchedDocuments = logisticsInvoiceDocumentsForCost(cost, documents, completeness);
  return (
    <TaxUploadItem
      targetKey={logisticsDocumentTargetKey(cost.id)}
      orderId={orderId}
      type="SUPPLIER_INVOICE"
      label={`${logisticsInvoiceLabel(cost)} / ${supplierName}`}
      documents={matchedDocuments}
      uploading={uploadingKey === uploadScopeKey(orderId, "SUPPLIER_INVOICE", scope)}
      uploadProgress={uploadProgressByKey[uploadScopeKey(orderId, "SUPPLIER_INVOICE", scope)] || 0}
      deletingDocumentId={deletingDocumentId}
      scope={scope}
      canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, "SUPPLIER_INVOICE", readOnly)}
      canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
      onUpload={onUpload}
      onDelete={onDelete}
    />
  );
}
