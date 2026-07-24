import { DetailField } from "../../components";
import { formatDate, formatDateTime } from "../../formatters";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import type { LogisticsExpense } from "./model";
import { LogisticsCurrencyAmountList } from "./shared";

export function LogisticsExpenseDrawerNotices({
  auditStatus,
  isVoided,
  invoiceGroups,
  rejectReasons,
  hasInvoiceNoticeFailure,
}: {
  auditStatus: string;
  isVoided: boolean;
  invoiceGroups: LogisticsExpense["invoiceGroups"];
  rejectReasons: string[];
  hasInvoiceNoticeFailure: boolean;
}) {
  return (
    <>
      {isVoided ? <div className={styles.infoStrip}>该物流费用账单已作废，仅保留原始金额、附件、发票和操作日志。</div> : null}
      {hasInvoiceNoticeFailure ? (
        <div className={styles.logisticsBillInvoiceNoticeError}>
          <strong>开票通知发送失败</strong>
          <span>{invoiceGroups?.map((group) => group.invoiceNotificationError || "").find(Boolean) || "请检查供应商绑定账号邮箱或供应商联系邮箱后重新发送。"}</span>
        </div>
      ) : null}
      {auditStatus.includes("驳回") && rejectReasons.length ? (
        <div className={styles.logisticsBillRejectNotice}>
          <strong>驳回原因</strong>
          <span>{rejectReasons.join("；")}</span>
        </div>
      ) : null}
    </>
  );
}

export function LogisticsExpenseBasicTab({
  expense,
  editingCount,
  supplierNames,
  canShowSupplier,
  billCurrencySummary,
}: {
  expense: LogisticsExpense;
  editingCount: number;
  supplierNames: string[];
  canShowSupplier: boolean;
  billCurrencySummary: Parameters<typeof LogisticsCurrencyAmountList>[0]["summary"];
}) {
  return (
    <div className={styles.logisticsDrawerSection}>
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(expense)} wide />
        <DetailField label="订单号" value={expense.orderNo || "-"} />
        <DetailField label="提单号" value={expense.blNo || expense.billOfLadingNo || "-"} />
        <DetailField label="船名航次" value={expense.order?.vesselVoyage || expense.vesselVoyage || "-"} />
        <DetailField label="费用明细" value={`${editingCount} 项`} />
        {expense.status === "voided" ? (
          <>
            <DetailField label="账单状态" value="已作废" />
            <DetailField label="作废人" value={expense.voidedBy?.name || "-"} />
            <DetailField label="作废时间" value={formatDateTime(expense.voidedAt)} />
            <DetailField label="作废原因" value={expense.voidReason || "-"} wide />
            <DetailField label="备注" value={expense.voidRemark || "-"} wide hidden={!expense.voidRemark} />
          </>
        ) : null}
        <DetailField label="供应商" value={supplierNames.join(" / ") || "-"} hidden={!canShowSupplier || !supplierNames.length} wide />
        <div className={`${styles.detailField} ${styles.detailFieldWide}`}>
          <span>账单合计</span>
          <LogisticsCurrencyAmountList summary={billCurrencySummary} />
        </div>
      </div>
    </div>
  );
}

export function LogisticsExpenseAuditTab({
  expense,
  items,
  auditStatus,
  invoiceStatus,
  paymentStatus,
  rejectReasons,
}: {
  expense: LogisticsExpense;
  items: LogisticsExpense[];
  auditStatus: string;
  invoiceStatus: string;
  paymentStatus: string;
  rejectReasons: string[];
}) {
  return (
    <div className={styles.detailGrid}>
      <DetailField label="审核状态" value={auditStatus} />
      <DetailField label="发票状态" value={invoiceStatus} />
      <DetailField label="付款状态" value={paymentStatus} />
      <DetailField label="付款时间" value={formatDate(expense.paymentDate)} />
      <DetailField label="提交时间" value={formatDateTime(expense.submittedAt)} />
      <DetailField label="审核人" value={expense.reviewedBy?.name || "-"} />
      <DetailField label="审核时间" value={formatDateTime(expense.reviewedAt)} />
      <DetailField label="创建人" value={items[0]?.createdBy?.name || "-"} />
      <DetailField label="创建时间" value={formatDateTime(items[0]?.createdAt)} />
      <DetailField label="更新人" value={items[0]?.updatedBy?.name || "-"} />
      <DetailField label="更新时间" value={formatDateTime(items[0]?.updatedAt)} />
      <DetailField label="驳回原因" value={rejectReasons.join("；") || "-"} wide hidden={!rejectReasons.length} />
    </div>
  );
}
