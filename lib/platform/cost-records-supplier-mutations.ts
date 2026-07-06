import { prisma } from "../prisma";
import {
  COST_BATCH_INPUT_SCHEMA,
  COST_INPUT_SCHEMA,
  ORDER_COST_STATUS_VOID,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  codedError,
  permissionError,
  requireText,
  runNonCriticalTask,
  safeSerializeCost,
  scheduleTaxRefundCompletenessRefresh,
  syncCostInvoiceStatus,
  writeAudit,
} from "./shared";
import { assertCostWritableOrder, canAccessOrder } from "./order-access";
import { attachBusinessDocumentsToCost, attachBusinessDocumentsToCosts } from "./business-documents";
import {
  createCostIdempotently,
  includeCostRelations,
} from "./cost-records-shared";
import {
  assertCanDeleteCost,
  buildCostData,
  canPhysicallyDeleteCost,
  costDeleteBlockReasons,
  costOrderSummaryForMutation,
  deletionAuditPayload,
  isOwnCostScope,
  isVoidedCost,
  requireCostLifecycleReason,
  requireCostActor,
  restoreOrderCostData,
  type AuditRequestLike,
  type CostActorInput,
  type CostLifecycleReasonInput,
  type DeletedCostAction,
} from "./cost-records-mutation-shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export async function saveCost(request: AuditRequestLike, actor: CostActorInput, input: unknown, id: string | null = null) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const body = assertInputSchema(assertJsonObject(input), COST_INPUT_SCHEMA);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt || before.status === ORDER_COST_STATUS_VOID)) throw permissionError("成本记录不存在、已删除或已作废", 404);
  const ownCostScope = isOwnCostScope(currentActor);
  if (before && ownCostScope && before.createdById !== currentActor.id) throw permissionError("只能维护自己录入的成本记录");
  if (before && !ownCostScope && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限修改该成本记录");
  const order = await assertCostWritableOrder(requireText(body.orderId || body.receivableOrderId || body.order_id, "关联订单"), currentActor, before);
  const data = await buildCostData(order, currentActor, body, id, before);
  const result = id
    ? { cost: await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() }), reused: false }
    : await createCostIdempotently(data);
  const { cost, reused } = result;
  if (!reused) {
    await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(cost.id));
    const isConfirmed = Boolean(data?.costConfirmed);
    const wasConfirmed = Boolean(before?.costConfirmed);
    const action = id
      ? (isConfirmed !== wasConfirmed && isConfirmed ? "确认成本" : "更新成本")
      : "新增成本";
    await runNonCriticalTask("成本操作日志写入", () => writeAudit(request, currentActor, action, "order_costs", cost.id, before, cost));
  }
  scheduleTaxRefundCompletenessRefresh(cost.orderId);
  return safeSerializeCost(await attachBusinessDocumentsToCost(cost));
}

export async function saveCosts(request: AuditRequestLike, actor: CostActorInput, input: unknown) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const body = assertInputSchema(assertJsonObject(input), COST_BATCH_INPUT_SCHEMA);
  const order = await assertCostWritableOrder(requireText(body.orderId || body.receivableOrderId || body.order_id, "关联订单"), currentActor);
  const items = Array.isArray(body.items)
    ? body.items.map((item, index) => assertInputSchema({ ...body, ...assertJsonObject(item, `第 ${index + 1} 行成本明细`) }, COST_INPUT_SCHEMA))
    : [];
  if (!items.length) {
    throw codedError("请至少录入一条供应商成本", 400, "COST_ITEMS_REQUIRED");
  }
  const rows = await Promise.all(items.map((item) => buildCostData(order, currentActor, {
    ...body,
    ...item,
    costType: item.costType || body.costType,
    paymentStatus: item.paymentStatus || body.paymentStatus,
    paymentDate: item.paymentDate ?? body.paymentDate,
    invoiceStatus: item.invoiceStatus || body.invoiceStatus,
    remark: item.remark ?? body.remark,
  })));
  const idempotencyCutoff = new Date();
  const results = await prisma.$transaction((tx) => Promise.all(
    rows.map((data) => createCostIdempotently(data, tx, {
      attachDocuments: false,
      createdBefore: idempotencyCutoff,
    })),
  ));
  const costs = results.map((result) => result.cost);
  const createdCosts = results.filter((result) => !result.reused).map((result) => result.cost);
  await Promise.all(createdCosts.map((cost) => runNonCriticalTask("成本操作日志写入", () => writeAudit(request, currentActor, "新增成本", "order_costs", cost.id, null, cost))));
  scheduleTaxRefundCompletenessRefresh(order.id);
  return (await attachBusinessDocumentsToCosts(costs)).map(safeSerializeCost);
}

