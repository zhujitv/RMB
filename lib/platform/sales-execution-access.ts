import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError, effectivePermissions } from "./shared";

export type SalesExecutionActor = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;

export type SalesExecutionClient = Prisma.TransactionClient | typeof prisma;

export function requireSalesExecutionActorId(actor: SalesExecutionActor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

export function salesExecutionAccessWhere(actor: SalesExecutionActor): Prisma.SalesExecutionWhereInput {
  const permissions = effectivePermissions(actor);
  if (permissions.dataScope === "ALL") return {};
  const actorId = String(actor?.id || "").trim();
  if (permissions.dataScope === "OWN" && actorId) return { salespersonUserId: actorId };
  return { id: "__no_sales_execution_access__" };
}

export async function lockSalesExecution(client: Prisma.TransactionClient, id: string) {
  const rows = await client.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "sales_executions" WHERE "id" = ${id} FOR UPDATE`,
  );
  if (!rows.length) throw codedError("销售执行单不存在", 404, "SALES_EXECUTION_NOT_FOUND");
}

export async function lockFactoryPurchaseOrders(
  client: Prisma.TransactionClient,
  executionId: string,
) {
  await client.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "factory_purchase_orders"
    WHERE "execution_id" = ${executionId}
    ORDER BY "id"
    FOR UPDATE
  `);
}

export async function lockFactoryPurchaseOrder(
  client: Prisma.TransactionClient,
  purchaseOrderId: string,
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`,
  );
  if (!rows.length) throw codedError("工厂采购单不存在", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
}

export function assertExpectedSalesExecutionRevision(
  input: Record<string, unknown>,
  currentRevision: number,
) {
  if (!Object.prototype.hasOwnProperty.call(input, "expectedRevision")) {
    throw codedError("缺少销售执行单版本，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
  }
  const expected = Number(input.expectedRevision);
  if (!Number.isSafeInteger(expected) || expected !== currentRevision) {
    throw codedError("销售执行单已被其他用户更新，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
  }
  return expected;
}

export function assertSalesExecutionDraft(status: unknown) {
  if (String(status) !== "DRAFT") {
    throw codedError("只有草稿销售执行单可以修改", 409, "SALES_EXECUTION_NOT_EDITABLE");
  }
}
