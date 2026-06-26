import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  DOMESTIC_LOGISTICS_TRANSPORT_TYPES,
  assertJsonObject,
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
  domesticLogisticsOrderInclude,
  domesticLogisticsRemark,
  domesticLogisticsSelectWithOrder,
  domesticLogisticsSubmitterRole,
  type DomesticLogisticsOrderDto,
  normalizeDomesticTransportItems,
  orderArchiveWhereForScope,
  serializeDomesticLogisticsOrder,
  sortDomesticLogisticsOrders,
} from "./domestic-logistics-ops";
import { buildExportInvoiceRemarkFromTransportItems, formatExportInvoiceRemark } from "./export-invoice-remark";
import {
  canAccessDomesticLogisticsOrder,
  canClaimDomesticLogisticsOrder,
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";
import { orderAccessWhere } from "./order-access";

type DomesticLogisticsInput = Record<string, unknown>;
type DomesticLogisticsQuery = {
  get(key: string): string | null;
};
type DomesticLogisticsListFilters = {
  keyword: string;
  businessScope: ReturnType<typeof archiveScope>;
};
type DomesticLogisticsActorInput = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
  supplierId?: string | null;
} | null | undefined;
type DomesticLogisticsActor = {
  id: string;
  role?: string;
  customPermissions?: unknown;
  supplierId?: string | null;
};
type AuditRequestLike = Parameters<typeof writeAudit>[0];

function actorRole(actor: DomesticLogisticsActorInput) {
  return String(actor?.role || "");
}

function requireDomesticLogisticsActor(actor: DomesticLogisticsActorInput): DomesticLogisticsActor {
  if (!actor?.id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return {
    id: actor.id,
    role: actor.role || undefined,
    customPermissions: actor.customPermissions,
    supplierId: actor.supplierId || null,
  };
}

function domesticLogisticsListFiltersFromQuery(query: DomesticLogisticsQuery): DomesticLogisticsListFilters {
  const keyword = nonEmpty(query.get("keyword"));
  const businessScope = archiveScope(query);
  return { keyword, businessScope };
}

function domesticLogisticsKeywordWhere(keyword: string): Prisma.ReceivableOrderWhereInput {
  return keyword
    ? {
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
    }
    : {};
}

function domesticLogisticsListWhere(filters: DomesticLogisticsListFilters, actor: DomesticLogisticsActorInput): Prisma.ReceivableOrderWhereInput {
  const andConditions: Prisma.ReceivableOrderWhereInput[] = [];
  const keywordWhere = domesticLogisticsKeywordWhere(filters.keyword);
  if (Object.keys(keywordWhere).length) andConditions.push(keywordWhere);
  if (actorRole(actor) === "业务员") andConditions.push(orderAccessWhere(actor));
  if (isExternalLogisticsSupplierAccount(actor)) {
    const supplierId = nonEmpty(actor?.supplierId);
    andConditions.push({ logisticsSuppliers: { some: { supplierId } } });
  } else if (actorRole(actor) === "物流供应商") {
    andConditions.push({ id: "__no_supplier_bound__" });
  }
  if (filters.businessScope === "current") {
    andConditions.push({ status: { notIn: ["已关闭", "已取消"] } });
  }
  return {
    deletedAt: null,
    ...orderArchiveWhereForScope(filters.businessScope),
    ...(andConditions.length ? { AND: andConditions } : {}),
  };
}

export async function listDomesticLogisticsOrders(query: DomesticLogisticsQuery, actor: DomesticLogisticsActorInput): Promise<DomesticLogisticsOrderDto[]> {
  assertRead(actor, "domesticLogistics");
  const filters = domesticLogisticsListFiltersFromQuery(query);
  const where = domesticLogisticsListWhere(filters, actor);
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: domesticLogisticsOrderInclude(),
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return orders.filter((order) => canAccessDomesticLogisticsOrder(actor, order))
    .sort(sortDomesticLogisticsOrders)
    .map((order) => serializeDomesticLogisticsOrder(order, actor));
}

async function getDomesticLogisticsOrderForActor(orderId: string, actor: DomesticLogisticsActorInput, input: DomesticLogisticsInput = {}) {
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
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(order.id));
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
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(row.orderId));
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
