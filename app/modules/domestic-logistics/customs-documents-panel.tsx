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
  const newCustomsUploadKey = `${orderId}:CUSTOMS_ENTRY_FORM:new`;
  return (
    <div className={styles.documentGroupCard}>
      <strong>报关批次</strong>
      <div className={styles.subList}>
        {customsDeclarations.length ? customsDeclarations.map((declaration, index) => {
          const declarationTitle = declaration.batchNo || `报关批次 ${index + 1}`;
          const supplierLabel = declaration.supplierCount
            ? `${declaration.supplierCount} 个供应商 · ${declaration.supplierValidationStatus || "待校验"}`
            : "未绑定供应商资料";
          return (
            <section className={styles.documentGroupCard} key={declaration.id || index}>
              <div className={styles.fileListItem}>
                <div>
                  <span>{declarationTitle}{declaration.declarationNo ? ` · ${declaration.declarationNo}` : ""}</span>
                  <small>
                    申报日期：{formatDate(declaration.declarationDate || declaration.customsDeclarationDate)}
                    ｜ 报关金额：{formatAmount(declaration.declarationAmount ?? declaration.customsDeclarationAmount)}
                    ｜ 柜数：{formatCount(declaration.containerCount ?? declaration.customsDeclarationContainerCount)}
                    ｜ 报关资料完整度：{declaration.overallCompleteness == null ? "-" : `${declaration.overallCompleteness}%`}
                    ｜ 供应商资料：{supplierLabel}
                    ｜ 退税归档：{declaration.taxArchived ? "已归档" : "未归档"}
                  </small>
                  {declaration.supplierName ? <small>供应商：{declaration.supplierName}</small> : null}
                </div>
              </div>
              {CUSTOMS_DOCUMENT_TYPES.map((documentType) => {
                const currentDocument = batchDocumentFor(declaration, documentType.value, documents);
                const uploadKey = `${orderId}:${documentType.value}:${declaration.id}`;
                const uploading = uploadingKey === uploadKey;
                const uploadProgress = uploadProgressByKey[uploadKey] || 0;
                return (
                  <div className={styles.fileListItem} key={`${declaration.id}:${documentType.value}`}>
                    <div>
                      <span>{documentType.label}</span>
                      {currentDocument ? (
                        <small>
                          {currentDocument.fileName || "-"} ｜ {currentDocument.uploadedByName || "-"} ｜ {formatDateTime(currentDocument.uploadedAt)}
                        </small>
                      ) : (
                        <small>暂未上传到当前报关批次</small>
                      )}
                    </div>
                    <div>
                      {canUpload ? (
                        <>
                          <label className={styles.secondaryButton}>
                            {uploading ? "上传中..." : currentDocument ? UPLOAD_REPLACE_TEXT : "上传"}
                            <input
                              type="file"
                              accept={PDF_UPLOAD_ACCEPT}
                              disabled={uploading}
                              hidden
                              onChange={(event) => {
                                onUpload(orderId, documentType.value, event.target.files?.[0] || null, declaration.id);
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
            </section>
          );
        }) : (
          <div className={styles.emptyState}>该提单下暂无报关批次。上传报关单 PDF 后会自动生成一条退税子资料。</div>
        )}
      </div>
      {canUpload ? (
        <div className={styles.fileListItem}>
          <div>
            <span>新增报关批次</span>
            <small>一个提单可分多次报关，每个批次独立管理报关资料、供应商资料和退税归档。</small>
          </div>
          <div>
            <label className={styles.primaryButtonCompact}>
              {uploadingKey === newCustomsUploadKey ? "读取中..." : "新增报关批次PDF"}
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
    </div>
  );
}

function batchDocumentFor(
  declaration: DomesticCustomsDeclaration,
  uploadDocumentType: string,
  legacyDocuments: DomesticLogisticsDocument[] = [],
) {
  const scopedType = scopedCustomsDocumentType(uploadDocumentType);
  const scopedDocument = latestUploadedDocument((declaration.documents || []).filter((document) => (
    [scopedType, uploadDocumentType].includes(String(document.documentType || ""))
    && document.uploadStatus === "SUCCESS"
  )));
  if (scopedDocument) return scopedDocument;
  if (uploadDocumentType === "CUSTOMS_ENTRY_FORM") {
    return declaration.pdfDocument
      || legacyDocuments.find((document) => document.id === declaration.pdfDocumentId)
      || null;
  }
  return null;
}

function scopedCustomsDocumentType(documentType: string) {
  if (documentType === "CUSTOMS_ENTRY_FORM") return "CUSTOMS_DECLARATION_FORM";
  if (documentType === "RELEASE_NOTICE") return "CUSTOMS_RELEASE_NOTICE";
  if (documentType === "CUSTOMS_POWER_OF_ATTORNEY") return "CUSTOMS_AUTHORIZATION";
  return documentType;
}

function formatAmount(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
}

function formatCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? String(count) : "-";
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
