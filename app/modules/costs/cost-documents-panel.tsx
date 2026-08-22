import { useEffect, useState } from "react";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { DetailField, DismissibleLayer } from "../../components";
import { moneyText } from "../../formatters";
import { useWorkspaceTabBusy, useWorkspaceTabDirty, useWorkspaceTabDiscardGuard } from "../../workspace/workspace-tab-context";
import styles from "../../WorkspaceShell.module.css";
import { CostDocumentUploadItem, ProductSupplierPaymentPanel } from "./cost-document-actions-panel";
import { canDeleteCost, canVoidCost, costDocumentTypesForDrawer, costUploadKey, documentsForType, isFactoryCost, isFactoryPurchaseSettlementCost, isLogisticsGeneratedCost, isLogisticsInvoiceCost, isPaymentVoucherEvidenceEnabled, isProductSupplierPaymentEnabled, isVoidedCost, paymentVoucherUploadKey } from "./helpers";
import { COST_FILTER_TYPE_LABELS, COST_FILTER_TYPES, type CostDocument, type CostRow } from "./model";

export function CostDocumentsDrawer({
  cost,
  loading,
  error,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  canWriteCosts,
  canRestoreCosts,
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
  onEditCost,
  onCopyCost,
  onVoidCost,
  onDeleteCost,
  onRestoreCost,
  onDelete,
}: {
  cost: CostRow;
  loading: boolean;
  error: string;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  canWriteCosts: boolean;
  canRestoreCosts: boolean;
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
  onEditCost: () => void;
  onCopyCost: () => void;
  onVoidCost: () => void;
  onDeleteCost: () => void;
  onRestoreCost: () => void;
  onDelete: (cost: CostRow, document: CostDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const documentTypes = costDocumentTypesForDrawer(cost);
  const paymentVoucherKey = paymentVoucherUploadKey(cost);
  const paymentPanelVisible = isProductSupplierPaymentEnabled(cost) || isFactoryPurchaseSettlementCost(cost);
  const voucherEvidenceEnabled = isPaymentVoucherEvidenceEnabled(cost);
  const logisticsGenerated = isLogisticsGeneratedCost(cost);
  const factorySettlementGenerated = isFactoryPurchaseSettlementCost(cost);
  const voided = isVoidedCost(cost);
  const canManageDocuments = canWriteDocuments && !logisticsGenerated && !factorySettlementGenerated && !voided;
  const canEditCostType = canManageCostType && !factorySettlementGenerated && !voided;
  const deleteAllowed = canDeleteCost(cost);
  const voidAllowed = canVoidCost(cost);
  const readOnlyReason = factorySettlementGenerated
    ? voucherEvidenceEnabled
      ? "该成本由采购结算自动生成，结算金额与付款状态在采购执行模块维护；此处仅可查看或上传最终付款凭证。"
      : "该成本由采购结算自动生成，结算金额与付款状态在采购执行模块维护；全额结清后可上传最终付款凭证。"
    : logisticsGenerated
    ? "该成本来自物流费用审核，发票按物流费用模块的分组开票规则上传；成本管理仅同步查看，不能在这里上传、替换或删除。"
    : voided
      ? "该成本已作废，仅保留历史金额、附件、付款凭证和操作日志。恢复后才能继续维护。"
      : "";
  const [selectedCostType, setSelectedCostType] = useState(cost.costType || "");
  const [costTypeReason, setCostTypeReason] = useState("");
  const costTypeDirty = selectedCostType !== (cost.costType || "") || Boolean(costTypeReason.trim());
  const drawerBusy = Boolean(uploadingKey || voucherUploadingKey || costTypeSaving || paymentSavingId || deletingDocumentId);
  const dismissConfirmMessage = costTypeDirty ? "当前内容尚未保存，确定关闭吗？" : "";
  useWorkspaceTabDirty(costTypeDirty);
  useWorkspaceTabBusy(drawerBusy);
  const confirmDrawerTransition = useWorkspaceTabDiscardGuard("当前成本资料有未保存修改，确定放弃并继续吗？");
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

  function runGuardedTransition(action: () => void) {
    if (!confirmDrawerTransition()) return;
    action();
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
              {canWriteCosts && !logisticsGenerated && !factorySettlementGenerated ? (
                <>
                  {voided ? canRestoreCosts ? (
                    <button className={styles.secondaryButton} type="button" disabled={drawerBusy} onClick={() => runGuardedTransition(onRestoreCost)}>恢复作废</button>
                  ) : null : (
                    <>
                      <button className={styles.secondaryButton} type="button" disabled={drawerBusy} onClick={() => runGuardedTransition(onEditCost)}>编辑</button>
                      <button className={styles.secondaryButton} type="button" disabled={drawerBusy} onClick={() => runGuardedTransition(onCopyCost)}>复制</button>
                      {voidAllowed ? <button className={styles.secondaryButton} type="button" disabled={drawerBusy} onClick={() => runGuardedTransition(onVoidCost)}>作废</button> : null}
                      {deleteAllowed ? <button className={styles.fileDangerButton} type="button" disabled={drawerBusy} onClick={() => runGuardedTransition(onDeleteCost)}>删除</button> : null}
                    </>
                  )}
                </>
              ) : null}
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
                  {canEditCostType ? (
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
                  {canEditCostType ? (
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
                {canEditCostType ? (
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
                  {factorySettlementGenerated ? "采购结算资料由采购执行模块维护，成本管理仅展示已关联资料。"
                    : logisticsGenerated ? "物流费用发票以发票分组为准：报关费、港杂费、海运费、拖车及其他费用合并发票。成本管理只展示同步结果。"
                    : isFactoryCost(cost) ? "产品供应商需维护采购合同和增值税发票。"
                      : isLogisticsInvoiceCost(cost) ? "客户指定临时货代或手工录入的物流成本，可在成本管理维护对应物流发票。"
                        : "当前成本可维护一份发票资料。"}
                </span>
              </div>
            </div>
            <div className={styles.documentGroupCard}>
              <strong>资料维护</strong>
              {readOnlyReason ? <div className={styles.infoStrip}>{readOnlyReason}</div> : null}
              {paymentPanelVisible ? (
                <ProductSupplierPaymentPanel
                  cost={cost}
                  canManagePayment={canManageFactoryPayments && !factorySettlementGenerated && !voided}
                  canUploadVoucher={canManageFactoryPayments && voucherEvidenceEnabled && !voided}
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
