import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { FACTORY_SUPPLIER_COST_TYPES, LOGISTICS_GENERATED_COST_SOURCE_TYPES, ORDER_COST_STATUS_VOID, SUPPLIER_DOCUMENT_TYPES } from "./shared-constants";
import { refreshTaxRefundCompleteness, syncCostInvoiceStatus } from "./shared-tax-sync";
import {
  costKey,
  costNameKey,
  documentIsUploaded,
  issueFor,
  pushCost,
  repairDocumentInclude,
  resolveRepairCost,
  resolvedOrderId,
  resolvedOrderNo,
  resolvedSupplierId,
  resolvedSupplierName,
  uniqueStrings,
  type RepairCost,
  type RepairTaxRelationOptions,
  type TaxRelationRepairIssue,
  type TaxRelationRepairStats,
} from "./repair-tax-relations-support";

export type { RepairTaxRelationOptions, TaxRelationRepairIssue, TaxRelationRepairStats } from "./repair-tax-relations-support";

const DEFAULT_REPAIR_LIMIT = 500;
const STARTUP_REPAIR_LIMIT = 200;
const STARTUP_STATE_KEY = Symbol.for("rmb.taxRelationRepairStarted");

export async function repairTaxRelations(options: RepairTaxRelationOptions = {}): Promise<TaxRelationRepairStats> {
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_REPAIR_LIMIT), 5000));
  const orderIds = uniqueStrings(options.orderIds || []);
  const orderNos = uniqueStrings(options.orderNos || []);
  const where: Prisma.OrderDocumentWhereInput = {
    deletedAt: null,
    documentType: { in: SUPPLIER_DOCUMENT_TYPES },
    ...(orderIds.length ? { orderId: { in: orderIds } } : {}),
    ...(orderNos.length ? { order: { orderNo: { in: orderNos } } } : {}),
  };
  const documents = await prisma.orderDocument.findMany({
    where,
    include: repairDocumentInclude,
    orderBy: [{ createdAt: "asc" }],
    take: limit,
  });
  const candidateOrderIds = uniqueStrings(documents.map(resolvedOrderId));
  const costs = candidateOrderIds.length
    ? await prisma.orderCost.findMany({
      where: {
        orderId: { in: candidateOrderIds },
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        costType: { in: FACTORY_SUPPLIER_COST_TYPES },
	        sourceType: { notIn: LOGISTICS_GENERATED_COST_SOURCE_TYPES },
      },
      select: {
        id: true,
        orderId: true,
        supplierId: true,
        supplierNameSnapshot: true,
        vendorName: true,
        costType: true,
      },
      take: Math.max(limit, 500),
    })
    : [];
  const costsById = new Map(costs.map((cost) => [cost.id, cost]));
  const costsByOrderSupplier = new Map<string, RepairCost[]>();
  const costsByOrderSupplierName = new Map<string, RepairCost[]>();
  for (const cost of costs) {
    pushCost(costsByOrderSupplier, cost.supplierId ? costKey(cost.orderId, cost.supplierId) : "", cost);
    pushCost(costsByOrderSupplierName, costNameKey(cost.orderId, cost.supplierNameSnapshot || cost.vendorName), cost);
  }

  const issues: TaxRelationRepairIssue[] = [];
  const affectedOrderIds = new Set<string>();
  const affectedCostIds = new Set<string>();
  let repaired = 0;

  for (const document of documents) {
    const reasons: string[] = [];
    const orderId = resolvedOrderId(document);
    const supplierId = resolvedSupplierId(document);
    if (!orderId) reasons.push("orderId missing");
    if (!supplierId && !resolvedSupplierName(document)) reasons.push("supplierId missing");
    if (document.factoryDocumentRequestId && !document.factoryDocumentRequest) reasons.push("uploadTaskId missing");
    if (document.factoryDocumentRequest?.deletedAt) reasons.push("uploadTask deleted");
    if (!documentIsUploaded(document)) reasons.push("status filtered");

    const resolved = resolveRepairCost(document, costsById, costsByOrderSupplier, costsByOrderSupplierName);
    if (!resolved.cost) reasons.push(resolved.reason);

    if (reasons.length) {
      const reason = [...new Set(reasons.filter(Boolean))].join("; ");
      issues.push(issueFor(document, reason));
      console.warn("tax-relation-repair-unable", { ...issueFor(document, reason), source: options.source || "manual" });
      continue;
    }

    const targetCost = resolved.cost!;
    const data: Prisma.OrderDocumentUpdateInput = {};
    if (document.orderId !== targetCost.orderId) data.order = { connect: { id: targetCost.orderId } };
    if ((document.supplierId || "") !== (targetCost.supplierId || "")) {
      if (targetCost.supplierId) data.supplier = { connect: { id: targetCost.supplierId } };
      else data.supplier = { disconnect: true };
    }
    if (document.costId !== targetCost.id) data.cost = { connect: { id: targetCost.id } };
    if (document.relatedModule !== "SUPPLIER") data.relatedModule = "SUPPLIER";
    if (document.uploadStatus !== "SUCCESS" && documentIsUploaded(document)) {
      data.uploadStatus = "SUCCESS";
      data.uploadProgress = 100;
    }

    const requestData: Prisma.SupplierDocumentRequestUpdateInput = {};
    const task = document.factoryDocumentRequest;
    if (task && task.costId !== targetCost.id) requestData.cost = { connect: { id: targetCost.id } };
    if (task && task.orderId !== targetCost.orderId) requestData.order = { connect: { id: targetCost.orderId } };
    if (task && targetCost.supplierId && task.supplierId !== targetCost.supplierId) {
      requestData.supplier = { connect: { id: targetCost.supplierId } };
    }

    if (Object.keys(data).length || Object.keys(requestData).length) {
      if (!options.dryRun) {
        await prisma.$transaction([
          ...(Object.keys(data).length
            ? [prisma.orderDocument.update({ where: { id: document.id }, data })]
            : []),
          ...(task && Object.keys(requestData).length
            ? [prisma.supplierDocumentRequest.update({ where: { id: task.id }, data: requestData })]
            : []),
        ]);
      }
      repaired += 1;
      console.info("tax-relation-repaired", {
        documentId: document.id,
        orderId: targetCost.orderId,
        orderNo: resolvedOrderNo(document),
        supplierId: targetCost.supplierId || "",
        supplierName: resolvedSupplierName(document),
        costId: targetCost.id,
        documentType: document.documentType,
        source: options.source || "manual",
        dryRun: Boolean(options.dryRun),
      });
    }
    affectedOrderIds.add(targetCost.orderId);
    if (document.documentType === "SUPPLIER_INVOICE") affectedCostIds.add(targetCost.id);
  }

  let refreshedOrders = 0;
  if (!options.dryRun) {
    for (const orderId of affectedOrderIds) {
      await refreshTaxRefundCompleteness(orderId);
      refreshedOrders += 1;
    }
  }
  let syncedCosts = 0;
  if (!options.dryRun) {
    for (const costId of affectedCostIds) {
      await syncCostInvoiceStatus(costId);
      syncedCosts += 1;
    }
  }

  const stats = {
    scanned: documents.length,
    repaired,
    unable: issues.length,
    refreshedOrders,
    syncedCosts,
    issues,
  };
  console.info("tax-relation-repair-summary", stats);
  return stats;
}

export function scheduleRepairTaxRelationsOnStartup() {
  const globalState = globalThis as typeof globalThis & { [STARTUP_STATE_KEY]?: boolean };
  if (globalState[STARTUP_STATE_KEY]) return;
  if (process.env.DISABLE_TAX_RELATION_STARTUP_REPAIR === "true") return;
  globalState[STARTUP_STATE_KEY] = true;
  setTimeout(() => {
    repairTaxRelations({ limit: STARTUP_REPAIR_LIMIT, source: "startup" }).catch((error) => {
      console.error("tax-relation-startup-repair-failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : "",
      });
    });
  }, 0);
}
