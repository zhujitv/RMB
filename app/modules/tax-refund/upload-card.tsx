import { PdfPreviewButton, fileDownloadUrl } from "../../components";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { UPLOAD_REPLACE_TEXT } from "../../uploadTexts";
import { PDF_UPLOAD_ACCEPT } from "../../utils";
import { latestTaxDocument, taxTargetDomId } from "./helpers";
import { type TaxDocument, type TaxRefundDetail, type UploadScope } from "./model";

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
  inlineUploadActions = false,
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
  inlineUploadActions?: boolean;
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
      inlineUploadActions={inlineUploadActions}
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
  document,
  uploading,
  uploadProgress = 0,
  deletingDocumentId,
  scope,
  canUpload,
  canDelete,
  canPreviewOrDownload,
  inlineUploadActions = false,
  onUpload,
  onDelete,
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
  scope?: UploadScope;
  canUpload: boolean;
  canDelete: boolean;
  canPreviewOrDownload: boolean;
  inlineUploadActions?: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
}) {
  const uploaded = Boolean(document);
  const deleting = Boolean(document?.id && deletingDocumentId === document.id);
  const uploadControl = canUpload ? (
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
  ) : (
    <button className={`${styles.secondaryButton} ${styles.fileUploadButton}`} type="button" disabled title="无权限操作">
      无权限操作
    </button>
  );
  const progressControl = uploading ? <UploadProgressInline progress={uploadProgress} /> : null;
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
          <div className={styles.fileUploadActions}>
            <span className={styles.fileUploadActionLabel}>操作：</span>
            {canPreviewOrDownload ? (
              <>
                <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
                <a className={styles.fileActionButton} href={fileDownloadUrl("order-document", document.id)}>下载</a>
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
            {inlineUploadActions ? uploadControl : null}
          </div>
        </div>
      ) : (
        <div className={styles.fileUploadEmpty}>暂未上传</div>
      )}
      {inlineUploadActions && document ? null : uploadControl}
      {progressControl}
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
