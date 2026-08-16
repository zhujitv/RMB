import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { lockSalesExecution } from "./sales-execution-access";

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

/** Global lock order for every container-loading mutation. */
export async function lockContainerLoadingScope(
  tx: Prisma.TransactionClient,
  executionId: string,
  containerLoadId: string,
  purchaseOrderIds: string[],
) {
  await lockSalesExecution(tx, executionId);
  const containers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "sales_execution_container_loads"
    WHERE "id" = ${containerLoadId} AND "execution_id" = ${executionId}
    FOR UPDATE
  `);
  if (!containers.length) {
    throw codedError("集装箱不存在或无权访问", 404, "CONTAINER_LOAD_NOT_FOUND");
  }
  // The caller may have inspected a DRAFT before waiting on the execution
  // lock. Re-read its allocations after the container row is locked so an
  // intervening draft edit cannot leave a newly-added PO unlocked.
  const currentAllocations = await tx.containerLoadAllocation.findMany({
    where: { containerLoadId, executionId },
    select: { purchaseOrderId: true },
  });
  const poIds = uniqueSorted([
    ...purchaseOrderIds,
    ...currentAllocations.map((allocation) => allocation.purchaseOrderId),
  ]);
  if (poIds.length) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "factory_purchase_orders"
      WHERE "execution_id" = ${executionId}
        AND "id" IN (${Prisma.join(poIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "factory_purchase_order_loading_results"
    WHERE "container_load_id" = ${containerLoadId}
    ORDER BY "id"
    FOR UPDATE
  `);
}

export async function lockAllExecutionContainerLoading(
  tx: Prisma.TransactionClient,
  executionId: string,
) {
  await lockSalesExecution(tx, executionId);
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "sales_execution_container_loads"
    WHERE "execution_id" = ${executionId}
    ORDER BY "id"
    FOR UPDATE
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "factory_purchase_orders"
    WHERE "execution_id" = ${executionId}
    ORDER BY "id"
    FOR UPDATE
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT result."id"
    FROM "factory_purchase_order_loading_results" result
    WHERE result."execution_id" = ${executionId}
    ORDER BY result."id"
    FOR UPDATE
  `);
}
