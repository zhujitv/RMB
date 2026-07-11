import { type LogisticsExpense } from "./model";

export function compactStatusLabel(
  value: unknown,
  type: "audit" | "invoice" | "payment",
) {
  const text = String(value || "").trim();
  if (!text || text === "-") {
    if (type === "audit") return "草稿";
    if (type === "invoice") return "待开票";
    return "待付款";
  }
  if (type === "audit") {
    if (text.includes("待审核")) return "待审核";
    if (text.includes("审核通过")) return "审核通过";
    if (text.includes("驳回")) return "已驳回";
    return "草稿";
  }
  if (type === "invoice") {
    if (text.includes("通知失败")) return "通知失败";
    if (text.includes("部分")) return "部分上传";
    if (text.includes("已确认") || text.includes("已上传")) return "已上传";
    return "待开票";
  }
  if (text.includes("部分")) return "部分付款";
  if (text.includes("已付款")) return "已付款";
  return "待付款";
}

export function normalizePayButtonInvoiceStatus(values: unknown[]) {
  const statuses = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (
    statuses.some((status) =>
      status.includes("部分") ||
      status.includes("通知失败") ||
      status.includes("待开票") ||
      status.includes("未通知") ||
      status.includes("已通知开票")
    )
  ) {
    return "未上传发票";
  }
  if (
    statuses.some(
      (status) =>
        status.includes("已上传发票") ||
        status === "已上传" ||
        status.includes("已确认"),
    )
  ) {
    return "已上传发票";
  }
  return statuses.length ? "未上传发票" : "未上传发票";
}

export function aggregateClientStatusValues(
  values: string[] = [],
  field: keyof LogisticsExpense | "invoiceStatus" | "paymentStatus",
) {
  const unique = [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ];
  if (!unique.length) return "-";
  if (unique.length === 1) return unique[0];
  if (field === "invoiceStatus") {
    if (unique.includes("已上传")) return "部分已上传";
    if (unique.includes("已上传发票")) return "部分上传发票";
    if (unique.includes("已确认")) return "部分已确认";
    if (unique.includes("已确认发票")) return "部分已确认";
    if (unique.includes("已通知开票")) return "部分已通知";
    if (unique.includes("未通知")) return "部分未通知";
  }
  if (field === "paymentStatus") {
    if (unique.includes("已付款")) return "部分已付款";
    if (unique.includes("待付款")) return "部分待付款";
    if (unique.includes("已开票")) return "部分已开票";
    if (unique.includes("待开票")) return "部分待开票";
  }
  return "混合状态";
}
