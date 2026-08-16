import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";

type QuantityValue = Prisma.Decimal | { toString(): string } | string | number;

export type DeliveryQuantityCoverageExecution = {
  items: Array<{ id: string; quantity: QuantityValue }>;
  purchaseOrders: Array<{
    id: string;
    status?: string;
    items: Array<{
      id: string;
      executionItemId: string;
      allocatedQuantity: QuantityValue;
    }>;
    deliveryQuantityVariances: Array<{
      items: Array<{
        purchaseOrderItemId: string;
        proposedQuantity: QuantityValue;
      }>;
    }>;
  }>;
};

type CandidateVarianceItem = {
  purchaseOrderItemId: string;
  proposedQuantity: QuantityValue;
};

export function deliveryQuantityCoverageShortages(
  execution: DeliveryQuantityCoverageExecution,
  targetPurchaseOrderId: string,
  candidateItems: CandidateVarianceItem[],
) {
  const candidateByItem = new Map(candidateItems.map((item) => [
    item.purchaseOrderItemId,
    new Prisma.Decimal(item.proposedQuantity.toString()),
  ]));
  const deliveredByExecutionItem = new Map<string, Prisma.Decimal>();
  for (const purchaseOrder of execution.purchaseOrders) {
    if (["REJECTED", "VOIDED"].includes(purchaseOrder.status || "")) continue;
    const approvedByItem = new Map(
      (purchaseOrder.deliveryQuantityVariances[0]?.items || []).map((item) => [
        item.purchaseOrderItemId,
        new Prisma.Decimal(item.proposedQuantity.toString()),
      ]),
    );
    for (const item of purchaseOrder.items) {
      const quantity = purchaseOrder.id === targetPurchaseOrderId
        ? candidateByItem.get(item.id)
        : approvedByItem.get(item.id)
          || new Prisma.Decimal(item.allocatedQuantity.toString());
      if (!quantity) return execution.items.map((executionItem) => executionItem.id);
      deliveredByExecutionItem.set(
        item.executionItemId,
        (deliveredByExecutionItem.get(item.executionItemId) || new Prisma.Decimal(0)).add(quantity),
      );
    }
  }
  return execution.items.flatMap((item) => {
    const delivered = deliveredByExecutionItem.get(item.id) || new Prisma.Decimal(0);
    return delivered.lt(new Prisma.Decimal(item.quantity.toString())) ? [item.id] : [];
  });
}

export async function lockDeliveryQuantityVarianceApprovalScope(
  tx: Prisma.TransactionClient,
  executionId: string,
) {
  const executionRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "sales_executions" WHERE "id" = ${executionId} FOR UPDATE
  `;
  if (!executionRows.length) {
    throw codedError("销售执行单不存在或无权访问", 404, "SALES_EXECUTION_NOT_FOUND");
  }
  await tx.$queryRaw`
    SELECT "id"
    FROM "factory_purchase_orders"
    WHERE "execution_id" = ${executionId}
      AND "status" NOT IN ('REJECTED', 'VOIDED')
    ORDER BY "id"
    FOR UPDATE
  `;
}

export async function assertDeliveryQuantityApprovalPreservesSalesCoverage(
  tx: Prisma.TransactionClient,
  executionId: string,
  targetPurchaseOrderId: string,
  candidateItems: CandidateVarianceItem[],
) {
  const execution = await tx.salesExecution.findUnique({
    where: { id: executionId },
    select: {
      items: { select: { id: true, quantity: true } },
      purchaseOrders: {
        where: { status: { notIn: ["REJECTED", "VOIDED"] } },
        select: {
          id: true,
          status: true,
          items: { select: { id: true, executionItemId: true, allocatedQuantity: true } },
          deliveryQuantityVariances: {
            where: { status: "APPROVED" },
            orderBy: [{ sequenceNo: "desc" }],
            take: 1,
            select: {
              items: { select: { purchaseOrderItemId: true, proposedQuantity: true } },
            },
          },
        },
      },
    },
  });
  if (!execution) {
    throw codedError("销售执行单不存在或无权访问", 404, "SALES_EXECUTION_NOT_FOUND");
  }
  const shortages = deliveryQuantityCoverageShortages(
    execution,
    targetPurchaseOrderId,
    candidateItems,
  );
  if (shortages.length) {
    throw codedError(
      "批准后客户订单数量将不足，请先由其它工厂申请并获批补足数量",
      409,
      "FACTORY_DELIVERY_QUANTITY_VARIANCE_EXECUTION_SHORT",
    );
  }
}
