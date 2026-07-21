import { prisma } from "../prisma";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { includeCostRelations } from "./cost-records-shared";
import { assertOrderOpen, canAccessOrder } from "./order-access";
import {
  assertWrite,
  codedError,
  isLogisticsCostType,
  ORDER_COST_STATUS_VOID,
  permissionError,
  requireText,
  runNonCriticalTask,
  safeSerializeCost,
  syncCostInvoiceStatus,
  validCost,
  writeAudit,
} from "./shared";
import {
  buildLogisticsCostData,
  requireCostActor,
  type AuditRequestLike,
  type CostActorInput,
  type CostInput,
} from "./cost-records-mutation-shared";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

export async function saveLogisticsCost(request: AuditRequestLike, actor: CostActorInput, input: CostInput, id: string | null = null) {
  assertWrite(actor, "logistics");
  const currentActor = requireCostActor(actor);
  const order = await assertOrderOpen(requireText(input.orderId || input.order_id, "关联订单"), currentActor);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt || !validCost(before) || !isLogisticsCostType(before.costType))) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (before && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限修改该物流费用");
  const data = await buildLogisticsCostData(order, currentActor, input, id, before);
  const cost = await prisma.$transaction(async (tx) => {
    const affectedOrderIds = [...new Set([order.id, before?.orderId].filter((value): value is string => Boolean(value)))].sort();
    for (const affectedOrderId of affectedOrderIds) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        affectedOrderId,
        "该订单已提交退税并归档，不能修改物流成本。",
      );
      await assertCommissionOrderWritableInTransaction(tx, affectedOrderId);
    }
    let saved;
    if (id && before) {
      const changed = await tx.orderCost.updateMany({
        where: {
          id,
          updatedAt: before.updatedAt,
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
        },
        data,
      });
      if (changed.count !== 1) {
        throw codedError("物流费用记录已被其他操作修改，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
      }
      saved = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
      if (!saved) throw codedError("物流费用记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    } else {
      saved = await tx.orderCost.create({ data, include: includeCostRelations() });
    }
    await writeAudit(
      request,
      currentActor,
      id ? "修改物流费用" : "新增物流费用",
      "order_costs",
      saved.id,
      before,
      saved,
      tx,
    );
    return saved;
  });
  await runNonCriticalTask("物流费用发票状态同步", () => syncCostInvoiceStatus(cost.id));
  return safeSerializeCost(await attachBusinessDocumentsToCost(cost));
}

export async function deleteLogisticsCost(request: AuditRequestLike, actor: CostActorInput, id: string) {
  assertWrite(actor, "logistics");
  const currentActor = requireCostActor(actor);
  const before = await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt || !isLogisticsCostType(before.costType)) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (!canAccessOrder(currentActor, before.order)) throw permissionError("无权限删除该物流费用");
  await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      before.orderId,
      "该订单已提交退税并归档，不能删除物流成本。",
    );
    await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    const changed = await tx.orderCost.updateMany({
      where: {
        id,
        updatedAt: before.updatedAt,
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
      },
      data: { deletedAt: new Date(), updatedById: currentActor.id },
    });
    if (changed.count !== 1) {
      throw codedError("物流费用记录已被其他操作修改，删除已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    }
    const current = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
    if (!current) throw codedError("物流费用记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    await writeAudit(request, currentActor, "删除物流费用", "order_costs", id, before, current, tx);
    return current;
  });
}
