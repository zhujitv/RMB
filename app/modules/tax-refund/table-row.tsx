import type { MouseEvent } from "react";
import { useState } from "react";
import { formatDate } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { customerDisplayName, customerLegalName } from "../../utils";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import { completenessClass, statusClass, taxCompletenessTooltipGroups, taxRefundBillOfLadingNumbers, taxRowStatus, taxStatusLabel } from "./helpers";
import { TAX_REFUND_STATUS_OPTIONS, type TaxRefundRow } from "./model";

export function TaxRefundTableRow({
  row,
  onViewDetail,
  onSubmitTaxRefund,
  onCancelArchive,
  onUpdateStatus,
  canSubmitTaxRefund,
  canCancelArchive,
  canUpdateStatus,
  submittingTax,
}: {
  row: TaxRefundRow;
  onViewDetail: () => void;
  onSubmitTaxRefund: () => void;
  onCancelArchive: () => void;
  onUpdateStatus: (status: string) => void;
  canSubmitTaxRefund: boolean;
  canCancelArchive: boolean;
  canUpdateStatus: boolean;
  submittingTax: boolean;
}) {
  const completeness = row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  const cachedPercent = row.overallCompleteness == null ? null : Number(row.overallCompleteness);
  const percent = cachedPercent != null && Number.isFinite(cachedPercent)
    ? Math.max(0, Math.min(100, Math.round(cachedPercent)))
    : total > 0 ? Math.round((completed / total) * 100) : 0;
  const declarationDate = formatDate(row.customsDeclarationDate || row.declarationDate);
  const currentStatus = taxRowStatus(row);
  const currentStatusLabel = row.taxRefundStatusLabel || taxStatusLabel(currentStatus);
  const summaryItems = String(row.completenessIssuesSummary || "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  const missingGroups = summaryItems.length && percent < 100
    ? [{ category: "异常摘要", items: summaryItems }]
    : taxCompletenessTooltipGroups(completeness, percent);
  const billOfLadingNumbers = taxRefundBillOfLadingNumbers(row);
  const billOfLadingTitle = billOfLadingNumbers.join(" / ");
  const businessEntityFullName = row.businessEntityName || row.businessEntityNameSnapshot || "";
  const businessEntityDisplayName = row.businessEntityDisplayName || row.businessEntityShortName || businessEntityFullName;
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const tooltipId = `tax-completeness-tooltip-${row.id}`;

  const showCompletenessTooltip = (event: MouseEvent<HTMLElement>) => {
    if (!missingGroups.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipHalfWidth = 150;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, tooltipHalfWidth + 16),
      window.innerWidth - tooltipHalfWidth - 16,
    );
    setTooltipPosition({ top: rect.bottom + 8, left });
  };

  return (
    <tr className={getBusinessEntityRowClass(row, styles, styles.clickableRow)} onClick={onViewDetail}>
      <td className={styles.taxRefundOrderNoColumn} title={row.orderNo || "-"}>{row.orderNo || "-"}</td>
      <td className={styles.taxRefundBlNoColumn} title={billOfLadingTitle || "-"}>
        {billOfLadingNumbers.length ? (
          <span className={styles.taxRefundBlNoList}>
            {billOfLadingNumbers.map((blNo) => <span key={blNo}>{blNo}</span>)}
          </span>
        ) : "-"}
      </td>
      <td className={styles.taxRefundCustomerColumn} title={customerLegalName(row)}>{customerDisplayName(row)}</td>
      <td className={styles.taxRefundBusinessEntityColumn} title={businessEntityFullName || "-"}>
        {businessEntityDisplayName || "-"}
      </td>
      <td className={styles.taxRefundDateColumn}>{declarationDate}</td>
      <td className={styles.taxRefundCompletenessColumn}>
        <span className={styles.taxCompletenessTooltipAnchor}>
          <span
            className={`${styles.statusPill} ${completenessClass(percent)} ${missingGroups.length ? styles.taxCompletenessTooltipTrigger : ""}`}
            aria-describedby={missingGroups.length && tooltipPosition ? tooltipId : undefined}
            onMouseEnter={showCompletenessTooltip}
            onMouseLeave={() => setTooltipPosition(null)}
          >
            {percent}%
          </span>
        </span>
        {missingGroups.length && tooltipPosition ? (
          <div
            id={tooltipId}
            className={styles.taxCompletenessTooltip}
            role="tooltip"
            style={{ top: tooltipPosition.top, left: tooltipPosition.left }}
          >
            <strong>缺失资料：</strong>
            <ul>
              {missingGroups.map((group) => (
                <li key={group.category}>
                  <span>{group.category}：</span>{group.items.join("、")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </td>
      <td className={styles.taxRefundStatusColumn}>
        {canUpdateStatus ? (
          <select
            value={currentStatus}
            title={currentStatusLabel}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onUpdateStatus(event.target.value)}
            disabled={submittingTax}
          >
            {TAX_REFUND_STATUS_OPTIONS.filter((option) => option.value).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        ) : (
          <span className={`${styles.statusPill} ${statusClass(currentStatus)}`} title={currentStatusLabel}>{currentStatusLabel}</span>
        )}
      </td>
      <td className={styles.taxRefundActionColumn}>
        <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>
          详情
        </button>
      </td>
    </tr>
  );
}
