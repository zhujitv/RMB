
import { MoneyAmount } from "../../components";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import type { OrderRow } from "./model";
import { orderCurrencyAmount } from "./utils";

export function OrderTableRows({
  order,
  onViewDetail,
}: {
  order: OrderRow;
  onViewDetail: () => void;
}) {
  const receivedCny = Number(order.summary?.arrivedPaymentsCny ?? order.summary?.confirmedPaymentsCny ?? 0);
  const receivedAmount = Number(order.summary?.arrivedPaymentsAmount ?? order.summary?.confirmedPaymentsAmount ?? orderCurrencyAmount(order, receivedCny));
  const outstandingCny = Number(order.summary?.arrivedOutstandingCny ?? order.summary?.outstandingCny ?? 0);
  const overpaidCny = Number(order.summary?.overpaidCny || 0);
  const displayedBalanceCny = overpaidCny > 0 ? overpaidCny : outstandingCny;
  const displayedBalanceAmount = overpaidCny > 0
    ? orderCurrencyAmount(order, overpaidCny)
    : (order.summary?.outstandingAmount ?? orderCurrencyAmount(order, outstandingCny));
  const businessEntityFullName = order.businessEntityName || order.businessEntityNameSnapshot || "";
  const businessEntityDisplayName = order.businessEntityDisplayName || order.businessEntityShortName || businessEntityFullName;
  return (
    <>
      <tr className={getBusinessEntityRowClass(order, styles, styles.clickableRow)} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{order.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(order)}>{customerDisplayName(order)}</td>
        <td className={styles.businessEntityColumn} title={businessEntityFullName || ""}>{businessEntityDisplayName || "-"}</td>
        <td className={styles.blNoColumn}>{order.blNo || order.billOfLadingNo || "-"}</td>
        <td className={styles.amountColumn}><MoneyAmount currency={order.currency} amount={order.finalReceivableAmount} amountCny={order.finalReceivableAmountCny} /></td>
        <td className={styles.amountColumn}><MoneyAmount currency={order.currency} amount={receivedAmount} amountCny={receivedCny} /></td>
        <td className={styles.amountColumn}><MoneyAmount currency={order.currency} amount={displayedBalanceAmount} amountCny={displayedBalanceCny} prefix={overpaidCny > 0 ? "多收 " : ""} /></td>
        <td><span className={`${styles.statusPill} ${orderStatusClass(order.status)}`}>{order.status || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}

function orderStatusClass(status = "") {
  if (["已收齐", "多收款"].includes(status)) return styles.statusSuccess;
  if (["部分收款", "生产中", "已发货"].includes(status)) return styles.statusWarning;
  if (["已取消"].includes(status)) return styles.statusMuted;
  if (["已关闭"].includes(status)) return styles.statusDanger;
  return "";
}
