// @ts-nocheck
import { prisma } from "../prisma";
import {
  COST_DUPLICATE_GUARD_LOOKBACK_MS,
  COST_IDEMPOTENCY_WINDOW_MS,
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  customerFullName,
  customerShortName,
  isLogisticsCostType,
  isTaxRefundFactoryCost,
  isTaxRefundLogisticsInvoiceCost,
  normalizedCostType,
  safeSerializeCost,
  successDocument,
  supplierTypeForCost,
  validCost,
} from "./shared";

export function costPageParams(query) {
  const page = Math.max(1, Number.parseInt(query.get("page") || "1", 10) || 1);
  const requestedPageSize = Number.parseInt(query.get("pageSize") || "20", 10) || 20;
  const allowedPageSizes = [20, 50, 100];
  const pageSize = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 20;
  return { page, pageSize };
}

export function archiveScope(query) {
  const scope = query ? String(query.get("archiveScope") || query.get("businessScope") || query.get("taxArchiveScope") || "").trim() : "";
  return ["current", "archive", "all"].includes(scope) ? scope : "current";
}

export function orderArchiveWhereForScope(scope = "current") {
  if (scope === "archive") return { OR: [{ taxArchived: true }, { taxRefundStatus: "SUBMITTED" }] };
  if (scope === "all") return {};
  return { taxArchived: false };
}

function costAmountBuckets(costs = []) {
  return costs.filter(validCost).reduce((acc, cost) => {
    const amount = Number(cost.amountCny || 0);
    acc.totalCostCny += amount;
    const displayCostType = normalizedCostType(cost.costType);
    if (FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType)) acc.factoryCostCny += amount;
    else if (displayCostType === "港杂费" || supplierTypeForCost(cost) === "港杂费用供应商") acc.portCostCny += amount;
    else if (isLogisticsCostType(cost.costType) || TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES.includes(cost.costType)) acc.logisticsCostCny += amount;
    else acc.otherCostCny += amount;
    return acc;
  }, {
    totalCostCny: 0,
    factoryCostCny: 0,
    logisticsCostCny: 0,
    portCostCny: 0,
    otherCostCny: 0,
  });
}

function costDocumentProgress(costs = []) {
  const progress = costs.filter(validCost).reduce((acc, cost) => {
    const successDocs = (cost.documents || []).filter(successDocument);
    if (isTaxRefundFactoryCost(cost)) {
      SUPPLIER_DOCUMENT_TYPES.forEach((type) => {
        acc.total += 1;
        if (successDocs.some((doc) => doc.documentType === type)) acc.completed += 1;
      });
    } else if (isTaxRefundLogisticsInvoiceCost(cost)) {
      acc.total += 1;
      if (successDocs.some((doc) => doc.documentType === "SUPPLIER_INVOICE")) acc.completed += 1;
    }
    return acc;
  }, { completed: 0, total: 0 });
  return {
    ...progress,
    text: progress.total ? `${progress.completed}/${progress.total}` : "无需资料",
  };
}

function costConfirmedProgress(costs = []) {
  const rows = costs.filter(validCost);
  const completed = rows.filter((cost) => cost.costConfirmed).length;
  return {
    completed,
    total: rows.length,
    text: rows.length ? `${completed}/${rows.length}` : "无成本",
  };
}

export function serializeCostOrderSummary(order) {
  const costs = order.costs || [];
  const buckets = costAmountBuckets(costs);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  return {
    id: order.id,
    orderId: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny ?? 0),
    costConfirmProgress: costConfirmedProgress(costs),
    documentProgress: costDocumentProgress(costs),
    costCount: costs.filter(validCost).length,
    ...buckets,
  };
}

export function includeCostRelations() {
  return {
    order: { include: { customer: true, salesperson: true } },
    supplier: true,
    createdBy: true,
    updatedBy: true,
    documents: {
      where: { deletedAt: null },
      include: { uploadedBy: true, supplier: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
  };
}

function duplicateCostWhere(data, windowMs, { sameCreator = false } = {}) {
  return {
    deletedAt: null,
    orderId: data.orderId,
    supplierId: data.supplierId || null,
    costType: data.costType,
    amount: data.amount,
    createdAt: { gte: new Date(Date.now() - windowMs) },
    ...(sameCreator ? { createdById: data.createdById || null } : {}),
  };
}

export function duplicateCostFingerprint(data) {
  return [
    data.orderId || "",
    data.supplierId || "",
    data.costType || "",
    Number(data.amount || 0).toFixed(2),
  ].join("|");
}

async function findDuplicateCost(data, windowMs, options = {}) {
  return prisma.orderCost.findFirst({
    where: duplicateCostWhere(data, windowMs, options),
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

export async function createCostIdempotently(data) {
  const recentDuplicate = await findDuplicateCost(data, COST_IDEMPOTENCY_WINDOW_MS);
  if (recentDuplicate) return { cost: recentDuplicate, reused: true };
  try {
    const cost = await prisma.orderCost.create({ data, include: includeCostRelations() });
    return { cost, reused: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const guardedDuplicate = await findDuplicateCost(data, COST_DUPLICATE_GUARD_LOOKBACK_MS, { sameCreator: true })
      || await findDuplicateCost(data, COST_DUPLICATE_GUARD_LOOKBACK_MS);
    if (guardedDuplicate) return { cost: guardedDuplicate, reused: true };
    throw error;
  }
}

export function serializeCosts(rows = []) {
  return rows.map(safeSerializeCost);
}
