import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api";
import { PdfPreviewButton, fileDownloadUrl } from "../../components";
import { formatDateTime } from "../../formatters";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import styles from "../../WorkspaceShell.module.css";
import { canDeleteTaxDocument, canUploadTaxDocument, latestTaxDocument, taxDocumentTargetKey, taxTargetDomId, uploadScopeKey } from "./helpers";
import { TAX_CUSTOMS_UPLOAD_TYPES, type TaxDocument, type TaxRefundDetail, type UploadScope } from "./model";
import { FileUploadCard } from "./upload-card";

export function CustomsRecognitionForm({
  detail,
  readOnly,
  onSaved,
}: {
  detail: TaxRefundDetail;
  readOnly: boolean;
  onSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
}) {
  const [customsDeclarationNo, setCustomsDeclarationNo] = useState(detail.customsDeclarationNo || "");
  const [customsDeclarationDate, setCustomsDeclarationDate] = useState(detail.customsDeclarationDate || "");
  const [saving, setSaving] = useState(false);
  const [rereading, setRereading] = useState(false);
  const [message, setMessage] = useState("");
  const detailIdRef = useRef(detail.id);
  const declarationNoRead = Boolean(detail.customsDeclarationNo);
  const declarationDateRead = Boolean(detail.customsDeclarationDate);
  const hasUploadedCustomsDeclarationPdf = (detail.documents || []).some((document) => (
    document.documentType === "CUSTOMS_ENTRY_FORM" && document.uploadStatus === "SUCCESS"
  ));
  const formDirty = customsDeclarationNo !== (detail.customsDeclarationNo || "")
    || customsDeclarationDate !== (detail.customsDeclarationDate || "");
  useWorkspaceTabDirty(formDirty);
  useWorkspaceTabBusy(saving || rereading);

  useEffect(() => {
    const detailChanged = detailIdRef.current !== detail.id;
    detailIdRef.current = detail.id;
    if (!detailChanged && formDirty) return;
    setCustomsDeclarationNo(detail.customsDeclarationNo || "");
    setCustomsDeclarationDate(detail.customsDeclarationDate || "");
    setMessage("");
  }, [detail.id, detail.customsDeclarationNo, detail.customsDeclarationDate, formDirty]);

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

  async function rereadCustomsDeclarationPdf() {
    if (formDirty && !window.confirm("当前手工填写的报关单信息尚未保存，重新读取将覆盖这些内容。确定继续吗？")) return;
    setRereading(true);
    setMessage("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        order?: TaxRefundDetail;
        customsPdfTextParse?: TaxDocument["customsPdfTextParse"];
      }>(`/api/tax-refund/${encodeURIComponent(detail.id)}/recognize-customs-declaration`, {
        method: "POST",
      });
      if (result.success !== true) throw new Error(result.message || "重新读取报关单信息失败");
      if (result.order) {
        setCustomsDeclarationNo(result.order.customsDeclarationNo || "");
        setCustomsDeclarationDate(result.order.customsDeclarationDate || "");
      }
      await onSaved(detail.id, result.order || null);
      const textResult = result.customsPdfTextParse;
      const declarationNoMessage = textResult?.customsDeclarationNo ? "已读取：报关单号" : "未读取到报关单号，请手动填写";
      const declarationDateMessage = textResult?.customsDeclarationDate ? "已读取：申报日期" : "未读取到申报日期，请手动填写";
      setMessage(`${declarationNoMessage}；${declarationDateMessage}`);
    } catch (rereadError) {
      setMessage(rereadError instanceof Error ? rereadError.message : "重新读取报关单信息失败");
    } finally {
      setRereading(false);
    }
  }

  return (
    <div className={styles.customsFormCard}>
      <div className={styles.customsFormHeader}>
        <div>
          <strong>报关单信息</strong>
          <span>上传报关单 PDF 后，系统将读取 PDF 文本内容，并自动回填报关单号和申报日期。</span>
        </div>
      </div>
      <div className={styles.customsFormGrid}>
        <label>
          <span>报关单号</span>
          <input
            value={customsDeclarationNo}
            disabled={readOnly || saving || rereading}
            onChange={(event) => setCustomsDeclarationNo(event.target.value)}
            placeholder="请输入报关单号"
          />
        </label>
        <label>
          <span>申报日期</span>
          <input
            type="date"
            value={customsDeclarationDate}
            disabled={readOnly || saving || rereading}
            onChange={(event) => setCustomsDeclarationDate(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.customsReadMessage}>
        <div>{declarationNoRead ? "已读取：报关单号" : "未读取到报关单号，请手动填写"}</div>
        <div>{declarationDateRead ? "已读取：申报日期" : "未读取到申报日期，请手动填写"}</div>
      </div>
      <div className={styles.customsFormActions}>
        {message ? <span>{message}</span> : <span>保存后将同步更新退税资料列表的申报日期。</span>}
        {readOnly ? null : (
          <div className={styles.inlineActionGroup}>
            <button className={styles.primaryButtonCompact} type="button" disabled={saving || rereading} onClick={saveCustomsRecognition}>
              {saving ? "保存中..." : "保存报关单信息"}
            </button>
            {hasUploadedCustomsDeclarationPdf ? (
              <button className={styles.secondaryButton} type="button" disabled={saving || rereading} onClick={rereadCustomsDeclarationPdf}>
                {rereading ? "读取中..." : "重新读取报关单信息"}
              </button>
            ) : null}
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
  currentUserRole,
  canWriteDocuments,
  readOnly,
  onUpload,
  onDelete,
}: {
  order: TaxRefundDetail;
  documents: TaxDocument[];
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canWriteDocuments: boolean;
  readOnly: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
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
              canUpload={canUpload}
              canDelete={canDelete}
              canPreviewOrDownload={canPreviewOrDownload}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </div>
  );
}

export function DocumentFileTable({
  orderId,
  documents,
  deletingDocumentId,
  canPreviewOrDownload,
  canDelete,
  onDelete,
}: {
  orderId: string;
  order?: TaxRefundDetail;
  documents: TaxDocument[];
  deletingDocumentId: string;
  canPreviewOrDownload: boolean;
  canDelete: boolean;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
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
            <th>预览</th>
            <th>下载</th>
            <th>删除</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            return (
              <tr key={document.id}>
                <td title={document.fileName || "-"}>{document.fileName || "-"}</td>
                <td>{document.uploadedByName || "-"}</td>
                <td>{formatDateTime(document.uploadedAt)}</td>
                <td>
                  {canPreviewOrDownload ? (
                    <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
                  ) : <span className={styles.mutedText}>-</span>}
                </td>
                <td>
                  {canPreviewOrDownload ? (
                    <a className={styles.fileActionButton} href={fileDownloadUrl("order-document", document.id)}>下载</a>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
