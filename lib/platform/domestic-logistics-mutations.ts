import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  DOMESTIC_LOGISTICS_TRANSPORT_TYPES,
  assertJsonObject,
  assertWrite,
  canWrite,
  codedError,
  nonEmpty,
  optional,
  requireText,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  serializeDomesticLogisticsInfo,
  writeAudit,
} from "./shared";
import {
  domesticLogisticsCanArchiveOrder,
  domesticLogisticsOrderInclude,
  domesticLogisticsRemark,
  domesticLogisticsSelectWithOrder,
  domesticLogisticsSubmitterRole,
  normalizeDomesticTransportItems,
} from "./domestic-logistics-ops";
import {
  buildExportInvoiceRemarkFromTransportItems,
  formatExportInvoiceRemark,
} from "./export-invoice-remark";
import {
  canAccessDomesticLogisticsOrder,
  canClaimDomesticLogisticsOrder,
} from "./masters-access";
import { canAccessOrder } from "./order-access";
import {
  requireDomesticLogisticsActor,
  type AuditRequestLike,
  type DomesticLogisticsActorInput,
  type DomesticLogisticsInput,
} from "./domestic-logistics-context";

export async function archiveDomesticLogisticsOrders(request: AuditRequestLike, actor: DomesticLogisticsActorInput, input: unknown = {}) {
  assertWrite(actor, "domesticLogistics");
  const currentActor = requireDomesticLogisticsActor(actor);
  if (currentActor.role !== "管理员") {
    throw codedError("只有管理员可以批量归档物流信息。", 403, "PERMISSION_DENIED");
  }
  const body = assertJsonObject(input);
  const requestedOrderIds = Array.isArray(body.orderIds)
    ? Array.from(new Set(body.orderIds.map((value) => nonEmpty(value)).filter(Boolean)))
    : [];
  if (!requestedOrderIds.length) {
    throw codedError("请选择需要归档的订单。", 400, "NO_ORDERS_SELECTED");
  }

  const orders = await prisma.receivableOrder.findMany({
    where: { id: { in: requestedOrderIds }, deletedAt: null },
    include: domesticLogisticsOrderInclude({ shipsgoTrackings: false }),
    take: requestedOrderIds.length,
  });
  const accessibleOrders = orders.filter((order) => canAccessDomesticLogisticsOrder(currentActor, order));
  const eligibleOrders = accessibleOrders.filter((order) => domesticLogisticsCanArchiveOrder(order, currentActor));
  const eligibleIds = eligibleOrders.map((order) => order.id);
  const foundIds = new Set(accessibleOrders.map((order) => order.id));
  const skippedIds = requestedOrderIds.filter((orderId) => !eligibleIds.includes(orderId));

  if (!eligibleIds.length) {
    throw codedError("没有符合归档条件的订单，仅允许批量归档审核通过且已上传发票的订单。", 400, "NO_ARCHIVABLE_ORDERS");
  }

  const updateResult = await prisma.receivableOrder.updateMany({
    where: {
      id: { in: eligibleIds },
      deletedAt: null,
      isArchived: false,
    },
    data: {
      isArchived: true,
      updatedById: currentActor.id,
    },
  });

  await runNonCriticalTask("物流信息批量归档日志写入", () => writeAudit(
    request,
    currentActor,
    "批量归档物流信息",
    "receivable_orders",
    "batch",
    null,
    {
      archivedOrderIds: eligibleIds,
      skippedOrderIds: skippedIds,
      missingOrInaccessibleOrderIds: requestedOrderIds.filter((orderId) => !foundIds.has(orderId)),
      archivedCount: updateResult.count,
    },
  ));

  return {
    success: true,
    archivedIds: eligibleIds,
    skippedIds,
    archivedCount: updateResult.count,
  };
}

