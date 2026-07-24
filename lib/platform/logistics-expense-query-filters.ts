import type { Prisma } from "../generated/prisma/client.js";
import {
  LOGISTICS_COST_TYPES,
  LOGISTICS_BILL_STATUS_NORMAL,
  LOGISTICS_BILL_STATUS_VOIDED,
  nonEmpty,
} from "./shared";
import { orderSalespersonOwnershipWhere } from "./order-access";
import {
  businessArchiveOrderWhere,
  businessArchiveScope,
  type BusinessArchiveScope,
} from "./business-archive";
import {
  insensitiveContains,
  logisticsExpenseAccessWhere,
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  type LogisticsExpenseBillDto,
  type LogisticsExpenseShipmentDto,
} from "./logistics-expense-shared";

export type QueryLike = {
  get(name: string): string | null;
};
export type LogisticsExpenseListFilters = {
  keyword: Prisma.StringFilter | null;
  supplierId: string;
  costType: string;
  status: string;
  billStatus: string;
  businessScope: BusinessArchiveScope;
};
export type LogisticsQueryActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

export type PaginatedRows<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
export type PaginatedLogisticsExpenseShipments = PaginatedRows<LogisticsExpenseBillDto | LogisticsExpenseShipmentDto>;
export const LOGISTICS_EXPENSE_LIST_PAGE_SIZE_MAX = 20;

export function logisticsExpenseListFiltersFromQuery(query: QueryLike): LogisticsExpenseListFilters {
  const keyword = insensitiveContains(query.get("keyword") || query.get("q"));
  return {
    keyword,
    supplierId: nonEmpty(query.get("supplierId")),
    costType: String(query.get("costType") || "").trim(),
    status: String(query.get("status") || ""),
    billStatus: nonEmpty(query.get("billStatus") || query.get("voidStatus") || "normal"),
    businessScope: businessArchiveScope(query.get("archiveScope") || query.get("businessScope")),
  };
}

export function logisticsExpenseBillListWhere(filters: LogisticsExpenseListFilters, actor: LogisticsQueryActor): Prisma.LogisticsBillWhereInput {
  const keyword = filters.keyword;
  const expenseWhere: Prisma.LogisticsExpenseWhereInput = {
    deletedAt: null,
    ...logisticsExpenseAccessWhere(actor),
  };
  const conditions: Prisma.LogisticsBillWhereInput[] = [
    { deletedAt: null },
    logisticsExpenseBillVoidStatusWhere(filters.billStatus),
    logisticsExpenseBillAccessWhere(actor),
    { order: { is: businessArchiveOrderWhere(filters.businessScope) } },
    { expenses: { some: expenseWhere } },
    logisticsExpenseBillStatusWhere(filters.status),
  ];
  if (filters.supplierId && actor?.role === "管理员") conditions.push({ supplierId: filters.supplierId });
  if (filters.costType && LOGISTICS_COST_TYPES.includes(filters.costType)) {
    conditions.push({ expenses: { some: { ...expenseWhere, costType: filters.costType } } });
  }
  if (keyword) {
    conditions.push({
      OR: [
        { billOfLadingNo: keyword },
        { order: { is: { orderNo: keyword } } },
        { order: { is: { blNo: keyword } } },
        { order: { is: { customerNameSnapshot: keyword } } },
        { order: { is: { customer: { is: { shortName: keyword } } } } },
        { order: { is: { customer: { is: { name: keyword } } } } },
        { supplier: { is: { supplierName: keyword } } },
        { expenses: { some: { ...expenseWhere, OR: [{ costType: keyword }, { supplierNameSnapshot: keyword }, { remark: keyword }] } } },
      ],
    });
  }
  return { AND: conditions };
}

export function logisticsExpenseBillAccessWhere(actor: LogisticsQueryActor): Prisma.LogisticsBillWhereInput {
  const role = nonEmpty(actor?.role);
  const actorId = nonEmpty(actor?.id);
  const supplierId = nonEmpty(actor?.supplierId);
  if (role === "管理员") return {};
  if (role === "财务") return { auditStatus: "审核通过" };
  if (role === "业务员") return { order: { is: orderSalespersonOwnershipWhere(actorId) } };
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) {
    return supplierId
      ? { OR: [{ supplierId }, { expenses: { some: { supplierId, deletedAt: null } } }] }
      : { id: "__no_supplier_bound__" };
  }
  return { id: "__no_logistics_bill_access__" };
}

export function logisticsExpenseBillVoidStatusWhere(billStatus = "normal"): Prisma.LogisticsBillWhereInput {
  const text = nonEmpty(billStatus || "normal");
  if (text === "all") return {};
  if (text === "voided") return { status: LOGISTICS_BILL_STATUS_VOIDED };
  return { status: { in: [LOGISTICS_BILL_STATUS_NORMAL, ""] } };
}

export function logisticsExpenseBillStatusWhere(status = ""): Prisma.LogisticsBillWhereInput {
  const text = nonEmpty(status);
  if (!text || text === "all") return {};
  if (text === "pending") return { auditStatus: "待审核" };
  if (text === "approved") return { auditStatus: "审核通过" };
  if (text === "rejected") return { auditStatus: "已驳回" };
  if (text === "draft") return { auditStatus: "草稿" };
  if (text === "toInvoice") return {
    auditStatus: "审核通过",
    invoiceStatus: { in: ["未通知", "已通知开票", "待开票", "通知失败", "待开票 / 通知失败"] },
  };
  if (text === "uploaded") return { invoiceStatus: "已上传发票" };
  if (text === "confirmedInvoice") return { invoiceStatus: { in: ["已确认", "已确认发票"] } };
  if (["草稿", "待审核", "审核通过", "已驳回"].includes(text)) return { auditStatus: text };
  if (["未通知", "已通知开票", "待开票", "通知失败", "待开票 / 通知失败", "部分上传发票", "已上传发票", "已确认", "已确认发票"].includes(text)) {
    return { invoiceStatus: text === "已上传" ? "已上传发票" : text };
  }
  if (["待付款", "部分付款", "已付款", "待开票"].includes(text)) return { paymentStatus: text };
  return {};
}
