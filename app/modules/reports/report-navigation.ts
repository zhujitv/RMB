import type { OpenMenuTarget, ReportRow } from "./model";

export function openReportRecord(
  reportType: string,
  row: ReportRow,
  onOpenRecord?: (target: OpenMenuTarget, keyword: string) => void,
) {
  const keyword = String(row.orderNo || row.customerShortName || row.customerName || row.id || "").trim();
  if (!keyword || !onOpenRecord) return;
  if (reportType === "payments") return onOpenRecord("payments", keyword);
  if (reportType === "costs") return onOpenRecord("costs", keyword);
  if (reportType === "tax-refunds") return onOpenRecord("taxRefund", keyword);
  onOpenRecord("orders", keyword);
}
