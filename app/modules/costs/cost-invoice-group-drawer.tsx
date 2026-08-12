import { useEffect, useState } from "react";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { DetailField, PdfPreviewButton, SideDetailDrawer, UiTabs, fileDownloadUrl } from "../../components";
import { formatCurrencyAmount, formatDate, formatDateTime } from "../../formatters";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { costInvoiceStatusClass, costPaymentStatusClass } from "./cost-table";
import { costSupplierName, currencyTotalAmount, hasPaymentVoucher, isPaymentVoucherEvidenceEnabled, isProductSupplierPaid, isSystemManagedCost } from "./helpers";
import type { CostDocument, CostInvoiceGroupRow, CostRow } from "./model";

export function CostInvoiceGroupDrawer({
  group,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onClose,
}: {
  group: CostInvoiceGroupRow;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState("basic");
  const supplierName = group.supplierName || group.supplierNameSnapshot || group.vendorName || "-";
  const costs = group.costs || [];
  const documents = group.documents || [];
  const singleManualCost = group.groupType !== "LOGISTICS_BILL" && costs.length === 1;

  useEffect(() => {
    setActiveTab("basic");
  }, [group.id]);

  return (
    <SideDetailDrawer
      ariaLabel="发票组详情"
      kicker="成本管理"
      title={`${group.orderNo || "-"} · ${customerLegalName(group)}`}
      subtitle={`供应商：${supplierName} · 费用类型：${group.costTypeSummary || "-"} · 发票状态：${group.invoiceStatus || "-"}`}
      onClose={onClose}
      actions={
        singleManualCost ? (
          <button className={styles.primaryButtonCompact} type="button" onClick={() => onOpenDocuments(costs[0].id)}>{isSystemManagedCost(costs[0]) ? "查看资料" : "资料维护"}</button>
        ) : null
      }
    >
      {group.groupType === "LOGISTICS_BILL" ? (
        <div className={styles.infoStrip}>该组来自物流费用分组开票。成本管理只同步展示发票、付款和异常结果，不再按单条费用维护物流发票。</div>
      ) : null}
      <UiTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: "basic", label: "基础信息" },
          { key: "items", label: "费用明细" },
          { key: "documents", label: "发票资料" },
        ]}
      />
      {activeTab === "basic" ? (
        <>
          <div className={styles.detailGrid}>
            <DetailField label="订单号" value={group.orderNo || "-"} />
            <DetailField label="客户全称" value={customerLegalName(group)} wide />
            <DetailField label="提单号" value={group.blNo || group.billOfLadingNo || "-"} />
            <DetailField label="供应商" value={supplierName} />
            <DetailField label="发票号 / 文件" value={group.invoiceNo || "-"} wide />
            <DetailField label="包含费用类型" value={group.costTypeSummary || "-"} wide />
            <DetailField label="付款状态" value={group.paymentStatus || "-"} />
            <DetailField label="发票状态" value={group.invoiceStatus || "-"} />
            {group.invoiceExceptionLabel ? <DetailField label="异常类型" value={group.invoiceExceptionLabel} /> : null}
            <DetailField label="费用明细数" value={`${group.costCount || costs.length} 项`} />
          </div>
          <CostInvoiceGroupTotals group={group} />
        </>
      ) : null}
      {activeTab === "items" ? <CostInvoiceGroupItemsTable costs={costs} onOpenPaymentVoucher={onOpenPaymentVoucher} /> : null}
      {activeTab === "documents" ? (
        <CostInvoiceGroupDocuments
          documents={documents}
          groupType={group.groupType}
          onOpenManualDocuments={singleManualCost ? () => onOpenDocuments(costs[0].id) : undefined}
        />
      ) : null}
    </SideDetailDrawer>
  );
}

export function CostInvoiceGroupTotals({ group }: { group: Pick<CostInvoiceGroupRow, "currencyTotals"> }) {
  const cnyTotal = currencyTotalAmount(group.currencyTotals, "CNY");
  const usdTotal = currencyTotalAmount(group.currencyTotals, "USD");
  return (
    <div className={styles.documentGroupGrid}>
      <div className={styles.documentGroupCard}>
        <strong>CNY 合计</strong>
        <span className={styles.costAmountTotal}>{formatCurrencyAmount("CNY", cnyTotal)}</span>
      </div>
      <div className={styles.documentGroupCard}>
        <strong>USD 合计</strong>
        <span className={styles.costAmountTotal}>{formatCurrencyAmount("USD", usdTotal)}</span>
      </div>
    </div>
  );
}

