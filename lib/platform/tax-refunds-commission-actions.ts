import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  COMMISSION_FORMULA_SETTING_KEY,
  DEFAULT_COMMISSION_FORMULA_SETTINGS,
  canWrite,
  codedError,
  includeOrderRelations,
  nonEmpty,
  normalizeCommissionFormulaSettings,
  optional,
  permissionError,
  roundMoney,
  serializeOrder,
  writeAudit,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import type {
  ActorLike,
  AuditRequestLike,
  TaxRefundActionInput,
} from "./tax-refunds-shared";
import { lockBusinessOrderForUpdate } from "./business-archive";
import { isCommissionSettled } from "./commission-settlement-lock";
import {
  COMMISSION_SETTLEMENT_TRANSACTION_OPTIONS,
  assertCommissionCanSettle,
} from "./tax-refunds-action-support";

export async function settleCommission(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  input: TaxRefundActionInput = {},
) {
  if (!canWrite(actor, "commissions")) {
    throw codedError("没有权限结算业务员提成。", 403, "PERMISSION_DENIED");
  }
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  try {
    const { order } = await prisma.$transaction(async (tx) => {
      await lockBusinessOrderForUpdate(tx, orderId);
      const commissionFormulaSetting = await tx.systemSetting.findUnique({
        where: { key: COMMISSION_FORMULA_SETTING_KEY },
      });
      const commissionFormulaSettings = normalizeCommissionFormulaSettings(
        commissionFormulaSetting?.value ?? DEFAULT_COMMISSION_FORMULA_SETTINGS,
      );
      const before = await tx.receivableOrder.findFirst({
        where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
        include: includeOrderRelations(),
      });
      if (!before) throw codedError("应收订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
      const { summary, commissionAmountCny } = assertCommissionCanSettle(
        before,
        commissionFormulaSettings,
      );
      const paidAmountCny = roundMoney(summary.arrivedPaymentsCny);
      const logisticsCostCny = roundMoney(summary.confirmedLogisticsCostCny);
      const commissionBaseCny = roundMoney(summary.settleableCommissionBaseCny);
      const settledAt = new Date();
      const locked = await tx.receivableOrder.updateMany({
        where: {
          id: orderId,
          deletedAt: null,
          updatedAt: before.updatedAt,
          commissionStatus: { notIn: ["已结算", "SETTLED"] },
          commissionSettledAt: null,
          commissionSettlementRecords: { none: { status: "ACTIVE", reversedAt: null } },
        },
        data: {
          commissionStatus: "SETTLED",
          commissionSettledById: actorId,
          commissionSettledAt: settledAt,
          commissionSettlementRemark: optional(input.remark),
          updatedById: actorId,
        },
      });
      if (locked.count !== 1) {
        throw codedError(
          "订单数据已变化，请刷新后重新结算。",
          409,
          "COMMISSION_SETTLEMENT_CONFLICT",
        );
      }
      await tx.commissionSettlement.create({
        data: {
          orderId,
          salespersonUserId: before.salespersonUserId,
          commissionRate: summary.commissionRate,
          paidAmountCny,
          logisticsCostCny,
          commissionBaseCny,
          commissionAmountCny,
          commissionFormulaMode: summary.commissionFormulaMode,
          commissionFormulaLabel: summary.commissionFormulaLabel,
          commissionFormulaDescription: summary.commissionFormulaDescription,
          commissionFormulaSource: summary.commissionFormulaSource,
          commissionFormulaDeductions: JSON.parse(
            JSON.stringify(summary.commissionFormulaDeductions || []),
          ) as Prisma.InputJsonValue,
          commissionFormulaFloorAtZero: summary.commissionFormulaFloorAtZero,
          commissionFormulaVersion: "v1",
          settledById: actorId,
          status: "ACTIVE",
          remark: optional(input.remark),
        },
      });
      const order = await tx.receivableOrder.findUnique({
        where: { id: orderId },
        include: includeOrderRelations(),
      });
      if (!order) throw codedError("应收订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
      await writeAudit(
        request,
        actor,
        "结算业务员提成",
        "receivable_orders",
        order.id,
        before,
        order,
        tx,
      );
      return { order };
    }, COMMISSION_SETTLEMENT_TRANSACTION_OPTIONS);
    return serializeOrder(order);
  } catch (error: unknown) {
    const typedError = error as { status?: number; code?: string };
    if (typedError.status) throw error;
    if (["P2034", "P2002"].includes(String(typedError.code || ""))) {
      throw codedError(
        "订单数据已变化，请刷新后重新结算。",
        409,
        "COMMISSION_SETTLEMENT_CONFLICT",
      );
    }
    throw codedError("数据库写入失败，业务员提成未结算。", 500, "DATABASE_ERROR");
  }
}

export async function reverseCommissionSettlement(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  input: TaxRefundActionInput = {},
) {
  if (actor?.role !== "管理员" || !canWrite(actor, "commissions")) {
    throw codedError("只有管理员可以撤销业务员提成结算。", 403, "PERMISSION_DENIED");
  }
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const reason = nonEmpty(input.reason || input.reversalReason || input.remark);
  if (!reason) {
    throw codedError(
      "撤销提成结算必须填写原因。",
      400,
      "COMMISSION_REVERSAL_REASON_REQUIRED",
    );
  }
  try {
    const order = await prisma.$transaction(async (tx) => {
      await lockBusinessOrderForUpdate(tx, orderId);
      const before = await tx.receivableOrder.findFirst({
        where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
        include: includeOrderRelations(),
      });
      if (!before) throw codedError("应收订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
      const settlementRecords = await tx.commissionSettlement.findMany({
        where: { orderId, status: "ACTIVE", reversedAt: null },
        orderBy: [{ settledAt: "desc" }, { createdAt: "desc" }],
      });
      if (!isCommissionSettled({ ...before, commissionSettlementRecords: settlementRecords })) {
        throw codedError(
          "该订单没有可撤销的提成结算。",
          400,
          "COMMISSION_NOT_SETTLED",
        );
      }
      const reversedAt = new Date();
      const unlocked = await tx.receivableOrder.updateMany({
        where: { id: orderId, deletedAt: null, updatedAt: before.updatedAt },
        data: {
          commissionStatus: "未结算",
          commissionSettledById: null,
          commissionSettledAt: null,
          commissionSettlementRemark: null,
          updatedById: actorId,
        },
      });
      if (unlocked.count !== 1) {
        throw codedError(
          "订单数据已变化，请刷新后重新撤销结算。",
          409,
          "COMMISSION_REVERSAL_CONFLICT",
        );
      }
      const reversedRecords = await tx.commissionSettlement.updateMany({
        where: { orderId, status: "ACTIVE", reversedAt: null },
        data: {
          status: "REVERSED",
          reversedAt,
          reversedById: actorId,
          reversalReason: reason,
        },
      });
      if (reversedRecords.count !== settlementRecords.length) {
        throw codedError(
          "提成结算记录已变化，请刷新后重新撤销。",
          409,
          "COMMISSION_REVERSAL_CONFLICT",
        );
      }
      const after = await tx.receivableOrder.findUnique({
        where: { id: orderId },
        include: includeOrderRelations(),
      });
      if (!after) throw codedError("应收订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
      await writeAudit(
        request,
        actor,
        "撤销业务员提成结算",
        "receivable_orders",
        orderId,
        { order: before, settlementRecords },
        {
          order: after,
          reversalReason: reason,
          reversedAt,
          reversedById: actorId,
          reversedSettlementRecordIds: settlementRecords.map((record) => record.id),
        },
        tx,
      );
      return after;
    }, COMMISSION_SETTLEMENT_TRANSACTION_OPTIONS);
    return serializeOrder(order);
  } catch (error: unknown) {
    const typedError = error as { status?: number; code?: string };
    if (typedError.status) throw error;
    if (["P2034", "P2002"].includes(String(typedError.code || ""))) {
      throw codedError(
        "订单数据已变化，请刷新后重新撤销结算。",
        409,
        "COMMISSION_REVERSAL_CONFLICT",
      );
    }
    throw codedError(
      "数据库写入失败，业务员提成结算未撤销。",
      500,
      "DATABASE_ERROR",
    );
  }
}
