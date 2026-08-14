import type { Prisma } from "../generated/prisma/client.js";
import { canWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import {
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";
import {
  supplierPurchaseOrderPublicSelect,
  type SelectedSupplierPurchaseOrder,
} from "./supplier-purchase-orders-query";

export type ActiveInternalConfirmationActor = {
  id: string;
  name: string;
  role: string;
  customPermissions: unknown;
};

export async function requireActiveInternalConfirmationActor(
  tx: Prisma.TransactionClient,
  actor: SalesExecutionActor,
) {
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${actorId} FOR SHARE`;
  const validActor = await tx.user.findFirst({
    where: {
      id: actorId,
      supplierId: null,
      isActive: true,
      approvalStatus: "APPROVED",
      emailVerified: true,
      mustChangePassword: false,
      passwordPolicyPassed: true,
      deletedAt: null,
    },
    select: { id: true, name: true, role: true, customPermissions: true },
  });
  if (!validActor || !canWrite(validActor, "salesExecution")) {
    throw codedError("当前账号已失效或无销售执行写入权限", 403, "SALES_EXECUTION_ACTOR_NOT_ACTIVE");
  }
  return validActor as ActiveInternalConfirmationActor;
}

export async function findInternalConfirmationPurchaseOrder(
  tx: Prisma.TransactionClient,
  actor: ActiveInternalConfirmationActor,
  executionId: string,
  purchaseOrderId: string,
): Promise<SelectedSupplierPurchaseOrder | null> {
  return tx.factoryPurchaseOrder.findFirst({
    where: {
      id: nonEmpty(purchaseOrderId),
      executionId: nonEmpty(executionId),
      dispatchedAt: { not: null },
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    select: supplierPurchaseOrderPublicSelect,
  });
}
