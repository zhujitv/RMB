import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { logisticsInvoiceGroupForExpense } from "../../../lib/platform/logistics-invoice-groups";
import { PdfPreviewButton } from "../../components";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import {
  ButtonSpinnerText,
  logisticsCurrencySummaryText,
  OcrWaitingInline,
} from "./invoice-group-utils";
import { InvoiceUploadForm } from "./invoice-upload-form";
import type {
  LogisticsExpense,
  LogisticsExpenseMutationResult,
  LogisticsInvoiceGroupSummary,
} from "./model";
import {
  currencySummaryFromSingleExpense,
  LogisticsCurrencyAmountList,
  logisticsExpenseBillAuditStatusFromRow,
  StatusPill,
} from "./shared";

type InvoiceGroupCardProps = {
  expense: LogisticsExpense;
  items: LogisticsExpense[];
  group: LogisticsInvoiceGroupSummary;
  canUploadInvoice: boolean;
  canConfirmInvoice: boolean;
  canManageInvoiceRecognition: boolean;
  deleting: boolean;
  confirmingValidation: boolean;
  confirmingInvoice: boolean;
  recognizing: boolean;
  message: string;
  onDelete: (expense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) => void;
  onManualConfirm: (expense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) => void;
  onConfirm: (expense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) => void;
  onRecognize: (expense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) => void;
  onUploaded: (result: LogisticsExpenseMutationResult) => void;
};

