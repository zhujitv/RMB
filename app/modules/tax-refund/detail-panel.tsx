import { DetailField } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { canDeleteTaxDocument, canUploadTaxDocument, factoryCostOrdinal, factorySupplierCosts, groupDocuments, latestTaxDocument, logisticsInvoiceCosts, taxDocumentTargetKey, taxRefundBillOfLadingText, taxTargetDomId, uploadScopeKey } from "./helpers";
import { TAX_EXPORT_UPLOAD_TYPES, type TaxRefundDetailTab } from "./model";
import { CustomsRecognitionForm, CustomsUploadCard, DocumentFileTable, FactoryCostUploadGroup, FileUploadCard, LogisticsInvoiceUploadItem } from "./upload-components";

import {
  LogisticsInvoiceRequirementStatus,
  SupplierDocumentReturnNotice,
  TaxInfoItem,
  TaxTransportField,
  taxLogisticsStatusLabel,
  taxTransportSummaryItems,
} from "./detail-panel-sections";
import type { TaxRefundDetailPanelProps } from "./detail-panel-types";

export function TaxRefundDetailPanel({
  detail,
  loading,
  activeTab,
  loadedSections,
  sectionLoading,
  error,
  fallback,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  readOnly,
  onCustomsSaved,
  onUpload,
  onDelete,
  onOpenDomesticLogistics,
  onOpenSupplierDocuments,
  currentUserRole,
  canWriteDocuments,
  onSelectTab,
}: TaxRefundDetailPanelProps) {
  if (loading && !detail) return <div className={styles.emptyState}>资料详情加载中...</div>;
  if (error) return <div className={styles.inlineError}>{error}</div>;
  if (!detail) return <div className={styles.emptyState}>点击查看资料后加载详情</div>;

  const groups = groupDocuments(detail.documents || []);
  const domesticExportInvoiceRemark = detail.domesticLogisticsInfo?.exportInvoice?.remark || null;
  const domesticRemarkText = detail.domesticLogisticsInfo?.remarkText || "";
  const logisticsArchiveStatus = taxLogisticsStatusLabel(detail.domesticLogisticsInfo?.archiveStatusLabel || "", Boolean(detail.domesticLogisticsInfo));
  const transportCards = taxTransportSummaryItems(detail);
  const displayBillOfLadingNo = taxRefundBillOfLadingText(detail, fallback);
  const factoryCosts = factorySupplierCosts(detail.costs || []);
  const showTaxArchiveRecord = Boolean(
    detail.taxRefundStatus === "SUBMITTED"
    || fallback.taxRefundStatus === "SUBMITTED"
    || detail.taxArchived
    || fallback.taxArchived,
  );
  const tabs: Array<{ key: TaxRefundDetailTab; label: string }> = [
    { key: "basic", label: "基础信息" },
    { key: "export-documents", label: "出口资料" },
    { key: "customs-documents", label: "报关资料" },
    { key: "factory-documents", label: "工厂资料" },
    { key: "logistics-documents", label: "物流资料" },
  ];
  const activeSectionLoading = Boolean(sectionLoading[activeTab]);
  const activeSectionLoaded = Boolean(loadedSections[activeTab]);
  const supplierDocumentMissingItems = (detail.documentCompleteness?.supplier?.missing || [])
    .filter((item) => !item.missingFactoryCost);

  return (
    <div className={styles.taxDetailPanel} id={taxTargetDomId("tax-detail-top")}>
      <div className={styles.taxDetailTabBar} role="tablist" aria-label="退税资料详情分段">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? styles.taxDetailTabActive : styles.taxDetailTab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => onSelectTab(tab.key)}
          >
            {tab.label}
            {sectionLoading[tab.key] ? <span className={styles.taxDetailTabSpinner} /> : null}
          </button>
        ))}
      </div>
      {activeSectionLoading && !activeSectionLoaded ? (
        <div className={styles.emptyState}>正在加载当前资料...</div>
      ) : null}
      <div className={styles.documentGroupGrid}>
        {activeTab === "basic" ? (
          <>
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
            <div className={`${styles.documentGroupCard} ${styles.taxBasicInfoCard}`}>
              <strong>基础信息</strong>
              <div className={styles.taxBasicInfoGrid}>
                <TaxInfoItem label="客户全称" value={customerLegalName({ ...fallback, ...detail })} wide />
                <TaxInfoItem label="订单号" value={detail.orderNo || fallback.orderNo || "-"} />
                <TaxInfoItem label="提单号" value={displayBillOfLadingNo} />
                <TaxInfoItem label="币种" value={detail.currency || fallback.currency || "-"} />
                <TaxInfoItem label="申报日期" value={formatDate(detail.customsDeclarationDate || detail.declarationDate || fallback.customsDeclarationDate || fallback.declarationDate)} />
                <div className={styles.taxInfoItem}>
                  <span>物流信息状态</span>
                  <strong>
                    <span className={`${styles.statusPill} ${logisticsArchiveStatus === "已归档" ? styles.statusSuccess : styles.statusWarning}`}>
                      {logisticsArchiveStatus}
                    </span>
                  </strong>
                </div>
              </div>
            </div>
          </>
        ) : null}
        {activeTab === "logistics-documents" ? (
          <div className={`${styles.documentGroupCard} ${styles.taxTransportSummaryCard}`} id={taxTargetDomId("domestic-logistics")}>
            <div className={styles.taxTransportSummaryHeader}>
              <strong>运输信息摘要</strong>
              {onOpenDomesticLogistics ? (
                <button className={styles.secondaryButton} type="button" onClick={onOpenDomesticLogistics}>
                  去维护物流信息
                </button>
              ) : null}
            </div>
            {transportCards.length ? (
              <div className={styles.taxTransportCardGrid}>
                {transportCards.map((item, index) => (
                  <div className={styles.taxTransportCard} key={`${item.containerNo || item.truckPlateNo || "transport"}-${index}`}>
                    <div className={styles.taxTransportCardTitle}>
                      <span>集装箱号</span>
                      <strong>{item.containerNo || "-"}</strong>
                    </div>
                    <div className={styles.taxTransportFields}>
                      <TaxTransportField label="柜型" value={item.containerType} />
                      <TaxTransportField label="车牌号" value={item.truckPlateNo} />
                      <TaxTransportField label="挂车车牌" value={item.trailerPlateNo} />
                      <TaxTransportField label="起运日期" value={formatDate(item.departureDate)} />
                      <TaxTransportField label="起运地" value={item.departurePlace} />
                      <TaxTransportField label="到达地" value={item.arrivalPlace} />
                      <TaxTransportField label="运输货物名称" value={item.cargoName} wide />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                {domesticRemarkText || domesticExportInvoiceRemark ? "暂无结构化集装箱明细，请前往物流信息维护。" : "暂无运输信息摘要，请前往物流信息维护。"}
              </div>
            )}
          </div>
        ) : null}
        {activeTab === "customs-documents" ? (
          <CustomsRecognitionForm
            detail={detail}
            readOnly={readOnly}
            onSaved={onCustomsSaved}
          />
        ) : null}
        {activeTab === "export-documents" ? (
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
        ) : null}
        {activeTab === "customs-documents" ? (
          <CustomsUploadCard
            order={detail}
            documents={detail.documents || []}
            uploadingKey={uploadingKey}
            uploadProgressByKey={uploadProgressByKey}
            deletingDocumentId={deletingDocumentId}
            currentUserRole={currentUserRole}
            canWriteDocuments={canWriteDocuments}
            readOnly={readOnly}
            onUpload={onUpload}
            onDelete={onDelete}
          />
        ) : null}
        {activeTab === "factory-documents" ? (
          <div className={`${styles.documentGroupCard} ${styles.factoryDocumentSection}`} id={taxTargetDomId("factory-section")}>
            <strong>工厂资料上传</strong>
            {supplierDocumentMissingItems.length ? (
              <SupplierDocumentReturnNotice
                orderNo={detail.orderNo || fallback.orderNo || ""}
                missingItems={supplierDocumentMissingItems}
                onOpenSupplierDocuments={onOpenSupplierDocuments}
              />
            ) : null}
            {factoryCosts.length ? (
              <div className={styles.factorySupplierGrid}>
                {factoryCosts.map((cost) => {
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
                })}
              </div>
            ) : <span className={styles.mutedText}>暂未录入产品供应商成本</span>}
          </div>
        ) : null}
        {activeTab === "logistics-documents" ? (
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
        ) : null}
        {activeTab === "export-documents" ? Object.entries(groups).filter(([groupName]) => !["出口资料", "报关资料", "工厂资料", "物流资料"].includes(groupName)).map(([groupName, documents]) => (
          <div className={styles.documentGroupCard} key={groupName}>
            <strong>{groupName}</strong>
            <DocumentFileTable
              orderId={detail.id}
              documents={documents}
              deletingDocumentId={deletingDocumentId}
              canPreviewOrDownload
              canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
              onDelete={onDelete}
            />
          </div>
        )) : null}
      </div>
    </div>
  );
}
