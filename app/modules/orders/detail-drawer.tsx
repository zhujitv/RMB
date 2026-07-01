
import { DetailField, SideDetailDrawer } from "../../components";
import { formatCny, moneyText } from "../../formatters";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import type { OrderRow } from "./model";
import { logisticsSupplierText, paymentTermText, rateMeta } from "./utils";

export function OrderDetailDrawer({
  order,
  canWrite,
  deleting,
  onEdit,
  onDelete,
  onClose,
}: {
  order: OrderRow;
  canWrite: boolean;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <SideDetailDrawer
      ariaLabel="应收订单详情"
      kicker="应收订单"
      title={`${order.orderNo || "-"} · ${customerLegalName(order)}`}
      subtitle={`提单号：${order.blNo || order.billOfLadingNo || "-"} · 状态：${order.status || "-"}`}
      onClose={onClose}
      actions={canWrite ? (
        <>
          <button className={styles.primaryButtonCompact} type="button" onClick={onEdit}>编辑订单</button>
          <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onDelete}>
            {deleting ? "删除中..." : "删除订单"}
          </button>
        </>
      ) : undefined}
    >
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(order)} wide />
        <DetailField label="业务员" value={order.salespersonName || "-"} />
        <DetailField label="贸易条款" value={order.tradeTerm || "-"} />
        <DetailField label="付款条款" value={paymentTermText(order)} wide />
        <DetailField label="到期日" value={`${order.dueDate || "-"} ${order.summary?.reminderStatus ? `· ${order.summary.reminderStatus}` : ""}`} />
        <DetailField label="提醒天数" value={`${order.reminderDays ?? "-"} 天`} />
        <DetailField label="提单日期" value={order.blDate || "-"} />
        <DetailField label="发货时间" value={order.actualShipmentDate || "-"} />
        <DetailField label="预计到港" value={order.expectedArrivalDate || "-"} />
        <DetailField label="预计收款" value={order.expectedPaymentDate || "-"} />
        <DetailField label="预计应收" value={moneyText(order.currency, order.estimatedReceivableAmount, order.estimatedReceivableAmountCny)} />
        <DetailField label="实际发货金额" value={moneyText(order.currency, order.actualShipmentAmount, order.actualShipmentAmountCny)} />
        <DetailField label="最终应收" value={moneyText(order.currency, order.finalReceivableAmount, order.finalReceivableAmountCny)} />
        <DetailField
          label="已收金额"
          value={moneyText(
            order.currency,
            order.summary?.arrivedPaymentsAmount ?? order.summary?.confirmedPaymentsAmount,
            order.summary?.arrivedPaymentsCny ?? order.summary?.confirmedPaymentsCny,
          )}
        />
        <DetailField
          label="未收金额"
          value={moneyText(
            order.currency,
            order.summary?.outstandingAmount,
            order.summary?.arrivedOutstandingCny ?? order.summary?.outstandingCny,
          )}
        />
        <DetailField label="预付款要求" value={formatCny(order.summary?.requiredDepositAmount)} />
        <DetailField label="已收预付款" value={formatCny(order.summary?.receivedDepositCny)} />
        <DetailField label="预付款差额" value={formatCny(order.summary?.depositGapCny)} />
        <DetailField label="币种 / 汇率" value={`${order.currency || "-"} / ${Number(order.exchangeRate || 0).toFixed(4)}`} />
        <DetailField label="汇率来源" value={rateMeta(order)} />
        <DetailField label="物流供应商" value={logisticsSupplierText(order.logisticsSuppliers)} wide />
        <DetailField label="备注" value={order.remark || "-"} wide hidden={!order.remark} />
      </div>
    </SideDetailDrawer>
  );
}
