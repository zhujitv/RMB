import { useEffect, useState } from "react";
import { DetailField, MoneyAmount, PdfPreviewButton, SideDetailDrawer, UiTabs, fileDownloadUrl } from "../../components";
import { formatCny, formatCurrencyAmount, formatDate, formatDateTime } from "../../formatters";
import { customerLegalName } from "../../utils";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import styles from "../../WorkspaceShell.module.css";
import { CostInvoiceActions } from "./invoice-actions";
import type { CostDocument, CostInvoiceGroupRow, CostOrderSummary, CostRow } from "./model";
import { costInvoiceStatusClass, costPaymentStatusClass } from "./cost-table";
import { costDeleteActionLabel, costSupplierName, currencyTotalAmount, hasPaymentVoucher, isLogisticsGeneratedCost, isProductSupplierPaid, isProductSupplierPaymentEnabled } from "./helpers";

export function CostDetailDrawer({
  cost,
  deleting,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onEdit,
  onDelete,
  onClose,
}: {
  cost: CostRow;
  deleting: boolean;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState("basic");
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const manualCost = cost.sourceType !== "LOGISTICS_EXPENSE";
  const deleteActionLabel = costDeleteActionLabel(cost);

  useEffect(() => {
    setActiveTab("basic");
  }, [cost.id]);

  return (
    <SideDetailDrawer
      ariaLabel="成本详情"
      kicker="成本管理"
      title={`${cost.orderNo || "-"} · ${customerLegalName(cost)}`}
      subtitle={`成本类型：${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} · 付款状态：${cost.paymentStatus || "-"} · 供应商：${supplierName}`}
      onClose={onClose}
      actions={
        <>
          <button className={styles.primaryButtonCompact} type="button" onClick={onOpenDocuments}>资料维护</button>
          {manualCost ? (
            <>
              <button className={styles.secondaryButton} type="button" onClick={onEdit}>编辑成本</button>
              <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onDelete}>
                {deleting ? "处理中..." : deleteActionLabel}
              </button>
            </>
          ) : null}
        </>
      }
    >
      {!manualCost ? <div className={styles.infoStrip}>系统生成的成本记录不可在此直接编辑。</div> : null}
      <UiTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: "basic", label: "基本信息" },
          { key: "payment", label: "付款信息" },
          { key: "invoice", label: "发票信息" },
          { key: "audit", label: "操作记录" },
        ]}
      />
      {activeTab === "basic" ? (
        <div className={styles.detailGrid}>
          <DetailField label="客户全称" value={customerLegalName(cost)} wide />
          <DetailField label="订单号" value={cost.orderNo || "-"} />
          <DetailField label="提单号" value={cost.blNo || cost.billOfLadingNo || "-"} />
          <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
          <DetailField label="供应商" value={supplierName} />
          <DetailMoneyField label="成本金额" cost={cost} />
          <DetailField label="币种 / 汇率" value={`${cost.currency || "-"} / ${Number(cost.exchangeRate || 0).toFixed(4)}`} />
          <DetailField label="来源" value={cost.sourceLabel || "人工录入"} />
          <DetailField label="备注" value={cost.remark || "-"} wide hidden={!cost.remark} />
        </div>
      ) : null}
      {activeTab === "payment" ? (
        <div className={styles.detailGrid}>
          <DetailField label="付款状态" value={cost.paymentStatus || "-"} />
          <DetailField label="付款日期" value={formatDate(cost.paymentDate)} />
          {isProductSupplierPaymentEnabled(cost) ? (
            <>
              <DetailField label="产品货款付款" value={isProductSupplierPaid(cost) ? "已付款" : "未付款"} />
              <DetailField label="付款时间" value={formatDateTime(cost.paidAt || cost.paymentDate)} />
              <DetailField
                label="付款凭证"
                value={hasPaymentVoucher(cost)
                  ? <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>查看付款凭证</button>
                  : isProductSupplierPaid(cost) ? "未上传水单" : "-"}
              />
            </>
          ) : null}
          <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
          <DetailMoneyField label="付款金额" cost={cost} />
        </div>
      ) : null}
      {activeTab === "invoice" ? (
        <div className={styles.detailGrid}>
          <DetailField label="发票状态" value={cost.invoiceStatus || "-"} />
          <DetailField label="供应商" value={supplierName} />
          <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
          <DetailField label="资料维护" value="点击上方“资料维护”查看或上传发票资料。" wide />
        </div>
      ) : null}
      {activeTab === "audit" ? (
        <div className={styles.detailGrid}>
          <DetailField label="创建人" value={cost.createdBy?.name || "-"} />
          <DetailField label="创建时间" value={formatDate(cost.createdAt)} />
          <DetailField label="修改人" value={cost.updatedBy?.name || "-"} />
          <DetailField label="更新时间" value={formatDate(cost.updatedAt)} />
          <DetailField label="记录来源" value={cost.sourceLabel || "人工录入"} />
        </div>
      ) : null}
    </SideDetailDrawer>
  );
}

export function DetailMoneyField({ label, cost }: { label: string; cost: CostRow }) {
  return (
    <div className={styles.detailField}>
      <span>{label}</span>
      <MoneyAmount
        className={styles.detailAmountCell}
        currency={cost.currency}
        amount={cost.amount}
        amountCny={cost.amountCny}
      />
    </div>
  );
}

