import {
  LOGISTICS_COST_TYPE_OPTIONS,
  LOGISTICS_COST_TYPES,
} from "../../../lib/platform/logistics-cost-types";

export type ReportType = {
  key: string;
  label: string;
  area: string;
};

export type ReportColumn = {
  key: string;
  label: string;
};

export type ReportRow = Record<string, unknown> & {
  id?: string;
  orderId?: string;
  customerFullName?: string;
  customerName?: string;
  customerShortName?: string;
  businessEntityDisplayName?: string;
  businessEntityShortName?: string;
  businessEntityName?: string;
  businessEntityNameSnapshot?: string;
  businessEntityIsDefault?: boolean;
  orderNo?: string;
  taxRefundStatus?: string;
};

export type ReportResponse = {
  reportType: string;
  label: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type BusinessEntityOption = {
  id: string;
  name: string;
  shortName?: string;
  displayName?: string;
  isDefault?: boolean;
};

export type BusinessEntitiesResponse = {
  entities?: BusinessEntityOption[];
};

export type ExportScope = "currentPage" | "selected" | "allFiltered";
export type ExportFormat = "xlsx" | "csv";
export type SortDirection = "asc" | "desc";
export type OpenMenuTarget = "orders" | "payments" | "costs" | "profit" | "taxRefund";

export const PAGE_SIZE = 20;
export const DEFAULT_REPORT_FILTERS = {
  dateFrom: "",
  dateTo: "",
  customerName: "",
  orderNo: "",
  blNo: "",
  currency: "",
  salespersonName: "",
  supplierName: "",
  businessEntityId: "",
  orderStatus: "",
  paymentStatus: "",
  costType: "",
  taxRefundStatus: "",
  declarationMonth: "",
  archiveScope: "current",
  keyword: "",
};

export type ReportFilters = typeof DEFAULT_REPORT_FILTERS;

export const REPORT_TYPES: ReportType[] = [
  { key: "receivables", label: "应收订单明细", area: "orders" },
  { key: "payments", label: "收款明细", area: "payments" },
  { key: "costs", label: "成本明细", area: "costs" },
  { key: "profits", label: "利润分析", area: "commissions" },
  { key: "commissions", label: "业务员提成", area: "commissions" },
  { key: "overdue", label: "逾期催款", area: "orders" },
  { key: "tax-refunds", label: "退税资料", area: "taxRefund" },
];

export const REPORT_READ_ROLES: Record<string, string[]> = {
  orders: ["管理员", "业务员", "财务"],
  payments: ["管理员", "业务员", "财务"],
  costs: ["管理员", "业务员", "财务"],
  commissions: ["管理员", "财务"],
  taxRefund: ["管理员", "业务员", "财务"],
};

export const ORDER_STATUSES = ["", "草稿", "已确认", "部分收款", "已收齐", "多收款", "已逾期", "已关闭", "已取消"];
export const PAYMENT_STATUSES = ["", "待确认", "已到账", "已退回", "已取消"];
export const COST_TYPES = ["", "工厂货款", "原材料货款", "采购货款", "产品货款", ...LOGISTICS_COST_TYPES, "银行手续费", "国外佣金", "样品费", "其他费用"];
export const COST_TYPE_LABELS: Record<string, string> = Object.fromEntries([
  ["", "全部"],
  ...LOGISTICS_COST_TYPE_OPTIONS.map((item) => [item.value, item.label]),
]);
export const TAX_REFUND_STATUSES = ["", "NOT_READY", "READY", "PROBLEM", "SUBMITTED", "REFUND_RECEIVED"];
export const TAX_REFUND_STATUS_LABELS: Record<string, string> = {
  NOT_READY: "资料不完整",
  READY: "资料完整待提交",
  PROBLEM: "资料异常",
  SUBMITTED: "已提交退税",
  REFUND_RECEIVED: "已收到退税款",
};

export const HIDDEN_DETAIL_KEYS = new Set(["id", "orderId", "customerId", "supplierId", "userId", "paymentId", "costId", "documentId"]);
export const EXPORT_ACTIONS: { scope: ExportScope; format: ExportFormat; label: string }[] = [
  { scope: "currentPage", format: "xlsx", label: "当前页 Excel" },
  { scope: "currentPage", format: "csv", label: "当前页 CSV" },
  { scope: "selected", format: "xlsx", label: "已勾选 Excel" },
  { scope: "selected", format: "csv", label: "已勾选 CSV" },
  { scope: "allFiltered", format: "xlsx", label: "查询结果 Excel" },
  { scope: "allFiltered", format: "csv", label: "查询结果 CSV" },
];

export function reportFileName(type: string, format: string) {
  const label = REPORT_TYPES.find((item) => item.key === type)?.label || "报表";
  return `${label}.${format === "xlsx" ? "xlsx" : "csv"}`;
}
