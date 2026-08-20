"use client";

import { useEffect, useState } from "react";
import { DetailField, SideDetailDrawer } from "../../components";
import { formatCurrencyAmount, formatDate, formatDateTime } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { QuotationDeliveryHistory } from "./quotation-delivery-history";
import { QuotationDetailActions } from "./quotation-detail-actions";
import { quotationValidityState } from "./quotation-expiry";
import styles from "./quotations.module.css";
import {
  currentQuotationVersion,
  quotationCustomerLegalName,
  quotationItemDescription,
  quotationLineAmount,
  quotationNumber,
  quotationStatusLabel,
  quotationSubtotal,
  quotationTotal,
  type QuotationRow,
} from "./types";

export function QuotationDetailDrawer({
  quotation,
  loading,
  error,
  canWrite,
  canSendCustomerEmail,
  canEdit,
  canVoid,
  canDelete,
  canConvert,
  voiding,
  deleting,
  onEdit,
  onVoid,
  onDelete,
  onOpenSalesExecution,
  onSaved,
  onClose,
}: {
  quotation: QuotationRow;
  loading: boolean;
  error: string;
  canWrite: boolean;
  canSendCustomerEmail: boolean;
  canEdit: boolean;
  canVoid: boolean;
  canDelete: boolean;
  canConvert: boolean;
  voiding: boolean;
  deleting: boolean;
  onEdit: () => void;
  onVoid: () => void;
  onDelete: () => void;
  onOpenSalesExecution: () => void;
  onSaved: (quotation: QuotationRow, message: string) => void;
  onClose: () => void;
}) {
  const versions = quotation.versions || [];
  const currentVersion = currentQuotationVersion(quotation);
  const currentVersionNumber = Number(quotation.currentVersionNumber || currentVersion?.versionNumber || 1);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState(currentVersionNumber);
  useEffect(() => {
    setSelectedVersionNumber(currentVersionNumber);
  }, [quotation.id, currentVersionNumber]);
  const version = versions.find((item) => Number(item.versionNumber) === selectedVersionNumber) || currentVersion;
  const versionQuotation = { ...quotation, currentVersion: version };
  const items = version?.items || [];
  const currency = version?.currency || "CNY";
  const customerSnapshotName = version?.customerNameSnapshot || quotationCustomerLegalName(quotation);
  const customerSnapshotShortName = version?.customerShortNameSnapshot || customerSnapshotName;
  const detailReady = !loading && !error && Array.isArray(quotation.deliveries) && Array.isArray(quotation.versions) && Boolean(currentVersion?.id);
  const expired = quotationValidityState(quotation).expired;
  return (
    <SideDetailDrawer
      ariaLabel="报价详情"
      kicker="客户与报价"
      title={`${quotationNumber(quotation) || "未编号"} · ${customerSnapshotShortName}`}
      subtitle={`查看版本：V${version?.versionNumber || currentVersionNumber} · 当前版本：V${currentVersionNumber} · 状态：${quotationStatusLabel(quotation.status)}`}
      onClose={onClose}
      actions={(
        <>
          <QuotationDetailActions
            quotation={quotation}
            versionNumber={Number(version?.versionNumber || currentVersionNumber)}
            canWrite={canWrite}
            canSendCustomerEmail={canSendCustomerEmail}
            ready={detailReady}
            onSaved={onSaved}
          />
          {canConvert && selectedVersionNumber === currentVersionNumber ? <button className={shell.primaryButtonCompact} type="button" disabled={voiding || deleting} onClick={onOpenSalesExecution}>{quotation.salesExecution?.id ? "打开销售执行" : "转为销售执行"}</button> : null}
          {canEdit ? <button className={shell.primaryButtonCompact} type="button" disabled={voiding || deleting} onClick={onEdit}>{quotation.status === "DRAFT" ? "编辑草稿" : "编辑新版本"}</button> : null}
          {canVoid ? (
            <button className={shell.dangerButton} type="button" disabled={voiding || deleting} onClick={onVoid}>
              {voiding ? "作废中..." : "作废报价"}
            </button>
          ) : null}
          {canDelete ? (
            <button className={shell.dangerButton} type="button" disabled={voiding || deleting} onClick={onDelete}>
              {deleting ? "删除中..." : "删除报价"}
            </button>
          ) : null}
        </>
      )}
    >
      {loading ? <div className={shell.emptyState} role="status" aria-live="polite">正在加载报价详情...</div> : null}
      {error ? <div className={shell.inlineError} role="alert" aria-live="assertive">{error}</div> : null}
      {expired ? (
        <div className={styles.voidNotice} role="alert">
          该报价已超过有效期，不能继续发送或登记客户接受。请编辑并生成有效期正确的新版本。
        </div>
      ) : null}
      {quotation.status === "VOIDED" ? (
        <div className={styles.voidNotice}>
          该报价已作废{quotation.voidReason ? `：${quotation.voidReason}` : ""}
          {quotation.voidedAt ? `（${formatDateTime(quotation.voidedAt)}）` : ""}
        </div>
      ) : null}

      <div className={shell.detailGrid}>
        <DetailField label="报价号" value={quotationNumber(quotation) || "-"} />
        <DetailField label="客户全称（版本快照）" value={customerSnapshotName} wide />
        <DetailField label="业务主体（版本快照）" value={version?.businessEntityShortNameSnapshot || version?.businessEntityNameSnapshot || quotation.businessEntity?.displayName || "-"} />
        <DetailField label="对外英文主体" value={version?.sellerNameEnSnapshot || "-"} wide />
        <DetailField label="客户联系人" value={version?.contactPersonSnapshot || "-"} />
        <DetailField label="客户邮箱" value={version?.contactEmailSnapshot || "-"} />
        <DetailField label="客户电话" value={version?.contactPhoneSnapshot || "-"} />
        <DetailField label="报价日期" value={formatDate(version?.quoteDate)} />
        <DetailField label="有效期至" value={formatDate(version?.validUntil)} />
        <DetailField label="币种" value={currency} />
        <DetailField label="贸易条款" value={version?.tradeTerm || "-"} />
        <DetailField label="付款条款" value={version?.paymentTerm || "-"} wide />
        <DetailField label="预计交期" value={version?.leadTimeDays == null || version.leadTimeDays === "" ? "-" : `${version.leadTimeDays} 天`} />
        <DetailField label="业务员" value={quotation.salesperson?.name || quotation.salespersonName || "-"} />
        {quotation.salesExecution?.id ? <DetailField label="客户订单号" value={`${quotation.salesExecution.customerOrderNo || "未填写"}${quotation.salesExecution.status === "VOIDED" ? "（已作废）" : ""}`} /> : null}
        <DetailField label="报价小计" value={formatCurrencyAmount(currency, quotationSubtotal(versionQuotation))} />
        <DetailField label="报价总额" value={formatCurrencyAmount(currency, quotationTotal(versionQuotation))} />
        <DetailField label="版本创建时间" value={formatDateTime(version?.createdAt)} />
        <DetailField label="备注" value={version?.remark || "-"} wide />
      </div>

      <section className={styles.drawerSection}>
        <div className={styles.drawerSectionHeader}>
          <h3>报价明细</h3>
          <small>共 {items.length} 行</small>
        </div>
        <div className={styles.detailTableWrap}>
          <table className={styles.detailTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>产品描述（含规格）</th>
                <th>单位</th>
                <th>数量</th>
                <th>单价</th>
                <th className={styles.amountCell}>金额</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? items.map((item, index) => (
                <tr key={item.id || `${quotation.id}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{quotationItemDescription(item) || "-"}</td>
                  <td>{item.unit || "-"}</td>
                  <td>{Number(item.quantity || 0).toLocaleString("zh-CN")}</td>
                  <td>{formatCurrencyAmount(currency, item.unitPrice)}</td>
                  <td className={styles.amountCell}>{formatCurrencyAmount(currency, quotationLineAmount(item))}</td>
                </tr>
              )) : (
                <tr><td colSpan={6}><div className={shell.emptyState}>暂无报价明细</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <QuotationDeliveryHistory
        deliveries={(quotation.deliveries || []).filter((delivery) => delivery.quotationVersionId === version?.id)}
        decisions={(quotation.decisions || []).filter((decision) => decision.quotationVersionId === version?.id)}
      />

      {versions.length > 1 ? (
        <section className={styles.drawerSection}>
          <div className={styles.drawerSectionHeader}>
            <h3>版本记录</h3>
            <small>每次保存草稿都会保留一个不可变版本。</small>
          </div>
          <div className={styles.versionList}>
            {versions.map((item, index) => (
              <button
                className={`${styles.versionPill} ${Number(item.versionNumber) === selectedVersionNumber ? styles.versionPillActive : ""}`}
                type="button"
                key={item.id || `${item.versionNumber}-${index}`}
                onClick={() => setSelectedVersionNumber(Number(item.versionNumber || currentVersionNumber))}
              >
                V{item.versionNumber || versions.length - index} · {formatDateTime(item.createdAt)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </SideDetailDrawer>
  );
}
