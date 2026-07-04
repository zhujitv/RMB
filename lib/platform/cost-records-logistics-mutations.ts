import { prisma } from "../prisma";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { includeCostRelations } from "./cost-records-shared";
import { assertOrderOpen, canAccessOrder } from "./order-access";
import {
  assertWrite,
  isLogisticsCostType,
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
  const cost = id
    ? await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() })
    : await prisma.orderCost.create({ data, include: includeCostRelations() });
  await runNonCriticalTask("物流费用发票状态同步", () => syncCostInvoiceStatus(cost.id));
  await runNonCriticalTask("物流费用操作日志写入", () => writeAudit(request, currentActor, id ? "修改物流费用" : "新增物流费用", "order_costs", cost.id, before, cost));
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
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: currentActor.id },
  });
  await runNonCriticalTask("物流费用删除操作日志写入", () => writeAudit(request, currentActor, "删除物流费用", "order_costs", id, before, cost));
}
