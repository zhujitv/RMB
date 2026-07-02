import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DetailField, DismissibleLayer } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { canDeleteTaxDocument, canRecognizeTaxCustoms, canUploadTaxDocument, factoryCostOrdinal, factorySupplierCosts, groupDocuments, latestTaxDocument, logisticsInvoiceCosts, taxDocumentTargetKey, taxRefundBillOfLadingText, taxSupplierDocumentLabel, taxTargetDomId, uploadScopeKey } from "./helpers";
import { TAX_EXPORT_UPLOAD_TYPES, type CustomsDeclarationItem, type DocumentCompleteness, type ExportTaxRefundCalculation, type TaxDocument, type TaxRefundDetail, type TaxRefundDetailTab, type TaxRefundRow, type UploadScope } from "./model";
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
  activeTab,
  loadedSections,
  sectionLoading,
  error,
  readOnly,
  packageDownloading,
  submittingTax,
  cancelingArchive,
  refreshingCompleteness,
  calculatingTaxRefund,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  recognizingDocumentId,
  recognitionStatusByDocument,
  canSendShippingDocuments,
  canRefreshCompleteness,
  canRecalculateTaxRefund,
  onClose,
  onSelectTab,
  onDownloadPackage,
  onSubmitTaxRefund,
  onCancelArchive,
  onRefreshCompleteness,
  onRecalculateTaxRefund,
  onSaveCustomsDeclarationItems,
  onCreateCompanyHsFromDeclarationItem,
  onCustomsSaved,
  onUpload,
  onDelete,
  onRecognizeCustomsDocument,
  onRecognizeFromUploadedCustoms,
  onOpenManualShippingDocuments,
  onOpenSupplierDocuments,
  onOpenDomesticLogistics,
  currentUserRole,
  canWriteDocuments,
  canCreateCompanyHsFromOcr,
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
  calculatingTaxRefund: boolean;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  recognizingDocumentId: string;
  recognitionStatusByDocument: Record<string, string>;
  canSendShippingDocuments: boolean;
  canRefreshCompleteness: boolean;
  canRecalculateTaxRefund: boolean;
  onClose: () => void;
  onSelectTab: (tab: TaxRefundDetailTab) => void;
  onDownloadPackage: () => void;
  onSubmitTaxRefund: () => void;
  onCancelArchive: () => void;
  onRefreshCompleteness: () => void;
  onRecalculateTaxRefund: () => void;
  onSaveCustomsDeclarationItems: (orderId: string, items: CustomsDeclarationItem[]) => Promise<void> | void;
  onCreateCompanyHsFromDeclarationItem: (orderId: string, payload: Record<string, unknown>) => Promise<void> | void;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onRecognizeCustomsDocument: (order: TaxRefundDetail, document: TaxDocument) => void;
  onRecognizeFromUploadedCustoms: (order: TaxRefundDetail) => void;
  onOpenManualShippingDocuments: (order: TaxRefundDetail) => void;
  onOpenSupplierDocuments: (keyword: string) => void;
  onOpenDomesticLogistics?: () => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
  canCreateCompanyHsFromOcr: boolean;
}) {
  const displayCustomer = customerLegalName(row);
  const displayBillOfLadingNo = taxRefundBillOfLadingText(detail || {}, row);
  const dismissLocked = packageDownloading || submittingTax || Boolean(uploadingKey);
  const dismissConfirmMessage = dismissLocked ? "当前内容尚未保存，确定关闭吗？" : "";
  const canRecognizeCustoms = canRecognizeTaxCustoms(currentUserRole, canWriteDocuments, readOnly);
  const calculationFormId = `tax-refund-calculation-form-${row.id}`;

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
            {activeTab === "calculation" && detail && currentUserRole === "管理员" && !readOnly ? (
              <button className={styles.primaryButtonCompact} type="submit" form={calculationFormId} disabled={calculatingTaxRefund || dismissLocked}>
                {calculatingTaxRefund ? "保存中..." : "保存"}
              </button>
            ) : null}
            {canRefreshCompleteness && canRecalculateTaxRefund ? (
              <button className={styles.secondaryButton} type="button" disabled={calculatingTaxRefund || dismissLocked} onClick={onRecalculateTaxRefund}>
                {calculatingTaxRefund ? "计算中..." : "重新计算"}
              </button>
            ) : null}
            {readOnly ? (
              <button className={styles.secondaryButton} type="button" disabled={cancelingArchive} onClick={onCancelArchive}>
                {cancelingArchive ? "处理中..." : "取消归档"}
              </button>
            ) : (
              <button className={styles.secondaryButton} type="button" disabled={submittingTax} onClick={onSubmitTaxRefund}>
                {submittingTax ? "提交中..." : "提交归档"}
              </button>
            )}
            <details className={styles.taxRefundMoreActions}>
              <summary>更多操作</summary>
              <div className={styles.taxRefundMoreActionMenu}>
              <button className={styles.secondaryButton} type="button" disabled={packageDownloading} onClick={onDownloadPackage}>
                {packageDownloading ? "下载中..." : "下载资料包"}
              </button>
              {detail && canRecognizeCustoms ? (
                <button className={styles.secondaryButton} type="button" disabled={Boolean(recognizingDocumentId) || dismissLocked} onClick={() => onRecognizeFromUploadedCustoms(detail)}>
                  {recognizingDocumentId ? "识别中..." : "重新识别"}
                </button>
              ) : null}
              {canRefreshCompleteness ? (
                <button className={styles.secondaryButton} type="button" disabled={refreshingCompleteness || dismissLocked} onClick={onRefreshCompleteness}>
                  {refreshingCompleteness ? "计算中..." : "重新计算完整度"}
                </button>
              ) : null}
              </div>
            </details>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
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
            onOpenSupplierDocuments={onOpenSupplierDocuments}
            currentUserRole={currentUserRole}
            canWriteDocuments={canWriteDocuments}
            canCreateCompanyHsFromOcr={canCreateCompanyHsFromOcr}
            calculatingTaxRefund={calculatingTaxRefund}
            calculationFormId={calculationFormId}
            onSaveCustomsDeclarationItems={onSaveCustomsDeclarationItems}
            onCreateCompanyHsFromDeclarationItem={onCreateCompanyHsFromDeclarationItem}
            onSelectTab={onSelectTab}
          />
        </div>
        </>
      )}
    </DismissibleLayer>
  );
}

