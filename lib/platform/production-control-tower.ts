import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { chinaDaysBetween, supplierPerformanceScore } from "./production-control-tower-rules";
import { assertRead } from "./shared";
import { salesExecutionAccessWhere, type SalesExecutionActor } from "./sales-execution-access";

const terminalStatuses = new Set(["COMPLETED"]);
const pageSize = 500;

function targetDate(row: { confirmedSupplierDeliveryDate: Date | null; supplierDeliveryDate: Date | null; initialSupplierDeliveryDate: Date | null; requestedDeliveryDate: Date }) {
  return row.confirmedSupplierDeliveryDate || row.supplierDeliveryDate || row.initialSupplierDeliveryDate || row.requestedDeliveryDate;
}

const purchaseOrderSelect = {
  id: true, poNo: true, supplierId: true, supplierNameSnapshot: true, status: true, productionStatus: true,
  requestedDeliveryDate: true, initialSupplierDeliveryDate: true, confirmedSupplierDeliveryDate: true, supplierDeliveryDate: true,
  actualDeliveryDate: true, respondedAt: true,
  execution: { select: { id: true, customerOrderNo: true, customerShortNameSnapshot: true, customerNameSnapshot: true } },
  items: { select: { allocatedQuantity: true } },
  productionProgressReports: { orderBy: { reportedAt: "desc" as const }, take: 1, select: { reportedAt: true, items: { select: { completedQuantity: true } } } },
  deliveryQuantityVariances: { select: { id: true } },
} satisfies Prisma.FactoryPurchaseOrderSelect;

async function loadAllPurchaseOrders(actor: SalesExecutionActor) {
  type Row = Prisma.FactoryPurchaseOrderGetPayload<{ select: typeof purchaseOrderSelect }>;
  const rows: Row[] = [];
  let cursor: string | undefined;
  do {
    const batch = await prisma.factoryPurchaseOrder.findMany({
      where: { status: { notIn: ["DRAFT", "VOIDED", "REJECTED"] }, voidedAt: null, execution: { is: { ...salesExecutionAccessWhere(actor), status: { not: "VOIDED" } } } },
      select: purchaseOrderSelect,
      orderBy: { id: "asc" }, take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...batch);
    cursor = batch.length === pageSize ? batch[batch.length - 1]?.id : undefined;
  } while (cursor);
  return rows;
}

export async function loadProductionControlTower(actor: SalesExecutionActor) {
  assertRead(actor, "salesExecution");
  const now = new Date();
  const rows = await loadAllPurchaseOrders(actor);
  const orders = rows.map((row) => {
    const target = targetDate(row); const latest = row.productionProgressReports[0];
    const ordered = row.items.reduce((sum, item) => sum + Number(item.allocatedQuantity || 0), 0);
    const completed = latest?.items.reduce((sum, item) => sum + Number(item.completedQuantity || 0), 0) || 0;
    const progress = row.productionStatus === "COMPLETED" ? 100 : ordered > 0 ? Math.min(100, Math.round(completed / ordered * 100)) : 0;
    const daysToTarget = chinaDaysBetween(target, now); const complete = terminalStatuses.has(row.productionStatus) || Boolean(row.actualDeliveryDate);
    const staleDays = latest ? Math.max(0, chinaDaysBetween(now, latest.reportedAt)) : null;
    const staleRisk = row.productionStatus === "IN_PRODUCTION" && (staleDays === null || staleDays > 7);
    const risk = !complete && daysToTarget < 0 ? "OVERDUE" : !complete && (daysToTarget <= 7 || staleRisk) ? "AT_RISK" : complete ? "COMPLETED" : "ON_TRACK";
    return { id: row.id, poNo: row.poNo, executionId: row.execution.id, customerOrderNo: row.execution.customerOrderNo, customerName: row.execution.customerShortNameSnapshot || row.execution.customerNameSnapshot, supplierId: row.supplierId, supplierName: row.supplierNameSnapshot, status: row.status, productionStatus: row.productionStatus, targetDate: target, actualDeliveryDate: row.actualDeliveryDate, progress, latestProgressAt: latest?.reportedAt || null, staleDays, daysToTarget, risk, responded: Boolean(row.respondedAt), hasVariance: row.deliveryQuantityVariances.length > 0 };
  });
  const riskOrder = { OVERDUE: 0, AT_RISK: 1, ON_TRACK: 2, COMPLETED: 3 } as const;
  orders.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || a.daysToTarget - b.daysToTarget || a.poNo.localeCompare(b.poNo));
  const supplierMap = new Map<string, typeof orders>();
  for (const order of orders) supplierMap.set(order.supplierId, [...(supplierMap.get(order.supplierId) || []), order]);
  const suppliers = [...supplierMap.entries()].map(([supplierId, supplierOrders]) => {
    const delivered = supplierOrders.filter((order) => order.actualDeliveryDate);
    const onTime = delivered.filter((order) => order.actualDeliveryDate && chinaDaysBetween(order.actualDeliveryDate, order.targetDate) <= 0).length;
    const active = supplierOrders.filter((order) => !["COMPLETED"].includes(order.productionStatus) && !order.actualDeliveryDate);
    const tracked = active.filter((order) => order.productionStatus === "IN_PRODUCTION");
    const fresh = tracked.filter((order) => order.staleDays !== null && order.staleDays <= 7).length;
    const responded = supplierOrders.filter((order) => order.responded).length;
    const varianceCount = supplierOrders.filter((order) => order.hasVariance).length;
    const onTimeRate = delivered.length ? Math.round(onTime / delivered.length * 100) : null;
    const progressFreshness = tracked.length ? Math.round(fresh / tracked.length * 100) : 100;
    const responseRate = Math.round(responded / supplierOrders.length * 100);
    const varianceRate = Math.round(varianceCount / supplierOrders.length * 100);
    const score = supplierPerformanceScore({ deliveredCount: delivered.length, onTimeRate, progressFreshness, responseRate, varianceRate });
    return { supplierId, supplierName: supplierOrders[0]?.supplierName || "未命名供应商", orderCount: supplierOrders.length, deliveredSampleSize: delivered.length, activeCount: active.length, overdueCount: active.filter((order) => order.risk === "OVERDUE").length, onTimeRate, progressFreshness, responseRate, varianceRate, score };
  }).sort((a, b) => a.score === null ? (b.score === null ? a.supplierName.localeCompare(b.supplierName, "zh-CN") : 1) : b.score === null ? -1 : b.score - a.score || a.supplierName.localeCompare(b.supplierName, "zh-CN"));
  return {
    generatedAt: now,
    summary: { total: orders.length, inProduction: orders.filter((order) => order.productionStatus === "IN_PRODUCTION").length, overdue: orders.filter((order) => order.risk === "OVERDUE").length, atRisk: orders.filter((order) => order.risk === "AT_RISK").length, completed: orders.filter((order) => order.risk === "COMPLETED").length },
    orders, suppliers,
  };
}
