import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { DetailField, SideDetailDrawer } from "../../components";
import { formatCny, formatCurrencyAmount } from "../../formatters";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { canDeleteCost, canVoidCost, costSupplierName, isFactoryPurchaseSettlementCost, isVoidedCost } from "./helpers";
import { CostInvoiceActions } from "./invoice-actions";
import type { CostOrderSummary, CostRow } from "./model";

export function CostOrderSummaryDrawer({
  order,
  canManage,
  canRestore,
  onOpenDocuments,
  onOpenPaymentVoucher,
  deletingId,
  onVoid,
  onDelete,
  onRestore,
  onClose,
}: {
  order: CostOrderSummary;
  canManage: boolean;
  canRestore: boolean;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  deletingId: string;
  onVoid: (cost: CostRow) => void;
  onDelete: (cost: CostRow) => void;
  onRestore: (cost: CostRow) => void;
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
        canManage={canManage}
        canRestore={canRestore}
        deletingId={deletingId}
        onOpenDocuments={onOpenDocuments}
        onOpenPaymentVoucher={onOpenPaymentVoucher}
        onVoid={onVoid}
        onDelete={onDelete}
        onRestore={onRestore}
      />
    </SideDetailDrawer>
  );
}

export function CostOrderItemsTable({
  costs,
  canManage,
  canRestore,
  deletingId,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onVoid,
  onDelete,
  onRestore,
}: {
  costs: CostRow[];
  canManage: boolean;
  canRestore: boolean;
  deletingId: string;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onVoid: (cost: CostRow) => void;
  onDelete: (cost: CostRow) => void;
  onRestore: (cost: CostRow) => void;
}) {
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
              <th>成本类型</th>
              <th className={styles.supplierColumn}>供应商</th>
              <th>币种</th>
              <th className={styles.amountColumn}>原币金额</th>
              <th className={styles.statusColumn}>付款状态</th>
              <th className={styles.statusColumn}>发票状态</th>
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
                <td className={styles.statusColumn}><span className={`${styles.statusPill} ${isVoidedCost(cost) ? styles.statusMuted : cost.paymentStatus === "已支付" ? styles.statusSuccess : styles.statusWarning}`}>{isVoidedCost(cost) ? "已作废" : cost.paymentStatus || "-"}</span></td>
                <td className={styles.statusColumn}><span className={`${styles.statusPill} ${cost.invoiceStatus === "已收到" ? styles.statusSuccess : styles.statusMuted}`}>{cost.invoiceStatus || "-"}</span></td>
                <td className={styles.costInvoiceActionColumn}>
                  <div className={styles.costInvoiceActions}>
                    <CostInvoiceActions cost={cost} onOpenDocuments={() => onOpenDocuments(cost.id)} onOpenPaymentVoucher={onOpenPaymentVoucher} />
                    {canRestore && isVoidedCost(cost) && !isFactoryPurchaseSettlementCost(cost) ? (
                      <button className={styles.secondaryButton} type="button" disabled={deletingId === cost.id} onClick={(event) => { event.stopPropagation(); onRestore(cost); }}>
                        {deletingId === cost.id ? "处理中..." : "恢复"}
                      </button>
                    ) : canManage && !isVoidedCost(cost) ? (
                      <>
                        {canVoidCost(cost) ? (
                          <button className={styles.secondaryButton} type="button" disabled={deletingId === cost.id} onClick={(event) => { event.stopPropagation(); onVoid(cost); }}>
                            {deletingId === cost.id ? "处理中..." : "作废"}
                          </button>
                        ) : null}
                        {canDeleteCost(cost) ? (
                          <button className={styles.fileDangerButton} type="button" disabled={deletingId === cost.id} onClick={(event) => { event.stopPropagation(); onDelete(cost); }}>
                            {deletingId === cost.id ? "处理中..." : "删除"}
                          </button>
                        ) : null}
                      </>
                    ) : null}
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
