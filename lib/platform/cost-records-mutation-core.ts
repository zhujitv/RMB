import type { Prisma } from "../generated/prisma/client.js";
import {
  FACTORY_SUPPLIER_COST_TYPES,
  ORDER_COST_STATUS_VOID,
  codedError,
  effectivePermissions,
  isLogisticsCostType,
  isLogisticsGeneratedCostSourceType,
  isProductSupplierType,
  permissionError,
} from "./shared";

export type CostWithOrder = Prisma.OrderCostGetPayload<{ include: { order: { include: { customer: true } } } }>;
export type CostActorInput = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type CostActor = {
  id: string;
  role?: string;
  customPermissions?: unknown;
};
export type CostInput = Record<string, unknown>;
export type CostOrderLike = { id: string; currency?: string | null; tradeTerm?: string | null };
export type DeletedCostAction = "deleted" | "voided";
export type CostLifecycleReasonInput = {
  reason?: unknown;
  voidReason?: unknown;
  deleteReason?: unknown;
  restoreReason?: unknown;
  action?: unknown;
};

export function requireCostActor(actor: CostActorInput): CostActor {
  if (!actor?.id) throw permissionError("请先登录", 401);
  return { id: actor.id, role: actor.role || undefined, customPermissions: actor.customPermissions };
}

export function isOwnCostScope(actor: CostActor) {
  return effectivePermissions(actor).dataScope === "OWN_COST";
}

export function isCostEntryActor(actor: CostActor) {
  return isOwnCostScope(actor) || actor.role === "成本录入员";
}

export function isPaidCost(cost: { paymentStatus?: string | null }) {
  return cost.paymentStatus === "已支付" || cost.paymentStatus === "部分支付";
}

export function isVoidedCost(cost: { status?: string | null; paymentStatus?: string | null; deletedAt?: Date | string | null }) {
  return cost.status === ORDER_COST_STATUS_VOID || cost.paymentStatus === "已取消" || Boolean(cost.deletedAt);
}

export function isProductSupplierPaymentCost(cost: {
  costType?: string | null;
  sourceType?: string | null;
  supplier?: { supplierType?: string | null } | null;
}) {
  if (isLogisticsGeneratedCostSourceType(cost.sourceType) || isLogisticsCostType(cost.costType || "")) return false;
  return FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType || "") || isProductSupplierType(cost.supplier?.supplierType);
}

export function assertProductSupplierPaymentCost(cost: Parameters<typeof isProductSupplierPaymentCost>[0]) {
  if (!isProductSupplierPaymentCost(cost)) {
    throw codedError("付款信息仅适用于成本管理中的产品供应商货款。", 400, "COST_PAYMENT_SCOPE_INVALID");
  }
}