export function InvoiceGroupCard(props: InvoiceGroupCardProps) {
  const { expense, items, group, canUploadInvoice, canConfirmInvoice,
    canManageInvoiceRecognition, deleting, confirmingValidation, confirmingInvoice,
    recognizing, message, onDelete, onManualConfirm, onConfirm, onRecognize, onUploaded } = props;
  const groupItems = items.filter((item) => logisticsInvoiceGroupForExpense(item)?.key === group.key);
  const groupCostTypes = [...new Set(groupItems.map((item) => item.costType).filter(Boolean))];
  const targetExpense = groupItems[0] || expense;
  const uploaded = Boolean(group.uploaded || group.status === "已上传" || group.status === "已确认");
  const confirmed = Boolean(group.confirmed || group.status === "已确认");
  const storedValidationStatus = group.validationStatus || (uploaded ? "已上传待识别" : "未上传");
  const validationStatus = recognizing ? "识别中" : storedValidationStatus;
  const validationPassed = ["校验通过", "人工确认通过"].includes(storedValidationStatus);
  const validationProblem = uploaded && !recognizing && !validationPassed
    && storedValidationStatus !== "识别中" && storedValidationStatus !== "已上传待识别";
  const invoiceDocument = groupItems.map((item) => item.invoiceDocument).find((document) => document?.id) || null;
  const uploadedByName = invoiceDocument?.uploadedBy?.name
    || groupItems.map((item) => item.invoiceUploadedBy?.name || "").find(Boolean) || "-";
  const uploadedAt = invoiceDocument?.uploadedAt
    || groupItems.map((item) => item.invoiceUploadedAt || "").find(Boolean) || "";
  const canUploadGroup = canUploadInvoice && groupItems.length > 0
    && groupItems.every((item) => logisticsExpenseBillAuditStatusFromRow(item) === "审核通过")
    && !uploaded && !confirmed;
  const canDeleteGroup = canUploadInvoice && uploaded && !confirmed && !recognizing && Boolean(group.invoiceDocumentId);
  const canConfirmGroup = canConfirmInvoice && uploaded && !confirmed && validationPassed
    && !recognizing && Boolean(group.invoiceDocumentId);

  return (
    <div className={styles.logisticsInvoiceGroupCard}>
      <div className={styles.logisticsInvoiceGroupTitle}>
        <strong>{group.label}</strong>
        <StatusPill value={group.status || "待开票"} />
      </div>
      <div className={styles.logisticsInvoiceGroupMeta}>
        <span>包含费用：{(groupCostTypes.length ? groupCostTypes : group.costTypes || []).map((type) => logisticsCostTypeLabel(type)).join(" / ") || "-"}</span>
        <span>分组合计：<LogisticsCurrencyAmountList summary={group.currencyTotals || currencySummaryFromSingleExpense(targetExpense)} compact /></span>
        {group.invoiceNotificationError ? <span className={styles.logisticsInvoiceGroupError}>{group.invoiceNotificationError}</span> : null}
      </div>
      {uploaded ? (
        <div className={styles.logisticsInvoiceFileList}>
          <strong>已上传文件列表</strong>
          <div className={styles.logisticsInvoiceFileRow}>
            <span className={styles.logisticsInvoiceFileName} title={invoiceDocument?.fileName || invoiceDocument?.originalFilename || "物流发票.pdf"}>
              {invoiceDocument?.fileName || invoiceDocument?.originalFilename || "物流发票.pdf"}
            </span>
            <span>上传人：{uploadedByName}</span>
            <span>上传时间：{uploadedAt ? formatDateTime(uploadedAt) : "-"}</span>
            {group.invoiceDocumentId ? <PdfPreviewButton documentId={group.invoiceDocumentId} fileName={invoiceDocument?.fileName || invoiceDocument?.originalFilename || "物流发票.pdf"} /> : null}
            {canDeleteGroup ? (
              <button className={styles.fileDangerButton} type="button" disabled={deleting} onClick={() => onDelete(targetExpense, group)}>
                {deleting ? "删除中..." : "删除"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {uploaded ? (
        <div className={styles.logisticsInvoiceValidationBox}>
          <div className={styles.logisticsInvoiceValidationHead}>
            <span>发票校验</span><StatusPill value={validationStatus} />
          </div>
          {recognizing ? <OcrWaitingInline /> : null}
          <div className={styles.logisticsInvoiceValidationGrid}>
            <ValidationItem label="系统分组合计" value={logisticsCurrencySummaryText(group)} />
            <ValidationItem label="识别发票金额" value={Number(group.recognizedAmount || 0) ? Number(group.recognizedAmount).toFixed(2) : "-"} />
            <ValidationItem label="系统费用分组" value={group.label} />
            <ValidationItem label="识别品名" value={group.recognizedName || "-"} />
            <ValidationItem label="识别销售方" value={group.recognizedSeller || "-"} />
            <ValidationItem label="识别购买方" value={group.recognizedBuyer || "-"} />
            <ValidationItem label="发票号码" value={group.recognizedInvoiceNo || "-"} />
            <ValidationItem label="开票日期" value={group.recognizedInvoiceDate || "-"} />
          </div>
          {group.validationMessage ? <div className={styles.logisticsInvoiceValidationError}>{group.validationMessage}</div> : null}
          {canManageInvoiceRecognition && group.invoiceDocumentId && !confirmed ? (
            <div className={styles.logisticsInvoiceValidationActions}>
              <button className={styles.secondaryButton} type="button" disabled={recognizing} onClick={() => onRecognize(targetExpense, group)}>
                {recognizing ? <ButtonSpinnerText text="识别中..." /> : "重新识别"}
              </button>
              {validationProblem ? (
                <button className={styles.secondaryButton} type="button" disabled={confirmingValidation} onClick={() => onManualConfirm(targetExpense, group)}>
                  {confirmingValidation ? "确认中..." : "人工确认通过"}
                </button>
              ) : null}
              {canConfirmGroup ? (
                <button className={styles.primaryButtonCompact} type="button" disabled={confirmingInvoice} onClick={() => onConfirm(targetExpense, group)}>
                  {confirmingInvoice ? "确认中..." : "确认发票"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {canUploadGroup ? <InvoiceUploadForm expense={targetExpense} group={group} onUploaded={onUploaded} /> : null}
      {message ? <span className={styles.inlineFormMessage}>{message}</span> : null}
    </div>
  );
}

function ValidationItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.logisticsInvoiceValidationItem}>
      <span>{label}</span><strong title={value}>{value}</strong>
    </div>
  );
}
