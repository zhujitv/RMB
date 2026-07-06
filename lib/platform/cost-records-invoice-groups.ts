import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { summarizeCurrencyTotals } from "./currency-totals";
import { assertRead, nonEmpty, safeSerializeCost, type CostDto } from "./shared";
import { costAccessWhere } from "./masters-access";
import { attachBusinessDocumentsToCosts, successfulSupplierInvoicePairs } from "./business-documents";
import { costPageParams } from "./cost-records-shared";
import {
  COST_INVOICE_GROUP_DETAIL_LIMIT,
  COST_INVOICE_GROUP_SCAN_LIMIT,
  COST_WORKFLOW_SORT_WEIGHTS,
  costPaymentInvoiceSortGroupWhere,
  costWorkflowSortCompare,
  costListFiltersFromQuery,
  includeCostInvoiceGroupRelations,
  pagedCostWhere,
  type ActorLike,
  type CostInvoiceGroupCostDto,
  type CostQuery,
  type CostWithInvoiceGroupRelations,
  type CostWorkflowSortWeight,
  type SupplierInvoicePair,
} from "./cost-records-query-shared";

function logisticsBillIdForCost(cost: CostWithInvoiceGroupRelations | null | undefined) {
  return nonEmpty(cost?.generatedLogisticsExpense?.billId || cost?.generatedLogisticsExpense?.bill?.id);
}

function costInvoiceGroupKey(cost: CostWithInvoiceGroupRelations) {
  const billId = logisticsBillIdForCost(cost);
  if (cost.sourceType === "LOGISTICS_EXPENSE" && billId) return `logistics-bill:${billId}`;
  if (cost.sourceType === "LOGISTICS_EXPENSE") {
    return [
      "logistics-fallback",
      cost.orderId || "",
      cost.supplierId || "",
      cost.order?.blNo || "",
      cost.currency || "CNY",
    ].join(":");
  }
  return `cost:${cost.id}`;
}

function groupPaymentStatus(costs: CostDto[] = []) {
  const statuses = costs.map((cost) => cost.paymentStatus || "待支付");
  if (statuses.length && statuses.every((status) => status === "已支付")) return "已支付";
  if (statuses.some((status) => status === "已支付" || status === "部分支付")) return "部分支付";
  if (statuses.length && statuses.every((status) => status === "已取消")) return "已取消";
  return statuses[0] || "待支付";
}

function groupInvoiceStatus(costs: CostDto[] = []) {
  const statuses = costs.map((cost) => cost.invoiceStatus || "未收到");
  if (statuses.length && statuses.every((status) => status === "已收到")) return "已收到";
  if (statuses.some((status) => status === "已收到")) return "部分收到";
  return "未收到";
}

const MISSING_INVOICE_OVERDUE_DAYS = 30;
const INVOICE_GROUP_CANDIDATE_BATCH_SIZE = 120;

function costTimestamp(value: unknown) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function costDateField(cost: CostDto, field: "costConfirmedAt" | "paymentDate" | "updatedAt" | "createdAt") {
  if (field in cost) return cost[field as keyof CostDto];
  return null;
}

function hasOverdueMissingInvoice(costs: CostDto[] = []) {
  const cutoff = Date.now() - MISSING_INVOICE_OVERDUE_DAYS * 24 * 60 * 60 * 1000;
  return costs.some((cost) => {
    const baseTime = costTimestamp(
      costDateField(cost, "costConfirmedAt")
      || costDateField(cost, "paymentDate")
      || costDateField(cost, "updatedAt")
      || costDateField(cost, "createdAt"),
    );
    return baseTime > 0 && baseTime < cutoff;
  });
}

function invoiceExceptionType(costs: CostDto[] = [], paymentStatus = "", invoiceStatus = "") {
  if (invoiceStatus !== "未收到") return "";
  if (paymentStatus === "已支付") return "PAID_WITHOUT_INVOICE";
  if (costs.some((cost) => cost.costConfirmed)) return "CONFIRMED_WITHOUT_INVOICE";
  if (hasOverdueMissingInvoice(costs)) return "OVERDUE_WITHOUT_INVOICE";
  return "";
}

function invoiceExceptionLabel(type: string) {
  if (type === "PAID_WITHOUT_INVOICE") return "已付款未收票";
  if (type === "CONFIRMED_WITHOUT_INVOICE") return "已确认未收票";
  if (type === "OVERDUE_WITHOUT_INVOICE") return "超期未收票";
  return "";
}

function uniqueTextList(values: Array<string | null | undefined>) {
  return values.map(nonEmpty).filter((value, index, rows) => value && rows.indexOf(value) === index);
}

