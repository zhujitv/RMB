import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import type { SalesExecutionActor } from "./sales-execution-access";
import type { writeAudit } from "./shared-audit";

type AuditRequest = Parameters<typeof writeAudit>[0];

/**
 * Direct PO delivery entry is intentionally retired. A PO may span containers
 * and one container may include several suppliers, so only the released
 * container ledger can authoritatively materialize PO actual quantities.
 */
export async function recordFactoryPurchaseOrderActualDelivery(
  _request: AuditRequest,
  actor: SalesExecutionActor,
  _executionId: string,
  _purchaseOrderId: string,
  _rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  throw codedError(
    "请在集装箱装柜总账中分配采购明细、完成供应商填报并放行；不再支持直接登记单张采购单交付。",
    409,
    "FACTORY_ACTUAL_DELIVERY_CONTAINER_LEDGER_REQUIRED",
  );
}
