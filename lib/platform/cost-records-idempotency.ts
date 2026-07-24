import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { logisticsCostSourceSelect } from "./cost-records-logistics-source";
import {
  COST_DUPLICATE_GUARD_LOOKBACK_MS,
  COST_IDEMPOTENCY_WINDOW_MS,
  ORDER_COST_STATUS_VOID,
  isPlainRecord,
} from "./shared";

type DuplicateCostOptions = { sameCreator?: boolean };
type CostCreateData = Prisma.OrderCostUncheckedCreateInput;

export function includeCostRelations() {
  return Prisma.validator<Prisma.OrderCostInclude>()({
    order: { include: {
      customer: true, businessEntity: true, salesperson: true,
      commissionSettlementRecords: {
        where: { status: "ACTIVE", reversedAt: null },
        select: { id: true, status: true, reversedAt: true },
        take: 1,
      },
    } },
    supplier: true,
    createdBy: true,
    updatedBy: true,
    generatedLogisticsExpense: { select: logisticsCostSourceSelect() },
    supplierDocumentRequests: { where: { deletedAt: null }, select: { id: true, deletedAt: true }, take: 1 },
    documents: {
      where: { deletedAt: null }, include: { uploadedBy: true, supplier: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
  });
}

type CostWithRelations = Prisma.OrderCostGetPayload<{ include: ReturnType<typeof includeCostRelations> }>;
type CostRecordClient = { orderCost: Pick<typeof prisma.orderCost, "create" | "findFirst"> };
type CreateCostIdempotentlyOptions = { attachDocuments?: boolean; createdBefore?: Date };

function duplicateDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function duplicateText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function duplicateCostWhere(data: CostCreateData, windowMs: number, { sameCreator = false }: DuplicateCostOptions = {}, createdBefore?: Date): Prisma.OrderCostWhereInput {
  return {
    deletedAt: null, status: { not: ORDER_COST_STATUS_VOID }, orderId: data.orderId,
    supplierId: data.supplierId || null, costType: data.costType, amount: data.amount,
    currency: duplicateText(data.currency, "CNY") || "CNY", exchangeRate: data.exchangeRate,
    paymentDate: duplicateDate(data.paymentDate), sourceType: duplicateText(data.sourceType, "MANUAL") || "MANUAL",
    sourceId: data.sourceId || null, remark: data.remark || null,
    createdAt: { gte: new Date(Date.now() - windowMs), ...(createdBefore ? { lt: createdBefore } : {}) },
    ...(sameCreator ? { createdById: data.createdById || null } : {}),
  };
}

export function duplicateCostFingerprint(data: Pick<CostCreateData, "orderId" | "supplierId" | "costType" | "amount" | "currency" | "exchangeRate" | "paymentDate" | "sourceType" | "sourceId" | "remark">) {
  return [data.orderId || "", data.supplierId || "", data.costType || "", duplicateText(data.currency, "CNY") || "CNY",
    Number(data.amount || 0).toFixed(2), Number(data.exchangeRate || 0).toFixed(6),
    duplicateDate(data.paymentDate)?.toISOString().slice(0, 10) || "", duplicateText(data.sourceType, "MANUAL") || "MANUAL",
    data.sourceId || "", data.remark || ""].join("|");
}

async function findDuplicateCost(client: CostRecordClient, data: CostCreateData, windowMs: number, options: DuplicateCostOptions = {}, createdBefore?: Date) {
  return client.orderCost.findFirst({
    where: duplicateCostWhere(data, windowMs, options, createdBefore),
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
}

async function maybeAttachBusinessDocuments(cost: CostWithRelations, attachDocuments: boolean) {
  return attachDocuments ? await attachBusinessDocumentsToCost(cost) as CostWithRelations : cost;
}

export async function createCostIdempotently(data: CostCreateData, client: CostRecordClient = prisma, options: CreateCostIdempotentlyOptions = {}): Promise<{ cost: CostWithRelations; reused: boolean }> {
  const attachDocuments = options.attachDocuments !== false;
  const recentDuplicate = await findDuplicateCost(client, data, COST_IDEMPOTENCY_WINDOW_MS, {}, options.createdBefore);
  if (recentDuplicate) return { cost: await maybeAttachBusinessDocuments(recentDuplicate, attachDocuments), reused: true };
  try {
    const cost = await client.orderCost.create({ data, include: includeCostRelations() });
    return { cost: await maybeAttachBusinessDocuments(cost, attachDocuments), reused: false };
  } catch (error) {
    if (!(isPlainRecord(error) && error.code === "P2002")) throw error;
    const guardedDuplicate = await findDuplicateCost(client, data, COST_DUPLICATE_GUARD_LOOKBACK_MS, { sameCreator: true }, options.createdBefore)
      || await findDuplicateCost(client, data, COST_DUPLICATE_GUARD_LOOKBACK_MS, {}, options.createdBefore);
    if (guardedDuplicate) return { cost: await maybeAttachBusinessDocuments(guardedDuplicate, attachDocuments), reused: true };
    throw error;
  }
}
