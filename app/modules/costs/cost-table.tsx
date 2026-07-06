import { MoneyAmount } from "../../components";
import { formatCurrencyAmount } from "../../formatters";
import { customerDisplayName, customerLegalName } from "../../utils";
import { summarizeCurrencyTotals } from "../../../lib/platform/currency-totals";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import styles from "../../WorkspaceShell.module.css";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import { CostInvoiceActions } from "./invoice-actions";
import { FACTORY_DOCUMENT_TYPES, type CostInvoiceGroupRow, type CostOrderSummary, type CostRow, type CostView } from "./model";
import { canDeleteCost, canVoidCost, costStatusLabel, costSupplierName, currencyTotalAmount, hasPaymentVoucher, isFactoryCost, isLogisticsGeneratedCost, isLogisticsInvoiceCost, isProductSupplierPaid, isProductSupplierPaymentEnabled, isVoidedCost, singlePaymentVoucherCost } from "./helpers";

export function CostTableRows({
  cost,
  selected,
  onViewDetail,
  deleting,
  onSelect,
  onEdit,
  onCopy,
  onVoid,
  onDelete,
  onRestore,
  onOpenDocuments,
  onOpenPaymentVoucher,
}: {
  cost: CostRow;
  selected: boolean;
  onViewDetail: () => void;
  deleting: boolean;
  onSelect: (selected: boolean) => void;
  onEdit: () => void;
  onCopy: () => void;
  onVoid: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const manualCost = !isLogisticsGeneratedCost(cost);
  const voided = isVoidedCost(cost);
  const deleteAllowed = canDeleteCost(cost);
  const voidAllowed = canVoidCost(cost);
  return (
    <>
      <tr className={getBusinessEntityRowClass(cost, styles, styles.clickableRow)} onClick={onViewDetail}>
        <td>
          <input
            type="checkbox"
            checked={selected}
            disabled={!voidAllowed}
            onChange={(event) => onSelect(event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`选择成本 ${cost.orderNo || ""}`}
          />
        </td>
        <td className={styles.orderNoColumn}><strong>{cost.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(cost)}>{customerDisplayName(cost)}</td>
        <td>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"}</td>
        <td className={styles.supplierColumn} title={supplierName}>{supplierName}</td>
        <td className={styles.amountColumn}><MoneyAmount currency={cost.currency} amount={cost.amount} amountCny={cost.amountCny} /></td>
        <td><span className={`${styles.statusPill} ${voided ? styles.statusMuted : cost.paymentStatus === "已支付" ? styles.statusSuccess : styles.statusWarning}`}>{costStatusLabel(cost)}</span></td>
        <td><span className={`${styles.statusPill} ${cost.invoiceStatus === "已收到" ? styles.statusSuccess : styles.statusMuted}`}>{cost.invoiceStatus || "-"}</span></td>
        <td className={styles.costInvoiceActionColumn}>
          <CostInvoiceActions cost={cost} onOpenDocuments={onOpenDocuments} onOpenPaymentVoucher={onOpenPaymentVoucher} />
          {manualCost ? (
            <>
              {voided ? (
                <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={(event) => { event.stopPropagation(); onRestore(); }}>
                  {deleting ? "处理中..." : "恢复"}
                </button>
              ) : (
                <>
                  <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>编辑</button>
                  <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onCopy(); }}>复制</button>
                  {voidAllowed ? (
                    <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={(event) => { event.stopPropagation(); onVoid(); }}>
                      {deleting ? "处理中..." : "作废"}
                    </button>
                  ) : null}
                  {deleteAllowed ? (
                    <button className={styles.fileDangerButton} type="button" disabled={deleting} onClick={(event) => { event.stopPropagation(); onDelete(); }}>
                      {deleting ? "处理中..." : "删除"}
                    </button>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </td>
      </tr>
    </>
  );
}

export function CostDetailTableHead({
  allSelected,
  onToggleAll,
}: {
  allSelected: boolean;
  onToggleAll: (selected: boolean) => void;
}) {
  return (
    <thead>
      <tr>
        <th>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onToggleAll(event.target.checked)}
            aria-label="选择当前页可作废成本"
          />
        </th>
        <th className={styles.orderNoColumn}>订单号</th>
        <th className={styles.customerColumn}>客户简称</th>
        <th>成本类型</th>
        <th className={styles.supplierColumn}>供应商</th>
        <th className={styles.amountColumn}>成本金额</th>
        <th>付款状态</th>
        <th>发票状态</th>
        <th className={styles.costInvoiceActionColumn}>操作</th>
      </tr>
    </thead>
  );
}

export function CostInvoiceGroupTableHead({ showException }: { showException: boolean }) {
  return (
    <thead>
      <tr>
        <th className={styles.orderNoColumn}>订单号</th>
        <th className={styles.customerColumn}>客户简称</th>
        <th className={styles.supplierColumn}>供应商</th>
        <th className={styles.amountColumn}>CNY 合计</th>
        <th className={styles.amountColumn}>USD 合计</th>
        <th className={styles.statusColumn}>付款状态</th>
        <th className={styles.statusColumn}>发票状态</th>
        {showException ? <th className={styles.statusColumn}>异常类型</th> : null}
        <th className={styles.costInvoiceActionColumn}>操作</th>
      </tr>
    </thead>
  );
}

export function CostInvoiceGroupRows({
  group,
  showException,
  onViewDetail,
  onOpenDocuments,
  onOpenPaymentVoucher,
}: {
  group: CostInvoiceGroupRow;
  showException: boolean;
  onViewDetail: () => void;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  const supplierName = group.supplierName || group.supplierNameSnapshot || group.vendorName || "-";
  const exceptionLabel = group.invoiceExceptionLabel || "";
  const voucherCost = singlePaymentVoucherCost(group.costs || []);
  return (
    <tr className={getBusinessEntityRowClass(group, styles, styles.clickableRow)} onClick={onViewDetail}>
      <td className={styles.orderNoColumn}><strong>{group.orderNo || "-"}</strong></td>
      <td className={styles.customerColumn} title={customerLegalName(group)}>{customerDisplayName(group)}</td>
      <td className={styles.supplierColumn} title={supplierName}>{supplierName}</td>
      <td className={styles.amountColumn}>
        <strong className={styles.costAmountTotal}>{formatCurrencyAmount("CNY", currencyTotalAmount(group.currencyTotals, "CNY"))}</strong>
      </td>
      <td className={styles.amountColumn}>
        <strong className={styles.costAmountTotal}>{formatCurrencyAmount("USD", currencyTotalAmount(group.currencyTotals, "USD"))}</strong>
      </td>
      <td className={styles.statusColumn}><span className={costPaymentStatusClass(group.paymentStatus)}>{group.paymentStatus || "-"}</span></td>
      <td className={styles.statusColumn}><span className={costInvoiceStatusClass(group.invoiceStatus)}>{group.invoiceStatus || "-"}</span></td>
      {showException ? (
        <td className={styles.statusColumn}>
          <span className={`${styles.statusPill} ${exceptionLabel === "已付款未收票" ? styles.statusWarning : styles.statusMuted}`}>{exceptionLabel || "-"}</span>
        </td>
      ) : null}
      <td className={styles.costInvoiceActionColumn}>
        <div className={styles.costInvoiceActions}>
          <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button>
          {voucherCost ? (
            <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenPaymentVoucher(voucherCost); }}>查看付款凭证</button>
          ) : null}
          <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>资料维护</button>
        </div>
      </td>
    </tr>
  );
}

export function CostOrderTableHead() {
  return (
    <thead>
      <tr>
        <th className={styles.orderNoColumn}>订单号 / Shipment</th>
        <th className={styles.customerColumn}>客户简称</th>
        <th className={styles.amountColumn}>CNY 合计</th>
        <th className={styles.amountColumn}>USD 合计</th>
        <th className={styles.statusColumn}>状态</th>
        <th className={styles.operationColumn}>详情</th>
      </tr>
    </thead>
  );
}

export function costViewColSpan(costView: CostView) {
  if (costView === "orders") return 6;
  if (costView === "invoiceGroups") return 8;
  if (costView === "invoiceExceptions") return 9;
  return 9;
}

export function costViewLabel(costView: CostView) {
  if (costView === "invoiceGroups") return "发票组";
  if (costView === "orders") return "订单成本汇总";
  if (costView === "invoiceExceptions") return "发票异常组";
  return "成本明细";
}

export function costPaymentStatusClass(status = "") {
  return `${styles.statusPill} ${status === "已支付" ? styles.statusSuccess : status === "部分支付" ? styles.statusWarning : styles.statusMuted}`;
}

export function costInvoiceStatusClass(status = "") {
  return `${styles.statusPill} ${status === "已收到" ? styles.statusSuccess : status === "部分收到" ? styles.statusWarning : styles.statusMuted}`;
}

export function CostOrderSummaryRows({
  order,
  onViewDetail,
}: {
  order: CostOrderSummary;
  onViewDetail: () => void;
}) {
  const confirmProgress = order.costConfirmProgress?.text || "无成本";
  return (
    <>
      <tr className={getBusinessEntityRowClass(order, styles, styles.clickableRow)} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{order.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(order)}>{customerDisplayName(order)}</td>
        <td className={styles.amountColumn}>
          <CostOrderAmountCell order={order} currency="CNY" fallback={order.totalCostCny} />
        </td>
        <td className={styles.amountColumn}>
          <CostOrderAmountCell order={order} currency="USD" />
        </td>
        <td className={styles.statusColumn}><span className={styles.statusPill}>{confirmProgress}</span></td>
        <td className={styles.operationColumn}><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}

export function CostOrderAmountCell({
  order,
  currency,
  fallback = 0,
}: {
  order: CostOrderSummary;
  currency: "CNY" | "USD";
  fallback?: number;
}) {
  const amount = currencyTotalAmount(order.currencyTotals, currency, fallback);
  return (
    <div className={styles.costAmountStack}>
      <strong className={styles.costAmountTotal}>{formatCurrencyAmount(currency, amount)}</strong>
    </div>
  );
}

export function recalculateOrderSummary(order: CostOrderSummary, costs: CostRow[]): CostOrderSummary {
  const activeCosts = costs.filter((cost) => Boolean(cost.id));
  const currencyTotals = summarizeCurrencyTotals(activeCosts);
  const confirmed = activeCosts.filter((cost) => cost.costConfirmed).length;
  const documentProgress = activeCosts.reduce((acc, cost) => {
    const successDocs = (cost.documents || []).filter((document) => document.uploadStatus === "SUCCESS");
    if (isFactoryCost(cost)) {
      FACTORY_DOCUMENT_TYPES.forEach((type) => {
        acc.total += 1;
        if (successDocs.some((document) => document.documentType === type.value)) acc.completed += 1;
      });
    } else if (isLogisticsInvoiceCost(cost)) {
      acc.total += 1;
      if (successDocs.some((document) => document.documentType === "SUPPLIER_INVOICE")) acc.completed += 1;
    }
    return acc;
  }, { completed: 0, total: 0 });
  return {
    ...order,
    costs: activeCosts,
    costCount: activeCosts.length,
    totalCostCny: currencyTotals.totalCny,
    currencyTotals,
    costConfirmProgress: {
      completed: confirmed,
      total: activeCosts.length,
      text: activeCosts.length ? `${confirmed}/${activeCosts.length}` : "无成本",
    },
    documentProgress: {
      ...documentProgress,
      text: documentProgress.total ? `${documentProgress.completed}/${documentProgress.total}` : "无需资料",
    },
  };
}