function groupInvoiceFiles(costs: CostDto[] = []) {
  const documents = costs.flatMap((cost) => cost.documents || [])
    .filter((document) => (
      document.documentType === "SUPPLIER_INVOICE"
      && document.uploadStatus === "SUCCESS"
    ));
  const seen = new Set<string>();
  return documents.filter((document) => {
    const key = document.id || document.fileName || "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializeCostInvoiceGroup(key: string, costs: CostDto[], rawRows: CostWithInvoiceGroupRelations[] = []) {
  const groupCosts = costs as CostInvoiceGroupCostDto[];
  const first = groupCosts[0] || {};
  const firstRaw = rawRows[0];
  const currencyTotals = summarizeCurrencyTotals(groupCosts);
  const invoiceFiles = groupInvoiceFiles(groupCosts);
  const paymentStatus = groupPaymentStatus(groupCosts);
  const invoiceStatus = groupInvoiceStatus(groupCosts);
  const exceptionType = invoiceExceptionType(groupCosts, paymentStatus, invoiceStatus);
  const sourceTypes = uniqueTextList(groupCosts.map((cost) => cost.sourceType));
  const groupType = sourceTypes.includes("LOGISTICS_EXPENSE") ? "LOGISTICS_BILL" : "COST";
  const costTypeLabels = uniqueTextList(groupCosts.map((cost) => cost.costType));
  const latestCreatedAt = groupCosts
    .map((cost) => new Date(cost.createdAt || cost.updatedAt || 0).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0] || 0;
  const latestUpdatedAt = groupCosts
    .map((cost) => new Date(cost.updatedAt || cost.createdAt || 0).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0] || 0;
  return {
    id: key,
    groupKey: key,
    groupType,
    logisticsBillId: logisticsBillIdForCost(firstRaw),
    orderId: first.orderId || "",
    orderNo: first.orderNo || "",
    blNo: first.blNo || first.billOfLadingNo || "",
    billOfLadingNo: first.billOfLadingNo || first.blNo || "",
    customerName: first.customerName || "",
    customerFullName: first.customerFullName || "",
    customerShortName: first.customerShortName || "",
    businessEntityId: first.businessEntityId || "",
    businessEntityName: first.businessEntityName || "",
    businessEntityShortName: first.businessEntityShortName || "",
    businessEntityDisplayName: first.businessEntityDisplayName || "",
    businessEntityNameSnapshot: first.businessEntityNameSnapshot || "",
    businessEntityIsDefault: first.businessEntityIsDefault !== false,
    businessEntity: first.businessEntity || null,
    supplierId: first.supplierId || "",
    supplierName: first.supplierName || first.supplierNameSnapshot || first.vendorName || "",
    supplierNameSnapshot: first.supplierNameSnapshot || first.supplierName || first.vendorName || "",
    vendorName: first.vendorName || first.supplierNameSnapshot || first.supplierName || "",
    invoiceNo: uniqueTextList(invoiceFiles.map((document) => document.fileName)).join(" / "),
    costTypes: costTypeLabels,
    costTypeSummary: costTypeLabels.join(" / "),
    currencyTotals,
    paymentStatus,
    invoiceStatus,
    invoiceExceptionType: exceptionType,
    invoiceExceptionLabel: invoiceExceptionLabel(exceptionType),
    costCount: groupCosts.length,
    costs: groupCosts,
    documents: invoiceFiles,
    createdAt: latestCreatedAt ? new Date(latestCreatedAt).toISOString() : first.createdAt || first.updatedAt || "",
    updatedAt: latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : first.updatedAt || first.createdAt || "",
    sourceType: groupType,
  };
}

function invoiceGroupSortedWhere(
  where: Prisma.OrderCostWhereInput,
  weight: CostWorkflowSortWeight,
  supplierInvoicePairs: SupplierInvoicePair[] = [],
): Prisma.OrderCostWhereInput {
  return {
    AND: [
      where,
      costPaymentInvoiceSortGroupWhere(weight, supplierInvoicePairs),
    ],
  };
}

async function findInvoiceGroupCandidateRows(
  where: Prisma.OrderCostWhereInput,
  supplierInvoicePairs: SupplierInvoicePair[] = [],
  requiredGroupCount: number,
  maxRows: number,
) {
  const rows: CostWithInvoiceGroupRelations[] = [];
  const seenCostIds = new Set<string>();
  const seenGroupKeys = new Set<string>();
  let stoppedEarly = false;

  outer:
  for (const weight of COST_WORKFLOW_SORT_WEIGHTS) {
    let skip = 0;
    while (rows.length < maxRows && seenGroupKeys.size < requiredGroupCount) {
      const remainingTake = maxRows - rows.length;
      const take = Math.min(INVOICE_GROUP_CANDIDATE_BATCH_SIZE, remainingTake);
      if (take <= 0) {
        stoppedEarly = true;
        break outer;
      }
      const groupRows = await prisma.orderCost.findMany({
        where: invoiceGroupSortedWhere(where, weight, supplierInvoicePairs),
        include: includeCostInvoiceGroupRelations(),
        orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
        skip,
        take,
      });
      skip += groupRows.length;
      for (const row of groupRows) {
        if (seenCostIds.has(row.id)) continue;
        seenCostIds.add(row.id);
        rows.push(row);
        seenGroupKeys.add(costInvoiceGroupKey(row));
      }
      if (groupRows.length < take) break;
    }
    if (seenGroupKeys.size >= requiredGroupCount || rows.length >= maxRows) {
      stoppedEarly = true;
      break;
    }
  }
  return {
    rows,
    scannedAllCandidates: !stoppedEarly,
  };
}

async function buildCostInvoiceGroups(query: CostQuery, actor: ActorLike = null, options: { exceptionsOnly?: boolean } = {}) {
  assertRead(actor, "costs");
  const { page, pageSize } = costPageParams(query);
  const filters = costListFiltersFromQuery(query);
  const invoicePairs = await successfulSupplierInvoicePairs();
  const where = pagedCostWhere(filters, actor, invoicePairs);
  const start = (page - 1) * pageSize;
  const requiredGroupCount = start + pageSize + 1;
  const candidateTake = Math.min(
    COST_INVOICE_GROUP_SCAN_LIMIT,
    Math.max(requiredGroupCount * 4, pageSize * 8),
  );
  const { rows: matchingRows, scannedAllCandidates } = await findInvoiceGroupCandidateRows(
    where,
    invoicePairs,
    requiredGroupCount,
    candidateTake,
  );
  const matchingRowsWithBusinessDocuments = await attachBusinessDocumentsToCosts(matchingRows);
  const groupMap = new Map<string, CostWithInvoiceGroupRelations[]>();
  matchingRowsWithBusinessDocuments.forEach((cost) => {
    const key = costInvoiceGroupKey(cost);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(cost);
  });
  const keys = [...groupMap.keys()];
  const billIds = uniqueTextList(keys.filter((key) => key.startsWith("logistics-bill:")).map((key) => key.replace(/^logistics-bill:/, "")));
  const singleCostIds = uniqueTextList(keys.filter((key) => key.startsWith("cost:")).map((key) => key.replace(/^cost:/, "")));
  const fallbackCostIds = keys
    .filter((key) => key.startsWith("logistics-fallback:"))
    .flatMap((key) => (groupMap.get(key) || []).map((cost) => cost.id));
  const fullWhere: Prisma.OrderCostWhereInput[] = [];
  if (billIds.length) {
    fullWhere.push({
      sourceType: "LOGISTICS_EXPENSE",
      generatedLogisticsExpense: { is: { billId: { in: billIds } } },
    });
  }
  const costIds = uniqueTextList([...singleCostIds, ...fallbackCostIds]);
  if (costIds.length) fullWhere.push({ id: { in: costIds } });
  const fullRows = fullWhere.length
    ? await prisma.orderCost.findMany({
      where: {
        deletedAt: null,
        ...costAccessWhere(actor),
        OR: fullWhere,
      },
      include: includeCostInvoiceGroupRelations(),
      orderBy: [{ createdAt: "desc" }, { updatedAt: "desc" }],
      take: COST_INVOICE_GROUP_DETAIL_LIMIT,
    })
    : [];
  const fullRowsWithBusinessDocuments = await attachBusinessDocumentsToCosts(fullRows);
  const rawRowsByKey = fullRowsWithBusinessDocuments.reduce<Map<string, CostWithInvoiceGroupRelations[]>>((acc, cost) => {
    const key = costInvoiceGroupKey(cost);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(cost);
    return acc;
  }, new Map());
  const groups = keys
    .map((key) => {
      const rawRows = rawRowsByKey.get(key) || groupMap.get(key) || [];
      const costs = rawRows.map(safeSerializeCost);
      return serializeCostInvoiceGroup(key, costs, rawRows);
    })
    .filter((group) => !options.exceptionsOnly || (group.invoiceStatus === "未收到" && Boolean(group.invoiceExceptionType)))
    .sort(costWorkflowSortCompare);
  const totalGroups = scannedAllCandidates
    ? groups.length
    : Math.max(groups.length, start + pageSize + 1);
  return {
    rows: groups.slice(start, start + pageSize),
    total: totalGroups,
    page,
    pageSize,
  };
}

export async function listCostInvoiceGroups(query: CostQuery, actor: ActorLike = null) {
  return buildCostInvoiceGroups(query, actor);
}

export async function listCostInvoiceExceptions(query: CostQuery, actor: ActorLike = null) {
  return buildCostInvoiceGroups(query, actor, { exceptionsOnly: true });
}
