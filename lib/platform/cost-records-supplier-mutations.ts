import { prisma } from "../prisma";
import {
  COST_BATCH_INPUT_SCHEMA,
  COST_INPUT_SCHEMA,
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
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
  costOrderSummaryForMutation,
  deletionAuditPayload,
  isOwnCostScope,
  requireCostActor,
  type AuditRequestLike,
  type CostActorInput,
  type DeletedCostAction,
} from "./cost-records-mutation-shared";

export async function saveCost(request: AuditRequestLike, actor: CostActorInput, input: unknown, id: string | null = null) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const body = assertInputSchema(assertJsonObject(input), COST_INPUT_SCHEMA);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt)) throw permissionError("成本记录不存在或已删除", 404);
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

export async function deleteCost(request: AuditRequestLike, actor: CostActorInput, id: string) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const before = await prisma.orderCost.findUnique({
    where: { id },
    include: {
      order: { include: { customer: true } },
      supplier: true,
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
  const hasUploadedInvoice = before.documents.some((document) => document.uploadStatus === "SUCCESS");
  const deletedAt = new Date();
  const action: DeletedCostAction = canPhysicallyDeleteCost(before, hasUploadedInvoice) ? "deleted" : "voided";
  const auditPayload = deletionAuditPayload(action, currentActor, before, deletedAt);
  const cost = await prisma.$transaction(async (tx) => {
    const saved = action === "deleted"
      ? await tx.orderCost.delete({ where: { id } })
      : await tx.orderCost.update({
        where: { id },
        data: {
          deletedAt,
          paymentStatus: "已取消",
          updatedById: currentActor.id,
        },
      });
    await softDeleteFileAssetBySource(
      tx,
      FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
      id,
      FILE_ASSET_ROLES.PAYMENT_VOUCHER,
      deletedAt,
    );
    return saved;
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
  scheduleTaxRefundCompletenessRefresh(before.orderId);
  return {
    action,
    cost: safeSerializeCost(cost),
    orderSummary: await costOrderSummaryForMutation(before.orderId, currentActor),
  };
}
