import type { Prisma } from "../generated/prisma/client.js";
import type { SalesExecutionActor } from "./sales-execution-access";
import { requireSalesExecutionActorId } from "./sales-execution-access";
import { loadSalesExecution } from "./sales-execution-query-service";
import { salesExecutionSnapshot } from "./sales-execution-values";

export async function appendSalesExecutionVersion(
  client: Prisma.TransactionClient,
  executionId: string,
  actor: SalesExecutionActor,
) {
  const execution = await loadSalesExecution(executionId, actor, client);
  return client.salesExecutionVersion.create({
    data: {
      executionId,
      versionNumber: execution.currentVersionNumber,
      snapshot: salesExecutionSnapshot(execution),
      createdById: requireSalesExecutionActorId(actor),
    },
  });
}
