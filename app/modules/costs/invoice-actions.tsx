import styles from "../../WorkspaceShell.module.css";
import type { CostRow } from "./model";
import { hasPaymentVoucher, isLogisticsGeneratedCost } from "./helpers";

export function CostInvoiceActions({
  cost,
  onOpenDocuments,
  onOpenPaymentVoucher,
}: {
  cost: CostRow;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher?: (cost: CostRow) => void;
}) {
  const invoiceReceived = cost.invoiceStatus === "已收到";
  const logisticsGenerated = isLogisticsGeneratedCost(cost);
  const voucherAvailable = hasPaymentVoucher(cost);
  return (
    <div className={styles.costInvoiceActions}>
      {logisticsGenerated ? (
        invoiceReceived ? (
          <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>查看发票</button>
        ) : (
          <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>查看说明</button>
        )
      ) : invoiceReceived ? (
        <>
          <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>查看发票</button>
          <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>替换</button>
        </>
      ) : (
        <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>上传发票</button>
      )}
      {voucherAvailable && onOpenPaymentVoucher ? (
        <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenPaymentVoucher(cost); }}>查看付款凭证</button>
      ) : null}
    </div>
  );
}

