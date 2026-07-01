import { DetailField, DismissibleLayer, ExportInvoiceRemarkView } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { canDeleteTaxDocument, canRecognizeTaxCustoms, canUploadTaxDocument, factoryCostOrdinal, factorySupplierCosts, groupDocuments, latestTaxDocument, logisticsInvoiceCosts, taxDocumentTargetKey, taxRefundBillOfLadingText, taxTargetDomId, uploadScopeKey } from "./helpers";
import { TAX_EXPORT_UPLOAD_TYPES, type DocumentCompleteness, type TaxDocument, type TaxRefundDetail, type TaxRefundRow, type UploadScope } from "./model";
import {
  CustomsRecognitionForm,
  CustomsUploadCard,
  DocumentFileTable,
  FactoryCostUploadGroup,
  FileUploadCard,
  LogisticsInvoiceUploadItem,
} from "./upload-components";

export function TaxRefundDetailDrawer({
  row,
  detail,
  loading,
  error,
  readOnly,
  packageDownloading,
  submittingTax,
  cancelingArchive,
  refreshingCompleteness,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  recognizingDocumentId,
  recognitionStatusByDocument,
  canSendShippingDocuments,
  canRefreshCompleteness,
  onClose,
  onDownloadPackage,
  onSubmitTaxRefund,
  onCancelArchive,
  onRefreshCompleteness,
  onCustomsSaved,
  onUpload,
  onDelete,
  onRecognizeCustomsDocument,
  onRecognizeFromUploadedCustoms,
  onOpenManualShippingDocuments,
  canCreateSupplierDocumentRequest,
  onOpenSupplierDocumentRequest,
  onOpenDomesticLogistics,
  currentUserRole,
  canWriteDocuments,
}: {
  row: TaxRefundRow;
  detail: TaxRefundDetail | null;
  loading: boolean;
  error: string;
  readOnly: boolean;
  packageDownloading: boolean;
  submittingTax: boolean;
  cancelingArchive: boolean;
  refreshingCompleteness: boolean;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  recognizingDocumentId: string;
  recognitionStatusByDocument: Record<string, string>;
  canSendShippingDocuments: boolean;
  canRefreshCompleteness: boolean;
  onClose: () => void;
  onDownloadPackage: () => void;
  onSubmitTaxRefund: () => void;
  onCancelArchive: () => void;
  onRefreshCompleteness: () => void;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onRecognizeCustomsDocument: (order: TaxRefundDetail, document: TaxDocument) => void;
  onRecognizeFromUploadedCustoms: (order: TaxRefundDetail) => void;
  onOpenManualShippingDocuments: (order: TaxRefundDetail) => void;
  canCreateSupplierDocumentRequest: boolean;
  onOpenSupplierDocumentRequest: (order: TaxRefundDetail) => void;
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
            <button className={styles.secondaryButton} type="button" disabled={packageDownloading} onClick={onDownloadPackage}>
              {packageDownloading ? "下载中..." : "下载资料包"}
            </button>
            {canRefreshCompleteness ? (
              <button className={styles.secondaryButton} type="button" disabled={refreshingCompleteness || dismissLocked} onClick={onRefreshCompleteness}>
                {refreshingCompleteness ? "计算中..." : "重新计算完整度"}
              </button>
            ) : null}
            {readOnly ? (
              <button className={styles.secondaryButton} type="button" disabled={cancelingArchive} onClick={onCancelArchive}>
                {cancelingArchive ? "处理中..." : "取消归档"}
              </button>
            ) : (
              <button className={styles.secondaryButton} type="button" disabled={submittingTax} onClick={onSubmitTaxRefund}>
                {submittingTax ? "提交中..." : "提交退税并归档"}
              </button>
            )}
            {canCreateSupplierDocumentRequest && detail ? (
              <button className={styles.secondaryButton} type="button" onClick={() => onOpenSupplierDocumentRequest(detail)}>
                通知产品供应商回传
              </button>
            ) : null}
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </div>
        </header>
        <div className={styles.taxRefundDrawerBody}>
          <TaxRefundDetailPanel
            detail={detail}
            loading={loading}
            error={error}
            fallback={row}
            uploadingKey={uploadingKey}
            uploadProgressByKey={uploadProgressByKey}
            deletingDocumentId={deletingDocumentId}
            recognizingDocumentId={recognizingDocumentId}
            recognitionStatusByDocument={recognitionStatusByDocument}
            readOnly={readOnly}
            onCustomsSaved={onCustomsSaved}
            onUpload={onUpload}
            onDelete={onDelete}
            onRecognizeCustomsDocument={onRecognizeCustomsDocument}
            onRecognizeFromUploadedCustoms={onRecognizeFromUploadedCustoms}
            canSendShippingDocuments={canSendShippingDocuments}
            onOpenManualShippingDocuments={onOpenManualShippingDocuments}
            onOpenDomesticLogistics={onOpenDomesticLogistics}
            currentUserRole={currentUserRole}
            canWriteDocuments={canWriteDocuments}
          />
        </div>
        </>
      )}
    </DismissibleLayer>
  );
}

