import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  nonEmpty,
  pageParams,
  pageResult,
  serializeSupplier,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import { businessArchiveOrderWhere } from "./business-archive";
import {
  assertCanReadLogisticsExpenses,
  compareLogisticsExpenseBillsForDisplay,
  groupLogisticsExpensesByShipment,
  includeLogisticsExpenseListRelations,
  logisticsExpenseAccessWhere,
  logisticsExpenseOrderSummary,
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
} from "./logistics-expense-shared";
import {
  LOGISTICS_EXPENSE_LIST_PAGE_SIZE_MAX,
  logisticsExpenseBillListWhere,
  logisticsExpenseListFiltersFromQuery,
  type LogisticsQueryActor,
  type PaginatedLogisticsExpenseShipments,
  type QueryLike,
} from "./logistics-expense-query-filters";

export async function listLogisticsExpenses(query: QueryLike, actor: LogisticsQueryActor): Promise<PaginatedLogisticsExpenseShipments> {
  assertCanReadLogisticsExpenses(actor);
  const filters = logisticsExpenseListFiltersFromQuery(query);
  const { page, pageSize } = pageParams(query, 20, LOGISTICS_EXPENSE_LIST_PAGE_SIZE_MAX);
  const billWhere = logisticsExpenseBillListWhere(filters, actor);
  // This list endpoint is read-only. Avoid wrapping count + page reads in a
  // transaction because Prisma must reserve a transaction connection first;
  // under pool pressure that can fail before either query starts.
  const total = await prisma.logisticsBill.count({ where: billWhere });
  const billHeaders = await prisma.logisticsBill.findMany({
    where: billWhere,
    select: {
      id: true,
      auditStatus: true,
      invoiceStatus: true,
      paymentStatus: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(total, pageSize),
  });
  const bills = billHeaders
    .sort(compareLogisticsExpenseBillsForDisplay)
    .slice((page - 1) * pageSize, page * pageSize);
  const billIds = bills.map((bill) => bill.id);
  if (!billIds.length) return pageResult([], total, page, pageSize);

  const rows = await prisma.logisticsExpense.findMany({
    where: {
      billId: { in: billIds },
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseListRelations(),
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

export async function listLogisticsExpenseOrders(query: QueryLike, actor: LogisticsQueryActor) {
  assertCanReadLogisticsExpenses(actor);
  const role = nonEmpty(actor?.role);
  const supplierId = nonEmpty(actor?.supplierId);
  const q = nonEmpty(query.get("keyword") || query.get("q") || query.get("orderNo"));
  const filters: Prisma.ReceivableOrderWhereInput[] = [
    { deletedAt: null },
    { status: { notIn: ["已关闭", "已取消"] } },
    businessArchiveOrderWhere("current"),
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
