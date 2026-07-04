"use client";

import { DetailField, SideDetailDrawer } from "../../components";
import { formatCny, formatDateTime, moneyText } from "../../formatters";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import type { PaymentRow } from "./types";
import { rateMeta } from "./helpers";

export function PaymentDetailDrawer({
  payment,
  canManage,
  deleting,
  confirming,
  onEdit,
  onDelete,
  onConfirmArrived,
  onClose,
}: {
  payment: PaymentRow;
  canManage: boolean;
  deleting: boolean;
  confirming: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onConfirmArrived: () => void;
  onClose: () => void;
}) {
  return (
    <SideDetailDrawer
      ariaLabel="收款详情"
      kicker="收款管理"
      title={`${payment.orderNo || "-"} · ${customerLegalName(payment)}`}
      subtitle={`收款日期：${payment.paymentDate || "-"} · 状态：${payment.status || "-"}`}
      onClose={onClose}
      actions={canManage ? (
        <>
          {payment.status === "待确认" ? (
            <button className={styles.primaryButtonCompact} type="button" disabled={confirming} onClick={onConfirmArrived}>
              {confirming ? "确认中..." : "确认到账"}
            </button>
          ) : null}
          <button className={styles.primaryButtonCompact} type="button" onClick={onEdit}>编辑收款</button>
          <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onDelete}>
            {deleting ? "删除中..." : "删除收款"}
          </button>
        </>
      ) : undefined}
    >
      <div className={styles.detailGrid}>
        <DetailField label="订单号" value={payment.orderNo || "-"} />
        <DetailField label="客户全称" value={customerLegalName(payment)} wide />
        <DetailField label="客户简称" value={customerDisplayName(payment) || "-"} />
        <DetailField label="收款日期" value={payment.paymentDate || "-"} />
        <DetailField label="收款金额" value={moneyText(payment.currency, payment.amount, payment.amountCny)} />
        <DetailField label="收款币种" value={payment.currency || "-"} />
        <DetailField label="收款类型" value={payment.paymentType || "-"} />
        <DetailField label="收款状态" value={payment.status || "-"} />
        <DetailField label="关联销售订单" value={payment.orderNo || "-"} />
        <DetailField label="币种 / 汇率" value={`${payment.currency || "-"} / ${Number(payment.exchangeRate || 0).toFixed(4)}`} />
        <DetailField label="折人民币" value={formatCny(Number(payment.amountCny || 0))} />
        <DetailField label="银行流水号" value={payment.bankReference || "-"} hidden={!payment.bankReference} />
        <DetailField label="汇率来源" value={rateMeta(payment)} />
        <DetailField label="创建人" value={payment.createdBy?.name || "-"} />
        <DetailField label="修改人" value={payment.updatedBy?.name || "-"} />
        <DetailField label="备注" value={payment.remark || "-"} wide hidden={!payment.remark} />
        <DetailField label="创建时间" value={formatDateTime(payment.createdAt)} />
        <DetailField label="更新时间" value={formatDateTime(payment.updatedAt)} />
      </div>
    </SideDetailDrawer>
  );
}
