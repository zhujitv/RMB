import { prisma } from "../prisma";
import {
  canWrite,
  codedError,
  includeOrderRelations,
  nonEmpty,
  optional,
  orderStatusAfterShipment,
  permissionError,
  refreshTaxRefundCompletenessForOrder,
  runNonCriticalTask,
  serializeOrder,
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
import {
  EDITABLE_TAX_REFUND_STATUSES,
  exchangeRateSettingsInTransaction,
  nextTaxRefundMutationVersion,
  runTaxRefundStatusTransaction,
  taxRefundCompletenessData,
  taxRefundCompletenessError,
  taxRefundStatusSerializationConflict,
} from "./tax-refunds-action-support";

export async function refreshTaxRefundCompletenessNow(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
) {
  if (!canWrite(actor, "taxRefund")) {
    throw permissionError("没有权限重新计算退税完整度", 403);
  }
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
    taxRefundCompletenessUpdatedAt: completeness
      ? new Date()
      : order.taxRefundCompletenessUpdatedAt,
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

export async function updateTaxRefundStatus(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  status: string,
  input: TaxRefundActionInput = {},
) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限修改退税状态", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  if (!EDITABLE_TAX_REFUND_STATUSES.includes(status)) {
    throw permissionError("请选择有效退税状态", 400);
  }
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
      throw codedError(
        "该订单已提交退税并归档，不能重复提交。",
        400,
        "TAX_REFUND_ALREADY_SUBMITTED",
      );
    }
    const forceSubmit = status === "SUBMITTED"
      && actor?.role === "管理员"
      && settings.allowAdminIncompleteTaxSubmit === true
      && input.forceSubmit === true;
    if (["READY", "SUBMITTED"].includes(status) && !completeness.complete && !forceSubmit) {
      throw taxRefundCompletenessError(completeness);
    }
    if (forceSubmit && !optional(input.forceReason)) {
      throw codedError(
        "强制提交退税必须填写原因。",
        400,
        "FORCE_SUBMIT_REASON_REQUIRED",
      );
    }
    if (status === "SUBMITTED") {
      const unverifiedInvoice = await tx.supplierDocumentRequest.findFirst({
        where: {
          orderId,
          deletedAt: null,
          contractStatus: "APPROVED",
          requiredDocumentTypes: { array_contains: ["SUPPLIER_INVOICE"] },
          invoiceMatchStatus: { not: "CONFIRMED" },
        },
        select: { id: true, contractNo: true, invoiceMatchStatus: true },
      });
      if (unverifiedInvoice) {
        throw codedError(
          `合同${unverifiedInvoice.contractNo || ""}对应发票尚未通过OCR完整匹配和人工确认，不能递交退税。`,
          409,
          "SUPPLIER_INVOICE_REVIEW_REQUIRED",
        );
      }
      await assertTaxRefundLogisticsBusinessClosure(orderId, tx);
    }

    const mutationVersion = nextTaxRefundMutationVersion(
      before.updatedAt,
      before.taxRefundCompletenessUpdatedAt,
    );
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
          status: orderStatusAfterShipment(before.status),
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
        status: before.status,
        taxRefundStatus: before.taxRefundStatus,
        taxArchived: beforeArchived,
        taxRefundCompleteness: before.taxRefundCompleteness,
        taxRefundCompletenessUpdatedAt: before.taxRefundCompletenessUpdatedAt,
      },
      {
        orderNo: after.orderNo,
        status: after.status,
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

export async function cancelTaxRefundArchive(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  nextStatus = "NOT_READY",
  input: TaxRefundActionInput = {},
) {
  if (actor?.role !== "管理员" || !canWrite(actor, "taxRefund")) {
    throw permissionError("只有管理员可以取消归档。", 403);
  }
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const restoredStatus = EDITABLE_TAX_REFUND_STATUSES.includes(nextStatus)
    && nextStatus !== "SUBMITTED"
    ? nextStatus
    : "NOT_READY";
  const order = await runTaxRefundStatusTransaction(async (tx) => {
    await lockBusinessOrderForUpdate(tx, orderId);
    const before = await tx.receivableOrder.findFirst({
      where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
      include: includeOrderRelations(),
    });
    if (!before) throw permissionError("应收订单不存在或已删除", 404);
    const beforeWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(before, tx);
    const completeness = taxDocumentCompleteness(beforeWithLogistics);
    const finalStatus = restoredStatus === "READY" && !completeness.complete
      ? "NOT_READY"
      : restoredStatus;
    const mutationVersion = nextTaxRefundMutationVersion(
      before.updatedAt,
      before.taxRefundCompletenessUpdatedAt,
    );
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
