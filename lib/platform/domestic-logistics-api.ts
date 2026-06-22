// @ts-nocheck
import { prisma } from "../prisma";
import {
  DOMESTIC_LOGISTICS_TRANSPORT_TYPES,
  assertRead,
  assertWrite,
  canWrite,
  codedError,
  nonEmpty,
  optional,
  refreshTaxRefundCompleteness,
  requireText,
  runNonCriticalTask,
  serializeDomesticLogisticsInfo,
  writeAudit,
} from "./shared";
import {
  archiveScope,
  domesticLogisticsInclude,
  domesticLogisticsOrderInclude,
  domesticLogisticsRemark,
  domesticLogisticsSubmitterRole,
  normalizeDomesticTransportItems,
  orderArchiveWhereForScope,
  serializeDomesticLogisticsOrder,
  sortDomesticLogisticsOrders,
} from "./domestic-logistics-ops";
import {
  canAccessDomesticLogisticsOrder,
  canClaimDomesticLogisticsOrder,
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";
import { orderAccessWhere } from "./order-access";

export async function listDomesticLogisticsOrders(query, actor) {
  assertRead(actor, "domesticLogistics");
  const keyword = nonEmpty(query.get("keyword"));
  const businessScope = archiveScope(query);
  const andConditions = [];
  if (keyword) {
    andConditions.push({
      OR: [
        { orderNo: { contains: keyword, mode: "insensitive" } },
        { blNo: { contains: keyword, mode: "insensitive" } },
        { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
        { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
        { logisticsSuppliers: { some: { supplier: { is: { supplierName: { contains: keyword, mode: "insensitive" } } } } } },
        { logisticsSuppliers: { some: { supplier: { is: { supplierType: { contains: keyword, mode: "insensitive" } } } } } },
        { domesticLogisticsInfos: { some: {
          deletedAt: null,
          OR: [
            { remarkText: { contains: keyword, mode: "insensitive" } },
	            { transportItems: { some: {
	              OR: [
	                { containerNo: { contains: keyword, mode: "insensitive" } },
	                { containerType: { contains: keyword, mode: "insensitive" } },
	                { sealNo: { contains: keyword, mode: "insensitive" } },
	              ],
	            } } },
          ],
        } } },
      ],
    });
  }
  if (actor?.role === "业务员") andConditions.push(orderAccessWhere(actor));
  if (isExternalLogisticsSupplierAccount(actor)) {
    andConditions.push({ logisticsSuppliers: { some: { supplierId: actor.supplierId } } });
  } else if (actor?.role === "物流供应商") {
    andConditions.push({ id: "__no_supplier_bound__" });
  }
  if (businessScope === "current") {
    andConditions.push({ status: { notIn: ["已关闭", "已取消"] } });
  }
  const where = {
    deletedAt: null,
    ...orderArchiveWhereForScope(businessScope),
    ...(andConditions.length ? { AND: andConditions } : {}),
  };
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: domesticLogisticsOrderInclude(),
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return orders.filter((order) => canAccessDomesticLogisticsOrder(actor, order))
    .sort(sortDomesticLogisticsOrders)
    .map(serializeDomesticLogisticsOrder);
}

async function getDomesticLogisticsOrderForActor(orderId, actor, input = {}) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: domesticLogisticsOrderInclude(),
  });
  if (!order) throw codedError("订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, order) && !canClaimDomesticLogisticsOrder(actor, order, input)) {
    throw codedError("无权限访问该订单物流信息", 403, "PERMISSION_DENIED");
  }
  return order;
}