type TaxTransportSummaryItem = {
  containerNo?: string;
  containerType?: string;
  truckPlateNo?: string;
  trailerPlateNo?: string;
  departureDate?: string;
  departurePlace?: string;
  arrivalPlace?: string;
  cargoName?: string;
};

function taxLogisticsStatusLabel(value = "", hasDomesticLogistics = false) {
  if (value.includes("已归档")) return "已归档";
  if (hasDomesticLogistics) return "未归档";
  return "未归档";
}

function taxTransportSummaryItems(detail: TaxRefundDetail): TaxTransportSummaryItem[] {
  const transportItems = Array.isArray(detail.domesticLogisticsInfo?.transportItems)
    ? detail.domesticLogisticsInfo.transportItems
    : [];
  if (transportItems.length) {
    return transportItems.map((item) => ({
      containerNo: item.containerNo || "",
      containerType: item.containerType || "",
      truckPlateNo: item.truckPlateNo || "",
      trailerPlateNo: item.trailerPlateNo || "",
      departureDate: item.departureDate || "",
      departurePlace: item.departurePlace || "",
      arrivalPlace: item.arrivalPlace || "",
      cargoName: item.cargoName || "",
    }));
  }
  const remarkContainers = Array.isArray(detail.domesticLogisticsInfo?.exportInvoice?.remark?.containers)
    ? detail.domesticLogisticsInfo.exportInvoice.remark.containers
    : [];
  return remarkContainers.map((item) => ({
    containerNo: item.containerNo || "",
    containerType: item.type || "",
    truckPlateNo: item.truckNo || "",
    trailerPlateNo: item.trailerNo || "",
    departureDate: item.shipDate || "",
    departurePlace: item.origin || "",
    arrivalPlace: item.destination || "",
    cargoName: item.goods || "",
  }));
}

function TaxInfoItem({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={`${styles.taxInfoItem} ${wide ? styles.taxInfoItemWide : ""}`}>
      <span>{label}</span>
      <strong title={String(value || "")}>{value || "-"}</strong>
    </div>
  );
}

function TaxTransportField({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={wide ? styles.taxTransportFieldWide : ""}>
      <span>{label}</span>
      <strong title={String(value || "")}>{value || "-"}</strong>
    </div>
  );
}

function TaxRefundDetailPanel({
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
  onOpenSupplierDocuments,
  currentUserRole,
  canWriteDocuments,
  canCreateCompanyHsFromOcr,
  calculatingTaxRefund,
  calculationFormId,
  onSaveCustomsDeclarationItems,
  onCreateCompanyHsFromDeclarationItem,
  onSelectTab,
}: {
  detail: TaxRefundDetail | null;
  loading: boolean;
  activeTab: TaxRefundDetailTab;
  loadedSections: Record<TaxRefundDetailTab, boolean>;
  sectionLoading: Record<TaxRefundDetailTab, boolean>;
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
  onOpenSupplierDocuments: (keyword: string) => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
  canCreateCompanyHsFromOcr: boolean;
  calculatingTaxRefund: boolean;
  calculationFormId: string;
  onSaveCustomsDeclarationItems: (orderId: string, items: CustomsDeclarationItem[]) => Promise<void> | void;
  onCreateCompanyHsFromDeclarationItem: (orderId: string, payload: Record<string, unknown>) => Promise<void> | void;
  onSelectTab: (tab: TaxRefundDetailTab) => void;
}) {
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
  const canRecognizeCustoms = canRecognizeTaxCustoms(currentUserRole, canWriteDocuments, readOnly);
  const showTaxArchiveRecord = Boolean(
    detail.taxRefundStatus === "SUBMITTED"
    || fallback.taxRefundStatus === "SUBMITTED"
    || detail.taxArchived
    || fallback.taxArchived,
  );
  const tabs: Array<{ key: TaxRefundDetailTab; label: string }> = [
    { key: "basic", label: "基础信息" },
    { key: "calculation", label: "退税计算" },
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
        {activeTab === "logistics-documents" && canSendShippingDocuments ? (
          <div className={styles.documentGroupCard}>
            <strong>清关资料发送</strong>
            <span className={styles.mutedText}>向客户发送商业发票、装箱单和报关单。发送前可临时调整收件邮箱、抄送、语言、标题和正文。</span>
            <button className={styles.secondaryButton} type="button" onClick={() => onOpenManualShippingDocuments(detail)}>
              手动发送清关资料
            </button>
          </div>
        ) : null}
        {activeTab === "customs-documents" ? (
        <>
          <CustomsRecognitionResultPanel detail={detail} currentUserRole={currentUserRole} />
          <CustomsRecognitionForm
            detail={detail}
            readOnly={readOnly}
            recognizing={Boolean(recognizingDocumentId)}
            canRecognize={canRecognizeCustoms}
            onSaved={onCustomsSaved}
            onRecognizeFromUploadedCustoms={onRecognizeFromUploadedCustoms}
          />
        </>
        ) : null}
        {activeTab === "calculation" ? (
        <TaxRefundCalculationPanel
          detail={detail}
          readOnly={readOnly || currentUserRole !== "管理员"}
          saving={calculatingTaxRefund}
          formId={calculationFormId}
          onSaveItems={onSaveCustomsDeclarationItems}
          canCreateCompanyHs={canCreateCompanyHsFromOcr && currentUserRole === "管理员" && !readOnly}
          onCreateCompanyHs={onCreateCompanyHsFromDeclarationItem}
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
        ) : null}
        {activeTab === "factory-documents" ? (
        <div className={styles.documentGroupCard} id={taxTargetDomId("factory-section")}>
          <strong>工厂资料上传</strong>
          {supplierDocumentMissingItems.length ? (
            <SupplierDocumentReturnNotice
              orderNo={detail.orderNo || fallback.orderNo || ""}
              missingItems={supplierDocumentMissingItems}
              onOpenSupplierDocuments={onOpenSupplierDocuments}
            />
          ) : null}
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
              recognizingDocumentId={recognizingDocumentId}
              recognitionStatusByDocument={recognitionStatusByDocument}
              canPreviewOrDownload
              canDelete={canDeleteTaxDocument(canWriteDocuments, readOnly)}
              canRecognize={false}
              onDelete={onDelete}
            />
          </div>
        )) : null}
      </div>
    </div>
  );
}

