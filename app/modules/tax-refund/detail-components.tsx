import { type ReactNode } from "react";
import { DetailField, DismissibleLayer } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { canDeleteTaxDocument, canUploadTaxDocument, factoryCostOrdinal, factorySupplierCosts, groupDocuments, latestTaxDocument, logisticsInvoiceCosts, taxDocumentTargetKey, taxRefundBillOfLadingText, taxSupplierDocumentLabel, taxTargetDomId, uploadScopeKey } from "./helpers";
import { TAX_EXPORT_UPLOAD_TYPES, type DocumentCompleteness, type TaxDocument, type TaxRefundDetail, type TaxRefundDetailTab, type TaxRefundRow, type UploadScope } from "./model";
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
  readOnly,
  onCustomsSaved,
  onUpload,
  onDelete,
  onOpenDomesticLogistics,
  onOpenSupplierDocuments,
  currentUserRole,
  canWriteDocuments,
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
  readOnly: boolean;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onOpenDomesticLogistics?: () => void;
  onOpenSupplierDocuments: (keyword: string) => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
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
  const uploadOrderId = detail.orderId || detail.id;
  const factoryCosts = factorySupplierCosts(detail.costs || []);
  const hasCustomsDeclarationScope = Boolean(detail.customsDeclarationId);
  const showTaxArchiveRecord = hasCustomsDeclarationScope
    ? Boolean(detail.taxRefundStatus === "SUBMITTED" || detail.taxArchived)
    : Boolean(
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
                orderId={uploadOrderId}
                type={documentType.value}
                label={documentType.label}
                document={latestTaxDocument((detail.documents || []).filter((document) => (
                  document.documentType === documentType.value && document.uploadStatus === "SUCCESS"
                )))[0] || null}
                uploading={uploadingKey === uploadScopeKey(uploadOrderId, documentType.value)}
                uploadProgress={uploadProgressByKey[uploadScopeKey(uploadOrderId, documentType.value)] || 0}
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
                orderId={uploadOrderId}
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
              orderId={uploadOrderId}
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
              orderId={uploadOrderId}
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
