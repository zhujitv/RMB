import { prisma } from "../prisma";
import {
  canWrite,
  codedError,
  getCommissionFormulaSettings,
  getExchangeRateSettings,
  includeOrderRelations,
  nonEmpty,
  optional,
  permissionError,
  refreshTaxRefundCompletenessForOrder,
  roundMoney,
  runNonCriticalTask,
  serializeOrder,
  summarizeOrder,
  taxDocumentCompleteness,
  taxRefundStatusFromCompleteness,
  writeAudit,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import {
  type ActorLike,
  type AuditRequestLike,
  type TaxRefundActionInput,
  hydrateTaxRefundOrderLogisticsInfo,
} from "./tax-refunds-shared";
import { assertTaxRefundLogisticsBusinessClosure } from "./tax-refund-business-closure";
import { isBusinessArchived, lockBusinessOrderForUpdate } from "./business-archive";

const EDITABLE_TAX_REFUND_STATUSES = ["NOT_READY", "READY", "PROBLEM", "SUBMITTED"];
const TAX_REFUND_SUBMIT_TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 10000 };

export async function refreshTaxRefundCompletenessNow(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限重新计算退税完整度", 403);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);

  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  const beforeCompleteness = order.taxRefundCompleteness || null;
  const completeness = await refreshTaxRefundCompletenessForOrder(orderWithLogistics);
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  const serialized = serializeOrder({
    ...orderWithLogistics,
    taxRefundCompleteness: completeness || order.taxRefundCompleteness,
    taxRefundCompletenessUpdatedAt: completeness ? new Date() : order.taxRefundCompletenessUpdatedAt,
    taxRefundStatus: status,
  });

  await runNonCriticalTask("退税完整度手动重算日志写入", () => writeAudit(
    request,
    actor,
    "手动重算退税完整度",
    "receivable_orders",
    order.id,
    { orderNo: order.orderNo, taxRefundCompleteness: beforeCompleteness },
    { orderNo: order.orderNo, taxRefundCompleteness: completeness, taxRefundStatus: status },
  ), { context: { orderId: order.id } });

  return serialized;
}

export async function updateTaxRefundStatus(request: AuditRequestLike, actor: ActorLike, orderId: string, status: string, input: TaxRefundActionInput = {}) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限修改退税状态", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  if (!EDITABLE_TAX_REFUND_STATUSES.includes(status)) throw permissionError("请选择有效退税状态", 400);
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before);
  const beforeArchived = isBusinessArchived(before);
  if (beforeArchived && status !== "SUBMITTED" && input.cancelArchive !== true) {
    throw permissionError("已提交退税档案只允许查看和下载资料。", 400);
  }
  const completeness = taxDocumentCompleteness(beforeWithLogistics);
  if (status === "SUBMITTED" && before.taxRefundStatus === "SUBMITTED" && beforeArchived) {
    throw codedError("该订单已提交退税并归档，不能重复提交。", 400, "TAX_REFUND_ALREADY_SUBMITTED");
  }
  const settings = await getExchangeRateSettings();
  const forceSubmit = status === "SUBMITTED"
    && actor?.role === "管理员"
    && settings.allowAdminIncompleteTaxSubmit === true
    && input.forceSubmit === true;
  if (["READY", "SUBMITTED"].includes(status) && !completeness.complete && !forceSubmit) {
    const error = codedError("资料尚未完整，无法提交退税。", 400, "TAX_REFUND_COMPLETENESS_REQUIRED");
    error.details = {
      completed: Number(completeness.completed || 0),
      total: Number(completeness.total || 0),
      percent: Number(completeness.total || 0) > 0
        ? Math.round((Number(completeness.completed || 0) / Number(completeness.total || 0)) * 100)
        : 0,
      missingLabels: completeness.missingLabels || [],
      text: completeness.text || "",
    };
    throw error;
  }
  if (forceSubmit && !optional(input.forceReason)) {
    throw codedError("强制提交退税必须填写原因。", 400, "FORCE_SUBMIT_REASON_REQUIRED");
  }
  const archiveRemark = optional(input.archiveRemark || input.remark);
  const now = new Date();
  const orderData = {
      taxRefundStatus: status,
      updatedById: actorId,
      ...(status === "SUBMITTED" ? {
        taxArchived: true,
        taxRefundArchivedById: actorId,
        taxRefundArchivedAt: now,
        taxRefundArchiveRemark: forceSubmit ? optional(input.forceReason) : archiveRemark,
        taxSubmittedById: actorId,
        taxSubmittedAt: now,
      } : {}),
  };
  const order = status === "SUBMITTED"
    ? await prisma.$transaction(async (tx) => {
      await lockBusinessOrderForUpdate(tx, orderId);
      const current = await tx.receivableOrder.findUnique({
        where: { id: orderId },
        select: {
          deletedAt: true,
          taxArchived: true,
          taxRefundStatus: true,
          taxRefundArchivedAt: true,
          taxSubmittedAt: true,
        },
      });
      if (!current || current.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
      if (isBusinessArchived(current)) {
        throw codedError("该订单已提交退税并归档，不能重复提交。", 400, "TAX_REFUND_ALREADY_SUBMITTED");
      }
      await assertTaxRefundLogisticsBusinessClosure(orderId, tx);
      return tx.receivableOrder.update({
        where: { id: orderId },
        data: orderData,
        include: includeOrderRelations(),
      });
    }, TAX_REFUND_SUBMIT_TRANSACTION_OPTIONS)
    : await prisma.receivableOrder.update({
      where: { id: orderId },
      data: orderData,
      include: includeOrderRelations(),
    });
  await writeAudit(
    request,
    actor,
    status === "SUBMITTED" ? "提交退税并归档" : "修改退税状态",
    "receivable_orders",
    order.id,
    {
      orderNo: before.orderNo,
      taxRefundStatus: before.taxRefundStatus,
      taxArchived: beforeArchived,
    },
    {
      orderNo: order.orderNo,
      taxRefundStatus: order.taxRefundStatus,
      taxArchived: Boolean(order.taxArchived),
      forceSubmit,
      forceReason: forceSubmit ? optional(input.forceReason) : undefined,
    },
  ).catch(() => null);
  return serializeOrder(await hydrateTaxRefundOrderLogisticsInfo(order));
}

