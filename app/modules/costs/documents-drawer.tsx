import { useEffect, useState } from "react";
import { DetailField, DismissibleLayer, FilePreviewModal, PdfPreviewButton, fileDownloadUrl } from "../../components";
import { formatDate, formatDateTime, moneyText } from "../../formatters";
import { PAYMENT_VOUCHER_UPLOAD_ACCEPT, PDF_UPLOAD_ACCEPT } from "../../utils";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import styles from "../../WorkspaceShell.module.css";
import { COST_FILTER_TYPE_LABELS, COST_FILTER_TYPES, type CostDocument, type CostRow } from "./model";
import { costDocumentTypesForDrawer, costSupplierName, costUploadKey, dateTimeLocalToIso, dateTimeLocalValue, documentsForType, hasPaymentVoucher, isFactoryCost, isLogisticsGeneratedCost, isLogisticsInvoiceCost, isProductSupplierPaid, isProductSupplierPaymentEnabled, paymentVoucherUploadKey } from "./helpers";

export function CostDocumentsDrawer({
  cost,
  loading,
  error,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  canWriteDocuments,
  canManageCostType,
  canManageFactoryPayments,
  costTypeSaving,
  paymentSavingId,
  voucherUploadingKey,
  onClose,
  onUpload,
  onUpdateCostType,
  onUpdatePayment,
  onUploadPaymentVoucher,
  onOpenPaymentVoucher,
  onDelete,
}: {
  cost: CostRow;
  loading: boolean;
  error: string;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  canManageCostType: boolean;
  canManageFactoryPayments: boolean;
  costTypeSaving: boolean;
  paymentSavingId: string;
  voucherUploadingKey: string;
  onClose: () => void;
  onUpload: (cost: CostRow, documentType: string, file: File | null) => void;
  onUpdateCostType: (cost: CostRow, costType: string, reason: string) => void;
  onUpdatePayment: (cost: CostRow, paid: boolean, paidAt: string) => void;
  onUploadPaymentVoucher: (cost: CostRow, file: File | null) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onDelete: (cost: CostRow, document: CostDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const documentTypes = costDocumentTypesForDrawer(cost);
  const paymentVoucherKey = paymentVoucherUploadKey(cost);
  const paymentEnabled = isProductSupplierPaymentEnabled(cost);
  const dismissConfirmMessage = uploadingKey || voucherUploadingKey ? "当前内容尚未保存，确定关闭吗？" : "";
  const logisticsGenerated = isLogisticsGeneratedCost(cost);
  const canManageDocuments = canWriteDocuments && !logisticsGenerated;
  const readOnlyReason = logisticsGenerated
    ? "该成本来自物流费用审核，发票按物流费用模块的分组开票规则上传；成本管理仅同步查看，不能在这里上传、替换或删除。"
    : "";
  const [selectedCostType, setSelectedCostType] = useState(cost.costType || "");
  const [costTypeReason, setCostTypeReason] = useState("");
  const costTypeOptions = (cost.costType && !COST_FILTER_TYPES.includes(cost.costType)
    ? [cost.costType, ...COST_FILTER_TYPES]
    : COST_FILTER_TYPES
  ).filter((type, index, rows) => rows.indexOf(type) === index);

  useEffect(() => {
    setSelectedCostType(cost.costType || "");
    setCostTypeReason("");
  }, [cost.id, cost.costType]);

  function submitCostTypeChange() {
    onUpdateCostType(cost, selectedCostType, costTypeReason);
  }

  return (
    <DismissibleLayer
      ariaLabel="成本资料维护"
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
            <span>供应商资料 / 发票资料</span>
            <strong>{cost.orderNo || "-"} · {supplierName}</strong>
            <small>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} · 提单号：{cost.blNo || cost.billOfLadingNo || "-"}</small>
          </div>
          <div className={styles.taxRefundDrawerActions}>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </div>
        </header>
        <div className={styles.taxRefundDrawerBody}>
          {loading ? <div className={styles.emptyState}>资料加载中...</div> : null}
          {error ? <div className={styles.inlineError}>{error}</div> : null}
          <div className={styles.documentGroupGrid}>
            <div className={styles.documentGroupCard}>
              <strong>成本信息</strong>
              <div className={styles.detailGrid}>
                <DetailField label="订单号" value={cost.orderNo || "-"} />
                <DetailField label="供应商" value={supplierName} />
                {canManageCostType ? (
                  <label>
                    成本类型
                    <select className={styles.uiSelect} value={selectedCostType} disabled={costTypeSaving} onChange={(event) => setSelectedCostType(event.target.value)}>
                      {costTypeOptions.map((type) => <option key={type} value={type}>{COST_FILTER_TYPE_LABELS[type] || logisticsCostTypeLabel(type) || type}</option>)}
                    </select>
                  </label>
                ) : (
                  <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
                )}
                <DetailField label="成本金额" value={moneyText(cost.currency, cost.amount, cost.amountCny)} />
                <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
                <DetailField label="发票状态" value={cost.invoiceStatus || "-"} />
                {canManageCostType ? (
                  <label>
                    修改原因
                    <input
                      className={styles.uiInput}
                      value={costTypeReason}
                      disabled={costTypeSaving || selectedCostType === (cost.costType || "")}
                      onChange={(event) => setCostTypeReason(event.target.value)}
                      placeholder="必填，例如：原费用误选，按发票改为港杂费"
                    />
                  </label>
                ) : null}
              </div>
              {canManageCostType ? (
                <div className={styles.detailActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={costTypeSaving || !selectedCostType || selectedCostType === (cost.costType || "") || !costTypeReason.trim()}
                    onClick={submitCostTypeChange}
                  >
                    {costTypeSaving ? "保存中..." : "保存成本类型"}
                  </button>
                </div>
              ) : null}
            </div>
            <div className={styles.documentGroupCard}>
              <strong>资料要求</strong>
              <span className={styles.mutedText}>
                {logisticsGenerated ? "物流费用发票以发票分组为准：报关费、港杂费、海运费、拖车及其他费用合并发票。成本管理只展示同步结果。"
                  : isFactoryCost(cost) ? "产品供应商需维护采购合同和增值税发票。"
                    : isLogisticsInvoiceCost(cost) ? "客户指定临时货代或手工录入的物流成本，可在成本管理维护对应物流发票。"
                      : "当前成本可维护一份发票资料。"}
              </span>
            </div>
          </div>
          <div className={styles.documentGroupCard}>
            <strong>资料维护</strong>
            {readOnlyReason ? <div className={styles.infoStrip}>{readOnlyReason}</div> : null}
            {paymentEnabled ? (
              <ProductSupplierPaymentPanel
                cost={cost}
                canManage={canManageFactoryPayments}
                saving={paymentSavingId === cost.id}
                voucherUploading={voucherUploadingKey === paymentVoucherKey}
                voucherProgress={uploadProgressByKey[paymentVoucherKey] || 0}
                onUpdatePayment={onUpdatePayment}
                onUploadPaymentVoucher={onUploadPaymentVoucher}
                onOpenPaymentVoucher={onOpenPaymentVoucher}
              />
            ) : null}
            {documentTypes.map((documentType) => (
              <CostDocumentUploadItem
                key={`${cost.id}-${documentType.value}`}
                cost={cost}
                documentType={documentType}
                documents={documentsForType(cost, documentType.value)}
                uploading={uploadingKey === costUploadKey(cost, documentType.value)}
                uploadProgress={uploadProgressByKey[costUploadKey(cost, documentType.value)] || 0}
                deletingDocumentId={deletingDocumentId}
                canWriteDocuments={canManageDocuments}
                readOnlyReason={readOnlyReason}
                onUpload={onUpload}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
        </>
      )}
    </DismissibleLayer>
  );
}

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
  return (
    <FilePreviewModal
      fileKind="payment-voucher"
      fileId={cost.id}
      title="付款凭证"
      initialFileName={cost.paymentVoucherFileName || "汇款水单"}
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
