import { prisma } from "../prisma";
import { attachBusinessDocumentsToCost } from "./business-documents";
import { canAccessOrder } from "./order-access";
import type { InputSchema } from "./shared-base-utils";
import {
  COST_TYPES,
  ORDER_COST_STATUS_VOID,
  assertWrite,
  assertInputSchema,
  assertJsonObject,
  codedError,
  isLogisticsGeneratedCostSourceType,
  isLogisticsCostType,
  normalizedCostType,
  permissionError,
  requireText,
  safeSerializeCost,
  scheduleTaxRefundCompletenessRefresh,
  syncCostInvoiceStatus,
  writeAudit,
} from "./shared";
import { costOrderSummaryForMutation, requireCostActor, type AuditRequestLike, type CostActorInput } from "./cost-records-mutation-shared";
import { includeCostRelations } from "./cost-records-shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertFactoryPurchaseSettlementCostCanBeManagedInCostModule } from "./cost-records-module-guard";
import { assertOrderCostAllowedByTradeTerm } from "./trade-term-cost-policy";

const COST_TYPE_UPDATE_SCHEMA: InputSchema = {
  costType: { label: "成本类型", kind: "text", required: true },
  reason: { label: "修改原因", kind: "text" },
  changeReason: { label: "修改原因", kind: "text" },
};

export async function updateCostType(request: AuditRequestLike, actor: CostActorInput, id: string, input: unknown) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  if (!["管理员", "财务"].includes(currentActor.role || "")) {
    throw permissionError("只有管理员或财务可以修改已登记成本类型", 403);
  }

  const body = assertInputSchema(assertJsonObject(input), COST_TYPE_UPDATE_SCHEMA);
  const nextCostType = normalizedCostType(requireText(body.costType, "成本类型"));
  const reason = requireText(body.reason || body.changeReason, "修改原因");
  if (!COST_TYPES.includes(nextCostType)) {
    throw codedError("请选择有效成本类型", 400, "COST_TYPE_INVALID");
  }

  const before = await prisma.orderCost.findFirst({
    where: { id, deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } },
    include: {
      ...includeCostRelations(),
      generatedLogisticsExpense: true,
    },
  });
  if (!before) throw permissionError("成本记录不存在、已删除或已作废", 404);
  if (!canAccessOrder(currentActor, before.order)) throw permissionError("无权限修改该成本记录");
  assertFactoryPurchaseSettlementCostCanBeManagedInCostModule(before, "修改成本类型");
  assertOrderCostAllowedByTradeTerm(before.order.tradeTerm, nextCostType);

	if (isLogisticsGeneratedCostSourceType(before.sourceType) && !isLogisticsCostType(nextCostType)) {
		throw codedError("物流费用同步成本只能改为物流费用类型。", 400, "LOGISTICS_COST_TYPE_REQUIRED");
	}

  if (before.costType === nextCostType) {
    return {
      cost: safeSerializeCost(await attachBusinessDocumentsToCost(before)),
      orderSummary: await costOrderSummaryForMutation(before.orderId, currentActor),
    };
  }

  const changedAt = new Date();
	const relatedLogisticsExpenseIds = [
		before.generatedLogisticsExpense?.id,
		isLogisticsGeneratedCostSourceType(before.sourceType) ? before.sourceId : null,
	].filter((value): value is string => Boolean(value));

	let updated = await prisma.$transaction(async (tx) => {
		await assertBusinessOrderWritableInTransaction(
			tx,
			before.orderId,
			"该订单已提交退税并归档，不能修改成本类型。",
		);
		await assertCommissionOrderWritableInTransaction(tx, before.orderId);
    const changed = await tx.orderCost.updateMany({
      where: {
        id,
        updatedAt: before.updatedAt,
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
      },
      data: {
        costType: nextCostType,
        updatedById: currentActor.id,
      },
    });
    if (changed.count !== 1) {
      throw codedError("成本记录已被其他操作修改，类型变更已取消，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    }
		if (relatedLogisticsExpenseIds.length || isLogisticsGeneratedCostSourceType(before.sourceType)) {
      await tx.logisticsExpense.updateMany({
        where: {
          deletedAt: null,
          OR: [
            { costId: before.id },
            ...relatedLogisticsExpenseIds.map((expenseId) => ({ id: expenseId })),
          ],
        },
        data: {
          costType: nextCostType,
          updatedById: currentActor.id,
        },
      });
    }
    const current = await tx.orderCost.findUnique({ where: { id }, include: includeCostRelations() });
    if (!current) throw codedError("成本记录已发生变化，请刷新后重试。", 409, "COST_RECORD_CONFLICT");
    await writeAudit(
      request,
      currentActor,
      "修改成本类型",
      "order_costs",
      id,
      {
        costId: id,
        orderNo: before.order.orderNo,
        supplier: before.supplierNameSnapshot || before.supplier?.supplierName || before.vendorName,
        oldCostType: before.costType,
        amount: Number(before.amount),
        currency: before.currency,
      },
      {
        costId: id,
        orderNo: before.order.orderNo,
        supplier: before.supplierNameSnapshot || before.supplier?.supplierName || before.vendorName,
        oldCostType: before.costType,
        newCostType: nextCostType,
        reason,
        changedById: currentActor.id,
        changedAt,
      },
      tx,
    );
    return current;
  });

  const synced = await syncCostInvoiceStatus(updated.id);
  if (synced) {
    updated = await prisma.orderCost.findUnique({
      where: { id: updated.id },
      include: includeCostRelations(),
    }) || updated;
  }
  scheduleTaxRefundCompletenessRefresh(updated.orderId, "成本类型修改后退税完整度刷新");
  invalidateWorkbenchTodosCache();

  return {
    cost: safeSerializeCost(await attachBusinessDocumentsToCost(updated)),
    orderSummary: await costOrderSummaryForMutation(updated.orderId, currentActor),
  };
}