async function getDomesticLogisticsOrderForActor(orderId: string, actor: DomesticLogisticsActorInput, input: DomesticLogisticsInput = {}) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: domesticLogisticsOrderInclude({ shipsgoTrackings: false }),
  });
  if (!order) throw codedError("订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, order) && !canClaimDomesticLogisticsOrder(actor, order, input)) {
    throw codedError("无权限访问该订单物流信息", 403, "PERMISSION_DENIED");
  }
  return order;
}

export async function saveDomesticLogisticsInfo(request: AuditRequestLike, actor: DomesticLogisticsActorInput, input: unknown, id: string | null = null) {
  assertWrite(actor, "domesticLogistics");
  const currentActor = requireDomesticLogisticsActor(actor);
  const body: DomesticLogisticsInput = assertJsonObject(input);
  if (currentActor.role === "财务") {
    throw codedError("财务只负责查看、整理和下载物流资料，不能录入或修改。", 403, "FINANCE_CANNOT_EDIT_DOMESTIC_LOGISTICS");
  }
  const orderId = requireText(body.orderId || body.order_id, "订单");
  const order = await getDomesticLogisticsOrderForActor(orderId, currentActor, body);
  const before = id
    ? await prisma.domesticLogisticsInfo.findFirst({ where: { id, deletedAt: null }, select: domesticLogisticsSelectWithOrder() })
    : ((order.domesticLogisticsInfos || [])[0] || null);
  if (id && !before) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
  if (id && before) {
    if (before.orderId !== order.id) {
      throw codedError("物流信息与当前订单不匹配，禁止跨订单修改。", 409, "DOMESTIC_LOGISTICS_ORDER_MISMATCH");
    }
    const beforeOrder = "order" in before ? before.order : order;
    if (!canAccessDomesticLogisticsOrder(currentActor, beforeOrder)) {
      throw codedError("无权限修改该订单物流信息", 403, "PERMISSION_DENIED");
    }
  }
  const requestedTransportType = String(body.transportType || "");
  const transportType = DOMESTIC_LOGISTICS_TRANSPORT_TYPES.includes(requestedTransportType) ? requestedTransportType : "TRUCK";
  const transportItems = normalizeDomesticTransportItems(body, transportType);
  const firstTransportItem = transportItems[0] || {};
  const remarkTextManualEdited = body.remarkTextManualEdited === true || body.remarkTextManualEdited === "true";
  const customsExportInvoiceRemark = transportType === "EXPRESS"
    ? { containers: [] }
    : buildExportInvoiceRemarkFromTransportItems(transportItems);
  const remarkText = remarkTextManualEdited
    ? optional(body.remarkText)
    : (formatExportInvoiceRemark(customsExportInvoiceRemark) || domesticLogisticsRemark({ ...body, transportType, transportItems }));
  const data = {
    orderId: order.id,
    transportType,
    truckPlateNo: transportType === "EXPRESS" ? null : firstTransportItem.truckPlateNo || null,
    trailerPlateNo: transportType === "EXPRESS" ? null : firstTransportItem.trailerPlateNo || null,
    departurePlace: transportType === "EXPRESS" ? null : firstTransportItem.departurePlace || null,
    destinationPlace: transportType === "EXPRESS" ? requireText(body.destinationPlace, "到达地") : firstTransportItem.arrivalPlace || null,
    departureDate: transportType === "EXPRESS" ? null : firstTransportItem.departureDate || null,
    expressTrackingNo: transportType === "EXPRESS" ? requireText(body.expressTrackingNo, "快递单号") : null,
    cargoDescription: transportType === "EXPRESS" ? requireText(body.cargoDescription, "运输货物名称") : firstTransportItem.cargoName || null,
    remarkTextManualEdited,
    remarkText,
    exportInvoice: { remark: customsExportInvoiceRemark } as Prisma.InputJsonValue,
    submittedByUserId: currentActor.id,
    submittedAt: new Date(),
    submitterRole: domesticLogisticsSubmitterRole(currentActor),
    financeStatus: "ARCHIVED",
    financeConfirmedById: null,
    financeConfirmedAt: null,
    rejectReason: null,
    correctionRequested: false,
    correctionReason: null,
  };
  const row = await prisma.$transaction(async (tx) => {
    const saved = before
      ? await tx.domesticLogisticsInfo.update({ where: { id: before.id }, data })
      : await tx.domesticLogisticsInfo.create({ data });
    await tx.domesticLogisticsTransportItem.deleteMany({ where: { logisticsInfoId: saved.id } });
    if (transportItems.length) {
      await tx.domesticLogisticsTransportItem.createMany({
	        data: transportItems.map((item, index) => ({
	          logisticsInfoId: saved.id,
	          containerNo: item.containerNo || null,
	          containerType: item.containerType || null,
	          sealNo: item.sealNo || null,
	          truckPlateNo: item.truckPlateNo || null,
          trailerPlateNo: item.trailerPlateNo || null,
          departureDate: item.departureDate || null,
          departurePlace: item.departurePlace || null,
          arrivalPlace: item.arrivalPlace || null,
          cargoName: item.cargoName || null,
          remark: item.remark || null,
          sortOrder: index,
        })),
      });
    }
    return tx.domesticLogisticsInfo.findUnique({ where: { id: saved.id }, select: domesticLogisticsSelectWithOrder() });
  });
  if (!row) throw codedError("物流信息保存失败，请重试。", 500, "DOMESTIC_LOGISTICS_SAVE_FAILED");
  await runNonCriticalTask("物流信息操作日志写入", () => writeAudit(request, currentActor, before ? "更新物流信息" : "新增物流信息", "domestic_logistics_infos", row.id, before, row));
  scheduleTaxRefundCompletenessRefresh(order.id);
  return serializeDomesticLogisticsInfo(row);
}