function lifecycleAction(input: CostLifecycleReasonInput | null | undefined) {
  const action = String(input?.action || "").trim().toLowerCase();
  return action === "void" || action === "delete" ? action : "";
}

function scheduleCostLifecycleRefresh(orderId: string) {
  scheduleTaxRefundCompletenessRefresh(orderId, "成本生命周期变更后退税完整度刷新");
  invalidateWorkbenchTodosCache();
}

export async function deleteCost(request: AuditRequestLike, actor: CostActorInput, id: string, input: CostLifecycleReasonInput = {}) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const before = await prisma.orderCost.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          customer: true,
          commissionSettlementRecords: { select: { id: true }, take: 1 },
        },
      },
      supplier: true,
      generatedLogisticsExpense: true,
      supplierDocumentRequests: {
        where: { deletedAt: null },
        select: { id: true, deletedAt: true },
        take: 1,
      },
      documents: {
        where: { deletedAt: null },
      },
    },
  });
  if (!before || before.deletedAt) throw permissionError("成本记录不存在或已删除", 404);
  const ownCostScope = isOwnCostScope(currentActor);
  if (ownCostScope && before.createdById !== currentActor.id) throw permissionError("只能删除自己录入的成本记录");
  if (!ownCostScope && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限删除该成本记录");
  assertCanDeleteCost(currentActor, before);
  if (isVoidedCost(before)) throw codedError("该成本已作废，不能重复处理。", 400, "COST_ALREADY_VOID");
  const requestedAction = lifecycleAction(input);
  const reason = requireCostLifecycleReason(input, requestedAction === "delete" ? "删除原因" : "作废原因");
  const canDelete = canPhysicallyDeleteCost(before);
  const deleteBlockReasons = costDeleteBlockReasons(before);
  if (requestedAction === "delete" && !canDelete) {
    throw codedError(`当前成本不能删除，只能作废：${deleteBlockReasons.join("；")}`, 400, "COST_DELETE_NOT_ALLOWED");
  }
  const deletedAt = new Date();
  const action: DeletedCostAction = requestedAction === "void" || !canDelete ? "voided" : "deleted";
  const auditPayload = {
    ...deletionAuditPayload(action, currentActor, before, deletedAt),
    reason,
    deleteBlockReasons,
  };
  const cost = await prisma.$transaction(async (tx) => {
    return action === "deleted"
      ? await tx.orderCost.delete({ where: { id } })
      : await tx.orderCost.update({
        where: { id },
        data: {
          status: ORDER_COST_STATUS_VOID,
          voidedAt: deletedAt,
          voidedById: currentActor.id,
          voidReason: reason,
          updatedById: currentActor.id,
        },
      });
  });
  await runNonCriticalTask("成本删除操作日志写入", () => writeAudit(
    request,
    currentActor,
    action === "deleted" ? "删除成本明细" : "作废成本明细",
    "order_costs",
    id,
    before,
    { ...auditPayload, costId: id },
  ));
  scheduleCostLifecycleRefresh(before.orderId);
  return {
    action,
    cost: safeSerializeCost(cost),
    orderSummary: await costOrderSummaryForMutation(before.orderId, currentActor),
  };
}

