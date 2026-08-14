import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertRead, assertWrite, canWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import { pageParams, pageResult } from "./shared-permission-data";
import {
  PRODUCT_SUPPLIER_OPERATOR_ROLES,
  PRODUCT_SUPPLIER_TYPES,
} from "./shared-party-constants";
import {
  serializeSupplierPurchaseOrder,
  type SupplierPurchaseOrderPublicRow,
} from "./supplier-purchase-orders-values";
import { applyFactoryPurchaseOrderResponse } from "./factory-purchase-order-response-core";
import {
  supplierPurchaseOrderPublicSelect,
  supplierPurchaseOrderScope,
  type SelectedSupplierPurchaseOrder,
  visibleSupplierPurchaseOrderStatus,
} from "./supplier-purchase-orders-query";
export type SupplierPurchaseOrderActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type QueryLike = Pick<URLSearchParams, "get">;
type AuditRequest = Parameters<typeof writeAudit>[0];
function publicDto(row: SelectedSupplierPurchaseOrder) {
  return serializeSupplierPurchaseOrder(row as SupplierPurchaseOrderPublicRow);
}

export async function assertActiveSupplierPurchaseOrderActor(
  tx: Prisma.TransactionClient,
  actorId: string,
  supplierId: string,
) {
  // Keep account and supplier eligibility stable until the purchase-order
  // response commits. Otherwise an administrator could disable/rebind the
  // account after this check while the stale request still succeeds.
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${actorId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "suppliers" WHERE "id" = ${supplierId} FOR SHARE`;
  const validActor = await tx.user.findFirst({
    where: {
      id: actorId,
      supplierId,
      role: { in: [...PRODUCT_SUPPLIER_OPERATOR_ROLES] },
      isActive: true, approvalStatus: "APPROVED", emailVerified: true,
      mustChangePassword: false, passwordPolicyPassed: true, deletedAt: null,
      supplierOperator: {
        is: {
          id: supplierId,
          deletedAt: null,
          status: "启用",
          supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
          allowFactoryDocumentUpload: true,
        },
      },
    },
    select: { id: true, name: true, role: true, customPermissions: true },
  });
  if (!validActor || !canWrite(validActor, "supplierPurchaseOrders")) {
    throw codedError("供应商账号已失效或绑定信息已变更", 403, "SUPPLIER_ACCOUNT_NOT_ACTIVE");
  }
  return validActor;
}
export async function listSupplierPurchaseOrders(query: QueryLike | null | undefined, actor: SupplierPurchaseOrderActor) {
  assertRead(actor, "supplierPurchaseOrders");
  const scope = supplierPurchaseOrderScope(actor);
  const { page, pageSize } = pageParams(query, 20, 50);
  const keyword = nonEmpty(query?.get("keyword") || query?.get("q"));
  const status = visibleSupplierPurchaseOrderStatus(query?.get("status"));
  const where: Prisma.FactoryPurchaseOrderWhereInput = {
    ...scope,
    ...(keyword ? {
      OR: [
        { poNo: { contains: keyword, mode: "insensitive" } },
        { execution: { is: { customerOrderNo: { contains: keyword, mode: "insensitive" } } } },
      ],
    } : {}),
    ...(status ? { status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.factoryPurchaseOrder.count({ where }),
    prisma.factoryPurchaseOrder.findMany({
      where,
      select: supplierPurchaseOrderPublicSelect,
      orderBy: [{ dispatchedAt: "desc" }, { poNo: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return pageResult(rows.map(publicDto), total, page, pageSize);
}
async function findSupplierPurchaseOrder(
  id: string,
  actor: SupplierPurchaseOrderActor,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return client.factoryPurchaseOrder.findFirst({
    where: { id: nonEmpty(id), ...supplierPurchaseOrderScope(actor) },
    select: supplierPurchaseOrderPublicSelect,
  });
}
export async function getSupplierPurchaseOrder(id: string, actor: SupplierPurchaseOrderActor) {
  assertRead(actor, "supplierPurchaseOrders");
  const row = await findSupplierPurchaseOrder(id, actor);
  if (!row) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
  return publicDto(row);
}
export async function respondToSupplierPurchaseOrder(
  request: AuditRequest,
  actor: SupplierPurchaseOrderActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "supplierPurchaseOrders");
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  const supplierId = nonEmpty(actor?.supplierId);
  if (!supplierId) throw codedError("供应商账号未绑定工厂", 403, "SUPPLIER_ACCOUNT_NOT_BOUND");

  try {
    return await prisma.$transaction(async (tx) => {
      const validActor = await assertActiveSupplierPurchaseOrderActor(tx, actorId, supplierId);
      const scoped = await findSupplierPurchaseOrder(id, actor, tx);
      if (!scoped) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findSupplierPurchaseOrder(scoped.id, actor, tx);
      if (!before) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      await applyFactoryPurchaseOrderResponse({
        tx,
        before,
        supplierId,
        actorId,
        rawInput: input,
        attribution: {
          source: "SUPPLIER_PORTAL",
          channel: "PORTAL",
          supplierContact: validActor.name.trim().slice(0, 100) || "供应商账号",
        },
      });
      const saved = await findSupplierPurchaseOrder(before.id, actor, tx);
      if (!saved) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      const beforeDto = publicDto(before);
      const savedDto = publicDto(saved);
      await writeAudit(
        request,
        { id: actorId },
        "供应商回复工厂采购单",
        "factory_purchase_orders",
        before.id,
        beforeDto,
        savedDto,
        tx,
      );
      return savedDto;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
    }
    throw error;
  }
}
