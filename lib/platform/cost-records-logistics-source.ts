import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  nonEmpty,
  normalizedCostType,
} from "./shared";

type MutableCostRow = Record<string, unknown> & {
  id?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  costType?: string | null;
  currency?: string | null;
  amount?: unknown;
  amountCny?: unknown;
  sourceType?: string | null;
  sourceId?: string | null;
  generatedLogisticsExpense?: unknown;
};

export function logisticsCostSourceSelect() {
  return Prisma.validator<Prisma.LogisticsExpenseSelect>()({
    id: true,
    billId: true,
    orderId: true,
    supplierId: true,
    costId: true,
    supplierNameSnapshot: true,
    costType: true,
    currency: true,
    amount: true,
    amountCny: true,
    auditStatus: true,
    invoiceStatus: true,
    invoiceDocumentId: true,
    createdAt: true,
    reviewedAt: true,
    bill: {
      select: {
        id: true,
        billKey: true,
        billOfLadingNo: true,
        auditStatus: true,
        invoiceStatus: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    },
    supplier: {
      select: {
        id: true,
        supplierName: true,
      },
    },
  });
}

export type LogisticsCostSourceRow = Prisma.LogisticsExpenseGetPayload<{ select: ReturnType<typeof logisticsCostSourceSelect> }>;

function amountKey(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function costFallbackKey(row: Pick<MutableCostRow, "orderId" | "supplierId" | "costType" | "currency" | "amount" | "amountCny">) {
  return [
    nonEmpty(row.orderId),
    nonEmpty(row.supplierId),
    normalizedCostType(nonEmpty(row.costType)),
    nonEmpty(row.currency || "CNY").toUpperCase(),
    amountKey(row.amount),
    amountKey(row.amountCny),
  ].join("::");
}

function expenseFallbackKey(row: LogisticsCostSourceRow) {
  return costFallbackKey(row);
}

function hasAttachedLogisticsSource(row: MutableCostRow) {
  const source = row.generatedLogisticsExpense;
  return Boolean(source && typeof source === "object" && nonEmpty((source as { id?: unknown }).id));
}

function isLogisticsSourceCost(row: MutableCostRow) {
  return LOGISTICS_GENERATED_COST_SOURCE_TYPES.includes(nonEmpty(row.sourceType));
}

function assignLogisticsSource(row: MutableCostRow, source: LogisticsCostSourceRow | undefined) {
  if (source?.id) row.generatedLogisticsExpense = source;
}

export async function attachLogisticsSourcesToCosts<T extends MutableCostRow>(rows: T[] = []): Promise<T[]> {
  const logisticsRows = rows.filter((row) => isLogisticsSourceCost(row));
  if (!logisticsRows.length) return rows;

  const directIds = [...new Set(logisticsRows.map((row) => nonEmpty(row.sourceId)).filter(Boolean))];
  const directSources = directIds.length
    ? await prisma.logisticsExpense.findMany({
      where: { id: { in: directIds }, deletedAt: null },
      select: logisticsCostSourceSelect(),
    })
    : [];
  const directById = new Map(directSources.map((row) => [row.id, row]));
  for (const row of logisticsRows) {
    if (hasAttachedLogisticsSource(row)) continue;
    assignLogisticsSource(row, directById.get(nonEmpty(row.sourceId)));
  }

  const fallbackRows = logisticsRows.filter((row) => !hasAttachedLogisticsSource(row));
  if (!fallbackRows.length) return rows;

  const orderIds = [...new Set(fallbackRows.map((row) => nonEmpty(row.orderId)).filter(Boolean))];
  const supplierIds = [...new Set(fallbackRows.map((row) => nonEmpty(row.supplierId)).filter(Boolean))];
  if (!orderIds.length || !supplierIds.length) return rows;

  const candidates = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      orderId: { in: orderIds },
      supplierId: { in: supplierIds },
      OR: [
        { auditStatus: "审核通过" },
        { bill: { is: { auditStatus: "审核通过", deletedAt: null } } },
      ],
    },
    select: logisticsCostSourceSelect(),
    take: Math.max(500, fallbackRows.length * 20),
  });
  const candidatesByKey = candidates.reduce<Map<string, LogisticsCostSourceRow[]>>((acc, row) => {
    const key = expenseFallbackKey(row);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(row);
    return acc;
  }, new Map());
  for (const row of fallbackRows) {
    const matches = candidatesByKey.get(costFallbackKey(row)) || [];
    if (matches.length === 1) assignLogisticsSource(row, matches[0]);
  }
  return rows;
}
