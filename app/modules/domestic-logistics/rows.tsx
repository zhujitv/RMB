import { Fragment } from "react";
import { DetailField, UiCheckbox } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerDisplayName, customerLegalName } from "../../utils";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import { CustomsDocumentPanel } from "./customs-documents-panel";
import { DomesticLogisticsEditPanel } from "./edit-panel";
import { firstItemValue, showContainerManagementFields } from "./helpers";
import { ARCHIVE_BUTTON_DISABLED_TOOLTIP, type DomesticLogisticsDocument, type DomesticLogisticsInfo, type DomesticLogisticsRow, type ShipsgoFeatureFlags, type ShipsgoTrackingRow } from "./model";
import { ShipsgoOrderTrackingPanel } from "./order-tracking-panel";

export function DomesticLogisticsRows({
  row,
  expanded,
  editing,
  canEditDomesticLogistics,
  canUploadCustomsDocuments,
  canDeleteCustomsDocuments,
  onToggle,
  onEdit,
  canCreateLogisticsExpense,
  currentUserRole,
  onOpenExpenseStatus,
  onOpenLogisticsFees,
  shipsgoFeatures,
  shipsgoBusyKey,
  canManageShipsgoTracking,
  canDeleteShipsgoTracking,
  onCreateShipsgoTracking,
  onSyncShipsgoTracking,
  onRecoverShipsgoTracking,
  onDeleteShipsgoTracking,
  onSaved,
  onCancelEdit,
  canDeleteDomesticLogistics,
  onDeleteDomesticLogistics,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  onUploadDocument,
  onDeleteDocument,
  selectionEnabled,
  selected,
  selectDisabled,
  colSpan,
  onSelect,
}: {
  row: DomesticLogisticsRow;
  expanded: boolean;
  editing: boolean;
  canEditDomesticLogistics: boolean;
  canUploadCustomsDocuments: boolean;
  canDeleteCustomsDocuments: boolean;
  onToggle: () => void;
  onEdit: () => void;
  canCreateLogisticsExpense: boolean;
  currentUserRole: string;
  onOpenExpenseStatus: () => void;
  onOpenLogisticsFees: () => void;
  shipsgoFeatures: ShipsgoFeatureFlags;
  shipsgoBusyKey: string;
  canManageShipsgoTracking: boolean;
  canDeleteShipsgoTracking: boolean;
  onCreateShipsgoTracking: (payload?: { carrierScac?: string }) => Promise<void>;
  onSyncShipsgoTracking: (trackingId: string) => Promise<ShipsgoTrackingRow>;
  onRecoverShipsgoTracking: () => Promise<void>;
  onDeleteShipsgoTracking: (tracking: ShipsgoTrackingRow) => void;
  onSaved: (info?: DomesticLogisticsInfo | null) => void;
  onCancelEdit: () => void;
  canDeleteDomesticLogistics: boolean;
  onDeleteDomesticLogistics: () => void;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  onUploadDocument: (orderId: string, documentType: string, file: File | null) => void;
  onDeleteDocument: (document: DomesticLogisticsDocument) => void;
  selectionEnabled: boolean;
  selected: boolean;
  selectDisabled: boolean;
  colSpan: number;
  onSelect: (checked: boolean) => void;
}) {
  const info = row.domesticLogisticsInfo;
  const destinationText = info?.destinationPlace || firstItemValue(info, "arrivalPlace") || "-";
  const cargoText = info?.cargoDescription || firstItemValue(info, "cargoName") || "-";
  return (
    <>
      <tr className={getBusinessEntityRowClass(row, styles, styles.clickableRow)} onClick={onToggle}>
        {selectionEnabled ? (
          <td className={styles.selectionColumn} onClick={(event) => event.stopPropagation()}>
            <UiCheckbox
              variant="table"
              label={`选择订单 ${row.orderNo || row.id}`}
              checked={selected}
              disabled={selectDisabled}
              title={selectDisabled ? ARCHIVE_BUTTON_DISABLED_TOOLTIP : "选择此订单归档"}
              onChange={(event) => onSelect(event.target.checked)}
            />
          </td>
        ) : null}
        <td className={styles.orderNoColumn} title={row.orderNo || ""}><strong>{row.orderNo || "-"}</strong></td>
        <td className={styles.blNoColumn} title={row.blNo || row.billOfLadingNo || ""}>{row.blNo || row.billOfLadingNo || "-"}</td>
        <td className={styles.customerColumn} title={customerLegalName(row)}>{customerDisplayName(row)}</td>
        <td className={styles.destinationColumn} title={destinationText}>{destinationText}</td>
        <td className={styles.cargoColumn} title={cargoText}>{cargoText}</td>
        <td className={styles.logisticsStatusColumn}><span className={`${styles.statusPill} ${row.logisticsStatus === "已提交" ? styles.statusSuccess : styles.statusWarning}`}>{row.logisticsStatus || "未提交"}</span></td>
        <td className={styles.logisticsExpenseStatusColumn}><DomesticLogisticsExpenseStatusButton row={row} onOpen={onOpenExpenseStatus} /></td>
        <td className={styles.detailActionColumn}><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={colSpan}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                {canCreateLogisticsExpense ? (
                  <button
                    className={`${styles.logisticsActionBtn} ${styles.logisticsSecondaryBtn}`}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onOpenLogisticsFees(); }}
                  >
                    录入费用
                  </button>
                ) : null}
                {canEditDomesticLogistics ? (
                  <button
                    className={`${styles.logisticsActionBtn} ${styles.logisticsPrimaryBtn} ${styles.logisticsEditBtn}`}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onEdit(); }}
                  >
                    {info ? "编辑物流信息" : "录入物流信息"}
                  </button>
                ) : null}
                {canDeleteDomesticLogistics && info?.id ? (
                  <button
                    className={`${styles.logisticsActionBtn} ${styles.logisticsDangerBtn}`}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onDeleteDomesticLogistics(); }}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              {editing ? (
                <DomesticLogisticsEditPanel row={row} onSaved={onSaved} onCancel={onCancelEdit} />
              ) : null}
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={customerLegalName(row)} wide />
                <DetailField label="提单号" value={row.blNo || row.billOfLadingNo || "-"} />
                <DetailField label="运输方式" value={info?.transportTypeLabel || "-"} />
                <DetailField label="起运地" value={info?.departurePlace || firstItemValue(info, "departurePlace") || "-"} />
                <DetailField label="到达地" value={info?.destinationPlace || firstItemValue(info, "arrivalPlace") || "-"} />
                <DetailField label="起运日期" value={info?.departureDate || firstItemValue(info, "departureDate") || "-"} />
                <DetailField label="车牌号 / 快递单号" value={info?.expressTrackingNo || info?.truckPlateNo || firstItemValue(info, "truckPlateNo") || "-"} />
                <DetailField label="运输货物名称" value={info?.cargoDescription || firstItemValue(info, "cargoName") || "-"} />
                <DetailField label="录入人" value={info?.submittedByName || "-"} />
                <DetailField label="录入时间" value={formatDateTime(info?.submittedAt || row.submittedAt)} />
              </div>
              {info?.transportItems?.length ? (
                <div className={styles.subList}>
                  <strong>集装箱运输明细</strong>
                  {info.transportItems.map((item, index) => (
                    <div className={styles.subListItem} key={`${item.containerNo || item.truckPlateNo || index}-${index}`}>
                      <strong>明细 {index + 1}{item.containerNo ? ` · ${item.containerNo}` : ""}</strong>
                      {showContainerManagementFields(info.transportType || "") ? (
                        <>
                          <span>柜型：{item.containerType || "-"}</span>
                          <span>封号：{item.sealNo || "-"}</span>
                        </>
                      ) : null}
                      <span>车牌号：{item.truckPlateNo || "-"}</span>
                      <span>挂车车牌：{item.trailerPlateNo || "-"}</span>
                      <span>起运日期：{formatDate(item.departureDate)}</span>
                      <span>起运地：{item.departurePlace || "-"}</span>
                      <span>到达地：{item.arrivalPlace || "-"}</span>
                      <span>运输货物名称：{item.cargoName || "-"}</span>
                      {item.remark ? <span>备注：{item.remark}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
                <ShipsgoOrderTrackingPanel
                  row={row}
                  features={shipsgoFeatures}
                  canManage={canManageShipsgoTracking}
                  canDelete={canDeleteShipsgoTracking}
                  busyKey={shipsgoBusyKey}
                  onCreate={onCreateShipsgoTracking}
                  onSync={onSyncShipsgoTracking}
                  onRecover={onRecoverShipsgoTracking}
                  onDelete={onDeleteShipsgoTracking}
                />
              ) : null}
              <CustomsDocumentPanel
                orderId={row.id}
                documents={row.documents || []}
                uploadingKey={uploadingKey}
                uploadProgressByKey={uploadProgressByKey}
                deletingDocumentId={deletingDocumentId}
                currentUserRole={currentUserRole}
                canUpload={canUploadCustomsDocuments}
                canDelete={canDeleteCustomsDocuments}
                onUpload={onUploadDocument}
                onDelete={onDeleteDocument}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DomesticLogisticsExpenseStatusButton({
  row,
  onOpen,
}: {
  row: DomesticLogisticsRow;
  onOpen: () => void;
}) {
  const status = row.logisticsExpenseStatusLabel || row.logisticsExpenseStatus || "未录入";
  return (
    <button
      className={`${styles.logisticsFeeStatusBadge} ${domesticLogisticsExpenseStatusClass(status)}`}
      type="button"
      title={`${status}；${status === "未录入" ? "点击录入物流费用" : "点击打开对应物流费用账单"}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {status}
    </button>
  );
}

function domesticLogisticsExpenseStatusClass(status = "") {
  if (status === "未录入") return styles.logisticsFeeStatusMuted;
  if (status === "草稿") return styles.logisticsFeeStatusDraft;
  if (status === "待审核") return styles.logisticsFeeStatusPending;
  if (status === "审核通过") return styles.logisticsFeeStatusApproved;
  if (status === "已驳回") return styles.logisticsFeeStatusRejected;
  if (status === "待开票") return styles.logisticsFeeStatusInvoice;
  if (status === "已上传发票") return styles.logisticsFeeStatusUploaded;
  if (status === "待付款") return styles.logisticsFeeStatusPayment;
  if (status === "部分付款") return styles.logisticsFeeStatusPartialPayment;
  if (status === "已付款") return styles.logisticsFeeStatusPaid;
  return styles.logisticsFeeStatusMuted;
}
