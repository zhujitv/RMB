import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { canAccessOrder } from "./order-access";
import { ORDER_COST_STATUS_VOID, codedError, nonEmpty, permissionError, writeAudit } from "./shared";
import { includeCostRelations } from "./cost-records-shared";
import { assertFactoryPurchaseSettlementCostCanBeManagedInCostModule, isFactoryPurchaseSettlementCost } from "./cost-records-module-guard";
import {
  assertProductSupplierPaymentCost,
  type CostActor,
} from "./cost-records-mutation-core";

export {
  assertProductSupplierPaymentCost,
  isCostEntryActor,
  isOwnCostScope,
  isPaidCost,
  isProductSupplierPaymentCost,
  isVoidedCost,
  requireCostActor,
} from "./cost-records-mutation-core";
export type {
  CostActor,
  CostActorInput,
  CostInput,
  CostLifecycleReasonInput,
  CostOrderLike,
  CostWithOrder,
  DeletedCostAction,
} from "./cost-records-mutation-core";
export {
  activeOrderCostWhere,
  assertCanDeleteCost,
  canPhysicallyDeleteCost,
  costDeleteBlockReasons,
  costOrderSummaryForMutation,
  deletionAuditPayload,
  requireCostLifecycleReason,
  restoreOrderCostData,
} from "./cost-records-lifecycle-helpers";
export { buildCostData, buildLogisticsCostData } from "./cost-records-mutation-builders";

export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type CostWithPaymentRelations = Prisma.OrderCostGetPayload<{ include: ReturnType<typeof includeCostRelations> }> & {
  paid?: boolean | null;
  paidAt?: Date | null;
  paymentVoucherUrl?: string | null;
  paymentVoucherFileName?: string | null;
  paymentVoucherMimeType?: string | null;
  paymentVoucherUploadedAt?: Date | null;
  paymentVoucherStorageKey?: string | null;
  paymentVoucherBucket?: string | null;
};

export function assertCanManageProductSupplierPayment(actor: CostActor) {
  if (actor.role === "管理员" || actor.role === "财务") return;
  throw permissionError("只有管理员或财务可以维护产品供应商货款付款信息", 403);
}

export function paymentBooleanInput(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = nonEmpty(value).toLowerCase();
  return ["true", "1", "yes", "y", "已付款", "已支付"].includes(text);
}

export function paidAtFromInput(value: unknown, fallback = new Date()) {
  const text = nonEmpty(value);
  if (!text) return fallback;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw codedError("付款时间格式错误", 400, "INVALID_PAID_AT");
  return date;
}

export function paymentVoucherFileName(extension: string) {
  return `汇款水单.${extension === "jpeg" ? "jpg" : extension}`;
}

export async function loadCostForPayment(actor: CostActor, id: string, mutationAction = ""): Promise<CostWithPaymentRelations> {
  const cost = await prisma.orderCost.findFirst({
    where: { id, deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } },
    include: includeCostRelations(),
  });
  if (!cost) throw permissionError("成本记录不存在或已删除", 404);
  if (!canAccessOrder(actor, cost.order)) throw permissionError("无权限读取该成本记录");
  if (mutationAction) assertFactoryPurchaseSettlementCostCanBeManagedInCostModule(cost, mutationAction);
  assertProductSupplierPaymentCost(cost);
  return cost as CostWithPaymentRelations;
}

export async function loadCostForPaymentVoucher(actor: CostActor, id: string) {
  // Purchase-settlement costs keep their financial fields immutable, but the
  // final payment voucher remains an independently managed piece of evidence.
  const cost = await loadCostForPayment(actor, id);
  if (isFactoryPurchaseSettlementCost(cost) && !["已支付", "待退款"].includes(cost.paymentStatus)) {
    throw codedError(
      "采购结算已结清或进入供应商退款流程后才能上传最终付款凭证。",
      409,
      "FACTORY_PURCHASE_SETTLEMENT_NOT_FULLY_PAID",
    );
  }
  return cost;
}
