import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { includeOrderRelations } from "./shared-order-relations";
import { taxDocumentCompleteness, taxRefundStatusFromCompleteness } from "./shared-tax-completeness";
import { hasCostBusinessDocument } from "./business-documents";
import { runNonCriticalTask } from "./shared-constants";

type TaxRefundCompletenessOrder = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;
type TaxRefundCompletenessResult = ReturnType<typeof taxDocumentCompleteness>;

const TAX_REFUND_COMPLETENESS_BATCH_CONCURRENCY = 3;
const pendingTaxRefundCompletenessRefreshes = new Map<string, Promise<TaxRefundCompletenessResult | null>>();

function normalizedOrderId(orderId: string | null | undefined) {
  return String(orderId || "").trim();
}

async function loadTaxRefundCompletenessOrder(orderId: string) {
  return prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: includeOrderRelations(),
  });
}

function safeCompletenessJson(value: unknown) {
  try {
    return JSON.stringify(value || null);
  } catch {
    return "";
  }
}

async function computeAndPersistTaxRefundCompleteness(order: TaxRefundCompletenessOrder) {
  const completeness = JSON.parse(JSON.stringify(taxDocumentCompleteness(order))) as TaxRefundCompletenessResult;
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  const completenessChanged = safeCompletenessJson(order.taxRefundCompleteness) !== safeCompletenessJson(completeness);
  const statusChanged = status !== order.taxRefundStatus;
  if (!completenessChanged && !statusChanged && order.taxRefundCompletenessUpdatedAt) {
    return completeness;
  }
  await prisma.receivableOrder.update({
    where: { id: order.id },
    data: {
      taxRefundCompleteness: completeness as Prisma.InputJsonValue,
      taxRefundCompletenessUpdatedAt: new Date(),
      ...(statusChanged ? { taxRefundStatus: status } : {}),
    },
  });
  return completeness;
}

function runDedupedTaxRefundCompletenessRefresh(
  orderId: string,
  task: () => Promise<TaxRefundCompletenessResult | null>,
) {
  const pending = pendingTaxRefundCompletenessRefreshes.get(orderId);
  if (pending) return pending;
  const promise = task().finally(() => {
    pendingTaxRefundCompletenessRefreshes.delete(orderId);
  });
  pendingTaxRefundCompletenessRefreshes.set(orderId, promise);
  return promise;
}

export async function refreshTaxRefundCompletenessForOrder(order: TaxRefundCompletenessOrder | null | undefined) {
  const orderId = normalizedOrderId(order?.id);
  if (!orderId || !order) return null;
  return runDedupedTaxRefundCompletenessRefresh(orderId, () => computeAndPersistTaxRefundCompleteness(order));
}

export async function refreshTaxRefundCompleteness(orderId: string | null | undefined) {
  const id = normalizedOrderId(orderId);
  if (!id) return null;
  return runDedupedTaxRefundCompletenessRefresh(id, async () => {
    const order = await loadTaxRefundCompletenessOrder(id);
    if (!order) return null;
    return computeAndPersistTaxRefundCompleteness(order);
  });
}

export async function refreshTaxRefundCompletenessBatch(
  orderIds: Array<string | null | undefined>,
  options: { concurrency?: number } = {},
) {
  const ids = [...new Set(orderIds.map(normalizedOrderId).filter(Boolean))];
  const results = new Map<string, TaxRefundCompletenessResult | null>();
  if (!ids.length) return results;
  const concurrency = Math.min(
    Math.max(1, Math.round(options.concurrency || TAX_REFUND_COMPLETENESS_BATCH_CONCURRENCY)),
    TAX_REFUND_COMPLETENESS_BATCH_CONCURRENCY,
  );
  let index = 0;
  async function worker() {
    while (index < ids.length) {
      const orderId = ids[index++];
      if (!orderId) continue;
      results.set(orderId, await refreshTaxRefundCompleteness(orderId));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return results;
}

export function scheduleTaxRefundCompletenessRefresh(orderId: string | null | undefined, label = "退税资料完整度刷新") {
  const id = normalizedOrderId(orderId);
  if (!id) return;
  void runNonCriticalTask(label, () => refreshTaxRefundCompleteness(id));
}

export function scheduleTaxRefundCompletenessRefreshBatch(
  orderIds: Array<string | null | undefined>,
  label = "退税资料完整度批量刷新",
) {
  const ids = [...new Set(orderIds.map(normalizedOrderId).filter(Boolean))];
  if (!ids.length) return;
  void runNonCriticalTask(label, () => refreshTaxRefundCompletenessBatch(ids));
}

export async function syncCostInvoiceStatus(costId: string | null | undefined) {
  if (!costId) return null;
  const cost = await prisma.orderCost.findFirst({
    where: { id: costId, deletedAt: null },
    select: { id: true, orderId: true, supplierId: true, sourceType: true, invoiceStatus: true },
  });
  if (!cost) return null;
  const invoiceCount = await prisma.orderDocument.count({
    where: {
      costId,
      documentType: "SUPPLIER_INVOICE",
      uploadStatus: "SUCCESS",
      deletedAt: null,
    },
  });
  const hasSupplierReturnInvoice = await hasCostBusinessDocument(cost, "SUPPLIER_INVOICE");
  if (cost.sourceType === "LOGISTICS_EXPENSE") {
    const invoiceStatus = invoiceCount > 0 || hasSupplierReturnInvoice ? "已收到" : (cost.invoiceStatus || "未通知");
    return prisma.orderCost.update({
      where: { id: costId },
      data: { invoiceStatus },
    });
  }
  const invoiceStatus = invoiceCount > 0 || hasSupplierReturnInvoice ? "已收到" : "未收到";
  return prisma.orderCost.update({
    where: { id: costId },
    data: { invoiceStatus },
  });
}