export function CostInvoiceGroupItemsTable({
  costs,
  onOpenPaymentVoucher,
}: {
  costs: CostRow[];
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  const logisticsSourceText = (value?: string) => value || "-";
  return (
    <div className={styles.logisticsDrawerSection}>
      <div className={styles.logisticsDrawerSectionHeader}>
        <div>
          <strong>费用明细</strong>
          <span>{costs.length} 项</span>
        </div>
      </div>
      <div className={`${styles.tableWrap} ${styles.costTableWrap}`}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>费用类型</th>
              <th className={styles.supplierColumn}>供应商</th>
              <th>shipmentId</th>
              <th>logisticsFeeId</th>
              <th>invoiceId</th>
              <th>币种</th>
              <th className={styles.amountColumn}>原币金额</th>
              <th className={styles.amountColumn}>折人民币</th>
              <th className={styles.statusColumn}>付款状态</th>
              <th>付款凭证</th>
              <th className={styles.statusColumn}>发票状态</th>
              <th>创建时间</th>
              <th>审核时间</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {costs.length ? costs.map((cost) => (
              <tr key={cost.id}>
                <td>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"}</td>
                <td className={styles.supplierColumn} title={costSupplierName(cost)}>{costSupplierName(cost)}</td>
                <td title={cost.logisticsSource?.shipmentId || ""}>{logisticsSourceText(cost.logisticsSource?.shipmentId)}</td>
                <td title={cost.logisticsSource?.logisticsFeeId || cost.sourceId || ""}>{logisticsSourceText(cost.logisticsSource?.logisticsFeeId || cost.sourceId)}</td>
                <td title={cost.logisticsSource?.invoiceId || ""}>{logisticsSourceText(cost.logisticsSource?.invoiceId)}</td>
                <td>{String(cost.currency || "CNY").toUpperCase()}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount(cost.currency || "CNY", cost.amount ?? cost.amountCny ?? 0)}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount("CNY", cost.amountCny ?? 0)}</td>
                <td className={styles.statusColumn}><span className={costPaymentStatusClass(cost.paymentStatus)}>{cost.paymentStatus || "-"}</span></td>
                <td>
                  {hasPaymentVoucher(cost) ? (
                    <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>查看付款凭证</button>
                  ) : isProductSupplierPaid(cost) && isPaymentVoucherEvidenceEnabled(cost) ? "未上传水单" : "-"}
                </td>
                <td className={styles.statusColumn}><span className={costInvoiceStatusClass(cost.invoiceStatus)}>{cost.invoiceStatus || "-"}</span></td>
                <td>{formatDateTime(cost.logisticsSource?.createdAt || cost.createdAt)}</td>
                <td>{formatDateTime(cost.logisticsSource?.reviewedAt)}</td>
                <td title={cost.remark || ""}>{cost.remark || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={14}><div className={styles.emptyState}>暂无费用明细</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CostInvoiceGroupDocuments({
  documents,
  groupType,
  onOpenManualDocuments,
}: {
  documents: CostDocument[];
  groupType?: string;
  onOpenManualDocuments?: () => void;
}) {
  return (
    <div className={styles.documentGroupCard}>
      <strong>整组发票资料</strong>
      {groupType === "LOGISTICS_BILL" ? (
        <span className={styles.mutedText}>物流发票按物流费用模块的分组开票入口上传，成本管理仅同步展示该组结果。</span>
      ) : null}
      {documents.length ? documents.map((document) => (
        <div key={document.id} className={styles.fileListItem}>
          <div>
            <span>{document.fileName || "-"}</span>
            <small>{document.uploadedByName || "-"} ｜ {formatDate(document.uploadedAt)}</small>
          </div>
          <div className={styles.fileListItemActions}>
            <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
            <a className={styles.fileActionButton} href={fileDownloadUrl("order-document", document.id)}>下载</a>
          </div>
        </div>
      )) : <div className={styles.emptyState}>暂未收到整组发票资料</div>}
      {onOpenManualDocuments ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={onOpenManualDocuments}>维护整组发票资料</button>
      ) : null}
    </div>
  );
}
