import { Prisma } from "../generated/prisma/client.js";
import {
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";

export const settlementPurchaseOrderSelect = Prisma.validator<Prisma.FactoryPurchaseOrderSelect>()({
  id: true,
  executionId: true,
  revision: true,
  poNo: true,
  supplierId: true,
  supplierNameSnapshot: true,
  status: true,
  purchaseCurrency: true,
  initialSupplierDeliveryDate: true,
  actualDeliveryDate: true,
  penaltyBaseAmount: true,
  delayGraceDays: true,
  delayPenaltyRatePerDay: true,
  delayPenaltyCapRatio: true,
  productionStatus: true,
  productionCompletedAt: true,
  settlement: true,
  payments: {
    where: { status: "CONFIRMED" },
    orderBy: [{ sequenceNo: "asc" }],
    select: { id: true, kind: true, amount: true, paidAt: true, status: true },
  },
  adjustments: {
    where: { status: { in: ["PROVISIONAL", "CONFIRMED"] } },
    orderBy: [{ sequenceNo: "asc" }],
    select: {
      id: true,
      sequenceNo: true,
      kind: true,
      direction: true,
      amount: true,
      currency: true,
      description: true,
      occurredAt: true,
      status: true,
      sourceType: true,
      sourceId: true,
      revision: true,
      confirmedById: true,
      confirmedAt: true,
    },
  },
  execution: {
    select: {
      id: true,
      shippingStartedAt: true,
      receivableOrder: { select: { id: true, deletedAt: true } },
    },
  },
});

export type SettlementPurchaseOrder = Prisma.FactoryPurchaseOrderGetPayload<{
  select: typeof settlementPurchaseOrderSelect;
}>;

export function loadPurchaseOrderForSettlement(
  tx: Prisma.TransactionClient,
  executionId: string,
  purchaseOrderId: string,
  actor: SalesExecutionActor,
) {
  return tx.factoryPurchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      executionId,
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    select: settlementPurchaseOrderSelect,
  });
}
