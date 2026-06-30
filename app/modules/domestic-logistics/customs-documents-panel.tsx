import { PdfPreviewButton } from "../../components";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { UPLOAD_REPLACE_TEXT } from "../../uploadTexts";
import { PDF_UPLOAD_ACCEPT } from "../../utils";
import { latestUploadedDocument } from "./helpers";
import { CUSTOMS_DOCUMENT_TYPES, type DomesticLogisticsDocument } from "./model";

export function CustomsDocumentPanel({
  orderId,
  documents,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  currentUserRole,
  canUpload,
  canDelete,
  onUpload,
  onDelete,
}: {
  orderId: string;
  documents: DomesticLogisticsDocument[];
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null) => void;
  onDelete: (document: DomesticLogisticsDocument) => void;
}) {
  const canPreviewOrDownload = ["管理员", "财务", "物流资料录入员", "物流供应商"].includes(currentUserRole);
  return (
    <div className={styles.documentGroupCard}>
      <strong>报关资料上传</strong>
      {CUSTOMS_DOCUMENT_TYPES.map((documentType) => {
        const matchedDocuments = documents.filter((document) => (
          document.documentType === documentType.value && document.uploadStatus === "SUCCESS"
        ));
        const currentDocument = latestUploadedDocument(matchedDocuments);
        const uploading = uploadingKey === `${orderId}:${documentType.value}`;
        const uploadProgress = uploadProgressByKey[`${orderId}:${documentType.value}`] || 0;
        return (
          <div className={styles.fileListItem} key={documentType.value}>
            <div>
              <span>{documentType.label}</span>
              {currentDocument ? (
                <small>
                  {currentDocument.fileName || "-"} ｜ {currentDocument.uploadedByName || "-"} ｜ {formatDateTime(currentDocument.uploadedAt)}
                </small>
              ) : (
                <small>暂未上传</small>
              )}
            </div>
            <div>
              {canUpload ? (
                <>
                  <label className={styles.secondaryButton}>
                    {uploading
                      ? (documentType.value === "CUSTOMS_ENTRY_FORM" ? "识别中..." : "上传中...")
                      : UPLOAD_REPLACE_TEXT}
                    <input
                      type="file"
                      accept={PDF_UPLOAD_ACCEPT}
                      disabled={uploading}
                      hidden
                      onChange={(event) => {
                        onUpload(orderId, documentType.value, event.target.files?.[0] || null);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {uploading ? <UploadProgressInline progress={uploadProgress} /> : null}
                </>
              ) : null}
              {currentDocument ? (
                <>
                  {canPreviewOrDownload ? (
                    <>
                      <PdfPreviewButton documentId={currentDocument.id} fileName={currentDocument.fileName || ""} />
                      <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(currentDocument.id)}/download`}>下载</a>
                    </>
                  ) : null}
                  {canDelete ? (
                    <button
                      className={styles.fileDangerButton}
                      type="button"
                      disabled={deletingDocumentId === currentDocument.id}
                      onClick={() => onDelete(currentDocument)}
                    >
                      {deletingDocumentId === currentDocument.id ? "删除中..." : "删除"}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UploadProgressInline({ progress }: { progress: number }) {
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