export async function saveDomesticLogisticsInfo(request, actor, input, id = null) {
  assertWrite(actor, "domesticLogistics");
  if (actor.role === "财务") {
    throw codedError("财务只负责查看、整理和下载物流资料，不能录入或修改。", 403, "FINANCE_CANNOT_EDIT_DOMESTIC_LOGISTICS");
  }
  const orderId = requireText(input.orderId || input.order_id, "订单");
  const order = await getDomesticLogisticsOrderForActor(orderId, actor, input);
  const before = id
    ? await prisma.domesticLogisticsInfo.findFirst({ where: { id, deletedAt: null }, include: domesticLogisticsInclude() })
    : ((order.domesticLogisticsInfos || [])[0] || null);
  if (id && !before) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
  const transportType = DOMESTIC_LOGISTICS_TRANSPORT_TYPES.includes(input.transportType) ? input.transportType : "TRUCK";
  const transportItems = normalizeDomesticTransportItems(input, transportType);
  const firstTransportItem = transportItems[0] || {};
  const remarkTextManualEdited = input.remarkTextManualEdited === true || input.remarkTextManualEdited === "true";
  const remarkText = remarkTextManualEdited ? optional(input.remarkText) : domesticLogisticsRemark({ ...input, transportType, transportItems });
  const data = {
    orderId: order.id,
    transportType,
    truckPlateNo: transportType === "EXPRESS" ? null : firstTransportItem.truckPlateNo || null,
    trailerPlateNo: transportType === "EXPRESS" ? null : firstTransportItem.trailerPlateNo || null,
    departurePlace: transportType === "EXPRESS" ? null : firstTransportItem.departurePlace || null,
    destinationPlace: transportType === "EXPRESS" ? requireText(input.destinationPlace, "到达地") : firstTransportItem.arrivalPlace || null,
    departureDate: transportType === "EXPRESS" ? null : firstTransportItem.departureDate || null,
    expressTrackingNo: transportType === "EXPRESS" ? requireText(input.expressTrackingNo, "快递单号") : null,
    cargoDescription: transportType === "EXPRESS" ? requireText(input.cargoDescription, "运输货物名称") : firstTransportItem.cargoName || null,
    remarkTextManualEdited,
    remarkText,
    submittedByUserId: actor.id,
    submittedAt: new Date(),
    submitterRole: domesticLogisticsSubmitterRole(actor),
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
    return tx.domesticLogisticsInfo.findUnique({ where: { id: saved.id }, include: domesticLogisticsInclude() });
  });
  await runNonCriticalTask("物流信息操作日志写入", () => writeAudit(request, actor, before ? "更新物流信息" : "新增物流信息", "domestic_logistics_infos", row.id, before, row));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(order.id));
  return serializeDomesticLogisticsInfo(row);
}

export async function deleteDomesticLogisticsInfo(request, actor, id) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以删除物流信息。", 403, "PERMISSION_DENIED");
  const before = await prisma.domesticLogisticsInfo.findFirst({
    where: { id, deletedAt: null },
    include: domesticLogisticsInclude(),
  });
  if (!before) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
  const row = await prisma.domesticLogisticsInfo.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: domesticLogisticsInclude(),
  });
  await runNonCriticalTask("物流信息删除操作日志写入", () => writeAudit(request, actor, "删除物流信息", "domestic_logistics_infos", row.id, before, row));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(row.orderId));
}

export async function requestDomesticLogisticsCorrection(request, actor, id, input = {}) {
  const before = await prisma.domesticLogisticsInfo.findFirst({
    where: { id, deletedAt: null },
    include: domesticLogisticsInclude(),
  });
  if (!before) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
  if (!assertCorrectionPermission(actor)) {
    throw codedError("无权限申请更正该物流信息。", 403, "PERMISSION_DENIED");
  }
  const row = await prisma.domesticLogisticsInfo.update({
    where: { id },
    data: {
      correctionRequested: true,
      correctionReason: requireText(input.correctionReason || input.reason, "更正原因"),
    },
    include: domesticLogisticsInclude(),
  });
  await runNonCriticalTask("物流信息更正申请日志写入", () => writeAudit(request, actor, "申请更正物流信息", "domestic_logistics_infos", row.id, before, row));
  return serializeDomesticLogisticsInfo(row);
}

function assertCorrectionPermission(actor) {
  return canWrite(actor, "taxRefund") || canWrite(actor, "domesticLogistics");
}