export async function cancelTaxRefundArchive(request: AuditRequestLike, actor: ActorLike, orderId: string, nextStatus = "NOT_READY", input: TaxRefundActionInput = {}) {
  if (actor?.role !== "管理员") throw permissionError("只有管理员可以取消归档。", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const restoredStatus = EDITABLE_TAX_REFUND_STATUSES.includes(nextStatus) && nextStatus !== "SUBMITTED" ? nextStatus : "NOT_READY";
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before);
  const completeness = taxDocumentCompleteness(beforeWithLogistics);
  const finalStatus = restoredStatus === "READY" && !completeness.complete ? "NOT_READY" : restoredStatus;
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: {
      taxArchived: false,
      taxRefundArchivedById: null,
      taxRefundArchivedAt: null,
      taxRefundArchiveRemark: optional(input.remark),
      taxSubmittedById: null,
      taxSubmittedAt: null,
      taxRefundStatus: finalStatus,
      updatedById: actorId,
    },
    include: includeOrderRelations(),
  });
  await writeAudit(
    request,
    actor,
    "取消归档",
    "receivable_orders",
    order.id,
    {
      orderNo: before.orderNo,
      taxRefundStatus: before.taxRefundStatus,
      taxArchived: Boolean(before.taxArchived || before.taxRefundArchivedAt),
    },
    {
      orderNo: order.orderNo,
      taxRefundStatus: order.taxRefundStatus,
      taxArchived: false,
      remark: optional(input.remark),
    },
  ).catch(() => null);
  return serializeOrder(await hydrateTaxRefundOrderLogisticsInfo(order));
}

export async function settleCommission(request: AuditRequestLike, actor: ActorLike, orderId: string, input: TaxRefundActionInput = {}) {
  if (!canWrite(actor, "commissions")) {
    throw codedError("没有权限结算业务员提成。", 403, "PERMISSION_DENIED");
  }
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw codedError("应收订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
  if (["已结算", "SETTLED"].includes(before.commissionStatus)) {
    throw codedError("该订单业务员提成已结算，不能重复结算。", 400, "COMMISSION_ALREADY_SETTLED");
  }
  const commissionFormulaSettings = await getCommissionFormulaSettings();
  const summary = summarizeOrder(before, commissionFormulaSettings);
  if (summary.commissionRate <= 0) {
    throw codedError("提成比例未设置，不能结算业务员提成。", 400, "COMMISSION_RATE_NOT_SET");
  }
  if (!summary.realSalespersonSet) {
    throw codedError("未分配真实业务员，不能结算业务员提成。", 400, "SALESPERSON_NOT_SET");
  }
  if (summary.arrivedOutstandingCny > 0 || !["已收齐", "多收款"].includes(before.status)) {
    throw codedError("当前订单货款尚未全部到账，不能结算业务员提成。", 400, "ORDER_NOT_FULLY_PAID");
  }
  if (!summary.taxLogisticsCostsComplete) {
    const missingText = (Array.isArray(summary.taxLogisticsMissingLabels) ? summary.taxLogisticsMissingLabels : []).join("、") || "物流费用";
    throw codedError(`退税资料中的物流费用未完整，缺少：${missingText}。不能结算业务员提成。`, 400, "TAX_LOGISTICS_COSTS_INCOMPLETE");
  }
  if (!summary.allCostsConfirmed) {
    throw codedError("当前订单成本尚未全部确认完成，不能结算业务员提成。", 400, "COST_NOT_CONFIRMED");
  }
  if (!summary.logisticsCostConfirmed) {
    throw codedError("当前订单物流成本尚未确认完成，不能结算业务员提成。", 400, "LOGISTICS_COST_NOT_CONFIRMED");
  }
  const paidAmountCny = roundMoney(summary.arrivedPaymentsCny);
  const logisticsCostCny = roundMoney(summary.confirmedLogisticsCostCny);
  const commissionBaseCny = roundMoney(summary.settleableCommissionBaseCny);
  const commissionAmountCny = roundMoney((commissionBaseCny * summary.commissionRate) / 100);
  if (commissionAmountCny <= 0) {
    throw codedError("提成金额为 0，不能结算，请检查提成比例和成本数据。", 400, "COMMISSION_AMOUNT_ZERO");
  }
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      await tx.commissionSettlement.create({
        data: {
          orderId,
          salespersonUserId: before.salespersonUserId,
          commissionRate: summary.commissionRate,
          paidAmountCny,
          logisticsCostCny,
          commissionBaseCny,
          commissionAmountCny,
          settledById: actorId,
          remark: optional(input.remark),
        },
      });
      return tx.receivableOrder.update({
        where: { id: orderId },
        data: {
          commissionStatus: "SETTLED",
          commissionSettledById: actorId,
          commissionSettledAt: new Date(),
          commissionSettlementRemark: optional(input.remark),
          updatedById: actorId,
        },
        include: includeOrderRelations(),
      });
    });
  } catch {
    throw codedError("数据库写入失败，业务员提成未结算。", 500, "DATABASE_ERROR");
  }
  await writeAudit(request, actor, "结算业务员提成", "receivable_orders", order.id, before, order).catch(() => null);
  return serializeOrder(order);
}
