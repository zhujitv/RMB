import { useEffect, useState } from "react";
import { fileDownloadUrl, FilePreviewModal, PdfPreviewButton } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import { PAYMENT_VOUCHER_UPLOAD_ACCEPT, PDF_UPLOAD_ACCEPT } from "../../utils";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import styles from "../../WorkspaceShell.module.css";
import { costSupplierName, dateTimeLocalToIso, dateTimeLocalValue, hasPaymentVoucher, isProductSupplierPaid } from "./helpers";
import { type CostDocument, type CostRow } from "./model";

export function ProductSupplierPaymentPanel({
  cost,
  canManage,
  saving,
  voucherUploading,
  voucherProgress,
  onUpdatePayment,
  onUploadPaymentVoucher,
  onOpenPaymentVoucher,
}: {
  cost: CostRow;
  canManage: boolean;
  saving: boolean;
  voucherUploading: boolean;
  voucherProgress: number;
  onUpdatePayment: (cost: CostRow, paid: boolean, paidAt: string) => void;
  onUploadPaymentVoucher: (cost: CostRow, file: File | null) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  const paid = isProductSupplierPaid(cost);
  const [paidAtInput, setPaidAtInput] = useState(() => dateTimeLocalValue(cost.paidAt || cost.paymentDate || undefined));
  const voucherLabel = cost.paymentVoucherFileName ? "查看付款凭证" : paid ? "未上传水单" : "未上传";
  const paymentDateDirty = paidAtInput !== dateTimeLocalValue(cost.paidAt || cost.paymentDate || undefined);
  useWorkspaceTabDirty(paymentDateDirty);
  useWorkspaceTabBusy(saving || voucherUploading);

  useEffect(() => {
    setPaidAtInput(dateTimeLocalValue(cost.paidAt || cost.paymentDate || undefined));
  }, [cost.id, cost.paidAt, cost.paymentDate]);

  function submitPaid() {
    const nextPaidAt = dateTimeLocalToIso(paidAtInput || dateTimeLocalValue());
    onUpdatePayment(cost, true, nextPaidAt);
  }

  return (
    <div className={styles.fileListItem}>
      <div>
        <span>产品货款付款</span>
        <small>{paid ? `已付款 ｜ ${formatDateTime(cost.paidAt || cost.paymentDate)}` : "未付款，可先不上传凭证"}</small>
        <small>
          付款凭证：{hasPaymentVoucher(cost)
            ? <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>{voucherLabel}</button>
            : voucherLabel}
        </small>
      </div>
      <div className={styles.fileListItemActions}>
        {canManage ? (
          <>
            <label>
              <span className={styles.mutedText}>付款时间</span>
              <input
                className={styles.uiInput}
                type="datetime-local"
                value={paidAtInput}
                disabled={saving}
                onChange={(event) => setPaidAtInput(event.target.value)}
              />
            </label>
            <button className={paid ? styles.secondaryButton : styles.primaryButtonCompact} type="button" disabled={saving} onClick={submitPaid}>
              {saving ? "保存中..." : paid ? "更新付款时间" : "标记已付款"}
            </button>
            {paid ? (
              <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => onUpdatePayment(cost, false, "")}>
                取消付款
              </button>
            ) : null}
            <label className={styles.secondaryButton}>
              {voucherUploading ? "上传中..." : cost.paymentVoucherFileName ? "更换付款凭证" : "上传付款凭证"}
              <input
                type="file"
                accept={PAYMENT_VOUCHER_UPLOAD_ACCEPT}
                disabled={voucherUploading}
                hidden
                onChange={(event) => {
                  onUploadPaymentVoucher(cost, event.target.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {voucherUploading ? <UploadProgressInline progress={voucherProgress} /> : null}
          </>
        ) : (
          <span className={styles.mutedText}>只读</span>
        )}
      </div>
    </div>
  );
}

export function PaymentVoucherPreviewModal({
  cost,
  onClose,
}: {
  cost: CostRow;
  onClose: () => void;
}) {
  const supplierName = costSupplierName(cost);
  const cacheKey = cost.paymentVoucherUploadedAt || cost.updatedAt || cost.paymentVoucherFileName || cost.id;
  return (
    <FilePreviewModal
      fileKind="payment-voucher"
      fileId={cost.id}
      title="付款凭证"
      initialFileName={cost.paymentVoucherFileName || "汇款水单"}
      cacheKey={cacheKey}
      metaItems={[
        { label: "订单号", value: cost.orderNo || "-" },
        { label: "供应商", value: supplierName || "-" },
        { label: "付款时间", value: formatDateTime(cost.paidAt || cost.paymentDate) },
      ]}
      downloadLabel="下载凭证"
      onClose={onClose}
    />
  );
}

export function CostDocumentUploadItem({
  cost,
  documentType,
  documents,
  uploading,
  uploadProgress = 0,
  deletingDocumentId,
  canWriteDocuments,
  readOnlyReason,
  onUpload,
  onDelete,
}: {
  cost: CostRow;
  documentType: { value: string; label: string; required?: boolean };
  documents: CostDocument[];
  uploading: boolean;
  uploadProgress?: number;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  readOnlyReason?: string;
  onUpload: (cost: CostRow, documentType: string, file: File | null) => void;
  onDelete: (cost: CostRow, document: CostDocument) => void;
}) {
  const completed = documents.some((document) => document.uploadStatus === "SUCCESS");
  return (
    <div className={styles.fileListItem}>
      <div>
        <span>{documentType.label}</span>
        <small>{completed ? `已上传 ${documents.length} 个文件` : documentType.required ? "缺失" : "暂未上传"}</small>
        {documents.map((document) => (
          <small key={document.id}>
            {document.fileName || "-"} ｜ {document.uploadedByName || "-"} ｜ {formatDate(document.uploadedAt)}
          </small>
        ))}
      </div>
      <div>
        {canWriteDocuments ? (
          <>
            <label className={styles.secondaryButton}>
              {uploading ? "上传中..." : completed ? "替换/上传PDF" : "选择PDF"}
              <input
                type="file"
                accept={PDF_UPLOAD_ACCEPT}
                disabled={uploading}
                hidden
                onChange={(event) => {
                  onUpload(cost, documentType.value, event.target.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {uploading ? <UploadProgressInline progress={uploadProgress} /> : null}
          </>
        ) : (
          <span className={styles.mutedText}>{readOnlyReason || "无权限操作"}</span>
        )}
        {documents.map((document) => (
          <span key={document.id} className={styles.fileListItemActions}>
            <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
            <a className={styles.fileActionButton} href={fileDownloadUrl("order-document", document.id)}>下载</a>
            {canWriteDocuments ? (
              <button
                className={styles.fileDangerButton}
                type="button"
                disabled={deletingDocumentId === document.id}
                onClick={() => onDelete(cost, document)}
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
