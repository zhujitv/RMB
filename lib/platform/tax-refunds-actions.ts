import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  canWrite,
  codedError,
  COMMISSION_FORMULA_SETTING_KEY,
  DEFAULT_COMMISSION_FORMULA_SETTINGS,
  DEFAULT_EXCHANGE_RATE_SETTINGS,
  EXCHANGE_RATE_SETTING_KEY,
  includeOrderRelations,
  nonEmpty,
  normalizeCommissionFormulaSettings,
  normalizeExchangeRateSettings,
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
  taxRefundCompletenessSummaryText,
} from "./tax-refunds-shared";
import { assertTaxRefundLogisticsBusinessClosure } from "./tax-refund-business-closure";
import { isBusinessArchived, lockBusinessOrderForUpdate } from "./business-archive";
import { isCommissionSettled } from "./commission-settlement-lock";

const EDITABLE_TAX_REFUND_STATUSES = ["NOT_READY", "READY", "PROBLEM", "SUBMITTED"];
const TAX_REFUND_STATUS_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 15000,
  maxWait: 10000,
};
const TAX_REFUND_STATUS_TRANSACTION_MAX_ATTEMPTS = 3;
const COMMISSION_SETTLEMENT_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 15000,
  maxWait: 10000,
};

type TaxRefundCompleteness = ReturnType<typeof taxDocumentCompleteness>;

function taxRefundStatusSerializationConflict() {
  return codedError(
    "退税状态刚刚被其他操作更新，请刷新后重试。",
    409,
    "TAX_REFUND_STATUS_CONFLICT",
  );
}

async function runTaxRefundStatusTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= TAX_REFUND_STATUS_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, TAX_REFUND_STATUS_TRANSACTION_OPTIONS);
    } catch (error: unknown) {
      if (String((error as { code?: string })?.code || "") !== "P2034") throw error;
      if (attempt === TAX_REFUND_STATUS_TRANSACTION_MAX_ATTEMPTS) throw taxRefundStatusSerializationConflict();
    }
  }
  throw taxRefundStatusSerializationConflict();
}

async function exchangeRateSettingsInTransaction(tx: Prisma.TransactionClient) {
  const setting = await tx.systemSetting.findUnique({ where: { key: EXCHANGE_RATE_SETTING_KEY } });
  return normalizeExchangeRateSettings(setting?.value ?? DEFAULT_EXCHANGE_RATE_SETTINGS);
}

function nextTaxRefundMutationVersion(...values: Array<Date | null | undefined>) {
  const latest = values.reduce((time, value) => Math.max(time, value?.getTime() || 0), Date.now());
  return new Date(latest + 1);
}

function taxRefundCompletenessData(completeness: TaxRefundCompleteness, version: Date) {
  const total = Number(completeness.total || 0);
  const completed = Number(completeness.completed || 0);
  const overall = Number.isFinite(total) && total > 0
    ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
    : 0;
  return {
    taxRefundCompleteness: JSON.parse(JSON.stringify(completeness)) as Prisma.InputJsonValue,
    taxRefundCompletenessUpdatedAt: version,
    taxRefundOverallCompleteness: overall,
    taxRefundCompletenessIssuesSummary: taxRefundCompletenessSummaryText(completeness).slice(0, 500),
  };
}

function taxRefundCompletenessError(completeness: TaxRefundCompleteness) {
  const total = Number(completeness.total || 0);
  const completed = Number(completeness.completed || 0);
  const error = codedError("资料尚未完整，无法提交退税。", 400, "TAX_REFUND_COMPLETENESS_REQUIRED");
  error.details = {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    missingLabels: completeness.missingLabels || [],
    text: completeness.text || "",
  };
  return error;
}

