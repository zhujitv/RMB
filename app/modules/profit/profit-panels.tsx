import { DetailField, SideDetailDrawer } from "../../components";
import { formatCny, formatPercent } from "../../formatters";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import {
  costGroupText,
  formatCnyOrDash,
  realizedGrossProfitLabel,
  type ProfitRow,
} from "./shared";

export function ProfitRows({
  row,
  onViewDetail,
}: {
  row: ProfitRow;
  onViewDetail: () => void;
}) {
  const summary = row.summary || {};
  return (
    <tr className={getBusinessEntityRowClass(row, styles, styles.clickableRow)} onClick={onViewDetail}>
      <td className={styles.orderNoColumn}>{row.orderNo || "-"}</td>
      <td className={styles.customerColumn} title={customerLegalName(row)}>{customerDisplayName(row)}</td>
      <td className={styles.amountColumn}>{formatCny(summary.receivableCny)}</td>
      <td className={styles.amountColumn}>{formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)}</td>
      <td className={styles.amountColumn}>{formatCny(summary.expectedGrossProfit)}</td>
      <td>{formatPercent(summary.expectedGrossMargin)}</td>
      <td>
        <button
          className={styles.rowDetailButton}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewDetail();
          }}
        >
          详情
        </button>
      </td>
    </tr>
  );
}

export function ProfitMobileCard({
  row,
  onViewDetail,
}: {
  row: ProfitRow;
  onViewDetail: () => void;
}) {
  const summary = row.summary || {};
  return (
    <article className={styles.mobileDataCard}>
      <div className={styles.mobileDataHeader}>
        <div className={styles.mobileDataMeta}>
          <strong>{row.orderNo || "-"}</strong>
          <span title={customerLegalName(row)}>{customerDisplayName(row)}</span>
          <span>业务员：{row.salespersonName || "-"}</span>
        </div>
        <span className={`${styles.statusPill} ${summary.commissionCanSettle ? styles.statusSuccess : styles.statusMuted}`}>
          {summary.commissionStatus || row.commissionStatus || "-"}
        </span>
      </div>
      <div className={styles.mobileMetricGrid}>
        <div className={styles.mobileMetricItem}>
          <span>最终应收</span>
          <strong>{formatCny(summary.receivableCny)}</strong>
        </div>
        <div className={styles.mobileMetricItem}>
          <span>总成本</span>
          <strong>{formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)}</strong>
        </div>
        <div className={styles.mobileMetricItem}>
          <span>预计毛利</span>
          <strong>{formatCny(summary.expectedGrossProfit)}</strong>
        </div>
        <div className={styles.mobileMetricItem}>
          <span>预计毛利率</span>
          <strong>{formatPercent(summary.expectedGrossMargin)}</strong>
        </div>
      </div>
      <div className={styles.mobileDataActions}>
        <button className={styles.rowDetailButton} type="button" onClick={onViewDetail}>详情</button>
      </div>
    </article>
  );
}

export function ProfitDetailDrawer({
  row,
  settling,
  reversing,
  canSettleCommission,
  canReverseCommission,
  onSettle,
  onReverse,
  onClose,
}: {
  row: ProfitRow;
  settling: boolean;
  reversing: boolean;
  canSettleCommission: boolean;
  canReverseCommission: boolean;
  onSettle: () => void;
  onReverse: () => void;
  onClose: () => void;
}) {
  const summary = row.summary || {};
  const commissionCanSettle = canSettleCommission && Boolean(summary.commissionCanSettle);
  const commissionSettled = Boolean(summary.commissionSnapshotMissing)
    || summary.commissionStatus === "已结算"
    || ["已结算", "SETTLED"].includes(String(row.commissionStatus || ""));
  const commissionCanReverse = canReverseCommission && commissionSettled;
  return (
    <SideDetailDrawer
      ariaLabel="利润分析详情"
      kicker="利润分析"
      title={`${row.orderNo || "-"} · ${customerLegalName(row)}`}
      subtitle={`提单号：${row.blNo || "-"} · 业务员：${row.salespersonName || "-"}`}
      onClose={onClose}
      actions={commissionCanSettle || commissionCanReverse ? (
        <>
          {commissionCanSettle ? (
            <button className={styles.primaryButtonCompact} type="button" disabled={settling || reversing} onClick={onSettle}>
              {settling ? "结算中..." : "确认结算提成"}
            </button>
          ) : null}
          {commissionCanReverse ? (
            <button className={styles.dangerButton} type="button" disabled={settling || reversing} onClick={onReverse}>
              {reversing ? "撤销中..." : "撤销提成结算"}
            </button>
          ) : null}
        </>
      ) : null}
    >
      <div className={styles.detailGrid}>
        <DetailField label="最终应收" value={formatCny(summary.receivableCny)} />
        <DetailField label="已到账金额" value={formatCny(summary.arrivedPaymentsCny)} />
        <DetailField label="总成本" value={formatCny(summary.confirmedTotalCostCny ?? summary.totalCostCny)} />
        <DetailField label="物流成本" value={formatCny(summary.logisticsCostCny)} />
        <DetailField label="预计毛利" value={formatCny(summary.expectedGrossProfit)} />
        <DetailField label="预计毛利率" value={formatPercent(summary.expectedGrossMargin)} />
        <DetailField label={realizedGrossProfitLabel()} value={formatCnyOrDash(summary.realizedGrossProfit)} />
        <DetailField label="已实现毛利率" value={formatPercent(summary.realizedGrossMargin)} />
        <DetailField label="净现金流" value={formatCny(summary.netCashFlowCny)} />
        <DetailField label="提成公式" value={summary.commissionFormulaLabel || summary.commissionFormulaDescription || "-"} />
        <DetailField label="提成前置缺失" value={(summary.taxLogisticsMissingLabels || []).join("、") || "-"} wide />
        <DetailField label="提成基数" value={summary.commissionSnapshotMissing ? "-" : formatCny(summary.commissionBaseCny)} />
        <DetailField label="业务员提成" value={summary.commissionSnapshotMissing ? "-" : formatCny(summary.commissionAmountCny ?? summary.estimatedCommissionCny)} />
        <DetailField label="提成比例" value={summary.commissionSnapshotMissing ? "-" : `${Number(summary.commissionRate || 0).toFixed(2)}%`} />
        <DetailField label="提成状态" value={summary.commissionStatus || row.commissionStatus || "-"} />
        <DetailField label="结算人" value={row.commissionSettledByName || "-"} />
        <DetailField label="结算时间" value={row.commissionSettledAt ? new Date(row.commissionSettledAt).toLocaleString("zh-CN") : "-"} />
        <DetailField label="成本结构" value={costGroupText(summary.costGroups)} wide />
      </div>
    </SideDetailDrawer>
  );
}
