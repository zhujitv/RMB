import { DismissibleLayer } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { taxRefundBillOfLadingText } from "./helpers";
import { type TaxDocument, type TaxRefundDetail, type TaxRefundDetailTab, type TaxRefundRow, type UploadScope } from "./model";
import { TaxRefundDetailPanel } from "./detail-panel";

export function TaxRefundDetailDrawer({
  row,
  detail,
  loading,
  activeTab,
  loadedSections,
  sectionLoading,
  error,
  readOnly,
  packageDownloading,
  submittingTax,
  cancelingArchive,
  refreshingCompleteness,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  canRefreshCompleteness,
  onClose,
  onSelectTab,
  onDownloadPackage,
  onSubmitTaxRefund,
  onCancelArchive,
  onRefreshCompleteness,
  onCustomsSaved,
  onUpload,
  onDelete,
  onOpenSupplierDocuments,
  onOpenDomesticLogistics,
  currentUserRole,
  canWriteDocuments,
}: {
  row: TaxRefundRow;
  detail: TaxRefundDetail | null;
  loading: boolean;
  activeTab: TaxRefundDetailTab;
  loadedSections: Record<TaxRefundDetailTab, boolean>;
  sectionLoading: Record<TaxRefundDetailTab, boolean>;
  error: string;
  readOnly: boolean;
  packageDownloading: boolean;
  submittingTax: boolean;
  cancelingArchive: boolean;
  refreshingCompleteness: boolean;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  canRefreshCompleteness: boolean;
  onClose: () => void;
  onSelectTab: (tab: TaxRefundDetailTab) => void;
  onDownloadPackage: () => void;
  onSubmitTaxRefund: () => void;
  onCancelArchive: () => void;
  onRefreshCompleteness: () => void;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onOpenSupplierDocuments: (keyword: string) => void;
  onOpenDomesticLogistics?: () => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
}) {
  const displayCustomer = customerLegalName(row);
  const displayBillOfLadingNo = taxRefundBillOfLadingText(detail || {}, row);
  const dismissLocked = packageDownloading || submittingTax || Boolean(uploadingKey);
  const dismissConfirmMessage = dismissLocked ? "当前内容尚未保存，确定关闭吗？" : "";

  return (
    <DismissibleLayer
      ariaLabel="退税资料详情"
      overlayClassName={styles.drawerOverlay}
      surfaceClassName={styles.taxRefundDrawer}
      dismissible
      dismissConfirmMessage={dismissConfirmMessage}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
        <header className={styles.taxRefundDrawerHeader}>
          <div className={styles.taxRefundDrawerTitle}>
            <span>退税资料详情</span>
            <strong>{row.orderNo || "-"} · {displayCustomer}</strong>
            <small>提单号：{displayBillOfLadingNo}</small>
          </div>
          <div className={styles.taxRefundDrawerActions}>
            {readOnly ? (
              <button className={styles.secondaryButton} type="button" disabled={cancelingArchive} onClick={onCancelArchive}>
                {cancelingArchive ? "处理中..." : "取消归档"}
              </button>
            ) : (
              <button className={styles.primaryButtonCompact} type="button" disabled={submittingTax} onClick={onSubmitTaxRefund}>
                {submittingTax ? "提交中..." : "提交归档"}
              </button>
            )}
            <button className={styles.secondaryButton} type="button" disabled={packageDownloading} onClick={onDownloadPackage}>
              {packageDownloading ? "下载中..." : "下载资料包"}
            </button>
            {canRefreshCompleteness ? (
              <button className={styles.secondaryButton} type="button" disabled={refreshingCompleteness || dismissLocked} onClick={onRefreshCompleteness}>
                {refreshingCompleteness ? "计算中..." : "重新计算完整度"}
              </button>
            ) : null}
            <button className={styles.secondaryButton} type="button" onClick={requestClose}>关闭</button>
          </div>
        </header>
        <div className={styles.taxRefundDrawerBody}>
          <TaxRefundDetailPanel
            detail={detail}
            loading={loading}
            activeTab={activeTab}
            loadedSections={loadedSections}
            sectionLoading={sectionLoading}
            error={error}
            fallback={row}
            uploadingKey={uploadingKey}
            uploadProgressByKey={uploadProgressByKey}
            deletingDocumentId={deletingDocumentId}
            readOnly={readOnly}
            onCustomsSaved={onCustomsSaved}
            onUpload={onUpload}
            onDelete={onDelete}
            onOpenDomesticLogistics={onOpenDomesticLogistics}
            onOpenSupplierDocuments={onOpenSupplierDocuments}
            currentUserRole={currentUserRole}
            canWriteDocuments={canWriteDocuments}
            onSelectTab={onSelectTab}
          />
        </div>
        </>
      )}
    </DismissibleLayer>
  );
}