function TaxRefundDetailPanel({
  detail,
  loading,
  error,
  fallback,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  recognizingDocumentId,
  recognitionStatusByDocument,
  readOnly,
  onCustomsSaved,
  onUpload,
  onDelete,
  onRecognizeCustomsDocument,
  onRecognizeFromUploadedCustoms,
  canSendShippingDocuments,
  onOpenManualShippingDocuments,
  onOpenDomesticLogistics,
  currentUserRole,
  canWriteDocuments,
}: {
  detail: TaxRefundDetail | null;
  loading: boolean;
  error: string;
  fallback: TaxRefundRow;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  recognizingDocumentId: string;
  recognitionStatusByDocument: Record<string, string>;
  readOnly: boolean;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onRecognizeCustomsDocument: (order: TaxRefundDetail, document: TaxDocument) => void;
  onRecognizeFromUploadedCustoms: (order: TaxRefundDetail) => void;
  canSendShippingDocuments: boolean;
  onOpenManualShippingDocuments: (order: TaxRefundDetail) => void;
  onOpenDomesticLogistics?: () => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
}) {
  if (loading) return <div className={styles.emptyState}>资料详情加载中...</div>;
  if (error) return <div className={styles.inlineError}>{error}</div>;
  if (!detail) return <div className={styles.emptyState}>点击查看资料后加载详情</div>;

  const groups = groupDocuments(detail.documents || []);
  const domesticExportInvoiceRemark = detail.domesticLogisticsInfo?.exportInvoice?.remark || null;
  const domesticRemarkText = detail.domesticLogisticsInfo?.remarkText || "";
  const displayBillOfLadingNo = taxRefundBillOfLadingText(detail, fallback);
  const factoryCosts = factorySupplierCosts(detail.costs || []);
  const canRecognizeCustoms = canRecognizeTaxCustoms(currentUserRole, canWriteDocuments, readOnly);
  const showTaxArchiveRecord = Boolean(
    detail.taxRefundStatus === "SUBMITTED"
    || fallback.taxRefundStatus === "SUBMITTED"
    || detail.taxArchived
    || fallback.taxArchived,
  );

  return (
    <div className={styles.taxDetailPanel} id={taxTargetDomId("tax-detail-top")}>
      <div className={styles.documentGroupGrid}>
        {showTaxArchiveRecord ? (
          <div className={styles.documentGroupCard}>
            <strong>提交记录</strong>
            <div className={styles.detailGrid}>
              <DetailField label="提交人" value={detail.taxSubmittedByName || fallback.taxSubmittedByName || "-"} />
              <DetailField label="提交时间" value={formatDateTime(detail.taxSubmittedAt || fallback.taxSubmittedAt)} />
              <DetailField label="归档人" value={detail.taxRefundArchivedByName || fallback.taxRefundArchivedByName || "-"} />
              <DetailField label="归档时间" value={formatDateTime(detail.taxRefundArchivedAt || fallback.taxRefundArchivedAt)} />
              {(detail.taxRefundArchiveRemark || fallback.taxRefundArchiveRemark) ? (
                <DetailField label="备注" value={detail.taxRefundArchiveRemark || fallback.taxRefundArchiveRemark || "-"} wide />
              ) : null}
            </div>
          </div>
        ) : null}
        <div className={styles.documentGroupCard}>
          <strong>基础信息</strong>
          <div className={styles.detailGrid}>
            <DetailField label="客户全称" value={customerLegalName({ ...fallback, ...detail })} wide />
            <DetailField label="订单号" value={detail.orderNo || fallback.orderNo || "-"} />
            <DetailField label="提单号" value={displayBillOfLadingNo} />
            <DetailField label="币种" value={detail.currency || fallback.currency || "-"} />
            <DetailField label="申报日期" value={formatDate(detail.customsDeclarationDate || detail.declarationDate || fallback.customsDeclarationDate || fallback.declarationDate)} />
            <DetailField label="物流信息" value={detail.domesticLogisticsInfo?.archiveStatusLabel || (domesticRemarkText ? "已提交" : "未提交")} />
          </div>
        </div>
        <div className={styles.documentGroupCard} id={taxTargetDomId("domestic-logistics")}>
          <strong>出口发票备注</strong>
          <ExportInvoiceRemarkView
            remark={domesticExportInvoiceRemark}
            fallbackText={domesticRemarkText}
            emptyText="暂无出口发票备注，请前往物流信息维护。"
          />
          {onOpenDomesticLogistics ? (
            <button className={styles.secondaryButton} type="button" onClick={onOpenDomesticLogistics}>
              去维护物流信息
            </button>
          ) : null}
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
        <CustomsRecognitionForm
          detail={detail}
          readOnly={readOnly}
          recognizing={Boolean(recognizingDocumentId)}
          canRecognize={canRecognizeCustoms}
          onSaved={onCustomsSaved}
          onRecognizeFromUploadedCustoms={onRecognizeFromUploadedCustoms}
        />
        <div className={`${styles.documentGroupCard} ${styles.fileUploadSection}`}>
          <strong>出口资料上传</strong>
          <div className={styles.fileUploadGrid}>
            {TAX_EXPORT_UPLOAD_TYPES.map((documentType) => (
              <FileUploadCard
                key={documentType.value}
                targetKey={taxDocumentTargetKey(documentType.value)}
                orderId={detail.id}
                type={documentType.value}
                label={documentType.label}
                document={latestTaxDocument((detail.documents || []).filter((document) => (
                  document.documentType === documentType.value && document.uploadStatus === "SUCCESS"
                )))[0] || null}
                uploading={uploadingKey === uploadScopeKey(detail.id, documentType.value)}
                uploadProgress={uploadProgressByKey[uploadScopeKey(detail.id, documentType.value)] || 0}
                deletingDocumentId={deletingDocumentId}
                canUpload={canUploadTaxDocument(currentUserRole, canWriteDocuments, documentType.value, readOnly)}
                canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
                canPreviewOrDownload
                onUpload={onUpload}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
        <CustomsUploadCard
          order={detail}
          documents={detail.documents || []}
          uploadingKey={uploadingKey}
          uploadProgressByKey={uploadProgressByKey}
          deletingDocumentId={deletingDocumentId}
          recognizingDocumentId={recognizingDocumentId}
          recognitionStatusByDocument={recognitionStatusByDocument}
          currentUserRole={currentUserRole}
          canWriteDocuments={canWriteDocuments}
          canRecognizeCustoms={canRecognizeCustoms}
          readOnly={readOnly}
          onUpload={onUpload}
          onDelete={onDelete}
          onRecognize={onRecognizeCustomsDocument}
        />
        <div className={styles.documentGroupCard} id={taxTargetDomId("factory-section")}>
          <strong>工厂资料上传</strong>
          {factoryCosts.length ? factoryCosts.map((cost) => {
            const ordinal = factoryCostOrdinal(cost, factoryCosts);
            return (
              <FactoryCostUploadGroup
                key={cost.id}
                orderId={detail.id}
                cost={cost}
                documents={detail.documents || []}
                sameSupplierFactoryCostCount={ordinal.total}
                displayIndex={ordinal.index}
                uploadingKey={uploadingKey}
                uploadProgressByKey={uploadProgressByKey}
                deletingDocumentId={deletingDocumentId}
                currentUserRole={currentUserRole}
                canWriteDocuments={canWriteDocuments}
                readOnly={readOnly}
                onUpload={onUpload}
                onDelete={onDelete}
              />
            );
          }) : <span className={styles.mutedText}>暂未录入产品供应商成本</span>}
        </div>
        <div className={styles.documentGroupCard} id={taxTargetDomId("logistics-section")}>
          <strong>物流资料上传</strong>
          <LogisticsInvoiceRequirementStatus completeness={detail.documentCompleteness || {}} />
          {logisticsInvoiceCosts(detail.costs || []).length ? logisticsInvoiceCosts(detail.costs || []).map((cost) => (
            <LogisticsInvoiceUploadItem
              key={cost.id}
              orderId={detail.id}
              cost={cost}
              documents={detail.documents || []}
              completeness={detail.documentCompleteness || {}}
              uploadingKey={uploadingKey}
              uploadProgressByKey={uploadProgressByKey}
              deletingDocumentId={deletingDocumentId}
              currentUserRole={currentUserRole}
              canWriteDocuments={canWriteDocuments}
              readOnly={readOnly}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          )) : <span className={styles.mutedText}>暂未录入需要发票的物流费用</span>}
        </div>
        {Object.entries(groups).filter(([groupName]) => !["出口资料", "报关资料", "工厂资料", "物流资料"].includes(groupName)).map(([groupName, documents]) => (
          <div className={styles.documentGroupCard} key={groupName}>
            <strong>{groupName}</strong>
            <DocumentFileTable
              orderId={detail.id}
              documents={documents}
              deletingDocumentId={deletingDocumentId}
              recognizingDocumentId={recognizingDocumentId}
              recognitionStatusByDocument={recognitionStatusByDocument}
              canPreviewOrDownload
              canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
              canRecognize={false}
              onDelete={onDelete}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function LogisticsInvoiceRequirementStatus({ completeness }: { completeness: DocumentCompleteness }) {
  const requirements = completeness.logistics?.requirements || [];
  if (!requirements.length) return null;

  return (
    <div className={styles.detailGrid}>
      {requirements.map((requirement) => (
        <DetailField
          key={requirement.key || requirement.label || "logistics-invoice"}
          label={requirement.label || "物流费用发票"}
          value={(
            <span className={`${styles.statusPill} ${requirement.completed ? styles.statusSuccess : styles.statusWarning}`}>
              {requirement.completed ? "已完成" : "缺失"}
            </span>
          )}
        />
      ))}
    </div>
  );
}

export { CustomsFilePickerDialog, ManualShippingDocumentsDialog, SupplierDocumentRequestDialog } from "./dialogs";
