// @ts-nocheck
import { prisma } from "../prisma";
import {
  COST_PAYMENT_STATUSES,
  COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  applyCommonFilters,
  assertRead,
  dateFromInput,
  equivalentCostTypes,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  nonEmpty,
  permissionError,
  safeSerializeCost,
  successDocument,
  validCost,
} from "./shared";
import { costAccessWhere } from "./masters-access";
import { orderAccessWhere } from "./order-access";
import { summarizeCurrencyTotals } from "./currency-totals";
import {
  archiveScope,
  costPageParams,
  includeCostRelations,
  orderArchiveWhereForScope,
  serializeCostOrderSummary,
} from "./cost-records-shared";

function insensitiveContains(value) {
  const text = nonEmpty(value);
  return text ? { contains: text, mode: "insensitive" } : null;
}

function costConfirmedFilter(value) {
  const text = nonEmpty(value);
  if (!text) return null;
  if (["true", "1", "已确认"].includes(text)) return true;
  if (["false", "0", "未确认"].includes(text)) return false;
  return null;
}

function costDateRangeFilter(query) {
  const from = dateFromInput(query.get("dateFrom"));
  const to = dateFromInput(query.get("dateTo"));
  if (!from && !to) return null;
  const range = {};
  if (from) range.gte = from;
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    range.lt = end;
  }
  return {
    OR: [
      { createdAt: range },
      { updatedAt: range },
      { paymentDate: range },
    ],
  };
}

function costInvoiceStatusFilter(value) {
  const text = nonEmpty(value);
  if (!text) return null;
  const successInvoice = {
    documentType: "SUPPLIER_INVOICE",
    uploadStatus: "SUCCESS",
    deletedAt: null,
  };
  if (text === "已收到") return { documents: { some: successInvoice } };
  if (text === "未收到") return { documents: { none: successInvoice } };
  return null;
}

function costFilterClauses(query) {
  const keyword = insensitiveContains(query.get("keyword"));
  const costType = nonEmpty(query.get("costType"));
  const paymentStatus = nonEmpty(query.get("paymentStatus"));
  const costConfirmed = costConfirmedFilter(query.get("costConfirmed"));
  const invoiceStatus = costInvoiceStatusFilter(query.get("invoiceStatus"));
  const dateRange = costDateRangeFilter(query);
  const businessScope = archiveScope(query);
  return [
    { order: { is: orderArchiveWhereForScope(businessScope) } },
    keyword ? {
      OR: [
        { costType: keyword },
        { vendorName: keyword },
        { supplierNameSnapshot: keyword },
        { remark: keyword },
        { order: { is: { orderNo: keyword } } },
        { order: { is: { customerNameSnapshot: keyword } } },
        { order: { is: { customer: { is: { name: keyword } } } } },
        { order: { is: { customer: { is: { shortName: keyword } } } } },
        { supplier: { is: { supplierName: keyword } } },
        { supplier: { is: { supplierType: keyword } } },
      ],
    } : null,
    costType && COST_TYPES.includes(costType) ? { costType: { in: equivalentCostTypes(costType) } } : null,
    paymentStatus && COST_PAYMENT_STATUSES.includes(paymentStatus) ? { paymentStatus } : null,
    costConfirmed == null ? null : { costConfirmed },
    invoiceStatus,
    dateRange,
  ].filter(Boolean);
}

function pagedCostWhere(query, actor) {
  const clauses = costFilterClauses(query);
  return {
    deletedAt: null,
    ...costAccessWhere(actor),
    ...(clauses.length ? { AND: clauses } : {}),
  };
}

export async function listCosts(query, actor = null) {
  assertRead(actor, "costs");
  const rows = await prisma.orderCost.findMany({
    where: {
      deletedAt: null,
      ...costAccessWhere(actor),
    },
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
  return applyCommonFilters(rows.map(safeSerializeCost), query);
}

export async function listCostsPage(query, actor = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const where = pagedCostWhere(query, actor);
  const [total, rows, summaryRows] = await Promise.all([
    prisma.orderCost.count({ where }),
    prisma.orderCost.findMany({
      where,
      include: includeCostRelations(),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.orderCost.findMany({
      where,
      select: { currency: true, amount: true, amountCny: true, paymentStatus: true, deletedAt: true, costType: true },
    }),
  ]);
  return { rows: rows.map(safeSerializeCost), total, page, pageSize, summary: summarizeCurrencyTotals(summaryRows.filter(validCost)) };
}

export async function listCostOrderSummaries(query, actor = null) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const costWhere = pagedCostWhere(query, actor);
  const businessScope = archiveScope(query);
  const where = {
    deletedAt: null,
    ...orderArchiveWhereForScope(businessScope),
    ...orderAccessWhere(actor),
    costs: { some: costWhere },
  };
  const [total, orders, summaryRows] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    prisma.receivableOrder.findMany({
      where,
      include: {
        customer: true,
        costs: {
          where: costWhere,
          include: {
            supplier: true,
            documents: {
              where: { deletedAt: null },
              include: { uploadedBy: true, supplier: true },
              orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
            },
          },
          orderBy: [{ createdAt: "desc" }],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.orderCost.findMany({
      where: costWhere,
      select: { currency: true, amount: true, amountCny: true, paymentStatus: true, deletedAt: true, costType: true },
    }),
  ]);
  return { rows: orders.map(serializeCostOrderSummary), total, page, pageSize, summary: summarizeCurrencyTotals(summaryRows.filter(validCost)) };
}

export async function getCost(id, actor = null) {
  assertRead(actor, "costs");
  const cost = await prisma.orderCost.findFirst({
    where: {
      id,
      deletedAt: null,
      ...costAccessWhere(actor),
    },
    include: includeCostRelations(),
  });
  if (!cost) throw permissionError("成本记录不存在或无权查看", 404);
  return safeSerializeCost(cost);
}
