"use client";

import { MoneyAmount } from "../../components";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import type { PaymentRow } from "./types";
import { paymentStatusClass } from "./helpers";

export function PaymentTableRows({
  payment,
  onViewDetail,
}: {
  payment: PaymentRow;
  onViewDetail: () => void;
}) {
  return (
    <>
      <tr className={getBusinessEntityRowClass(payment, styles, styles.clickableRow)} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{payment.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(payment)}>{customerDisplayName(payment)}</td>
        <td>{payment.paymentDate || "-"}</td>
        <td>{payment.paymentType || "-"}</td>
        <td className={styles.amountColumn}><MoneyAmount currency={payment.currency} amount={payment.amount} amountCny={payment.amountCny} /></td>
        <td><span className={`${styles.statusPill} ${paymentStatusClass(payment.status)}`}>{payment.status || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}
