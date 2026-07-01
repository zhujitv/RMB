
import type {
  LogisticsExpense,
  LogisticsExpenseMutationResult,
  LogisticsExpenseReviewResult,
} from "./model";
import { logisticsExpenseCurrencySummaryFromItems } from "./shared-currency";
import {
  aggregateClientLogisticsExpenseStatus,
  aggregateClientLogisticsInvoiceStatus,
  logisticsExpenseBillItems,
  logisticsInvoiceGroupsForBill,
  sortLogisticsExpenseBillsForDisplay,
} from "./shared-status";

export function removeLogisticsExpenseFromRows(
  rows: LogisticsExpense[],
  expenseId: string,
) {
  let removedBill = false;
  let billId = "";
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    if (!items.some((item) => item.id === expenseId)) return [row];
    billId = row.id;
    const nextItems = items.filter((item) => item.id !== expenseId);
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  return {
    rows: sortLogisticsExpenseBillsForDisplay(nextRows),
    removedBill,
    billId,
  };
}

export function replaceLogisticsExpenseItemsInRows(
  rows: LogisticsExpense[],
  savedItems: LogisticsExpense[],
) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => {
      const items = row.items?.length ? row.items : [row];
      if (!items.some((item) => savedById.has(item.id))) return row;
      const nextItems = items.map((item) => savedById.get(item.id) || item);
      return rebuildLogisticsExpenseBill(row, nextItems);
    }),
  );
}

export function normalizeLogisticsExpenseBillRow(bill: LogisticsExpense) {
  const items = bill.items?.length ? bill.items : [];
  return items.length ? rebuildLogisticsExpenseBill(bill, items) : bill;
}

export function replaceLogisticsExpenseBillsInRows(
  rows: LogisticsExpense[],
  bills: LogisticsExpense[],
) {
  if (!bills.length) return rows;
  const billById = new Map(
    bills.map((bill) => [bill.id, normalizeLogisticsExpenseBillRow(bill)]),
  );
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => billById.get(row.id) || row),
  );
}

export function logisticsExpenseReviewResultLabel(
  result: LogisticsExpenseReviewResult,
) {
  const orderNo = result.orderNo || "";
  const blNo = result.blNo || "";
  const identity = [orderNo, blNo].filter(Boolean).join(" / ");
  return identity || result.billId || "账单";
}

export function logisticsExpenseReviewFailureMessage(
  result: LogisticsExpenseMutationResult,
) {
  const failures = (result.results || []).filter(
    (item) => item.auditStatus !== "审核通过" && item.errorMessage,
  );
  if (!failures.length) return "";
  return failures
    .map(
      (item) =>
        `${logisticsExpenseReviewResultLabel(item)}：${item.errorMessage}`,
    )
    .join("；");
}

export function logisticsExpenseReviewNotice(
  result: LogisticsExpenseMutationResult,
) {
  if (result.message) return result.message;
  if (result.emailError)
    return `费用已审核，开票通知发送失败，可稍后重发：${result.emailError}`;
  const successCount = Number(result.successCount || 0);
  if (successCount > 0)
    return `已审核 ${successCount} 票物流费用，开票通知已按供应商合并发送`;
  return "物流费用已审核，开票通知已按供应商合并发送";
}

export function reconcileLogisticsExpenseMutationRows(
  rows: LogisticsExpense[],
  result: LogisticsExpenseMutationResult,
) {
  const bills = [
    ...(Array.isArray(result.bills) ? result.bills : []),
    ...(result.bill ? [result.bill] : []),
  ].filter(Boolean);
  if (bills.length) return replaceLogisticsExpenseBillsInRows(rows, bills);
  const savedItems = [
    ...(Array.isArray(result.expenses) ? result.expenses : []),
    ...(result.expense ? [result.expense] : []),
  ].filter(Boolean);
  if (savedItems.length)
    return replaceLogisticsExpenseItemsInRows(rows, savedItems);
  return rows;
}

export function markLogisticsExpenseBillSubmitted(
  rows: LogisticsExpense[],
  billId: string,
  updatedIds: string[],
  submittedAt?: string,
) {
  const updatedIdSet = new Set(updatedIds.filter(Boolean));
  const submittedAtValue = submittedAt || new Date().toISOString();
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => {
      const items = row.items?.length ? row.items : [row];
      const belongsToBill =
        row.id === billId || items.some((item) => updatedIdSet.has(item.id));
      if (!belongsToBill) return row;
      const nextItems = items.map((item) => {
        return {
          ...item,
          auditStatus: "待审核",
          submittedAt: submittedAtValue,
          rejectReason: "",
          invoiceNotificationError: "",
        };
      });
      return rebuildLogisticsExpenseBill(row, nextItems);
    }),
  );
}

