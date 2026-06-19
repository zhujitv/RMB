// @ts-nocheck
import { prisma } from "../prisma";
import {
  canRead,
  canWrite,
  codedError,
  effectivePermissions,
  nonEmpty,
  permissionError,
  requireText,
} from "./shared";

export function validateDuplicateOrder(orderNo, id = null) {
  return prisma.receivableOrder.findFirst({
    where: {
      orderNo: { equals: orderNo, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
}

export function orderAccessWhere(actor) {
  if (!canRead(actor, "orders")) return { id: "__no_order_access__" };
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return {};
  if (scope === "OWN") return { customer: { is: { salespersonUserId: actor.id } } };
  if (scope === "OWN_COST") {
    return { costs: { some: { createdById: actor.id, deletedAt: null } } };
  }
  return { id: "__no_order_access__" };
}

export function scopeOrderForActor(order, actor) {
  if (effectivePermissions(actor).dataScope !== "OWN_COST" || !order) return order;
  return {
    ...order,
    payments: [],
    costs: (order.costs || []).filter((cost) => !cost.deletedAt && cost.createdById === actor.id),
    documents: (order.documents || []).filter((document) => (
      document.relatedModule === "SUPPLIER"
      && (document.cost?.createdById === actor.id || (order.costs || []).some((cost) => cost.id === document.costId && cost.createdById === actor.id))
    )),
  };
}

export function canAccessOrder(actor, order) {
  if (!canRead(actor, "orders")) return false;
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return order?.customer?.salespersonUserId === actor.id;
  if (scope === "OWN_COST") {
    return (order.costs || []).some((cost) => !cost.deletedAt && cost.createdById === actor.id);
  }
  return false;
}

export async function assertOrderOpen(orderId, actor) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { customer: true, costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } } },
  });
  if (!order) {
    const error = new Error("请选择有效应收订单");
    error.status = 400;
    throw error;
  }
  if (!canAccessOrder(actor, order)) {
    const error = new Error("无权限访问该应收订单");
    error.status = 403;
    throw error;
  }
  if (["已关闭", "已取消"].includes(order.status) && actor.role !== "管理员") {
    const error = new Error("已关闭或已取消订单不能继续新增收款或成本");
    error.status = 400;
    throw error;
  }
  return order;
}

export async function assertCostWritableOrder(orderId, actor, before = null) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { customer: true },
  });
  if (!order) {
    throw codedError("请选择有效应收订单", 404, "ORDER_NOT_FOUND");
  }
  if (["已关闭", "已取消"].includes(order.status) && actor.role !== "管理员") {
    const error = new Error("已关闭或已取消订单不能继续新增收款或成本");
    error.status = 400;
    throw error;
  }
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "OWN_COST") {
    if (!canWrite(actor, "costs")) throw permissionError("没有权限执行该操作");
    if (before) {
      if (before.createdById !== actor.id) throw permissionError("只能维护自己录入的成本记录");
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

export async function assertOrderCanReceivePayment(order) {
  if (["已关闭", "已取消"].includes(order.status)) {
    const error = new Error("已关闭或已取消订单不能新增收款");
    error.status = 400;
    throw error;
  }
  const confirmed = await prisma.payment.aggregate({
    where: {
      orderId: order.id,
      deletedAt: null,
      status: "已到账",
    },
    _sum: { amountCny: true },
  });
  const finalReceivableCny = Number(order.finalReceivableAmountCny ?? order.receivableAmountCny);
  const outstandingCny = finalReceivableCny - Number(confirmed._sum.amountCny || 0);
  if (outstandingCny <= 0) {
    const error = new Error("订单已收齐，不能新增收款");
    error.status = 400;
    throw error;
  }
}