export async function restoreCost(request: AuditRequestLike, actor: CostActorInput, id: string, input: CostLifecycleReasonInput = {}) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  if (currentActor.role !== "管理员") throw permissionError("只有管理员可以恢复已作废成本。", 403);
  const reason = requireCostLifecycleReason(input, "恢复原因");
  const before = await prisma.orderCost.findUnique({
    where: { id },
    include: includeCostRelations(),
  });
  if (!before || before.deletedAt) throw permissionError("成本记录不存在或已删除", 404);
  if (!canAccessOrder(currentActor, before.order)) throw permissionError("无权限恢复该成本记录");
  if (!isVoidedCost(before)) throw codedError("该成本不是作废状态，无需恢复。", 400, "COST_NOT_VOID");
  const updated = await prisma.orderCost.update({
    where: { id },
    data: {
      ...restoreOrderCostData(currentActor, reason),
      ...(before.paymentStatus === "已取消" ? { paymentStatus: "待支付" } : {}),
    },
    include: includeCostRelations(),
  });
  await runNonCriticalTask("成本恢复操作日志写入", () => writeAudit(
    request,
    currentActor,
    "恢复作废成本",
    "order_costs",
    id,
    before,
    {
      costId: id,
      orderNo: before.order.orderNo,
      reason,
      restoredById: currentActor.id,
      restoredAt: updated.restoredAt,
    },
  ));
  scheduleCostLifecycleRefresh(updated.orderId);
  return {
    action: "restored",
    cost: safeSerializeCost(await attachBusinessDocumentsToCost(updated)),
    orderSummary: await costOrderSummaryForMutation(updated.orderId, currentActor),
  };
}

export async function batchVoidCosts(request: AuditRequestLike, actor: CostActorInput, input: unknown) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  if (currentActor.role !== "管理员") throw permissionError("只有管理员可以批量作废成本。", 403);
  const body = assertJsonObject(input);
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  if (!ids.length) throw codedError("请选择需要作废的成本记录。", 400, "COST_BATCH_VOID_EMPTY");
  const reason = requireCostLifecycleReason(body, "作废原因");
  const rows = await prisma.orderCost.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: {
      ...includeCostRelations(),
      generatedLogisticsExpense: true,
      supplierDocumentRequests: {
        where: { deletedAt: null },
        select: { id: true, deletedAt: true },
        take: 1,
      },
      order: {
        include: {
          customer: true,
          businessEntity: true,
          salesperson: true,
          commissionSettlementRecords: { select: { id: true }, take: 1 },
        },
      },
    },
    take: Math.min(ids.length, 500),
  });
  const voidedCosts: unknown[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    if (!canAccessOrder(currentActor, row.order)) {
      skipped.push({ id: row.id, reason: "无权限" });
      continue;
    }
    if (isVoidedCost(row)) {
      skipped.push({ id: row.id, reason: "已作废" });
      continue;
    }
    const updated = await prisma.orderCost.update({
      where: { id: row.id },
      data: {
        status: ORDER_COST_STATUS_VOID,
        voidedAt: new Date(),
        voidedById: currentActor.id,
        voidReason: reason,
        updatedById: currentActor.id,
      },
      include: includeCostRelations(),
    });
    voidedCosts.push(updated);
    scheduleCostLifecycleRefresh(updated.orderId);
    await runNonCriticalTask("批量作废成本日志写入", () => writeAudit(
      request,
      currentActor,
      "批量作废成本",
      "order_costs",
      row.id,
      row,
      {
        costId: row.id,
        orderNo: row.order.orderNo,
        reason,
        voidedById: currentActor.id,
        voidedAt: updated.voidedAt,
      },
    ));
  }
  const missingIds = ids.filter((id) => !rows.some((row) => row.id === id));
  missingIds.forEach((id) => skipped.push({ id, reason: "成本不存在或已删除" }));
  return {
    voidedCount: voidedCosts.length,
    skippedCount: skipped.length,
    skipped,
    costs: voidedCosts.map(safeSerializeCost),
  };
}
