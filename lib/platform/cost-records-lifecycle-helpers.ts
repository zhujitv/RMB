import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { ORDER_COST_STATUS_ACTIVE, ORDER_COST_STATUS_VOID, codedError, isLogisticsGeneratedCostSourceType, nonEmpty, permissionError } from "./shared";
import { serializeCostOrderSummary } from "./cost-records-shared";
import { isCostEntryActor, isOwnCostScope, isPaidCost, isVoidedCost, type CostActor, type CostLifecycleReasonInput, type CostWithOrder, type DeletedCostAction } from "./cost-records-mutation-core";

type CostDeletionCandidate = {
  sourceType?: string | null; paymentStatus?: string | null; costConfirmed?: boolean | null; paid?: boolean | null;
  paidAt?: Date | string | null; paymentDate?: Date | string | null; paymentVoucherUrl?: string | null;
  paymentVoucherFileName?: string | null; paymentVoucherStorageKey?: string | null; status?: string | null;
  documents?: Array<{ uploadStatus?: string | null; deletedAt?: Date | string | null; factoryDocumentRequestId?: string | null }> | null;
  supplierDocumentRequests?: Array<{ id?: string | null; deletedAt?: Date | string | null }> | null;
  generatedLogisticsExpense?: unknown;
  order?: { taxArchived?: boolean | null; taxRefundStatus?: string | null; taxRefundArchivedAt?: Date | string | null;
    commissionStatus?: string | null; commissionSettlementRecords?: Array<{ id?: string | null }> | null } | null;
};

export function costDeleteBlockReasons(cost: CostDeletionCandidate) {
  const reasons: string[] = [];
  if (isVoidedCost(cost)) reasons.push("成本已作废或已删除");
  if (nonEmpty(cost.paymentStatus) !== "待支付") reasons.push("付款状态不是待支付");
  if (cost.paid || cost.paidAt || cost.paymentDate || isPaidCost(cost)) reasons.push("已存在付款记录");
  if (cost.paymentVoucherStorageKey || cost.paymentVoucherUrl || cost.paymentVoucherFileName) reasons.push("已存在付款凭证");
  if ((cost.documents || []).some((doc) => !doc.deletedAt && (doc.uploadStatus === "SUCCESS" || doc.factoryDocumentRequestId))) reasons.push("已存在成本附件或发票资料");
  const order = cost.order;
  const taxStatus = nonEmpty(order?.taxRefundStatus);
  if (order && (order.taxArchived || order.taxRefundArchivedAt || (taxStatus && taxStatus !== "NOT_READY"))) reasons.push("订单已进入退税流程");
  if ((cost.supplierDocumentRequests || []).some((request) => !request.deletedAt)) reasons.push("已关联资料回传任务");
  if (order && (["已结算", "SETTLED"].includes(nonEmpty(order.commissionStatus)) || order.commissionSettlementRecords?.length)) reasons.push("已关联利润或提成结算");
  if (cost.costConfirmed) reasons.push("成本已确认");
  if (isLogisticsGeneratedCostSourceType(cost.sourceType) || cost.generatedLogisticsExpense) reasons.push("物流费用同步成本不能在成本管理物理删除");
  return [...new Set(reasons)];
}

export function canPhysicallyDeleteCost(cost: CostDeletionCandidate) { return costDeleteBlockReasons(cost).length === 0; }
export function requireCostLifecycleReason(input: CostLifecycleReasonInput | null | undefined, fallbackLabel = "原因") {
  const reason = nonEmpty(input?.reason || input?.voidReason || input?.deleteReason || input?.restoreReason);
  if (!reason) throw codedError(`${fallbackLabel}不能为空`, 400, "COST_LIFECYCLE_REASON_REQUIRED");
  return reason;
}
export function activeOrderCostWhere(): Prisma.OrderCostWhereInput { return { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } }; }
export function restoreOrderCostData(actor: CostActor, reason: string): Prisma.OrderCostUncheckedUpdateInput {
  return { status: ORDER_COST_STATUS_ACTIVE, voidedAt: null, voidedById: null, voidReason: null,
    restoredAt: new Date(), restoredById: actor.id, restoreReason: reason, updatedById: actor.id };
}
export function assertCanDeleteCost(actor: CostActor, cost: { createdById?: string | null; paymentStatus?: string | null; costConfirmed?: boolean | null }) {
  if (actor.role === "管理员") return;
  const ownCost = cost.createdById === actor.id;
  if (isCostEntryActor(actor)) {
    if (!ownCost) throw permissionError("只能删除自己录入的成本记录");
    if (cost.costConfirmed || isPaidCost(cost)) throw permissionError("已确认或已付款的成本不能删除，请联系管理员处理。");
    return;
  }
  if (actor.role === "业务员") {
    if (!ownCost) throw permissionError("只能删除自己录入的成本记录");
    if (cost.costConfirmed) throw permissionError("普通业务员不可删除已确认成本");
    if (isPaidCost(cost)) throw permissionError("已付款成本不能删除，请联系管理员处理。");
    return;
  }
  throw permissionError("当前角色无权限删除成本明细");
}

export async function costOrderSummaryForMutation(orderId: string, actor: CostActor) {
  const order = await prisma.receivableOrder.findFirst({ where: { id: orderId, deletedAt: null }, include: {
    customer: true, costs: { where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID },
      ...(isOwnCostScope(actor) ? { createdById: actor.id } : {}) }, include: {
      supplier: true, generatedLogisticsExpense: { select: { id: true } },
      supplierDocumentRequests: { where: { deletedAt: null }, select: { id: true, deletedAt: true }, take: 1 },
      documents: { where: { deletedAt: null }, include: { uploadedBy: true, supplier: true },
        orderBy: [{ documentType: "asc" }, { createdAt: "desc" }] },
    }, orderBy: [{ createdAt: "desc" }] },
  } });
  return order ? serializeCostOrderSummary(order) : null;
}

export function deletionAuditPayload(action: DeletedCostAction, actor: CostActor,
  cost: CostWithOrder & { supplier?: { supplierName?: string | null } | null }, deletedAt: Date) {
  return { action, deletedById: actor.id, deletedAt, orderNo: cost.order.orderNo, costType: cost.costType,
    supplier: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName,
    amount: Number(cost.amount), currency: cost.currency, amountCny: Number(cost.amountCny) };
}
