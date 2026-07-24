import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { canRead, canWrite, permissionError } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { ORDER_COST_STATUS_VOID } from "./shared-cost-constants";
import { effectivePermissions } from "./shared-permission-data";
import { assertCommissionNotSettled } from "./commission-settlement-lock";
import { assertBusinessNotArchived } from "./business-archive";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;

type OrderCostLike = {
  id?: string | null;
  createdById?: string | null;
  status?: string | null;
  deletedAt?: unknown;
} & Record<string, unknown>;

type OrderDocumentLike = {
  relatedModule?: string | null;
  costId?: string | null;
  cost?: { createdById?: string | null } | null;
} & Record<string, unknown>;

type OrderLike = {
  id?: string | null;
  status?: string | null;
  salespersonUserId?: string | null;
  customer?: { salespersonUserId?: string | null } | null;
  costs?: OrderCostLike[] | null;
  documents?: OrderDocumentLike[] | null;
  payments?: unknown[] | null;
  finalReceivableAmountCny?: unknown;
  receivableAmountCny?: unknown;
} & Record<string, unknown>;

function actorId(actor: ActorLike) {
  return nonEmpty(actor?.id);
}

function actorRole(actor: ActorLike) {
  return nonEmpty(actor?.role);
}

export function orderSalespersonOwnershipWhere(currentActorId: string): Prisma.ReceivableOrderWhereInput {
  return currentActorId
    ? {
        OR: [
          { salespersonUserId: currentActorId },
          {
            AND: [
              { salespersonUserId: null },
              { customer: { is: { salespersonUserId: currentActorId } } },
            ],
          },
        ],
      }
    : { id: "__no_order_access__" };
}

export function orderOwnedBySalesperson(order: OrderLike | null | undefined, currentActorId: string) {
  if (!order || !currentActorId) return false;
  if (order.salespersonUserId) return order.salespersonUserId === currentActorId;
  return order.customer?.salespersonUserId === currentActorId;
}

export function orderAccessWhere(actor: ActorLike): Prisma.ReceivableOrderWhereInput {
  if (!canRead(actor, "orders")) return { id: "__no_order_access__" };
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return {};
  if (scope === "OWN") {
    const currentActorId = actorId(actor);
    return orderSalespersonOwnershipWhere(currentActorId);
  }
  if (scope === "OWN_COST") {
    const currentActorId = actorId(actor);
    return currentActorId ? { costs: { some: { createdById: currentActorId, deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } } } } : { id: "__no_order_access__" };
  }
  return { id: "__no_order_access__" };
}

export function scopeOrderForActor<T extends OrderLike | null | undefined>(order: T, actor: ActorLike): T {
  if (effectivePermissions(actor).dataScope !== "OWN_COST" || !order) return order;
  const currentActorId = actorId(actor);
  return {
    ...order,
    payments: [],
    commissionSettlementRecords: [],
    costs: (order.costs || []).filter((cost) => !cost.deletedAt && cost.status !== ORDER_COST_STATUS_VOID && cost.createdById === currentActorId),
    documents: (order.documents || []).filter((document) => (
      document.relatedModule === "SUPPLIER"
      && (document.cost?.createdById === currentActorId || (order.costs || []).some((cost) => cost.id === document.costId && cost.status !== ORDER_COST_STATUS_VOID && cost.createdById === currentActorId))
    )),
  } as T;
}

export function canAccessOrder(actor: ActorLike, order: OrderLike | null | undefined) {
  if (!canRead(actor, "orders")) return false;
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return orderOwnedBySalesperson(order, actorId(actor));
  if (scope === "OWN_COST") {
    const currentActorId = actorId(actor);
    return (order?.costs || []).some((cost) => !cost.deletedAt && cost.status !== ORDER_COST_STATUS_VOID && cost.createdById === currentActorId);
  }
  return false;
}

export function validateDuplicateOrder(
  orderNo: string,
  id: string | null = null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return client.receivableOrder.findFirst({
    where: {
      orderNo: { equals: orderNo, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
}

export async function assertOrderOpen(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { customer: true, costs: { where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } }, select: { createdById: true, status: true, deletedAt: true } } },
  });
  if (!order) {
    throw codedError("请选择有效应收订单", 400, "ORDER_REQUIRED");
  }
  if (!canAccessOrder(actor, order)) {
    throw codedError("无权限访问该应收订单", 403, "ORDER_PERMISSION_DENIED");
  }
  if (["已关闭", "已取消"].includes(order.status) && actorRole(actor) !== "管理员") {
    throw codedError("已关闭或已取消订单不能继续新增收款或成本", 400, "ORDER_CLOSED");
  }
  return order;
}

export async function assertCostWritableOrder(
  orderId: string,
  actor: ActorLike,
  before: { createdById?: string | null; orderId?: string | null } | null = null,
) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { customer: true },
  });
  if (!order) {
    throw codedError("请选择有效应收订单", 404, "ORDER_NOT_FOUND");
  }
  assertBusinessNotArchived(order, "该订单已提交退税并归档，不能新增或修改成本。");
  assertCommissionNotSettled(order);
  if (["已关闭", "已取消"].includes(order.status) && actorRole(actor) !== "管理员") {
    throw codedError("已关闭或已取消订单不能继续新增收款或成本", 400, "ORDER_CLOSED");
  }
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "OWN_COST") {
    if (!canWrite(actor, "costs")) throw permissionError("没有权限执行该操作");
    if (before) {
      if (before.createdById !== actorId(actor)) throw permissionError("只能维护自己录入的成本记录");
      if (before.orderId !== order.id) throw permissionError("不能转移历史成本到其他订单");
      return order;
    }
    return order;
  }
  if (!canAccessOrder(actor, { ...order, costs: [] })) {
    throw codedError("无权限访问该应收订单", 403, "PERMISSION_DENIED");
  }
  return order;
}

export async function assertOrderCanReceivePayment(order: OrderLike) {
  const orderId = nonEmpty(order.id);
  if (!orderId) throw codedError("请选择有效应收订单", 400, "ORDER_REQUIRED");
  if (["已关闭", "已取消"].includes(nonEmpty(order.status))) {
    throw codedError("已关闭或已取消订单不能新增收款", 400, "ORDER_CLOSED");
  }
}
