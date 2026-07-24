import { prisma } from "../prisma";
import { canAccessOrder } from "./order-access";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import {
  FILE_ASSET_ROLES, FILE_ASSET_SOURCE_TABLES, ORDER_COST_STATUS_VOID, assertWrite, codedError,
  permissionError, safeSerializeCost, scheduleTaxRefundCompletenessRefresh, softDeleteFileAssetBySource, writeAudit,
} from "./shared";
import {
  assertCanDeleteCost, canPhysicallyDeleteCost, costDeleteBlockReasons, costOrderSummaryForMutation,
  deletionAuditPayload, isOwnCostScope, isVoidedCost, requireCostActor, requireCostLifecycleReason,
  type AuditRequestLike, type CostActorInput, type CostLifecycleReasonInput, type DeletedCostAction,
} from "./cost-records-mutation-shared";
import { assertCostCanBeManagedInCostModule } from "./cost-records-module-guard";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

function scheduleRefresh(orderId: string) {
  scheduleTaxRefundCompletenessRefresh(orderId, "成本生命周期变更后退税完整度刷新");
  invalidateWorkbenchTodosCache();
}

export async function deleteCost(request: AuditRequestLike, actor: CostActorInput, id: string, input: CostLifecycleReasonInput = {}) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const before = await prisma.orderCost.findUnique({ where: { id }, include: {
    order: { include: { customer: true, commissionSettlementRecords: {
      where: { status: "ACTIVE", reversedAt: null }, select: { id: true, status: true, reversedAt: true }, take: 1 } } },
    supplier: true, generatedLogisticsExpense: true,
    supplierDocumentRequests: { where: { deletedAt: null }, select: { id: true, deletedAt: true }, take: 1 },
    documents: { where: { deletedAt: null } },
  } });
  if (!before || before.deletedAt) throw permissionError("成本记录不存在或已删除", 404);
  assertCostCanBeManagedInCostModule(before, "删除或作废");
  const ownScope = isOwnCostScope(currentActor);
  if (ownScope && before.createdById !== currentActor.id) throw permissionError("只能删除自己录入的成本记录");
  if (!ownScope && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限删除该成本记录");
  assertCanDeleteCost(currentActor, before);
  if (isVoidedCost(before)) throw codedError("该成本已作废，不能重复处理。", 400, "COST_ALREADY_VOID");
  const requestedAction = ["void", "delete"].includes(String(input.action || "").trim().toLowerCase())
    ? String(input.action).trim().toLowerCase() : "";
  const reason = requireCostLifecycleReason(input, requestedAction === "delete" ? "删除原因" : "作废原因");
  const canDelete = canPhysicallyDeleteCost(before);
  const blockReasons = costDeleteBlockReasons(before);
  if (requestedAction === "delete" && !canDelete) throw codedError(`当前成本不能删除，只能作废：${blockReasons.join("；")}`, 400, "COST_DELETE_NOT_ALLOWED");
  const deletedAt = new Date();
  const action: DeletedCostAction = requestedAction === "void" || !canDelete ? "voided" : "deleted";
  const auditPayload = { ...deletionAuditPayload(action, currentActor, before, deletedAt), reason, deleteBlockReasons: blockReasons };
  const cost = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(tx, before.orderId, "该订单已提交退税并归档，不能删除或作废成本。");
    await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    if (action === "deleted") {
      await softDeleteFileAssetBySource(tx, FILE_ASSET_SOURCE_TABLES.ORDER_COSTS, id, FILE_ASSET_ROLES.PAYMENT_VOUCHER, deletedAt);
      const deleted = await tx.orderCost.deleteMany({ where: { id, updatedAt: before.updatedAt, deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } } });
      if (deleted.count !== 1) throw codedError("成本记录已被其他操作修改，删除已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
      await writeAudit(request, currentActor, "删除成本明细", "order_costs", id, before, { ...auditPayload, costId: id }, tx);
      return before;
    }
    const changed = await tx.orderCost.updateMany({ where: { id, updatedAt: before.updatedAt, deletedAt: null,
      status: { not: ORDER_COST_STATUS_VOID } }, data: { status: ORDER_COST_STATUS_VOID, voidedAt: deletedAt,
      voidedById: currentActor.id, voidReason: reason, updatedById: currentActor.id } });
    if (changed.count !== 1) throw codedError("成本记录已被其他操作修改，作废已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    const updated = await tx.orderCost.findUnique({ where: { id } });
    if (!updated) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    await writeAudit(request, currentActor, "作废成本明细", "order_costs", id, before, { ...auditPayload, costId: id }, tx);
    return updated;
  });
  scheduleRefresh(before.orderId);
  return { action, cost: safeSerializeCost(cost), orderSummary: await costOrderSummaryForMutation(before.orderId, currentActor) };
}
