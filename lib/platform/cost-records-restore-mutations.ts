import { prisma } from "../prisma";
import { canAccessOrder } from "./order-access";
import { assertBusinessOrderWritableInTransaction, isBusinessArchived } from "./business-archive";
import { assertCommissionOrderWritableInTransaction, isCommissionSettled } from "./commission-settlement-lock";
import { includeCostRelations } from "./cost-records-shared";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { ORDER_COST_STATUS_VOID, assertJsonObject, assertWrite, codedError, isLogisticsGeneratedCostSourceType,
  permissionError, safeSerializeCost, scheduleTaxRefundCompletenessRefresh, writeAudit } from "./shared";
import { costOrderSummaryForMutation, isVoidedCost, requireCostActor, requireCostLifecycleReason, restoreOrderCostData,
  type AuditRequestLike, type CostActorInput, type CostLifecycleReasonInput } from "./cost-records-mutation-shared";
import { assertCostCanBeManagedInCostModule, isFactoryPurchaseSettlementCost } from "./cost-records-module-guard";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

function scheduleRefresh(orderId: string) {
  scheduleTaxRefundCompletenessRefresh(orderId, "成本生命周期变更后退税完整度刷新");
  invalidateWorkbenchTodosCache();
}

export async function restoreCost(request: AuditRequestLike, actor: CostActorInput, id: string, input: CostLifecycleReasonInput = {}) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  if (currentActor.role !== "管理员") throw permissionError("只有管理员可以恢复已作废成本。", 403);
  const reason = requireCostLifecycleReason(input, "恢复原因");
  const before = await prisma.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
  if (!before || before.deletedAt) throw permissionError("成本记录不存在或已删除", 404);
  assertCostCanBeManagedInCostModule(before, "恢复");
  if (!canAccessOrder(currentActor, before.order)) throw permissionError("无权限恢复该成本记录");
  if (!isVoidedCost(before)) throw codedError("该成本不是作废状态，无需恢复。", 400, "COST_NOT_VOID");
  const updated = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(tx, before.orderId, "该订单已提交退税并归档，不能恢复成本。");
    await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    const restored = await tx.orderCost.updateMany({ where: { id, updatedAt: before.updatedAt, deletedAt: null,
      status: ORDER_COST_STATUS_VOID }, data: { ...restoreOrderCostData(currentActor, reason),
      ...(before.paymentStatus === "已取消" ? { paymentStatus: "待支付" } : {}) } });
    if (restored.count !== 1) throw codedError("成本记录已被其他操作修改，恢复已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    const current = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
    if (!current) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    await writeAudit(request, currentActor, "恢复作废成本", "order_costs", id, before,
      { costId: id, orderNo: before.order.orderNo, reason, restoredById: currentActor.id, restoredAt: current.restoredAt }, tx);
    return current;
  });
  scheduleRefresh(updated.orderId);
  return { action: "restored", cost: safeSerializeCost(await attachBusinessDocumentsToCost(updated)),
    orderSummary: await costOrderSummaryForMutation(updated.orderId, currentActor) };
}

export async function batchVoidCosts(request: AuditRequestLike, actor: CostActorInput, input: unknown) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  if (currentActor.role !== "管理员") throw permissionError("只有管理员可以批量作废成本。", 403);
  const body = assertJsonObject(input);
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((id) => String(id || "").trim()).filter(Boolean))] : [];
  if (!ids.length) throw codedError("请选择需要作废的成本记录。", 400, "COST_BATCH_VOID_EMPTY");
  const reason = requireCostLifecycleReason(body, "作废原因");
  const rows = await prisma.orderCost.findMany({ where: { id: { in: ids }, deletedAt: null }, include: {
    ...includeCostRelations(), generatedLogisticsExpense: true,
    supplierDocumentRequests: { where: { deletedAt: null }, select: { id: true, deletedAt: true }, take: 1 },
    order: { include: { customer: true, businessEntity: true, salesperson: true,
      commissionSettlementRecords: { where: { status: "ACTIVE", reversedAt: null },
        select: { id: true, status: true, reversedAt: true }, take: 1 } } },
  }, take: Math.min(ids.length, 500) });
  const voidedCosts: unknown[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    if (!canAccessOrder(currentActor, row.order)) { skipped.push({ id: row.id, reason: "无权限" }); continue; }
    if (isVoidedCost(row)) { skipped.push({ id: row.id, reason: "已作废" }); continue; }
    if (isFactoryPurchaseSettlementCost(row)) { skipped.push({ id: row.id, reason: "采购结算生成成本请到采购执行模块的结算与付款中操作" }); continue; }
    if (isLogisticsGeneratedCostSourceType(row.sourceType) || row.generatedLogisticsExpense) { skipped.push({ id: row.id, reason: "物流费用同步成本请到物流费用模块操作" }); continue; }
    if (isCommissionSettled(row.order)) { skipped.push({ id: row.id, reason: "业务员提成已结算" }); continue; }
    if (isBusinessArchived(row.order)) { skipped.push({ id: row.id, reason: "订单已提交退税并归档" }); continue; }
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        await assertBusinessOrderWritableInTransaction(tx, row.orderId, "该订单已提交退税并归档，不能批量作废成本。");
        await assertCommissionOrderWritableInTransaction(tx, row.orderId);
        const changed = await tx.orderCost.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID } }, data: { status: ORDER_COST_STATUS_VOID, voidedAt: new Date(),
          voidedById: currentActor.id, voidReason: reason, updatedById: currentActor.id } });
        if (changed.count !== 1) throw codedError("成本记录已被其他操作修改，批量作废已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
        const current = await tx.orderCost.findUnique({ where: { id: row.id }, include: includeCostRelations() });
        if (!current) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
        await writeAudit(request, currentActor, "批量作废成本", "order_costs", row.id, row,
          { costId: row.id, orderNo: row.order.orderNo, reason, voidedById: currentActor.id, voidedAt: current.voidedAt }, tx);
        return current;
      });
    } catch (error: unknown) {
      if (String((error as { code?: string })?.code || "") === "COMMISSION_SETTLEMENT_LOCKED") {
        skipped.push({ id: row.id, reason: "业务员提成已结算" }); continue;
      }
      throw error;
    }
    voidedCosts.push(updated); scheduleRefresh(updated.orderId);
  }
  ids.filter((id) => !rows.some((row) => row.id === id)).forEach((id) => skipped.push({ id, reason: "成本不存在或已删除" }));
  return { voidedCount: voidedCosts.length, skippedCount: skipped.length, skipped, costs: voidedCosts.map(safeSerializeCost) };
}
