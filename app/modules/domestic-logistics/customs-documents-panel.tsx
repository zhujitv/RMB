import { PdfPreviewButton, fileDownloadUrl } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { UPLOAD_REPLACE_TEXT } from "../../uploadTexts";
import { PDF_UPLOAD_ACCEPT } from "../../utils";
import { latestUploadedDocument } from "./helpers";
import { CUSTOMS_DOCUMENT_TYPES, type DomesticCustomsDeclaration, type DomesticLogisticsDocument } from "./model";

export function CustomsDocumentPanel({
  orderId,
  documents,
  customsDeclarations,
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
  customsDeclarations: DomesticCustomsDeclaration[];
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null, customsDeclarationId?: string) => void;
  onDelete: (document: DomesticLogisticsDocument) => void;
}) {
  const canPreviewOrDownload = ["管理员", "财务", "物流资料录入员", "物流供应商"].includes(currentUserRole);
  const customsDocumentTypes = CUSTOMS_DOCUMENT_TYPES.filter((item) => item.value !== "CUSTOMS_ENTRY_FORM");
  const newCustomsUploadKey = `${orderId}:CUSTOMS_ENTRY_FORM:new`;
  return (
    <div className={styles.documentGroupCard}>
      <strong>报关单列表</strong>
      <div className={styles.subList}>
        {customsDeclarations.length ? customsDeclarations.map((declaration, index) => {
          const currentDocument = declaration.pdfDocument
            || documents.find((document) => document.id === declaration.pdfDocumentId)
            || null;
          const uploadKey = `${orderId}:CUSTOMS_ENTRY_FORM:${declaration.id}`;
          const uploading = uploadingKey === uploadKey;
          const uploadProgress = uploadProgressByKey[uploadKey] || 0;
          return (
            <div className={styles.fileListItem} key={declaration.id || index}>
              <div>
                <span>报关单 {index + 1}{declaration.declarationNo ? ` · ${declaration.declarationNo}` : ""}</span>
                <small>
                  申报日期：{formatDate(declaration.declarationDate || declaration.customsDeclarationDate)}
                  ｜ PDF：{currentDocument ? "已上传" : "未上传"}
                  ｜ 完整度：{declaration.overallCompleteness == null ? "-" : `${declaration.overallCompleteness}%`}
                  ｜ 归档：{declaration.taxArchived ? "已归档" : "未归档"}
                  {declaration.supplierName ? ` ｜ 供应商：${declaration.supplierName}` : ""}
                </small>
                {currentDocument ? (
                  <small>{currentDocument.fileName || "-"} ｜ {currentDocument.uploadedByName || "-"} ｜ {formatDateTime(currentDocument.uploadedAt)}</small>
                ) : null}
              </div>
              <div>
                {canUpload ? (
                  <>
                    <label className={styles.secondaryButton}>
                      {uploading ? "读取中..." : (currentDocument ? UPLOAD_REPLACE_TEXT : "上传报关单PDF")}
                      <input
                        type="file"
                        accept={PDF_UPLOAD_ACCEPT}
                        disabled={uploading}
                        hidden
                        onChange={(event) => {
                          onUpload(orderId, "CUSTOMS_ENTRY_FORM", event.target.files?.[0] || null, declaration.id);
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
                        <a className={styles.fileActionButton} href={fileDownloadUrl("order-document", currentDocument.id)}>下载</a>
                      </>
                    ) : null}
                    {canDelete ? (
                      <button
                        className={styles.fileDangerButton}
                        type="button"
                        disabled={deletingDocumentId === currentDocument.id}
                        onClick={() => onDelete(currentDocument)}
                      >
                        {deletingDocumentId === currentDocument.id ? "删除中..." : "删除报关单"}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          );
        }) : (
          <div className={styles.emptyState}>该提单下暂无报关单。上传报关单 PDF 后会自动生成一条退税子资料。</div>
        )}
      </div>
      {canUpload ? (
        <div className={styles.fileListItem}>
          <div>
            <span>新增报关单</span>
            <small>一个提单可上传多份报关单 PDF，每份报关单单独读取报关单号和申报日期。</small>
          </div>
          <div>
            <label className={styles.primaryButtonCompact}>
              {uploadingKey === newCustomsUploadKey ? "读取中..." : "新增报关单PDF"}
              <input
                type="file"
                accept={PDF_UPLOAD_ACCEPT}
                disabled={uploadingKey === newCustomsUploadKey}
                hidden
                onChange={(event) => {
                  onUpload(orderId, "CUSTOMS_ENTRY_FORM", event.target.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {uploadingKey === newCustomsUploadKey ? <UploadProgressInline progress={uploadProgressByKey[newCustomsUploadKey] || 0} /> : null}
          </div>
        </div>
      ) : null}

      <strong>其它报关资料</strong>
      {customsDocumentTypes.map((documentType) => {
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
                    {uploading ? "上传中..." : UPLOAD_REPLACE_TEXT}
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
                      <a className={styles.fileActionButton} href={fileDownloadUrl("order-document", currentDocument.id)}>下载</a>
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
