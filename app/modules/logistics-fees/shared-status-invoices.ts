import {
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupsForExpenses,
} from "../../../lib/platform/logistics-invoice-groups";
import {
  type LogisticsExpense,
  type LogisticsInvoiceGroupSummary,
} from "./model";
import { logisticsExpenseCurrencySummaryFromItems } from "./shared-currency";
import {
  aggregateClientLogisticsExpenseStatus,
  logisticsExpenseDetailInvoiceStatus,
} from "./shared-status-bill";

export function logisticsInvoiceGroupsForBill(
  items: LogisticsExpense[],
): LogisticsInvoiceGroupSummary[] {
  return logisticsInvoiceGroupsForExpenses(items).map((group) => {
    const groupItems = items.filter(
      (item) => logisticsInvoiceGroupForExpense(item)?.key === group.key,
    );
    const includedFeeTypes = [...new Set(groupItems
      .map((item) => String(item.costType || "").trim())
      .filter(Boolean))];
    const uploaded =
      groupItems.length > 0 &&
      groupItems.every((item) =>
        ["已上传", "已确认"].includes(
          logisticsExpenseDetailInvoiceStatus(item),
        ),
      );
    const confirmed =
      groupItems.length > 0 &&
      groupItems.every(
        (item) => logisticsExpenseDetailInvoiceStatus(item) === "已确认",
      );
    const failed = groupItems.some(
      (item) => logisticsExpenseDetailInvoiceStatus(item) === "通知失败",
    );
    const notified = groupItems.some(
      (item) => logisticsExpenseDetailInvoiceStatus(item) === "已通知开票",
    );
    return {
      key: group.key,
      label: group.label,
      costTypes: group.costTypes,
      includedFeeTypes,
      amountCny: groupItems.reduce(
        (sum, item) => sum + Number(item.amountCny || 0),
        0,
      ),
      currencyTotals: logisticsExpenseCurrencySummaryFromItems(groupItems),
      itemIds: groupItems.map((item) => item.id).filter(Boolean),
      status: confirmed
        ? "已确认"
        : uploaded
          ? "已上传"
          : failed
            ? "通知失败"
            : notified
              ? "已通知开票"
              : "待开票",
      uploaded,
      confirmed,
      failed,
      notified,
      invoiceDocumentId:
        groupItems.find((item) => item.invoiceDocumentId)?.invoiceDocumentId ||
        "",
      invoiceNotificationError:
        groupItems
          .map((item) => item.invoiceNotificationError || "")
          .find(Boolean) || "",
      validationStatus:
        groupItems
          .map((item) => item.invoiceValidationStatus || "")
          .find(Boolean) || "未上传",
      validationMessage:
        groupItems
          .map((item) => item.invoiceValidationMessage || "")
          .find(Boolean) || "",
      validationJson:
        groupItems
          .map((item) => item.invoiceValidationJson)
          .find(Boolean) || null,
      ocrTaskId:
        groupItems
          .map((item) => item.invoiceOcrTaskId || "")
          .find(Boolean) || "",
      recognizedInvoiceNo:
        groupItems
          .map((item) => item.invoiceRecognizedNo || "")
          .find(Boolean) || "",
      recognizedInvoiceDate:
        groupItems
          .map((item) => item.invoiceRecognizedDate || "")
          .find(Boolean) || "",
      recognizedSeller:
        groupItems
          .map((item) => item.invoiceRecognizedSeller || "")
          .find(Boolean) || "",
      recognizedBuyer:
        groupItems
          .map((item) => item.invoiceRecognizedBuyer || "")
          .find(Boolean) || "",
      recognizedAmount: Number(
        groupItems
          .map((item) => item.invoiceRecognizedAmount)
          .find((value) => value != null) || 0,
      ),
      recognizedName:
        groupItems
          .map((item) => item.invoiceRecognizedName || "")
          .find(Boolean) || "",
      manualConfirmedAt:
        groupItems
          .map((item) => item.invoiceManualConfirmedAt)
          .find(Boolean) || null,
      manualConfirmReason:
        groupItems
          .map((item) => item.invoiceManualConfirmReason || "")
          .find(Boolean) || "",
    };
  });
}

export function aggregateInvoiceGroupStatus(
  items: LogisticsExpense[],
  groups: LogisticsInvoiceGroupSummary[],
) {
  if (!groups.length) return aggregateClientLogisticsExpenseStatus(items, "invoiceStatus");
  if (groups.some((group) => group.failed)) return "待开票 / 通知失败";
  if (groups.every((group) => group.confirmed)) return "已确认发票";
  if (groups.every((group) => group.uploaded || group.confirmed)) return "已上传发票";
  if (groups.some((group) => group.uploaded || group.confirmed)) return "部分上传发票";
  if (groups.some((group) => group.notified)) return "已通知开票";
  return "待开票";
}

export function aggregateClientLogisticsInvoiceStatus(items: LogisticsExpense[]) {
  const groups = logisticsInvoiceGroupsForBill(items);
  return aggregateInvoiceGroupStatus(items, groups);
}
