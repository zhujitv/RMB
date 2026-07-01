import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  LOGISTICS_COST_TYPES,
  nonEmpty,
  pageParams,
  pageResult,
  serializeSupplier,
} from "./shared";
import { summarizeCurrencyTotals, type CurrencyTotalInput } from "./currency-totals";
import { orderAccessWhere } from "./order-access";
import {
  assertCanReadLogisticsExpenses,
  includeLogisticsExpenseRelations,
  insensitiveContains,
  logisticsExpenseAccessWhere,
  logisticsExpenseOrderSummary,
  logisticsExpenseStatusWhere,
  groupLogisticsExpensesByShipment,
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  type LogisticsExpenseBillDto,
  type LogisticsExpenseShipmentDto,
} from "./logistics-expense-shared";

type SupplierStatementRow = {
  supplierId: string;
  supplierName: string;
  orderIds: Set<string>;
  approvedRows: CurrencyTotalInput[];
  paidRows: CurrencyTotalInput[];
  approvedAmountCny: number;
  pendingPaymentAmountCny: number;
  paidAmountCny: number;
};
type LogisticsStatementExpenseRow = {
  supplierId: string;
  supplierNameSnapshot?: string | null;
  supplier?: { supplierName?: string | null } | null;
  orderId: string;
  currency?: unknown;
  amount?: unknown;
  amountCny?: unknown;
  cost?: {
    paymentDate?: Date | string | null;
    deletedAt?: Date | string | null;
    currency?: unknown;
    amount?: unknown;
    amountCny?: unknown;
  } | null;
};
type ShipmentStatementRow = {
  supplierId: string;
  supplierName: string;
  orderId: string;
  approvedRows: CurrencyTotalInput[];
  paidRows: CurrencyTotalInput[];
};
type QueryLike = {
  get(name: string): string | null;
};
type LogisticsExpenseListFilters = {
  keyword: Prisma.StringFilter | null;
  supplierId: string;
  costType: string;
  status: string;
};
type LogisticsQueryActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

type PaginatedRows<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
type PaginatedLogisticsExpenseShipments = PaginatedRows<LogisticsExpenseBillDto | LogisticsExpenseShipmentDto>;
const LOGISTICS_EXPENSE_LIST_PAGE_SIZE_MAX = 20;
const LOGISTICS_STATEMENT_SCAN_LIMIT = 3000;

function logisticsExpenseListFiltersFromQuery(query: QueryLike): LogisticsExpenseListFilters {
  const keyword = insensitiveContains(query.get("keyword") || query.get("q"));
  return {
    keyword,
    supplierId: nonEmpty(query.get("supplierId")),
    costType: String(query.get("costType") || "").trim(),
    status: String(query.get("status") || ""),
  };
}

function logisticsExpenseListWhere(filters: LogisticsExpenseListFilters, actor: LogisticsQueryActor): Prisma.LogisticsExpenseWhereInput {
  const keyword = filters.keyword;
  const conditions: Prisma.LogisticsExpenseWhereInput[] = [
    { deletedAt: null },
    logisticsExpenseAccessWhere(actor),
    logisticsExpenseStatusWhere(filters.status),
  ];
  if (filters.supplierId && actor?.role === "管理员") conditions.push({ supplierId: filters.supplierId });
  if (filters.costType && LOGISTICS_COST_TYPES.includes(filters.costType)) conditions.push({ costType: filters.costType });
  if (keyword) {
    conditions.push({
      OR: [
        { costType: keyword },
        { supplierNameSnapshot: keyword },
        { remark: keyword },
        { order: { is: { orderNo: keyword } } },
        { order: { is: { blNo: keyword } } },
        { order: { is: { customerNameSnapshot: keyword } } },
        { order: { is: { customer: { is: { shortName: keyword } } } } },
        { supplier: { is: { supplierName: keyword } } },
      ],
    });
  }
  return { AND: conditions };
}