function assertCommissionCanSettle(
  order: Parameters<typeof summarizeOrder>[0],
  commissionFormulaSettings: Parameters<typeof summarizeOrder>[1],
) {
  if (isCommissionSettled(order)) {
    throw codedError("该订单业务员提成已结算，不能重复结算。", 400, "COMMISSION_ALREADY_SETTLED");
  }
  const summary = summarizeOrder(order, commissionFormulaSettings);
  if (summary.commissionRate <= 0) {
    throw codedError("提成比例未设置，不能结算业务员提成。", 400, "COMMISSION_RATE_NOT_SET");
  }
  if (!summary.realSalespersonSet) {
    throw codedError("未分配真实业务员，不能结算业务员提成。", 400, "SALESPERSON_NOT_SET");
  }
  if (summary.hasArrivedPaymentCurrencyMismatch) {
    throw codedError("订单存在币种不一致的历史收款，请先人工复核，不能结算业务员提成。", 400, "PAYMENT_CURRENCY_MISMATCH");
  }
  if (["草稿", "已关闭", "已取消"].includes(order.status || "") || summary.arrivedOutstandingAmount > 0) {
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
  const commissionAmountCny = roundMoney((summary.settleableCommissionBaseCny * summary.commissionRate) / 100);
  if (commissionAmountCny <= 0) {
    throw codedError("提成金额为 0，不能结算，请检查提成比例和成本数据。", 400, "COMMISSION_AMOUNT_ZERO");
  }
  return { summary, commissionAmountCny };
}

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
  const order = await runTaxRefundStatusTransaction(async (tx) => {
    await lockBusinessOrderForUpdate(tx, orderId);
    const before = await tx.receivableOrder.findFirst({
      where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
      include: includeOrderRelations(),
    });
    if (!before) throw permissionError("应收订单不存在或已删除", 404);

    const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before, tx);
    const completeness = taxDocumentCompleteness(beforeWithLogistics);
    const settings = await exchangeRateSettingsInTransaction(tx);
    const beforeArchived = isBusinessArchived(before);
    if (beforeArchived && status !== "SUBMITTED" && input.cancelArchive !== true) {
      throw permissionError("已提交退税档案只允许查看和下载资料。", 400);
    }
    if (status === "SUBMITTED" && before.taxRefundStatus === "SUBMITTED" && beforeArchived) {
      throw codedError("该订单已提交退税并归档，不能重复提交。", 400, "TAX_REFUND_ALREADY_SUBMITTED");
    }
    const forceSubmit = status === "SUBMITTED"
      && actor?.role === "管理员"
      && settings.allowAdminIncompleteTaxSubmit === true
      && input.forceSubmit === true;
    if (["READY", "SUBMITTED"].includes(status) && !completeness.complete && !forceSubmit) {
      throw taxRefundCompletenessError(completeness);
    }
    if (forceSubmit && !optional(input.forceReason)) {
      throw codedError("强制提交退税必须填写原因。", 400, "FORCE_SUBMIT_REASON_REQUIRED");
    }
    if (status === "SUBMITTED") {
      await assertTaxRefundLogisticsBusinessClosure(orderId, tx);
    }

    const mutationVersion = nextTaxRefundMutationVersion(before.updatedAt, before.taxRefundCompletenessUpdatedAt);
    const archiveRemark = optional(input.archiveRemark || input.remark);
    const updated = await tx.receivableOrder.updateMany({
      where: {
        id: orderId,
        deletedAt: null,
        updatedAt: before.updatedAt,
        taxRefundCompletenessUpdatedAt: before.taxRefundCompletenessUpdatedAt,
      },
      data: {
        taxRefundStatus: status,
        updatedById: actorId,
        updatedAt: mutationVersion,
        ...taxRefundCompletenessData(completeness, mutationVersion),
        ...(status === "SUBMITTED" ? {
          taxArchived: true,
          taxRefundArchivedById: actorId,
          taxRefundArchivedAt: mutationVersion,
          taxRefundArchiveRemark: forceSubmit ? optional(input.forceReason) : archiveRemark,
          taxSubmittedById: actorId,
          taxSubmittedAt: mutationVersion,
        } : {}),
      },
    });
    if (updated.count !== 1) throw taxRefundStatusSerializationConflict();

    const after = await tx.receivableOrder.findUnique({
      where: { id: orderId },
      include: includeOrderRelations(),
    });
    if (!after || after.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
    const afterWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(after, tx);
    await writeAudit(
      request,
      actor,
      status === "SUBMITTED" ? "提交退税并归档" : "修改退税状态",
      "receivable_orders",
      after.id,
      {
        orderNo: before.orderNo,
        taxRefundStatus: before.taxRefundStatus,
        taxArchived: beforeArchived,
        taxRefundCompleteness: before.taxRefundCompleteness,
        taxRefundCompletenessUpdatedAt: before.taxRefundCompletenessUpdatedAt,
      },
      {
        orderNo: after.orderNo,
        taxRefundStatus: after.taxRefundStatus,
        taxArchived: Boolean(after.taxArchived),
        taxRefundCompleteness: completeness,
        taxRefundCompletenessUpdatedAt: mutationVersion,
        forceSubmit,
        forceReason: forceSubmit ? optional(input.forceReason) : undefined,
      },
      tx,
    );
    return afterWithLogistics;
  });
  return serializeOrder(order);
}

