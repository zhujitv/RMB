import { useEffect, useState } from "react";
import { DetailField, DismissibleLayer } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { canDeleteTaxDocument, canRecognizeTaxCustoms, canUploadTaxDocument, factoryCostOrdinal, factorySupplierCosts, groupDocuments, latestTaxDocument, logisticsInvoiceCosts, taxDocumentTargetKey, taxRefundBillOfLadingText, taxTargetDomId, uploadScopeKey } from "./helpers";
import { TAX_EXPORT_UPLOAD_TYPES, type CustomsDeclarationItem, type DocumentCompleteness, type TaxDocument, type TaxRefundDetail, type TaxRefundRow, type UploadScope } from "./model";
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
  calculatingTaxRefund,
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
  onRecalculateTaxRefund,
  onSaveCustomsDeclarationItems,
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
  calculatingTaxRefund: boolean;
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
  onRecalculateTaxRefund: () => void;
  onSaveCustomsDeclarationItems: (orderId: string, items: CustomsDeclarationItem[]) => Promise<void> | void;
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
            {canRefreshCompleteness ? (
              <button className={styles.secondaryButton} type="button" disabled={calculatingTaxRefund || dismissLocked} onClick={onRecalculateTaxRefund}>
                {calculatingTaxRefund ? "计算中..." : "重新计算退税"}
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
            calculatingTaxRefund={calculatingTaxRefund}
            onSaveCustomsDeclarationItems={onSaveCustomsDeclarationItems}
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
  calculatingTaxRefund,
  onSaveCustomsDeclarationItems,
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
  calculatingTaxRefund: boolean;
  onSaveCustomsDeclarationItems: (orderId: string, items: CustomsDeclarationItem[]) => Promise<void> | void;
}) {
  if (loading) return <div className={styles.emptyState}>资料详情加载中...</div>;
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
        <TaxRefundCalculationPanel
          detail={detail}
          readOnly={readOnly || currentUserRole !== "管理员"}
          saving={calculatingTaxRefund}
          onSaveItems={onSaveCustomsDeclarationItems}
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

function moneyText(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount !== 0 ? amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "-";
}

function percentText(value: unknown) {
  const rate = Number(value || 0);
  return Number.isFinite(rate) && rate > 0 ? `${(rate * 100).toFixed(2)}%` : "-";
}

function inputNumberValue(value: unknown) {
  return value == null || value === "" ? "" : String(value);
}

function TaxRefundCalculationPanel({
  detail,
  readOnly,
  saving,
  onSaveItems,
}: {
  detail: TaxRefundDetail;
  readOnly: boolean;
  saving: boolean;
  onSaveItems: (orderId: string, items: CustomsDeclarationItem[]) => Promise<void> | void;
}) {
  const [items, setItems] = useState<CustomsDeclarationItem[]>(detail.customsDeclarationItems || []);
  const calculations = detail.exportTaxRefundCalculations || [];
  const summary = detail.exportTaxRefundSummary || {};
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
        quantity: null,
        unit: "",
        tradeTerm: "FOB",
        currency: detail.currency || "",
        fobAmount: null,
        exchangeRate: null,
      },
    ]);
  }

  const hasExceptions = Boolean(summary.abnormalReasons?.length);
  return (
    <div className={styles.documentGroupCard} id={taxTargetDomId("tax-refund-calculation")}>
      <div className={styles.taxTransportSummaryHeader}>
        <strong>退税计算</strong>
        <span className={`${styles.statusPill} ${hasExceptions ? styles.statusDanger : summary.estimatedRefundAmount ? styles.statusSuccess : styles.statusWarning}`}>
          {summary.calculationStatus || "待计算"}
        </span>
      </div>
      <div className={styles.detailGrid}>
        <DetailField label="预计退税收入" value={`CNY ${moneyText(summary.estimatedRefundAmount)}`} />
        <DetailField label="异常原因" value={summary.abnormalReasons?.length ? summary.abnormalReasons.join(" / ") : "无"} wide />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>报关单号</th>
              <th>HS编码</th>
              <th>报关品名</th>
              <th>报关数量</th>
              <th>单位</th>
              <th>币种</th>
              <th>FOB金额</th>
              <th>申报汇率</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((item, index) => (
              <tr key={item.id || `new-${index}`}>
                <td><input disabled={readOnly} value={item.declarationNo || ""} onChange={(event) => updateItem(index, { declarationNo: event.target.value })} /></td>
                <td><input disabled={readOnly} value={item.hsCode || ""} onChange={(event) => updateItem(index, { hsCode: event.target.value })} /></td>
                <td><input disabled={readOnly} value={item.productName || ""} onChange={(event) => updateItem(index, { productName: event.target.value })} /></td>
                <td><input disabled={readOnly} type="number" value={inputNumberValue(item.quantity)} onChange={(event) => updateItem(index, { quantity: Number(event.target.value || 0) })} /></td>
                <td><input disabled={readOnly} value={item.unit || ""} onChange={(event) => updateItem(index, { unit: event.target.value })} /></td>
                <td><input disabled={readOnly} value={item.currency || ""} onChange={(event) => updateItem(index, { currency: event.target.value })} /></td>
                <td><input disabled={readOnly} type="number" value={inputNumberValue(item.fobAmount)} onChange={(event) => updateItem(index, { fobAmount: Number(event.target.value || 0) })} /></td>
                <td><input disabled={readOnly} type="number" value={inputNumberValue(item.exchangeRate)} onChange={(event) => updateItem(index, { exchangeRate: Number(event.target.value || 0) })} /></td>
              </tr>
            )) : (
              <tr><td colSpan={8}><div className={styles.emptyState}>暂无报关商品明细，上传报关单 PDF 后自动识别，管理员也可手工新增。</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <div className={styles.taxTransportSummaryHeader}>
          <button className={styles.secondaryButton} type="button" disabled={saving} onClick={addItem}>新增明细</button>
          <button className={styles.primaryButtonCompact} type="button" disabled={saving} onClick={() => onSaveItems(detail.id, items)}>
            {saving ? "保存中..." : "保存确认并计算"}
          </button>
        </div>
      ) : null}
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>报关单号</th>
              <th>HS编码</th>
              <th>报关品名</th>
              <th>报关金额</th>
              <th>关联供应商数量</th>
              <th>关联发票数量</th>
              <th>发票数量合计</th>
              <th>发票金额合计</th>
              <th>匹配状态</th>
              <th>差异数量</th>
              <th>差异金额</th>
              <th>退税率</th>
              <th>预计退税金额</th>
            </tr>
          </thead>
          <tbody>
            {calculations.length ? calculations.map((row) => {
              const abnormal = row.calculationStatus === "资料异常" || Boolean(row.abnormalReasons?.length);
              return (
                <tr key={row.id || row.declarationItemId} className={abnormal ? styles.rowDanger : ""}>
                  <td>{row.declarationNo || "-"}</td>
                  <td>{row.hsCode || "-"}</td>
                  <td>{row.productName || "-"}</td>
                  <td>{moneyText(row.declarationAmountCny)}</td>
                  <td>{row.invoiceMatch?.supplierCount ?? "-"}</td>
                  <td>{row.invoiceMatch?.invoiceCount ?? "-"}</td>
                  <td>{moneyText(row.invoiceMatch?.invoiceQuantity)}</td>
                  <td>{moneyText(row.invoiceMatch?.invoiceAmountWithoutTax)}</td>
                  <td><span className={`${styles.statusPill} ${abnormal ? styles.statusDanger : styles.statusSuccess}`}>{row.invoiceMatchStatus || "-"}</span></td>
                  <td>{moneyText(row.invoiceMatch?.differenceQuantity)}</td>
                  <td>{moneyText(row.invoiceMatch?.differenceAmount)}</td>
                  <td>{percentText(row.rebateRate)}</td>
                  <td>{moneyText(row.estimatedRefundAmount)}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan={13}><div className={styles.emptyState}>暂无退税计算结果。</div></td></tr>
            )}
          </tbody>
        </table>
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