export async function deleteDomesticLogisticsInfo(request: AuditRequestLike, actor: DomesticLogisticsActorInput, id: string) {
  const currentActor = requireDomesticLogisticsActor(actor);
  if (currentActor.role !== "管理员") throw codedError("只有管理员可以删除物流信息。", 403, "PERMISSION_DENIED");
  const before = await prisma.domesticLogisticsInfo.findFirst({
    where: { id, deletedAt: null },
    select: domesticLogisticsSelectWithOrder(),
  });
  if (!before) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
  const row = await prisma.domesticLogisticsInfo.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: domesticLogisticsSelectWithOrder(),
  });
  await runNonCriticalTask("物流信息删除操作日志写入", () => writeAudit(request, currentActor, "删除物流信息", "domestic_logistics_infos", row.id, before, row));
  scheduleTaxRefundCompletenessRefresh(row.orderId);
}

export async function requestDomesticLogisticsCorrection(request: AuditRequestLike, actor: DomesticLogisticsActorInput, id: string, input: unknown = {}) {
  const body: DomesticLogisticsInput = assertJsonObject(input);
  const before = await prisma.domesticLogisticsInfo.findFirst({
    where: { id, deletedAt: null },
    select: domesticLogisticsSelectWithOrder(),
  });
  if (!before) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
  if (!assertCorrectionPermission(actor)) {
    throw codedError("无权限申请更正该物流信息。", 403, "PERMISSION_DENIED");
  }
  if (!canAccessDomesticLogisticsOrder(actor, before.order) && !canAccessOrder(actor, before.order)) {
    throw codedError("无权限申请更正该物流信息。", 403, "PERMISSION_DENIED");
  }
  const row = await prisma.domesticLogisticsInfo.update({
    where: { id },
    data: {
      correctionRequested: true,
      correctionReason: requireText(body.correctionReason || body.reason, "更正原因"),
    },
    select: domesticLogisticsSelectWithOrder(),
  });
  await runNonCriticalTask("物流信息更正申请日志写入", () => writeAudit(request, actor, "申请更正物流信息", "domestic_logistics_infos", row.id, before, row));
  return serializeDomesticLogisticsInfo(row);
}

function assertCorrectionPermission(actor: DomesticLogisticsActorInput) {
  return canWrite(actor, "taxRefund") || canWrite(actor, "domesticLogistics");
}