function customsItemHasKeyFields(item: CustomsDeclarationItem) {
  return Boolean(
    item.declarationNo
    || item.declarationDate
    || item.exportDate
    || item.tradeTerm
    || item.currency
    || item.fobAmount
    || item.domesticConsignor
    || item.hsCode
    || item.productName
    || item.quantity
    || item.unit,
  );
}

function customsRecognitionLooksSuccessful(detail: TaxRefundDetail) {
  const text = [
    detail.customsParseStatusLabel,
    detail.customsParseMessage,
    detail.customsOcrRawResult?.status,
  ].filter(Boolean).join(" ");
  return /SUCCESS|成功|已识别|识别通过/i.test(text);
}

function customsRawResultText(detail: TaxRefundDetail) {
  const raw = detail.customsOcrRawResult;
  if (!raw) return "暂无 OCR 原始结果。";
  return JSON.stringify({
    id: raw.id || "",
    documentId: raw.documentId || "",
    provider: raw.provider || "",
    apiName: raw.apiName || "",
    status: raw.status || "",
    errorMessage: raw.errorMessage || "",
    confidence: raw.confidence ?? null,
    recognizedAt: raw.createdAt || null,
    rawJson: raw.rawJson || null,
    parsedJson: raw.parsedJson || null,
  }, null, 2);
}

function canReadCustomsRawResult(role: string) {
  return role === "管理员" || role === "财务";
}

