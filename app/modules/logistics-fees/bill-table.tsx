import { UiCheckbox } from "../../components";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import type { LogisticsExpense } from "./model";
import {
  compactStatusLabel,
  formatOriginalCurrencyValue,
  logisticsCurrencyAmountByCode,
  logisticsExpenseBillAuditStatusFromRow,
  logisticsExpenseBillCanVoid,
  logisticsExpenseBillCanApprove,
  logisticsExpenseBillInvoiceStatusFromRow,
  logisticsExpenseBillItems,
  logisticsExpenseBillPaymentStatusFromRow,
  logisticsExpenseCurrencySummaryFromItems,
  logisticsExpenseSelectionSelected,
  isVoidedLogisticsExpenseBill,
  StatusPill,
} from "./shared";

export function LogisticsExpenseBillTable({
  rows,
  loading,
  canReviewExpense,
  hasReviewableRows,
  allReviewableSelected,
  selectedBillIds,
  expandedId,
  onToggleAllReviewableBills,
  onOpen,
  onSelectBill,
  onVoidBill,
}: {
  rows: LogisticsExpense[];
  loading: boolean;
  canReviewExpense: boolean;
  hasReviewableRows: boolean;
  allReviewableSelected: boolean;
  selectedBillIds: string[];
  expandedId: string;
  onToggleAllReviewableBills: (checked: boolean) => void;
  onOpen: (expense: LogisticsExpense) => void;
  onSelectBill: (expense: LogisticsExpense, checked: boolean) => void;
  onVoidBill?: (expense: LogisticsExpense) => void;
}) {
  const colSpan = canReviewExpense ? 10 : 9;
  return (
    <div className={`${styles.tableWrap} ${styles.logisticsCompactTableWrap}`}>
      <table className={`${styles.dataTable} ${styles.logisticsCompactTable}`}>
        <thead>
          <tr>
            {canReviewExpense ? (
              <th className={styles.selectionColumn}>
                <UiCheckbox
                  variant="table"
                  label="选择本页待审核账单"
                  checked={allReviewableSelected}
                  disabled={!hasReviewableRows}
                  onChange={(event) =>
                    onToggleAllReviewableBills(event.target.checked)
                  }
                />
              </th>
            ) : null}
            <th className={styles.orderNoColumn}>订单号 / Shipment</th>
            <th className={styles.blNoColumn}>提单号 / B/L No.</th>
            <th className={styles.customerColumn}>客户简称</th>
            <th className={styles.amountColumn}>CNY 合计</th>
            <th className={styles.amountColumn}>USD 合计</th>
            <th className={styles.statusColumn}>审核</th>
            <th className={styles.statusColumn}>发票</th>
            <th className={styles.statusColumn}>付款</th>
            <th className={styles.operationColumn}>操作</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan}>
                <div className={styles.emptyState}>数据加载中...</div>
              </td>
            </tr>
          ) : rows.length ? (
            rows.map((expense) => (
              <LogisticsExpenseCompactRow
                key={expense.id}
                expense={expense}
                active={expandedId === expense.id}
                selectionEnabled={canReviewExpense}
                selected={logisticsExpenseSelectionSelected(
                  expense,
                  selectedBillIds,
                )}
                onOpen={() => onOpen(expense)}
                onSelect={(checked) => onSelectBill(expense, checked)}
                onVoidBill={onVoidBill}
              />
            ))
          ) : (
            <tr>
              <td colSpan={colSpan}>
                <div className={styles.emptyState}>未找到匹配的物流费用</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LogisticsExpenseCompactRow({
  expense,
  active,
  selectionEnabled,
  selected,
  onOpen,
  onSelect,
  onVoidBill,
}: {
  expense: LogisticsExpense;
  active: boolean;
  selectionEnabled: boolean;
  selected: boolean;
  onOpen: () => void;
  onSelect: (checked: boolean) => void;
  onVoidBill?: (expense: LogisticsExpense) => void;
}) {
  const voided = isVoidedLogisticsExpenseBill(expense);
  const auditStatus = compactStatusLabel(
    logisticsExpenseBillAuditStatusFromRow(expense),
    "audit",
  );
  const invoiceStatus = compactStatusLabel(
    logisticsExpenseBillInvoiceStatusFromRow(expense),
    "invoice",
  );
  const paymentStatus = compactStatusLabel(
    logisticsExpenseBillPaymentStatusFromRow(expense),
    "payment",
  );
  const items = expense.items?.length ? expense.items : [expense];
  const currencyTotals =
    expense.currencyTotals || logisticsExpenseCurrencySummaryFromItems(items);
  return (
    <tr
      className={getBusinessEntityRowClass(
        expense,
        styles,
        styles.clickableRow,
        active && styles.logisticsCompactRowActive,
      )}
      onClick={onOpen}
    >
      {selectionEnabled ? (
        <td
          className={styles.selectionColumn}
          onClick={(event) => event.stopPropagation()}
        >
          <UiCheckbox
            variant="table"
            label={`选择账单 ${expense.orderNo || expense.blNo || expense.id}`}
            checked={selected}
            disabled={!logisticsExpenseBillCanApprove(expense)}
            onChange={(event) => onSelect(event.target.checked)}
          />
        </td>
      ) : null}
      <td className={styles.orderNoColumn}>
        <strong>{expense.shipmentNo || expense.orderNo || "-"}</strong>
        {voided ? <StatusPill value="已作废" /> : null}
      </td>
      <td className={styles.blNoColumn}>
        {expense.blNo || expense.billOfLadingNo || "-"}
      </td>
      <td className={styles.customerColumn} title={customerLegalName(expense)}>
        {expense.customer || customerDisplayName(expense)}
      </td>
      <td className={styles.amountColumn}>
        {formatOriginalCurrencyValue(
          "CNY",
          logisticsCurrencyAmountByCode(currencyTotals, "CNY"),
        )}
      </td>
      <td className={styles.amountColumn}>
        {formatOriginalCurrencyValue(
          "USD",
          logisticsCurrencyAmountByCode(currencyTotals, "USD"),
        )}
      </td>
      <td className={styles.statusColumn}>
        <StatusPill value={auditStatus} />
      </td>
      <td className={styles.statusColumn}>
        <StatusPill value={invoiceStatus} />
      </td>
      <td className={styles.statusColumn}>
        <StatusPill value={paymentStatus} />
      </td>
      <td className={styles.operationColumn}>
        <button
          className={styles.rowDetailButton}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          详情
        </button>
        {!voided && onVoidBill && logisticsExpenseBillCanVoid(expense) ? (
          <button
            className={styles.fileDangerButton}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onVoidBill(expense);
            }}
          >
            作废
          </button>
        ) : null}
      </td>
    </tr>
  );
}
