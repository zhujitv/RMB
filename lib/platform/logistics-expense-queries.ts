// @ts-nocheck
import { prisma } from "../prisma";
import {
  LOGISTICS_COST_TYPES,
  nonEmpty,
  pageParams,
  pageResult,
  serializeSupplier,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import {
  assertCanReadLogisticsExpenses,
  includeLogisticsExpenseRelations,
  insensitiveContains,
  logisticsExpenseAccessWhere,
  logisticsExpenseOrderSummary,
  logisticsExpenseStatusWhere,
  groupLogisticsExpensesByBill,
  serializeLogisticsExpense,
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
} from "./logistics-expense-shared";

export async function listLogisticsExpenses(query, actor) {
  assertCanReadLogisticsExpenses(actor);
  const view = nonEmpty(query.get("view") || "bills");
  const keyword = insensitiveContains(query.get("keyword") || query.get("q"));
  const supplierId = nonEmpty(query.get("supplierId"));
  const costType = String(query.get("costType") || "").trim();
  const where = {
    deletedAt: null,
    ...logisticsExpenseAccessWhere(actor),
    ...logisticsExpenseStatusWhere(query.get("status")),
    ...(supplierId && actor.role === "管理员" ? { supplierId } : {}),
    ...(costType && LOGISTICS_COST_TYPES.includes(costType) ? { costType } : {}),
    ...(keyword ? {
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
    } : {}),
  };
  const { page, pageSize } = pageParams(query, 20, 100);
  if (view === "items") {
    const [total, rows] = await Promise.all([
      prisma.logisticsExpense.count({ where }),
      prisma.logisticsExpense.findMany({
        where,
        include: includeLogisticsExpenseRelations(),
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageResult(rows.map(serializeLogisticsExpense), total, page, pageSize);
  }
  const rows = await prisma.logisticsExpense.findMany({
    where,
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  const bills = groupLogisticsExpensesByBill(rows);
  const start = (page - 1) * pageSize;
  return pageResult(bills.slice(start, start + pageSize), bills.length, page, pageSize);
}

export async function listLogisticsExpenseOrders(query, actor) {
  assertCanReadLogisticsExpenses(actor);
  const q = nonEmpty(query.get("keyword") || query.get("q") || query.get("orderNo"));
  const filters = [
    { deletedAt: null },
    { status: { notIn: ["已关闭", "已取消"] } },
    actor?.role === "业务员" ? orderAccessWhere(actor) : {},
    [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actor?.role) && actor.supplierId
      ? { logisticsSuppliers: { some: { supplierId: actor.supplierId } } }
      : (actor?.role === LOGISTICS_OPERATOR_ROLE ? { id: "__no_supplier_bound__" } : {}),
    q ? {
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { blNo: { contains: q, mode: "insensitive" } },
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: q, mode: "insensitive" } } } },
      ],
    } : {},
  ].filter((item) => Object.keys(item).length);
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

export async function logisticsSupplierStatement(query, actor) {
  assertCanReadLogisticsExpenses(actor);
  const month = nonEmpty(query.get("month"));
  const where = {
    deletedAt: null,
    auditStatus: "审核通过",
    ...logisticsExpenseAccessWhere(actor),
    ...(month ? {
      reviewedAt: {
        gte: new Date(`${month}-01T00:00:00.000Z`),
        lt: new Date(new Date(`${month}-01T00:00:00.000Z`).setUTCMonth(new Date(`${month}-01T00:00:00.000Z`).getUTCMonth() + 1)),
      },
    } : {}),
  };
  const rows = await prisma.logisticsExpense.findMany({ where, include: includeLogisticsExpenseRelations(), orderBy: [{ reviewedAt: "desc" }] });
  return Object.values(rows.reduce((acc, row) => {
    const key = row.supplierId;
    acc[key] ||= {
      supplierId: row.supplierId,
      supplierName: row.supplierNameSnapshot || row.supplier?.supplierName || "",
      orderIds: new Set(),
      approvedAmountCny: 0,
      invoicedAmountCny: 0,
      pendingPaymentAmountCny: 0,
      paidAmountCny: 0,
    };
    acc[key].orderIds.add(row.orderId);
    const amount = Number(row.amountCny || 0);
    acc[key].approvedAmountCny += amount;
    if (["已上传", "已确认"].includes(row.invoiceStatus)) acc[key].invoicedAmountCny += amount;
    if (row.paymentStatus === "待付款") acc[key].pendingPaymentAmountCny += amount;
    if (row.paymentStatus === "已付款") acc[key].paidAmountCny += amount;
    return acc;
  }, {})).map((item) => ({ ...item, orderCount: item.orderIds.size, orderIds: undefined }));
}