export function CostOrderSummaryDrawer({
  order,
  onOpenDocuments,
  onOpenPaymentVoucher,
  deletingId,
  onDelete,
  onClose,
}: {
  order: CostOrderSummary;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  deletingId: string;
  onDelete: (cost: CostRow) => void;
  onClose: () => void;
}) {
  const confirmProgress = order.costConfirmProgress?.text || "无成本";
  const documentProgress = order.documentProgress?.text || "无需资料";
  return (
    <SideDetailDrawer
      ariaLabel="订单成本汇总详情"
      kicker="成本汇总"
      title={`${order.orderNo || "-"} · ${customerLegalName(order)}`}
      subtitle={`提单号：${order.blNo || order.billOfLadingNo || "-"}`}
      onClose={onClose}
    >
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(order)} wide />
        <DetailField label="订单号" value={order.orderNo || "-"} />
        <DetailField label="提单号" value={order.blNo || order.billOfLadingNo || "-"} />
        <DetailField label="最终应收" value={formatCny(Number(order.receivableAmountCny || 0))} />
        <DetailField label="成本确认" value={confirmProgress} />
        <DetailField label="资料状态" value={documentProgress} />
        <DetailField label="成本条数" value={String(Number(order.costCount || 0))} />
      </div>
      <CostOrderItemsTable
        costs={order.costs || []}
        deletingId={deletingId}
        onOpenDocuments={onOpenDocuments}
        onOpenPaymentVoucher={onOpenPaymentVoucher}
        onDelete={onDelete}
      />
    </SideDetailDrawer>
  );
}

export function CostOrderItemsTable({
  costs,
  deletingId,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onDelete,
}: {
  costs: CostRow[];
  deletingId: string;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onDelete: (cost: CostRow) => void;
}) {
  return (
    <div className={styles.logisticsDrawerSection}>
      <div className={styles.logisticsDrawerSectionHeader}>
        <div>
          <strong>费用明细</strong>
          <span>{costs.length} 项</span>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>成本类型</th>
              <th className={styles.supplierColumn}>供应商</th>
              <th>币种</th>
              <th className={styles.amountColumn}>原币金额</th>
              <th>付款状态</th>
              <th>发票状态</th>
              <th className={styles.costInvoiceActionColumn}>操作</th>
            </tr>
          </thead>
          <tbody>
            {costs.length ? costs.map((cost) => (
              <tr key={cost.id}>
                <td>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"}</td>
                <td className={styles.supplierColumn} title={costSupplierName(cost)}>{costSupplierName(cost)}</td>
                <td>{String(cost.currency || "CNY").toUpperCase()}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount(cost.currency || "CNY", cost.amount ?? cost.amountCny ?? 0)}</td>
                <td><span className={`${styles.statusPill} ${cost.paymentStatus === "已支付" ? styles.statusSuccess : styles.statusWarning}`}>{cost.paymentStatus || "-"}</span></td>
                <td><span className={`${styles.statusPill} ${cost.invoiceStatus === "已收到" ? styles.statusSuccess : styles.statusMuted}`}>{cost.invoiceStatus || "-"}</span></td>
                <td className={styles.costInvoiceActionColumn}>
                  <div className={styles.costInvoiceActions}>
                    <CostInvoiceActions cost={cost} onOpenDocuments={() => onOpenDocuments(cost.id)} onOpenPaymentVoucher={onOpenPaymentVoucher} />
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={deletingId === cost.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(cost);
                      }}
                    >
                      {deletingId === cost.id ? "处理中..." : costDeleteActionLabel(cost)}
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={7}><div className={styles.emptyState}>暂无成本明细</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
          <button className={styles.primaryButtonCompact} type="button" onClick={() => onOpenDocuments(costs[0].id)}>资料维护</button>
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
  return (
    <div className={styles.logisticsDrawerSection}>
      <div className={styles.logisticsDrawerSectionHeader}>
        <div>
          <strong>费用明细</strong>
          <span>{costs.length} 项</span>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>费用类型</th>
              <th className={styles.supplierColumn}>供应商</th>
              <th>币种</th>
              <th className={styles.amountColumn}>原币金额</th>
              <th className={styles.amountColumn}>折人民币</th>
              <th>付款状态</th>
              <th>付款凭证</th>
              <th>发票状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {costs.length ? costs.map((cost) => (
              <tr key={cost.id}>
                <td>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"}</td>
                <td className={styles.supplierColumn} title={costSupplierName(cost)}>{costSupplierName(cost)}</td>
                <td>{String(cost.currency || "CNY").toUpperCase()}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount(cost.currency || "CNY", cost.amount ?? cost.amountCny ?? 0)}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount("CNY", cost.amountCny ?? 0)}</td>
                <td><span className={costPaymentStatusClass(cost.paymentStatus)}>{cost.paymentStatus || "-"}</span></td>
                <td>
                  {hasPaymentVoucher(cost) ? (
                    <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>查看付款凭证</button>
                  ) : isProductSupplierPaid(cost) && isProductSupplierPaymentEnabled(cost) ? "未上传水单" : "-"}
                </td>
                <td><span className={costInvoiceStatusClass(cost.invoiceStatus)}>{cost.invoiceStatus || "-"}</span></td>
                <td title={cost.remark || ""}>{cost.remark || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={9}><div className={styles.emptyState}>暂无费用明细</div></td></tr>
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