export async function cancelTaxRefundArchive(request: AuditRequestLike, actor: ActorLike, orderId: string, nextStatus = "NOT_READY", input: TaxRefundActionInput = {}) {
  if (actor?.role !== "管理员") throw permissionError("只有管理员可以取消归档。", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const restoredStatus = EDITABLE_TAX_REFUND_STATUSES.includes(nextStatus) && nextStatus !== "SUBMITTED" ? nextStatus : "NOT_READY";
  const order = await runTaxRefundStatusTransaction(async (tx) => {
    await lockBusinessOrderForUpdate(tx, orderId);
    const before = await tx.receivableOrder.findFirst({
      where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
      include: includeOrderRelations(),
    });
    if (!before) throw permissionError("应收订单不存在或已删除", 404);
    const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before, tx);
    const completeness = taxDocumentCompleteness(beforeWithLogistics);
    const finalStatus = restoredStatus === "READY" && !completeness.complete ? "NOT_READY" : restoredStatus;
    const mutationVersion = nextTaxRefundMutationVersion(before.updatedAt, before.taxRefundCompletenessUpdatedAt);
    const updated = await tx.receivableOrder.updateMany({
      where: {
        id: orderId,
        deletedAt: null,
        updatedAt: before.updatedAt,
        taxRefundCompletenessUpdatedAt: before.taxRefundCompletenessUpdatedAt,
      },
      data: {
        taxArchived: false,
        taxRefundArchivedById: null,
        taxRefundArchivedAt: null,
        taxRefundArchiveRemark: optional(input.remark),
        taxSubmittedById: null,
        taxSubmittedAt: null,
        taxRefundStatus: finalStatus,
        updatedById: actorId,
        updatedAt: mutationVersion,
        ...taxRefundCompletenessData(completeness, mutationVersion),
      },
    });
    if (updated.count !== 1) throw taxRefundStatusSerializationConflict();
    const after = await tx.receivableOrder.findUnique({
      where: { id: orderId },
      include: includeOrderRelations(),
    });
    if (!after || after.deletedAt) throw permissionError("应收订单不存在或已删除", 404);
    const afterWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(after, tx);
    await writeAudit(
      request,
      actor,
      "取消归档",
      "receivable_orders",
      after.id,
      {
        orderNo: before.orderNo,
        taxRefundStatus: before.taxRefundStatus,
        taxArchived: Boolean(before.taxArchived || before.taxRefundArchivedAt),
        taxRefundCompleteness: before.taxRefundCompleteness,
        taxRefundCompletenessUpdatedAt: before.taxRefundCompletenessUpdatedAt,
      },
      {
        orderNo: after.orderNo,
        taxRefundStatus: after.taxRefundStatus,
        taxArchived: false,
        taxRefundCompleteness: completeness,
        taxRefundCompletenessUpdatedAt: mutationVersion,
        remark: optional(input.remark),
      },
      tx,
    );
    return afterWithLogistics;
  });
  return serializeOrder(order);
}

export async function settleCommission(request: AuditRequestLike, actor: ActorLike, orderId: string, input: TaxRefundActionInput = {}) {
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
      const { summary, commissionAmountCny } = assertCommissionCanSettle(before, commissionFormulaSettings);
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
        throw codedError("订单数据已变化，请刷新后重新结算。", 409, "COMMISSION_SETTLEMENT_CONFLICT");
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
          commissionFormulaDeductions: JSON.parse(JSON.stringify(summary.commissionFormulaDeductions || [])) as Prisma.InputJsonValue,
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
      await writeAudit(request, actor, "结算业务员提成", "receivable_orders", order.id, before, order, tx);
      return { order };
    }, COMMISSION_SETTLEMENT_TRANSACTION_OPTIONS);
    return serializeOrder(order);
  } catch (error: unknown) {
    const typedError = error as { status?: number; code?: string };
    if (typedError.status) throw error;
    if (["P2034", "P2002"].includes(String(typedError.code || ""))) {
      throw codedError("订单数据已变化，请刷新后重新结算。", 409, "COMMISSION_SETTLEMENT_CONFLICT");
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
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以撤销业务员提成结算。", 403, "PERMISSION_DENIED");
  }
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const reason = nonEmpty(input.reason || input.reversalReason || input.remark);
  if (!reason) {
    throw codedError("撤销提成结算必须填写原因。", 400, "COMMISSION_REVERSAL_REASON_REQUIRED");
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
        throw codedError("该订单没有可撤销的提成结算。", 400, "COMMISSION_NOT_SETTLED");
      }
      const reversedAt = new Date();
      const unlocked = await tx.receivableOrder.updateMany({
        where: {
          id: orderId,
          deletedAt: null,
          updatedAt: before.updatedAt,
        },
        data: {
          commissionStatus: "未结算",
          commissionSettledById: null,
          commissionSettledAt: null,
          commissionSettlementRemark: null,
          updatedById: actorId,
        },
      });
      if (unlocked.count !== 1) {
        throw codedError("订单数据已变化，请刷新后重新撤销结算。", 409, "COMMISSION_REVERSAL_CONFLICT");
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
        throw codedError("提成结算记录已变化，请刷新后重新撤销。", 409, "COMMISSION_REVERSAL_CONFLICT");
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
        {
          order: before,
          settlementRecords,
        },
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
      throw codedError("订单数据已变化，请刷新后重新撤销结算。", 409, "COMMISSION_REVERSAL_CONFLICT");
    }
    throw codedError("数据库写入失败，业务员提成结算未撤销。", 500, "DATABASE_ERROR");
  }
}
