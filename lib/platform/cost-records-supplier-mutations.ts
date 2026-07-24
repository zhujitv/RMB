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
import { assertCostCanBeManagedInCostModule } from "./cost-records-module-guard";

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

export { deleteCost } from "./cost-records-delete-mutation";
export { batchVoidCosts, restoreCost } from "./cost-records-restore-mutations";
