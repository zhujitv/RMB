import { prisma } from "../prisma";
import { reviewFactoryPurchaseOrderPriceCorrectionBatch } from "./factory-purchase-order-price-correction-batch-review";
import type { PriceCorrectionAuditRequest } from "./factory-purchase-order-price-correction-values";
import type { SalesExecutionActor } from "./sales-execution-access";

export async function reviewPriceCorrectionAsBatchWhenNeeded(
  request: PriceCorrectionAuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  correctionId: string,
  rawInput: unknown,
) {
  const batchHint = await prisma.factoryPurchaseOrderPriceCorrection.findFirst({
    where: {
      id: correctionId,
      purchaseOrderId,
      purchaseOrder: { is: { executionId } },
    },
    select: { batchId: true, batchLineCount: true },
  });
  if (!batchHint?.batchId) return null;
  return reviewFactoryPurchaseOrderPriceCorrectionBatch(
    request,
    actor,
    executionId,
    purchaseOrderId,
    batchHint.batchId,
    rawInput,
  );
}