export function markLogisticsExpenseBillRejected(
  rows: LogisticsExpense[],
  billId: string,
  rejectReason: string,
) {
  const reviewedAt = new Date().toISOString();
  return sortLogisticsExpenseBillsForDisplay(
    rows.map((row) => {
      const items = row.items?.length ? row.items : [row];
      const belongsToBill = row.id === billId;
      if (!belongsToBill) return row;
      const nextItems = items.map((item) => ({
        ...item,
        auditStatus: "已驳回",
        invoiceStatus: "未通知",
        paymentStatus: "待开票",
        reviewedAt,
        rejectedAt: reviewedAt,
        rejectReason,
        invoiceNotifiedAt: null,
        invoiceNotificationError: "",
      }));
      return rebuildLogisticsExpenseBill(row, nextItems);
    }),
  );
}

export function reconcileLogisticsExpenseRowsAfterBatchSave(
  rows: LogisticsExpense[],
  billId: string,
  savedItems: LogisticsExpense[],
  deletedIds: string[],
) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  const deletedIdSet = new Set(deletedIds);
  let matchedBill = false;
  let removedBill = false;
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    const belongsToBill =
      row.id === billId ||
      items.some((item) => savedById.has(item.id) || deletedIdSet.has(item.id));
    if (!belongsToBill) return [row];
    matchedBill = true;
    const nextItems = items
      .filter((item) => !deletedIdSet.has(item.id))
      .map((item) => savedById.get(item.id) || item);
    for (const savedItem of savedItems) {
      if (!nextItems.some((item) => item.id === savedItem.id))
        nextItems.push(savedItem);
    }
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  if (!matchedBill && savedItems.length) {
    nextRows.unshift(buildLogisticsExpenseBillFromItems(savedItems));
  }
  return { rows: sortLogisticsExpenseBillsForDisplay(nextRows), removedBill };
}

export function buildLogisticsExpenseBillFromItems(items: LogisticsExpense[]) {
  const first = items[0] || {};
  return rebuildLogisticsExpenseBill(
    {
      id: logisticsExpenseBillIdFromItem(first),
      isBill: true,
      orderId: first.orderId,
      orderNo: first.orderNo,
      blNo: first.blNo || first.billOfLadingNo,
      billOfLadingNo: first.billOfLadingNo || first.blNo,
      customerName: first.customerName,
      customerShortName: first.customerShortName,
      order: first.order,
    } as LogisticsExpense,
    items,
  );
}

export function logisticsExpenseBillIdFromItem(
  item: Partial<LogisticsExpense>,
) {
  return `bill:${item.orderId || "order"}:${item.blNo || item.billOfLadingNo || item.orderNo || "no-bl"}`;
}

export function rebuildLogisticsExpenseBill(
  row: LogisticsExpense,
  nextItems: LogisticsExpense[],
) {
  const amountCny = nextItems.reduce(
    (sum, item) => sum + Number(item.amountCny || 0),
    0,
  );
  const amount = nextItems.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const currencyTotals = logisticsExpenseCurrencySummaryFromItems(nextItems);
  const first = nextItems[0] || {};
  return {
    ...row,
    ...(nextItems.length === 1
      ? {
          costType: first.costType,
          currency: first.currency,
          exchangeRate: first.exchangeRate,
          amount,
        }
      : {
          costType: `${nextItems.length} 项费用`,
          amount: currencyTotals.cnyActual,
        }),
    amountCny,
    currencyTotals,
    auditStatus: aggregateClientLogisticsExpenseStatus(
      nextItems,
      "auditStatus",
    ),
    invoiceStatus: aggregateClientLogisticsInvoiceStatus(nextItems),
    paymentStatus: aggregateClientLogisticsExpenseStatus(
      nextItems,
      "paymentStatus",
    ),
    itemCount: nextItems.length,
    invoiceGroups: logisticsInvoiceGroupsForBill(nextItems),
    supplierNames: [
      ...new Set(nextItems.map((item) => item.supplierName).filter(Boolean)),
    ],
    items: nextItems,
  } as LogisticsExpense;
}
