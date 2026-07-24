import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { nonEmpty } from "./shared";
import { summarizeCurrencyTotals, type CurrencyTotalInput } from "./currency-totals";
import {
  assertCanReadLogisticsExpenses,
  groupLogisticsExpensesByShipment,
  includeLogisticsExpenseRelations,
  logisticsExpenseAccessWhere,
} from "./logistics-expense-shared";
import {
  logisticsExpenseBillVoidStatusWhere,
  type LogisticsQueryActor,
  type QueryLike,
} from "./logistics-expense-query-filters";

type SupplierStatementRow = {
  supplierId: string;
  supplierName: string;
  orderIds: Set<string>;
  approvedRows: CurrencyTotalInput[];
  paidRows: CurrencyTotalInput[];
  approvedAmountCny: number;
  pendingPaymentAmountCny: number;
  paidAmountCny: number;
};
type LogisticsStatementExpenseRow = {
  supplierId: string;
  supplierNameSnapshot?: string | null;
  supplier?: { supplierName?: string | null } | null;
  orderId: string;
  currency?: unknown;
  amount?: unknown;
  amountCny?: unknown;
  cost?: {
    paymentDate?: Date | string | null;
    deletedAt?: Date | string | null;
    currency?: unknown;
    amount?: unknown;
    amountCny?: unknown;
  } | null;
};
type ShipmentStatementRow = {
  supplierId: string;
  supplierName: string;
  orderId: string;
  approvedRows: CurrencyTotalInput[];
  paidRows: CurrencyTotalInput[];
};

const LOGISTICS_STATEMENT_SCAN_LIMIT = 3000;

export async function logisticsSupplierStatement(query: QueryLike, actor: LogisticsQueryActor) {
  assertCanReadLogisticsExpenses(actor);
  const month = nonEmpty(query.get("month"));
  const reviewedMonthWhere: Prisma.LogisticsExpenseWhereInput = month ? {
    bill: {
      is: {
        reviewedAt: {
          gte: new Date(`${month}-01T00:00:00.000Z`),
          lt: new Date(new Date(`${month}-01T00:00:00.000Z`).setUTCMonth(new Date(`${month}-01T00:00:00.000Z`).getUTCMonth() + 1)),
        },
      },
    },
  } : {};
  const where: Prisma.LogisticsExpenseWhereInput = {
    deletedAt: null,
    AND: [
      { bill: { is: { auditStatus: "审核通过" } } },
      { bill: { is: logisticsExpenseBillVoidStatusWhere("normal") } },
      reviewedMonthWhere,
    ],
    ...logisticsExpenseAccessWhere(actor),
  };
  const rows = await prisma.logisticsExpense.findMany({
    where,
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ updatedAt: "desc" }],
    take: LOGISTICS_STATEMENT_SCAN_LIMIT,
  });
  const shipmentRows = groupLogisticsStatementRowsByShipment(rows);
  return Object.values(shipmentRows.reduce<Record<string, SupplierStatementRow>>((acc, shipment) => {
    const key = shipment.supplierId;
    acc[key] ||= {
      supplierId: shipment.supplierId,
      supplierName: shipment.supplierName,
      orderIds: new Set(),
      approvedRows: [],
      paidRows: [],
      approvedAmountCny: 0,
      pendingPaymentAmountCny: 0,
      paidAmountCny: 0,
    };
    acc[key].orderIds.add(shipment.orderId);
    acc[key].approvedRows.push(...shipment.approvedRows);
    acc[key].paidRows.push(...shipment.paidRows);
    return acc;
  }, {})).map((item) => {
    const approvedCurrencyTotals = summarizeCurrencyTotals(item.approvedRows);
    const paidCurrencyTotals = summarizeCurrencyTotals(item.paidRows);
    const pendingPaymentCurrencyTotals = subtractCurrencyTotals(approvedCurrencyTotals, paidCurrencyTotals);
    return {
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      orderCount: item.orderIds.size,
      approvedCurrencyTotals,
      pendingPaymentCurrencyTotals,
      paidCurrencyTotals,
      approvedAmountCny: approvedCurrencyTotals.cnyActual,
      pendingPaymentAmountCny: pendingPaymentCurrencyTotals.cnyActual,
      paidAmountCny: paidCurrencyTotals.cnyActual,
    };
  });
}

function groupLogisticsStatementRowsByShipment(rows: LogisticsStatementExpenseRow[] = []): ShipmentStatementRow[] {
  const groups = new Map<string, ShipmentStatementRow>();
  for (const row of rows) {
    const shipmentKey = [row.supplierId, row.orderId].join("::");
    if (!groups.has(shipmentKey)) {
      groups.set(shipmentKey, {
        supplierId: row.supplierId,
        supplierName: row.supplierNameSnapshot || row.supplier?.supplierName || "",
        orderId: row.orderId,
        approvedRows: [],
        paidRows: [],
      });
    }
    const shipment = groups.get(shipmentKey)!;
    shipment.approvedRows.push({ currency: row.currency, amount: row.amount, amountCny: row.amountCny });
    const paidRow = logisticsPaymentLedgerRow(row);
    if (paidRow) shipment.paidRows.push(paidRow);
  }
  return [...groups.values()];
}

function logisticsPaymentLedgerRow(row: LogisticsStatementExpenseRow): CurrencyTotalInput | null {
  const cost = row.cost;
  if (!cost || cost.deletedAt || !cost.paymentDate) return null;
  return { currency: cost.currency, amount: cost.amount, amountCny: cost.amountCny };
}

function subtractCurrencyTotals(
  payable: ReturnType<typeof summarizeCurrencyTotals>,
  paid: ReturnType<typeof summarizeCurrencyTotals>,
) {
  const rows: CurrencyTotalInput[] = [
    { currency: "CNY", amount: payable.cnyActual, amountCny: payable.cnyActual },
    ...payable.foreignTotals.map((item) => ({ currency: item.currency, amount: item.amount, amountCny: 0 })),
    { currency: "CNY", amount: -paid.cnyActual, amountCny: -paid.cnyActual },
    ...paid.foreignTotals.map((item) => ({ currency: item.currency, amount: -item.amount, amountCny: 0 })),
  ];
  return summarizeCurrencyTotals(rows);
}
