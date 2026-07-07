import { preventEnterFormSubmit } from "../../formGuards";
import styles from "../../WorkspaceShell.module.css";
import { logisticsCostTypeDefaultCurrency, logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { CURRENCIES, COST_TYPE_OPTIONS, type LogisticsExpense, type LogisticsExpenseDraft } from "./model";
import {
  compactStatusLabel,
  editableQuantityText,
  expenseBillingQuantity,
  expenseCostSyncText,
  formatOriginalCurrencyAccounting,
  logisticsExpenseBillIsEditable,
  logisticsExpenseDeleteBlockReason,
  logisticsExpenseDetailInvoiceStatus,
  logisticsExpenseDisplayCurrency,
  logisticsExpenseDraftFromItem,
  logisticsExpenseEditBlockReason,
  logisticsExpenseLineContainerType,
  logisticsExpenseOriginalAmount,
  StatusPill,
} from "./shared";

export function LogisticsExpenseDetailsTable({
  items,
  drafts,
  busyId,
  deletingId,
  billAuditStatus,
  canEditAmount,
  canDeleteExpense,
  onDraftChange,
  onStageDelete,
}: {
  items: LogisticsExpense[];
  drafts: Record<string, LogisticsExpenseDraft>;
  busyId: string;
  deletingId: string;
  billAuditStatus: string;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onDraftChange: (
    id: string,
    field: keyof LogisticsExpenseDraft,
    value: string,
  ) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
}) {
  return (
    <div
      className={styles.logisticsDetailTableWrap}
      onKeyDown={preventEnterFormSubmit}
    >
      <table className={styles.logisticsDetailTable}>
        <thead>
          <tr>
            <th>费用类型</th>
            <th>柜型</th>
            <th>数量</th>
            <th className={styles.numericCell}>金额</th>
            <th>备注</th>
            <th>发票状态</th>
            <th>成本同步</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((expense, index) => (
            <LogisticsExpenseDetailLine
              key={expense.id || `${expense.orderId || "expense"}-${index}`}
              expense={expense}
              draft={
                drafts[expense.id] || logisticsExpenseDraftFromItem(expense)
              }
              busy={busyId === expense.id}
              deleting={deletingId === expense.id}
              billAuditStatus={billAuditStatus}
              canEditAmount={canEditAmount}
              canDeleteExpense={canDeleteExpense}
              onDraftChange={onDraftChange}
              onStageDelete={onStageDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogisticsExpenseDetailLine({
  expense,
  draft,
  busy,
  deleting,
  billAuditStatus,
  canEditAmount,
  canDeleteExpense,
  onDraftChange,
  onStageDelete,
}: {
  expense: LogisticsExpense;
  draft: LogisticsExpenseDraft;
  busy: boolean;
  deleting: boolean;
  billAuditStatus: string;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onDraftChange: (
    id: string,
    field: keyof LogisticsExpenseDraft,
    value: string,
  ) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
}) {
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const billEditable = logisticsExpenseBillIsEditable(billAuditStatus);
  const editBlockReason = billEditable
    ? logisticsExpenseEditBlockReason(expense)
    : `账单${billAuditStatus}，不能修改`;
  const canEditThisAmount = canEditAmount && billEditable && !editBlockReason;
  const shouldRenderRemarkInput = canEditThisAmount;
  const originalAmount = logisticsExpenseOriginalAmount(expense);
  const originalCurrency = logisticsExpenseDisplayCurrency(expense, draft);
  const recommendedCurrency = logisticsCostTypeDefaultCurrency(draft.costType);
  const shouldShowCurrencySuggestion =
    Boolean(draft.currencyTouched) && originalCurrency !== recommendedCurrency;
  const deleteBlockReason = logisticsExpenseDeleteBlockReason(expense);
  return (
    <tr>
      <td>
        {expense.isTemporary ? (
          <select
            className={styles.inlineCostTypeSelect}
            value={draft.costType}
            onChange={(event) =>
              onDraftChange(expense.id, "costType", event.target.value)
            }
            aria-label="费用类型"
          >
            {COST_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          logisticsCostTypeLabel(expense.costType || "") || "-"
        )}
      </td>
      <td>{logisticsExpenseLineContainerType(expense)}</td>
      <td>
        {canEditThisAmount ? (
          <input
            className={styles.inlineQuantityInput}
            type="number"
            min="1"
            step="1"
            value={draft.appliedContainerCount}
            onChange={(event) =>
              onDraftChange(
                expense.id,
                "appliedContainerCount",
                event.target.value,
              )
            }
            aria-label="适用数量"
          />
        ) : (
          editableQuantityText(expenseBillingQuantity(expense))
        )}
      </td>
      <td className={styles.numericCell}>
        <div className={styles.inlineAmountEditor}>
          {canEditThisAmount ? (
            <>
              <input
                value={draft.unitAmount}
                onChange={(event) =>
                  onDraftChange(expense.id, "unitAmount", event.target.value)
                }
                inputMode="decimal"
                aria-label="物流费用单价"
              />
              <select
                value={originalCurrency}
                onChange={(event) =>
                  onDraftChange(expense.id, "currency", event.target.value)
                }
                aria-label="物流费用币种"
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <strong>
              {formatOriginalCurrencyAccounting(
                originalCurrency,
                originalAmount,
              )}
            </strong>
          )}
          {canEditThisAmount && shouldShowCurrencySuggestion ? (
            <span className={styles.inlineEditHint}>
              建议币种为 {recommendedCurrency}
            </span>
          ) : null}
        </div>
      </td>
      <td
        className={styles.remarkCell}
        title={draft.remark || expense.remark || ""}
      >
        {shouldRenderRemarkInput ? (
          <div className={styles.inlineRemarkCell}>
            <input
              className={styles.inlineRemarkInput}
              value={draft.remark}
              onChange={(event) =>
                onDraftChange(expense.id, "remark", event.target.value)
              }
              disabled={!canEditThisAmount}
              placeholder="-"
              aria-label="物流费用备注"
            />
            {!canEditThisAmount && editBlockReason ? (
              <span className={styles.inlineEditHint}>{editBlockReason}</span>
            ) : null}
          </div>
        ) : (
          expense.remark || "-"
        )}
      </td>
      <td>
        <StatusPill value={compactStatusLabel(invoiceStatus, "invoice")} />
      </td>
      <td>
        <div className={styles.costSyncCell}>
          <span>{expenseCostSyncText(expense)}</span>
        </div>
      </td>
      <td>
        <div className={styles.compactDetailActions}>
          <button
            className={styles.logisticsLineDeleteButton}
            type="button"
            disabled={
              !canDeleteExpense ||
              busy ||
              deleting ||
              (!expense.isTemporary && Boolean(deleteBlockReason))
            }
            title={
              !canDeleteExpense
                ? "无权限删除该费用明细"
                : deleteBlockReason || "删除这条费用明细"
            }
            onClick={(event) => {
              event.stopPropagation();
              onStageDelete(expense);
            }}
          >
            {deleting ? "删除中..." : expense.isTemporary ? "移除" : "删除"}
          </button>
        </div>
      </td>
    </tr>
  );
}