function CustomsRecognitionDocumentSummary({
  title,
  document,
  canReadRaw,
}: {
  title: string;
  document?: TaxRefundDetail["currentCustomsDocument"] | null;
  canReadRaw: boolean;
}) {
  if (!document) return null;
  return (
    <div className={styles.customsOcrFileRow}>
      <div>
        <strong>{title}</strong>
        <span title={document.fileName || ""}>{document.fileName || document.id || "-"}</span>
      </div>
      <div>
        <span>{formatDateTime(document.uploadedAt)}</span>
        <span>documentId: {document.id || "-"}</span>
        {canReadRaw ? (
          <span className={document.hasRawJson && document.hasParsedJson ? styles.textSuccess : styles.textDanger}>
            raw: {document.hasRawJson ? "已保存" : "缺失"} / parsed: {document.hasParsedJson ? "已保存" : "缺失"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CustomsRecognitionResultPanel({
  detail,
  currentUserRole,
}: {
  detail: TaxRefundDetail;
  currentUserRole: string;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const items = detail.customsDeclarationItems || [];
  const firstItem = items[0] || {};
  const hasAnyParsedField = Boolean(detail.customsDeclarationNo || detail.customsDeclarationDate || items.some(customsItemHasKeyFields));
  const ocrSuccessButEmpty = customsRecognitionLooksSuccessful(detail) && !hasAnyParsedField;
  const ocrSuccessButNoItems = customsRecognitionLooksSuccessful(detail) && hasAnyParsedField && !items.length;
  const rawMissing = canReadCustomsRawResult(currentUserRole) && customsRecognitionLooksSuccessful(detail) && !detail.customsOcrRawResult?.rawJson;
  const totalFobAmount = items.reduce((sum, item) => sum + Number(item.fobAmount || 0), 0);
  const firstCurrency = firstItem.currency || detail.currency || "";
  const firstTradeTerm = firstItem.tradeTerm || "";
  const firstExportDate = firstItem.exportDate || "";
  const domesticConsignor = firstItem.domesticConsignor || detail.businessEntityName || detail.businessEntityDisplayName || "";
  const declarationUnit = firstItem.declarationUnit || "";
  const transportMode = firstItem.transportMode || "";
  const billOfLadingNo = firstItem.billOfLadingNo || detail.billOfLadingNo || "";
  const tradeCountry = firstItem.tradeCountry || "";
  const destinationCountry = firstItem.destinationCountry || "";
  const supervisionMode = firstItem.supervisionMode || "";
  const canReadRaw = canReadCustomsRawResult(currentUserRole);
  const historicalCustomsDocuments = detail.historicalCustomsDocuments || [];
  return (
    <div className={`${styles.documentGroupCard} ${styles.customsRecognitionResultCard}`} id={taxTargetDomId("customs-recognition-result")}>
      <div className={styles.customsResultHeader}>
        <div>
          <strong>报关单识别结果</strong>
          <span>{detail.customsParseMessage || "上传报关单后，识别结果会显示在这里。"}</span>
        </div>
        <div className={styles.inlineActionGroup}>
          <span className={`${styles.statusPill} ${ocrSuccessButEmpty ? styles.statusDanger : hasAnyParsedField ? styles.statusSuccess : styles.statusWarning}`}>
            {ocrSuccessButEmpty ? "字段异常" : hasAnyParsedField ? "已解析" : "待识别"}
          </span>
          {canReadRaw ? (
            <button className={styles.secondaryButton} type="button" onClick={() => setShowRaw((value) => !value)}>
              查看OCR原始结果
            </button>
          ) : null}
        </div>
      </div>
      {ocrSuccessButEmpty ? (
        <div className={styles.inlineError}>OCR识别成功，但未解析到报关单关键字段。</div>
      ) : null}
      {ocrSuccessButNoItems ? (
        <div className={styles.inlineError}>OCR已识别基础字段，但未解析到报关商品明细。</div>
      ) : null}
      {detail.currentCustomsDocument || historicalCustomsDocuments.length ? (
        <div className={styles.customsOcrFilePanel}>
          <CustomsRecognitionDocumentSummary title="当前识别文件" document={detail.currentCustomsDocument} canReadRaw={canReadRaw} />
          {historicalCustomsDocuments.length ? (
            <div className={styles.customsOcrHistoryList}>
              {historicalCustomsDocuments.map((document, index) => (
                <CustomsRecognitionDocumentSummary
                  key={document?.id || `historical-customs-${index}`}
                  title="历史识别文件"
                  document={document}
                  canReadRaw={canReadRaw}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.taxBasicInfoGrid}>
        <TaxInfoItem label="报关单号" value={detail.customsDeclarationNo || firstItem.declarationNo || ""} />
        <TaxInfoItem label="申报日期" value={formatDate(detail.customsDeclarationDate || detail.declarationDate || firstItem.declarationDate)} />
        <TaxInfoItem label="出口日期" value={formatDate(firstExportDate)} />
        <TaxInfoItem label="成交方式" value={firstTradeTerm} />
        <TaxInfoItem label="币种" value={firstCurrency} />
        <TaxInfoItem label="FOB金额" value={totalFobAmount ? currencyAmountText(firstCurrency, totalFobAmount) : currencyAmountText(firstCurrency, firstItem.fobAmount)} />
        <TaxInfoItem label="境内发货人" value={domesticConsignor} wide />
        <TaxInfoItem label="申报单位" value={declarationUnit} />
        <TaxInfoItem label="运输方式" value={transportMode} />
        <TaxInfoItem label="提运单号" value={billOfLadingNo} />
        <TaxInfoItem label="贸易国别" value={tradeCountry} />
        <TaxInfoItem label="目的国" value={destinationCountry} />
        <TaxInfoItem label="监管方式" value={supervisionMode} />
      </div>
      <div className={styles.sectionSubheading}>商品明细</div>
      <div className={styles.taxCalculationTableContainer}>
        <table className={`${styles.dataTable} ${styles.taxCalculationDataTable} ${styles.customsRecognitionTable}`}>
          <thead>
            <tr>
              <th>HS编码</th>
              <th>商品名称</th>
              <th>规格型号</th>
              <th>数量</th>
              <th>单位</th>
              <th>金额</th>
              <th>币种</th>
              <th>确认状态</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((item, index) => (
              <tr key={item.id || `customs-item-${index}`} className={item.confirmationStatus === "CONFIRMED" ? "" : styles.rowWarning}>
                <td>{item.hsCode || "-"}</td>
                <td title={item.productName || ""}>{item.productName || "-"}</td>
                <td title={item.specification || ""}>{item.specification || "-"}</td>
                <td className={styles.numericCell}>{amountText(item.quantity)}</td>
                <td>{item.unit || "-"}</td>
                <td className={styles.numericCell}>{currencyAmountText(item.currency, item.totalAmount || item.fobAmount)}</td>
                <td>{item.currency || "-"}</td>
                <td>
                  <span className={`${styles.statusPill} ${item.confirmationStatus === "CONFIRMED" ? styles.statusSuccess : styles.statusWarning}`}>
                    {item.confirmationStatus === "CONFIRMED" ? "已确认" : "待确认"}
                  </span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className={styles.taxCalculationEmptyCell}>
                  <div className={styles.emptyState}>
                    {hasAnyParsedField ? "OCR已识别基础字段，但未解析到报关商品明细。" : "暂无报关商品明细，请先上传或识别报关单。"}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canReadRaw && rawMissing ? (
        <div className={styles.inlineError}>OCR原始结果未保存，请重新识别。</div>
      ) : null}
      {canReadRaw && showRaw ? (
        <div className={styles.customsRawResultSection}>
          <div className={styles.sectionSubheading}>OCR原始结果</div>
          <div className={styles.taxBasicInfoGrid}>
            <TaxInfoItem label="识别接口" value={detail.customsOcrRawResult?.apiName || ""} />
            <TaxInfoItem label="识别时间" value={formatDateTime(detail.customsOcrRawResult?.createdAt)} />
            <TaxInfoItem label="字段置信度" value={detail.customsOcrRawResult?.confidence == null ? "" : `${Math.round(Number(detail.customsOcrRawResult.confidence) * 10000) / 100}%`} />
            <TaxInfoItem label="失败原因" value={detail.customsOcrRawResult?.errorMessage || ""} wide />
          </div>
          <pre className={styles.customsOcrRawResult}>{customsRawResultText(detail)}</pre>
          {detail.customsOcrCallLogs?.length ? (
            <>
              <div className={styles.sectionSubheading}>OCR调用日志</div>
              <div className={styles.customsOcrLogList}>
                {detail.customsOcrCallLogs.map((log) => (
                  <div className={styles.customsOcrLogRow} key={log.id || `${log.documentId}-${log.createdAt}`}>
                    <span>{formatDateTime(log.createdAt)}</span>
                    <span>{log.provider || "-"}</span>
                    <span>{log.apiName || "-"}</span>
                    <span>documentId: {log.documentId || "-"}</span>
                    <span className={log.rawJson && log.parsedJson ? styles.textSuccess : styles.textDanger}>
                      raw: {log.rawJson ? "已保存" : "缺失"} / parsed: {log.parsedJson ? "已保存" : "缺失"}
                    </span>
                    {log.errorMessage ? <span title={log.errorMessage}>错误：{log.errorMessage}</span> : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SupplierDocumentReturnNotice({
  orderNo,
  missingItems,
  onOpenSupplierDocuments,
}: {
  orderNo: string;
  missingItems: NonNullable<DocumentCompleteness["supplier"]>["missing"];
  onOpenSupplierDocuments: (keyword: string) => void;
}) {
  const labels = (missingItems || [])
    .map((item) => item?.label || `${item?.supplierName ? `${item.supplierName} ` : ""}${taxSupplierDocumentLabel(item?.documentType || "")}`)
    .map((label) => String(label || "").trim())
    .filter((label, index, arr) => Boolean(label) && arr.indexOf(label) === index);
  return (
    <div className={styles.taxSupplierReturnNotice}>
      <div>
        <strong>产品供应商资料缺失</strong>
        <span>{labels.length ? labels.join(" / ") : "请在资料回传模块处理供应商催办和发送记录。"}</span>
      </div>
      <button className={styles.secondaryButton} type="button" onClick={() => onOpenSupplierDocuments(orderNo)}>
        前往资料回传
      </button>
    </div>
  );
}

function amountText(value: unknown) {
  if (value == null || value === "") return "-";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
}

function percentText(value: unknown) {
  const rate = Number(value || 0);
  return Number.isFinite(rate) && rate > 0 ? `${(rate * 100).toFixed(2)}%` : "-";
}

function inputNumberValue(value: unknown) {
  return value == null || value === "" ? "" : String(value);
}

function quantityUnitText(quantity: unknown, unit: unknown) {
  const quantityText = amountText(quantity);
  const unitText = String(unit || "").trim();
  if (quantityText === "-" && !unitText) return "-";
  return `${quantityText}${unitText ? ` ${unitText}` : ""}`;
}

function currencyAmountText(currency: unknown, amount: unknown) {
  const amountValue = amountText(amount);
  const currencyText = String(currency || "").trim();
  if (amountValue === "-" && !currencyText) return "-";
  return `${currencyText ? `${currencyText} ` : ""}${amountValue}`;
}

function differenceText(quantity: unknown, amount: unknown) {
  const quantityText = amountText(quantity);
  const amountTextValue = amountText(amount);
  if (quantityText === "-" && amountTextValue === "-") return "-";
  return `数量 ${quantityText} / 金额 ${amountTextValue}`;
}

function invoiceMatchLineText(row: ExportTaxRefundCalculation | undefined, key: "supplierName" | "invoiceNo") {
  const lines = Array.isArray(row?.invoiceMatch?.lines) ? row.invoiceMatch.lines : [];
  const values = lines
    .map((line) => (line && typeof line === "object" ? String((line as Record<string, unknown>)[key] || "").trim() : ""))
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
  return values.length ? values.join(" / ") : "-";
}

function TaxCalculationStatCard({
  label,
  value,
  tone = "default",
  title,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "danger";
  title?: string;
}) {
  const toneClass = tone === "success" ? styles.taxCalculationStatSuccess : tone === "danger" ? styles.taxCalculationStatDanger : "";
  return (
    <div className={`${styles.taxCalculationStatCard} ${toneClass}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TablePanel({
  title,
  summary,
  actions,
  formId,
  onSubmit,
  children,
}: {
  title: string;
  summary?: string;
  actions?: ReactNode;
  formId?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const table = formId ? (
    <form id={formId} onSubmit={onSubmit}>
      {children}
    </form>
  ) : children;
  return (
    <section className={styles.taxCalculationTablePanel}>
      <div className={styles.taxCalculationSectionHeader}>
        <div className={styles.taxCalculationSectionTitle}>
          <strong>{title}</strong>
          {summary ? <span>{summary}</span> : null}
        </div>
        {actions}
      </div>
      <div className={styles.taxCalculationTableContainer}>
        {table}
      </div>
    </section>
  );
}

type TaxCalculationSubTab = "refund" | "invoice" | "declaration";

function TaxRefundCalculationPanel({
  detail,
  readOnly,
  saving,
  formId,
  onSaveItems,
  canCreateCompanyHs,
  onCreateCompanyHs,
}: {
  detail: TaxRefundDetail;
  readOnly: boolean;
  saving: boolean;
  formId: string;
  onSaveItems: (orderId: string, items: CustomsDeclarationItem[]) => Promise<void> | void;
  canCreateCompanyHs: boolean;
  onCreateCompanyHs: (orderId: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const [items, setItems] = useState<CustomsDeclarationItem[]>(detail.customsDeclarationItems || []);
  const [companyHsDraft, setCompanyHsDraft] = useState<Record<string, { rebateRate: string; vatRate: string }>>({});
  const [activeCalculationSubTab, setActiveCalculationSubTab] = useState<TaxCalculationSubTab>("refund");
  const calculations = detail.exportTaxRefundCalculations || [];
  const summary = detail.exportTaxRefundSummary || {};
  const confirmedItems = items.filter((item) => item.confirmationStatus === "CONFIRMED");
  const calculationsByItemId = new Map(calculations.map((row) => [row.declarationItemId || "", row]));
  const orphanCalculations = calculations.filter((row) => row.declarationItemId && !confirmedItems.some((item) => item.id === row.declarationItemId));
  const displayRows = [
    ...confirmedItems.map((item, index) => ({
      key: item.id || `item-${index}`,
      item,
      calculation: calculationsByItemId.get(item.id || ""),
    })),
    ...orphanCalculations.map((calculation) => ({
      key: calculation.id || calculation.declarationItemId || `calculation-${calculation.hsCode}`,
      item: null,
      calculation,
    })),
  ];
  const matchedStatuses = new Set(["匹配", "整体匹配", "多票合并匹配"]);
  const abnormalStatuses = new Set(["HS未维护", "发票未匹配", "资料不匹配", "资料异常"]);
  const matchedCount = displayRows.filter((row) => matchedStatuses.has(row.calculation?.invoiceMatchStatus || "")).length;
  const exceptionCount = displayRows.filter((row) => {
    const status = row.calculation?.calculationStatus || "";
    return abnormalStatuses.has(status) || Boolean(row.calculation?.abnormalReasons?.length);
  }).length;
  const theoreticalRefundTotal = displayRows.reduce((sum, row) => sum + Number(row.calculation?.theoreticalRefundAmount || 0), 0);
  const estimatedRefundTotal = displayRows.reduce((sum, row) => sum + Number(row.calculation?.estimatedRefundAmount || 0), 0);
  const abnormalReasonText = summary.abnormalReasons?.length ? summary.abnormalReasons.join(" / ") : (exceptionCount ? "查看异常行" : "无");
  useEffect(() => {
    setItems(detail.customsDeclarationItems || []);
  }, [detail.id, detail.customsDeclarationItems]);

  function updateItem(index: number, patch: Partial<CustomsDeclarationItem>) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function addItem() {
    setItems((current) => [
      ...current,
      {
        declarationNo: detail.customsDeclarationNo || "",
        declarationDate: detail.customsDeclarationDate || "",
        hsCode: "",
        productName: "",
        specification: "",
        quantity: null,
        unit: "",
        tradeTerm: "FOB",
        currency: detail.currency || "",
        fobAmount: null,
        totalAmount: null,
        exchangeRate: null,
      },
    ]);
  }

  function companyHsDraftFor(row: { declarationItemId?: string; rebateRate?: number | null; vatRate?: number | null }) {
    const key = row.declarationItemId || "";
    return companyHsDraft[key] || {
      rebateRate: row.rebateRate == null ? "13" : String(Number(row.rebateRate) * 100),
      vatRate: row.vatRate == null ? "13" : String(Number(row.vatRate) * 100),
    };
  }

  function updateCompanyHsDraft(key: string, patch: { rebateRate?: string; vatRate?: string }) {
    setCompanyHsDraft((current) => ({ ...current, [key]: { ...companyHsDraftFor({ declarationItemId: key }), ...patch } }));
  }

  const hasExceptions = Boolean(summary.abnormalReasons?.length || exceptionCount);
  const isAbnormalCalculation = (row?: ExportTaxRefundCalculation) => Boolean(
    row && (abnormalStatuses.has(row.calculationStatus || "") || row.abnormalReasons?.length),
  );
  const statusClass = (status?: string) => matchedStatuses.has(status || "") || status === "退税金额已计算" ? styles.statusSuccess : styles.statusDanger;
  const calculationStatusText = summary.calculationStatus || (exceptionCount ? "异常" : estimatedRefundTotal ? "已计算" : "待计算");
  const hasConfirmedItems = confirmedItems.length > 0;
  const subTabs: Array<{ key: TaxCalculationSubTab; label: string; count: number }> = [
    { key: "refund", label: "退税结果", count: displayRows.length },
    { key: "invoice", label: "发票匹配", count: displayRows.length },
    { key: "declaration", label: "报关商品", count: items.length },
  ];
  const declarationTable = (
    <TablePanel
      title="报关商品"
      actions={!readOnly ? <button className={styles.secondaryButton} type="button" disabled={saving} onClick={addItem}>{items.length ? "新增明细" : "手工新增商品明细"}</button> : null}
      formId={formId}
      onSubmit={(event) => { event.preventDefault(); void onSaveItems(detail.id, items); }}
    >
      <table className={`${styles.dataTable} ${styles.taxCalculationDataTable} ${styles.taxDeclarationFocusTable}`}>
        <thead>
          <tr>
            <th>报关单号</th>
            <th>HS编码</th>
            <th>中文品名</th>
            <th>规格型号</th>
            <th>数量/单位</th>
            <th>FOB金额</th>
            <th>汇率</th>
            <th>确认状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id || `new-${index}`} className={item.confirmationStatus === "CONFIRMED" ? "" : styles.rowWarning}>
              <td title={item.declarationNo || ""}><input disabled={readOnly} value={item.declarationNo || ""} onChange={(event) => updateItem(index, { declarationNo: event.target.value })} /></td>
              <td title={item.hsCode || ""}><input disabled={readOnly} value={item.hsCode || ""} onChange={(event) => updateItem(index, { hsCode: event.target.value })} /></td>
              <td title={item.productName || ""}><input disabled={readOnly} value={item.productName || ""} onChange={(event) => updateItem(index, { productName: event.target.value })} /></td>
              <td title={item.specification || ""}><input disabled={readOnly} value={item.specification || ""} onChange={(event) => updateItem(index, { specification: event.target.value })} /></td>
              <td className={styles.numericCell} title={quantityUnitText(item.quantity, item.unit)}>
                <div className={styles.taxInlineInputGroup}>
                  <input disabled={readOnly} type="number" value={inputNumberValue(item.quantity)} onChange={(event) => updateItem(index, { quantity: Number(event.target.value || 0) })} />
                  <input disabled={readOnly} value={item.unit || ""} onChange={(event) => updateItem(index, { unit: event.target.value })} />
                </div>
              </td>
              <td className={styles.numericCell} title={currencyAmountText(item.currency, item.fobAmount)}>
                <div className={styles.taxMoneyInputGroup}>
                  <input disabled={readOnly} value={item.currency || ""} onChange={(event) => updateItem(index, { currency: event.target.value })} />
                  <input disabled={readOnly} type="number" value={inputNumberValue(item.fobAmount)} onChange={(event) => updateItem(index, { fobAmount: Number(event.target.value || 0), totalAmount: Number(event.target.value || 0) })} />
                </div>
              </td>
              <td className={styles.numericCell}><input disabled={readOnly} type="number" value={inputNumberValue(item.exchangeRate)} onChange={(event) => updateItem(index, { exchangeRate: Number(event.target.value || 0) })} /></td>
              <td>
                <span className={`${styles.statusPill} ${item.confirmationStatus === "CONFIRMED" ? styles.statusSuccess : styles.statusWarning}`}>
                  {item.confirmationStatus === "CONFIRMED" ? "已确认" : "待确认"}
                </span>
              </td>
              <td>{readOnly ? "-" : "保存后确认"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TablePanel>
  );
  return (
    <div className={`${styles.documentGroupCard} ${styles.taxRefundCalculationWorkspace}`} id={taxTargetDomId("tax-refund-calculation")}>
      <div className={styles.taxCalculationKpiBar}>
        <TaxCalculationStatCard label="计算状态" value={calculationStatusText} tone={hasExceptions ? "danger" : estimatedRefundTotal ? "success" : "default"} />
        <TaxCalculationStatCard label="预计退税收入" value={`CNY ${amountText(estimatedRefundTotal || summary.estimatedRefundAmount)}`} tone={estimatedRefundTotal ? "success" : "default"} />
        <TaxCalculationStatCard label="理论退税额" value={`CNY ${amountText(theoreticalRefundTotal)}`} />
        <TaxCalculationStatCard label="异常数量" value={exceptionCount} tone={exceptionCount ? "danger" : "success"} />
        <TaxCalculationStatCard label="异常原因" value={abnormalReasonText} tone={hasExceptions ? "danger" : "success"} title={abnormalReasonText} />
      </div>
      {!items.length ? (
        <div className={styles.taxCalculationEmptyPanel}>
          <span>暂无报关商品明细，请先上传或识别报关单。</span>
          {!readOnly ? <button className={styles.primaryButton} type="button" disabled={saving} onClick={addItem}>手工新增商品明细</button> : null}
        </div>
      ) : !hasConfirmedItems ? (
          <>
            <div className={styles.taxCalculationBlockedPanel}>没有确认报关商品明细，不允许进入退税计算。请先在“报关商品”中确认并保存。</div>
            {declarationTable}
          </>
      ) : (
        <>
          <div className={styles.taxCalculationSubTabs} role="tablist" aria-label="退税计算明细">
            {subTabs.map((tab) => (
              <button
                key={tab.key}
                className={activeCalculationSubTab === tab.key ? styles.taxCalculationSubTabActive : styles.taxCalculationSubTab}
                type="button"
                role="tab"
                aria-selected={activeCalculationSubTab === tab.key}
                onClick={() => setActiveCalculationSubTab(tab.key)}
              >
                <span>{tab.label}</span>
                <b>{tab.count}</b>
              </button>
            ))}
          </div>
          {activeCalculationSubTab === "refund" ? (
            <TablePanel title="退税结果">
              <table className={`${styles.dataTable} ${styles.taxCalculationDataTable} ${styles.taxRefundResultFocusTable}`}>
                <thead>
                  <tr>
                    <th>报关单号</th>
                    <th>HS编码</th>
                    <th>品名</th>
                    <th>FOB金额</th>
                    <th>报关人民币金额</th>
                    <th>退税率</th>
                    <th>发票金额</th>
                    <th>预计退税额</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((displayRow) => {
                    const row = displayRow.calculation;
                    const item = displayRow.item;
                    const abnormal = isAbnormalCalculation(row);
                    const hsMissing = Boolean(row?.abnormalReasons?.includes("HS编码未维护"));
                    const draft = companyHsDraftFor(row || { declarationItemId: item?.id || "" });
                    const fobSummary = currencyAmountText(row?.fobCurrency || item?.currency, row?.fobAmount ?? item?.fobAmount);
                    const invoiceAmount = amountText(row?.supplierInvoiceAmountWithTax ?? row?.invoiceMatch?.supplierInvoiceAmountWithTax ?? row?.invoiceMatch?.invoiceAmountWithTax);
                    const calculationTitle = [
                      `企业HS：${row?.invoiceMatch?.companyHs?.cnName || (hsMissing ? "未维护" : "-")}`,
                      `理论退税：CNY ${amountText(row?.theoreticalRefundAmount)}`,
                      `不含税发票：CNY ${amountText(row?.supplierInvoiceAmountWithoutTax ?? row?.invoiceMatch?.supplierInvoiceAmountWithoutTax)}`,
                      `可用进项：CNY ${amountText(row?.inputVatAmount ?? row?.availableInputVatAmount)}`,
                      `增值税率：${percentText(row?.vatRate)}`,
                    ].join("\n");
                    return (
                      <tr key={`refund-${displayRow.key}`} className={abnormal ? styles.rowDanger : ""}>
                        <td title={row?.declarationNo || item?.declarationNo || ""}>{row?.declarationNo || item?.declarationNo || "-"}</td>
                        <td>{row?.hsCode || item?.hsCode || "-"}</td>
                        <td title={row?.productName || item?.productName || ""}>{row?.productName || item?.productName || "-"}</td>
                        <td className={styles.numericCell} title={calculationTitle}>{fobSummary}</td>
                        <td className={styles.numericCell} title={calculationTitle}>{amountText(row?.customsRmbAmount ?? row?.declarationAmountCny ?? item?.fobAmountCny)}</td>
                        <td className={styles.numericCell} title={calculationTitle}>{percentText(row?.rebateRate)}</td>
                        <td className={styles.numericCell} title={calculationTitle}>{invoiceAmount}</td>
                        <td className={styles.numericCell} title={calculationTitle}>{amountText(row?.estimatedRefundAmount)}</td>
                        <td><span className={`${styles.statusPill} ${row ? statusClass(row.calculationStatus) : styles.statusWarning}`}>{row?.calculationStatus || "待计算"}</span></td>
                        <td>
                          {canCreateCompanyHs && hsMissing && row?.declarationItemId ? (
                            <div className={styles.rowActionGroup}>
                              <input aria-label="出口退税率" type="number" min="0" max="13" step="0.01" value={draft.rebateRate} onChange={(event) => updateCompanyHsDraft(row.declarationItemId || "", { rebateRate: event.target.value })} placeholder="退税率" />
                              <input aria-label="增值税率" type="number" min="0" max="13" step="0.01" value={draft.vatRate} onChange={(event) => updateCompanyHsDraft(row.declarationItemId || "", { vatRate: event.target.value })} placeholder="增值税率" />
                              <button className={styles.secondaryButton} type="button" title="新增到企业HS库" disabled={saving} onClick={() => onCreateCompanyHs(detail.id, { declarationItemId: row.declarationItemId, rebateRate: draft.rebateRate, vatRate: draft.vatRate })}>新增HS</button>
                            </div>
                          ) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TablePanel>
          ) : null}
          {activeCalculationSubTab === "invoice" ? (
            <TablePanel title="发票匹配">
              <table className={`${styles.dataTable} ${styles.taxCalculationDataTable} ${styles.taxInvoiceFocusTable}`}>
                <thead>
                  <tr>
                    <th>HS编码</th>
                    <th>品名</th>
                    <th>报关数量</th>
                    <th>发票数量</th>
                    <th>供应商</th>
                    <th>发票号</th>
                    <th>差异</th>
                    <th>状态</th>
                    <th>异常原因</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((displayRow) => {
                    const row = displayRow.calculation;
                    const item = displayRow.item;
                    const abnormal = isAbnormalCalculation(row);
                    const declarationQuantity = quantityUnitText(item?.quantity, item?.unit);
                    const invoiceQuantity = quantityUnitText(row?.invoiceMatch?.invoiceQuantity, item?.unit);
                    const differenceSummary = differenceText(row?.invoiceMatch?.differenceQuantity, row?.invoiceMatch?.differenceAmount);
                    const supplierText = invoiceMatchLineText(row, "supplierName") !== "-" ? invoiceMatchLineText(row, "supplierName") : `${row?.invoiceMatch?.supplierCount ?? "-"} 个供应商`;
                    const invoiceText = invoiceMatchLineText(row, "invoiceNo") !== "-" ? invoiceMatchLineText(row, "invoiceNo") : `${row?.invoiceMatch?.invoiceCount ?? "-"} 张发票`;
                    return (
                      <tr key={`invoice-${displayRow.key}`} className={abnormal ? styles.rowDanger : ""}>
                        <td>{row?.hsCode || item?.hsCode || "-"}</td>
                        <td title={row?.productName || item?.productName || ""}>{row?.productName || item?.productName || "-"}</td>
                        <td className={styles.numericCell} title={declarationQuantity}>{declarationQuantity}</td>
                        <td className={styles.numericCell} title={invoiceQuantity}>{invoiceQuantity}</td>
                        <td title={supplierText}>{supplierText}</td>
                        <td title={invoiceText}>{invoiceText}</td>
                        <td className={styles.numericCell} title={differenceSummary}>{differenceSummary}</td>
                        <td><span className={`${styles.statusPill} ${row ? statusClass(row.invoiceMatchStatus) : styles.statusWarning}`}>{row?.invoiceMatchStatus || "待匹配"}</span></td>
                        <td title={row?.abnormalReasons?.join(" / ") || ""}>{row?.abnormalReasons?.length ? row.abnormalReasons.join(" / ") : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TablePanel>
          ) : null}
          {activeCalculationSubTab === "declaration" ? (
            declarationTable
          ) : null}
        </>
      )}
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

export { CustomsFilePickerDialog, ManualShippingDocumentsDialog } from "./dialogs";