export async function listLogisticsExpenses(query: QueryLike, actor: LogisticsQueryActor): Promise<PaginatedLogisticsExpenseShipments> {
  assertCanReadLogisticsExpenses(actor);
  const filters = logisticsExpenseListFiltersFromQuery(query);
  const { page, pageSize } = pageParams(query, 20, LOGISTICS_EXPENSE_LIST_PAGE_SIZE_MAX);
  const billWhere = logisticsExpenseBillListWhere(filters, actor);
  // This list endpoint is read-only. Avoid wrapping count + page reads in a
  // transaction because Prisma must reserve a transaction connection first;
  // under pool pressure that can fail before either query starts.
  const total = await prisma.logisticsBill.count({ where: billWhere });
  const bills = await prisma.logisticsBill.findMany({
    where: billWhere,
    select: { id: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const billIds = bills.map((bill) => bill.id);
  if (!billIds.length) return pageResult([], total, page, pageSize);

  const rows = await prisma.logisticsExpense.findMany({
    where: {
      billId: { in: billIds },
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ createdAt: "asc" }],
    take: billIds.length * 100,
  });
  const rowsByBillId = new Map<string, typeof rows>();
  for (const row of rows) {
    const billId = row.billId || "";
    if (!billId) continue;
    if (!rowsByBillId.has(billId)) rowsByBillId.set(billId, []);
    rowsByBillId.get(billId)!.push(row);
  }
  const pageRows = billIds
    .map((billId) => rowsByBillId.get(billId) || [])
    .filter((billRows) => billRows.length > 0)
    .map((billRows) => groupLogisticsExpensesByShipment(billRows)[0])
    .filter(Boolean);
  return pageResult(pageRows, total, page, pageSize);
}

function logisticsExpenseBillListWhere(filters: LogisticsExpenseListFilters, actor: LogisticsQueryActor): Prisma.LogisticsBillWhereInput {
  const keyword = filters.keyword;
  const expenseWhere: Prisma.LogisticsExpenseWhereInput = {
    deletedAt: null,
    ...logisticsExpenseAccessWhere(actor),
  };
  const conditions: Prisma.LogisticsBillWhereInput[] = [
    { deletedAt: null },
    logisticsExpenseBillAccessWhere(actor),
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

function logisticsExpenseBillAccessWhere(actor: LogisticsQueryActor): Prisma.LogisticsBillWhereInput {
  const role = nonEmpty(actor?.role);
  const actorId = nonEmpty(actor?.id);
  const supplierId = nonEmpty(actor?.supplierId);
  if (role === "管理员") return {};
  if (role === "财务") return { auditStatus: "审核通过" };
  if (role === "业务员") return { order: { is: { customer: { is: { salespersonUserId: actorId } } } } };
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) return supplierId ? { supplierId } : { id: "__no_supplier_bound__" };
  return { id: "__no_logistics_bill_access__" };
}

function logisticsExpenseBillStatusWhere(status = ""): Prisma.LogisticsBillWhereInput {
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

export async function listLogisticsExpenseOrders(query: QueryLike, actor: LogisticsQueryActor) {
  assertCanReadLogisticsExpenses(actor);
  const role = nonEmpty(actor?.role);
  const supplierId = nonEmpty(actor?.supplierId);
  const q = nonEmpty(query.get("keyword") || query.get("q") || query.get("orderNo"));
  const filters: Prisma.ReceivableOrderWhereInput[] = [
    { deletedAt: null },
    { status: { notIn: ["已关闭", "已取消"] } },
  ];
  if (role === "业务员") filters.push(orderAccessWhere(actor));
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role) && supplierId) {
    filters.push({ logisticsSuppliers: { some: { supplierId } } });
  } else if (role === LOGISTICS_OPERATOR_ROLE) {
    filters.push({ id: "__no_supplier_bound__" });
  }
  if (q) {
    filters.push({
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { blNo: { contains: q, mode: "insensitive" } },
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const rows = await prisma.receivableOrder.findMany({
    where: { AND: filters },
    include: {
      customer: true,
      logisticsSuppliers: { include: { supplier: true } },
      domesticLogisticsInfos: {
        include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 50,
  });
  return rows.map((order) => ({
    ...logisticsExpenseOrderSummary(order),
    logisticsSupplierIds: (order.logisticsSuppliers || []).map((row) => row.supplierId),
    logisticsSuppliers: (order.logisticsSuppliers || []).map((row) => serializeSupplier(row.supplier)).filter((item) => item.id),
  }));
}

export async function logisticsSupplierStatement(query: QueryLike, actor: LogisticsQueryActor) {
  assertCanReadLogisticsExpenses(actor);
  const month = nonEmpty(query.get("month"));
  const reviewedMonthWhere: Prisma.LogisticsExpenseWhereInput = month ? {
    bill: {
      is: {
        reviewedAt: {
          gte: new Date(`${month}-01T00:00:00.000Z`),
          lt: new Date(new Date(`${month}-01T00:00:00.000Z`).setUTCMonth(new Date(`${month}-01T00:00:00.000Z`).getUTCMonth() + 1)),
        },
      },
    },
  } : {};
  const where: Prisma.LogisticsExpenseWhereInput = {
    deletedAt: null,
    AND: [
      { bill: { is: { auditStatus: "审核通过" } } },
      reviewedMonthWhere,
    ],
    ...logisticsExpenseAccessWhere(actor),
  };
  const rows = await prisma.logisticsExpense.findMany({
    where,
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ updatedAt: "desc" }],
    take: LOGISTICS_STATEMENT_SCAN_LIMIT,
  });
  const shipmentRows = groupLogisticsStatementRowsByShipment(rows);
  return Object.values(shipmentRows.reduce<Record<string, SupplierStatementRow>>((acc, shipment) => {
    const key = shipment.supplierId;
    acc[key] ||= {
      supplierId: shipment.supplierId,
      supplierName: shipment.supplierName,
      orderIds: new Set(),
      approvedRows: [],
      paidRows: [],
      approvedAmountCny: 0,
      pendingPaymentAmountCny: 0,
      paidAmountCny: 0,
    };
    acc[key].orderIds.add(shipment.orderId);
    acc[key].approvedRows.push(...shipment.approvedRows);
    acc[key].paidRows.push(...shipment.paidRows);
    return acc;
  }, {})).map((item) => {
    const approvedCurrencyTotals = summarizeCurrencyTotals(item.approvedRows);
    const paidCurrencyTotals = summarizeCurrencyTotals(item.paidRows);
    const pendingPaymentCurrencyTotals = subtractCurrencyTotals(approvedCurrencyTotals, paidCurrencyTotals);
    return {
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      orderCount: item.orderIds.size,
      approvedCurrencyTotals,
      pendingPaymentCurrencyTotals,
      paidCurrencyTotals,
      approvedAmountCny: approvedCurrencyTotals.cnyActual,
      pendingPaymentAmountCny: pendingPaymentCurrencyTotals.cnyActual,
      paidAmountCny: paidCurrencyTotals.cnyActual,
    };
  });
}

function groupLogisticsStatementRowsByShipment(rows: LogisticsStatementExpenseRow[] = []): ShipmentStatementRow[] {
  const groups = new Map<string, ShipmentStatementRow>();
  for (const row of rows) {
    const shipmentKey = [row.supplierId, row.orderId].join("::");
    if (!groups.has(shipmentKey)) {
      groups.set(shipmentKey, {
        supplierId: row.supplierId,
        supplierName: row.supplierNameSnapshot || row.supplier?.supplierName || "",
        orderId: row.orderId,
        approvedRows: [],
        paidRows: [],
      });
    }
    const shipment = groups.get(shipmentKey)!;
    shipment.approvedRows.push({ currency: row.currency, amount: row.amount, amountCny: row.amountCny });
    const paidRow = logisticsPaymentLedgerRow(row);
    if (paidRow) shipment.paidRows.push(paidRow);
  }
  return [...groups.values()];
}

function logisticsPaymentLedgerRow(row: LogisticsStatementExpenseRow): CurrencyTotalInput | null {
  const cost = row.cost;
  if (!cost || cost.deletedAt || !cost.paymentDate) return null;
  return { currency: cost.currency, amount: cost.amount, amountCny: cost.amountCny };
}

function subtractCurrencyTotals(
  payable: ReturnType<typeof summarizeCurrencyTotals>,
  paid: ReturnType<typeof summarizeCurrencyTotals>,
) {
  const rows: CurrencyTotalInput[] = [
    { currency: "CNY", amount: payable.cnyActual, amountCny: payable.cnyActual },
    ...payable.foreignTotals.map((item) => ({ currency: item.currency, amount: item.amount, amountCny: 0 })),
    { currency: "CNY", amount: -paid.cnyActual, amountCny: -paid.cnyActual },
    ...paid.foreignTotals.map((item) => ({ currency: item.currency, amount: -item.amount, amountCny: 0 })),
  ];
  return summarizeCurrencyTotals(rows);
}
