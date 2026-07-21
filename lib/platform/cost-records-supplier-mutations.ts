import { prisma } from "../prisma";
import {
  COST_BATCH_INPUT_SCHEMA,
  COST_INPUT_SCHEMA,
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
  ORDER_COST_STATUS_VOID,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  codedError,
  isLogisticsGeneratedCostSourceType,
  permissionError,
  requireText,
  runNonCriticalTask,
  safeSerializeCost,
  scheduleTaxRefundCompletenessRefresh,
  softDeleteFileAssetBySource,
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
import {
  assertCommissionOrderWritableInTransaction,
  isCommissionSettled,
} from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction, isBusinessArchived } from "./business-archive";

function assertCostCanBeManagedInCostModule(cost: { sourceType?: string | null; generatedLogisticsExpense?: unknown }, action: string) {
  if (!isLogisticsGeneratedCostSourceType(cost.sourceType) && !cost.generatedLogisticsExpense) return;
  throw codedError(`物流费用同步成本不能在成本管理${action}，请到物流费用模块操作。`, 400, "LOGISTICS_COST_MANAGED_BY_LOGISTICS");
}

export async function saveCost(request: AuditRequestLike, actor: CostActorInput, input: unknown, id: string | null = null) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const body = assertInputSchema(assertJsonObject(input), COST_INPUT_SCHEMA);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt || before.status === ORDER_COST_STATUS_VOID)) throw permissionError("成本记录不存在、已删除或已作废", 404);
  if (before) assertCostCanBeManagedInCostModule(before, "修改");
  const ownCostScope = isOwnCostScope(currentActor);
  if (before && ownCostScope && before.createdById !== currentActor.id) throw permissionError("只能维护自己录入的成本记录");
  if (before && !ownCostScope && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限修改该成本记录");
  const order = await assertCostWritableOrder(requireText(body.orderId || body.receivableOrderId || body.order_id, "关联订单"), currentActor, before);
  const data = await buildCostData(order, currentActor, body, id, before);
  const result = await prisma.$transaction(async (tx) => {
    const affectedOrderIds = [...new Set([order.id, before?.orderId].filter((value): value is string => Boolean(value)))].sort();
    for (const affectedOrderId of affectedOrderIds) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        affectedOrderId,
        "该订单已提交退税并归档，不能修改成本。",
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
        throw codedError("成本记录已被其他操作修改，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
      }
      const cost = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
      if (!cost) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
      saved = { cost, reused: false };
    } else {
      saved = await createCostIdempotently(data, tx, { attachDocuments: false });
    }
    if (!saved.reused) {
      const isConfirmed = Boolean(data?.costConfirmed);
      const wasConfirmed = Boolean(before?.costConfirmed);
      const action = id
        ? (isConfirmed !== wasConfirmed && isConfirmed ? "确认成本" : "更新成本")
        : "新增成本";
      await writeAudit(request, currentActor, action, "order_costs", saved.cost.id, before, saved.cost, tx);
    }
    return saved;
  });
  const { cost, reused } = result;
  if (!reused) {
    await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(cost.id));
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
  const results = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      order.id,
      "该订单已提交退税并归档，不能新增成本。",
    );
    await assertCommissionOrderWritableInTransaction(tx, order.id);
    const saved = await Promise.all(rows.map((data) => createCostIdempotently(data, tx, {
      attachDocuments: false,
      createdBefore: idempotencyCutoff,
    })));
    const createdCosts = saved.filter((result) => !result.reused).map((result) => result.cost);
    for (const cost of createdCosts) {
      await writeAudit(request, currentActor, "新增成本", "order_costs", cost.id, null, cost, tx);
    }
    return saved;
  });
  const costs = results.map((result) => result.cost);
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
          commissionSettlementRecords: {
            where: { status: "ACTIVE", reversedAt: null },
            select: { id: true, status: true, reversedAt: true },
            take: 1,
          },
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
  assertCostCanBeManagedInCostModule(before, "删除或作废");
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
    await assertBusinessOrderWritableInTransaction(
      tx,
      before.orderId,
      "该订单已提交退税并归档，不能删除或作废成本。",
    );
    await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    if (action === "deleted") {
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
        id,
        FILE_ASSET_ROLES.PAYMENT_VOUCHER,
        deletedAt,
      );
      const deleted = await tx.orderCost.deleteMany({
        where: {
          id,
          updatedAt: before.updatedAt,
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
        },
      });
      if (deleted.count !== 1) {
        throw codedError("成本记录已被其他操作修改，删除已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
      }
      await writeAudit(
        request,
        currentActor,
        "删除成本明细",
        "order_costs",
        id,
        before,
        { ...auditPayload, costId: id },
        tx,
      );
      return before;
    }
    const changed = await tx.orderCost.updateMany({
        where: {
          id,
          updatedAt: before.updatedAt,
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
        },
        data: {
          status: ORDER_COST_STATUS_VOID,
          voidedAt: deletedAt,
          voidedById: currentActor.id,
          voidReason: reason,
          updatedById: currentActor.id,
        },
      });
    if (changed.count !== 1) {
      throw codedError("成本记录已被其他操作修改，作废已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    }
    const updated = await tx.orderCost.findUnique({ where: { id } });
    if (!updated) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    await writeAudit(
      request,
      currentActor,
      "作废成本明细",
      "order_costs",
      id,
      before,
      { ...auditPayload, costId: id },
      tx,
    );
    return updated;
  });
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
  assertCostCanBeManagedInCostModule(before, "恢复");
  if (!canAccessOrder(currentActor, before.order)) throw permissionError("无权限恢复该成本记录");
  if (!isVoidedCost(before)) throw codedError("该成本不是作废状态，无需恢复。", 400, "COST_NOT_VOID");
  const updated = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      before.orderId,
      "该订单已提交退税并归档，不能恢复成本。",
    );
    await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    const restored = await tx.orderCost.updateMany({
      where: {
        id,
        updatedAt: before.updatedAt,
        deletedAt: null,
        status: ORDER_COST_STATUS_VOID,
      },
      data: {
        ...restoreOrderCostData(currentActor, reason),
        ...(before.paymentStatus === "已取消" ? { paymentStatus: "待支付" } : {}),
      },
    });
    if (restored.count !== 1) {
      throw codedError("成本记录已被其他操作修改，恢复已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    }
    const current = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
    if (!current) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    await writeAudit(request, currentActor, "恢复作废成本", "order_costs", id, before, {
      costId: id,
      orderNo: before.order.orderNo,
      reason,
      restoredById: currentActor.id,
      restoredAt: current.restoredAt,
    }, tx);
    return current;
  });
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
          commissionSettlementRecords: {
            where: { status: "ACTIVE", reversedAt: null },
            select: { id: true, status: true, reversedAt: true },
            take: 1,
          },
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
    if (isLogisticsGeneratedCostSourceType(row.sourceType) || row.generatedLogisticsExpense) {
      skipped.push({ id: row.id, reason: "物流费用同步成本请到物流费用模块操作" });
      continue;
    }
    if (isCommissionSettled(row.order)) {
      skipped.push({ id: row.id, reason: "业务员提成已结算" });
      continue;
    }
    if (isBusinessArchived(row.order)) {
      skipped.push({ id: row.id, reason: "订单已提交退税并归档" });
      continue;
    }
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        await assertBusinessOrderWritableInTransaction(
          tx,
          row.orderId,
          "该订单已提交退税并归档，不能批量作废成本。",
        );
        await assertCommissionOrderWritableInTransaction(tx, row.orderId);
        const changed = await tx.orderCost.updateMany({
          where: {
            id: row.id,
            updatedAt: row.updatedAt,
            deletedAt: null,
            status: { not: ORDER_COST_STATUS_VOID },
          },
          data: {
            status: ORDER_COST_STATUS_VOID,
            voidedAt: new Date(),
            voidedById: currentActor.id,
            voidReason: reason,
            updatedById: currentActor.id,
          },
        });
        if (changed.count !== 1) {
          throw codedError("成本记录已被其他操作修改，批量作废已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
        }
        const current = await tx.orderCost.findUnique({ where: { id: row.id }, include: includeCostRelations() });
        if (!current) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
        await writeAudit(request, currentActor, "批量作废成本", "order_costs", row.id, row, {
          costId: row.id,
          orderNo: row.order.orderNo,
          reason,
          voidedById: currentActor.id,
          voidedAt: current.voidedAt,
        }, tx);
        return current;
      });
    } catch (error: unknown) {
      if (String((error as { code?: string })?.code || "") === "COMMISSION_SETTLEMENT_LOCKED") {
        skipped.push({ id: row.id, reason: "业务员提成已结算" });
        continue;
      }
      throw error;
    }
    voidedCosts.push(updated);
    scheduleCostLifecycleRefresh(updated.orderId);
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
