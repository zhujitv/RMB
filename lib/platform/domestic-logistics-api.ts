import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  DOMESTIC_LOGISTICS_TRANSPORT_TYPES,
  assertJsonObject,
  assertRead,
  assertWrite,
  canWrite,
  codedError,
  logServerError,
  nonEmpty,
  optional,
  pageParams,
  requireText,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  serializeDomesticLogisticsInfo,
  writeAudit,
} from "./shared";
import {
  archiveScope,
  domesticLogisticsCanArchiveOrder,
  domesticLogisticsOrderInclude,
  domesticLogisticsRemark,
  domesticLogisticsSelectWithOrder,
  domesticLogisticsSubmitterRole,
  type DomesticLogisticsOrderDto,
  normalizeDomesticTransportItems,
  serializeDomesticLogisticsOrder,
} from "./domestic-logistics-ops";
import { buildExportInvoiceRemarkFromTransportItems, formatExportInvoiceRemark } from "./export-invoice-remark";
import {
  canAccessDomesticLogisticsOrder,
  canClaimDomesticLogisticsOrder,
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";
import { canAccessOrder } from "./order-access";

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
const DOMESTIC_LOGISTICS_LIST_PAGE_SIZE_MAX = 20;

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

function isShipsgoTrackingSchemaError(error: unknown) {
  const message = String((error as { message?: unknown } | null | undefined)?.message || error || "");
  return /shipsgo_trackings|ShipsgoTracking|shipsgoTrackings/i.test(message)
    && /(does not exist|not exist|relation|table|column|Unknown field|Unknown argument)/i.test(message);
}

function domesticLogisticsListSqlWhere(filters: DomesticLogisticsListFilters, actor: DomesticLogisticsActorInput) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`ro.deleted_at IS NULL`,
  ];
  if (filters.businessScope === "archive") {
    conditions.push(Prisma.sql`ro.is_archived = true`);
  } else if (filters.businessScope === "current") {
    conditions.push(Prisma.sql`ro.is_archived = false`);
    conditions.push(Prisma.sql`ro.status NOT IN ('已关闭', '已取消')`);
  }
  if (actorRole(actor) === "业务员") {
    const currentActorId = nonEmpty(actor?.id);
    conditions.push(currentActorId
      ? Prisma.sql`(ro.salesperson_user_id = ${currentActorId} OR (ro.salesperson_user_id IS NULL AND c.salesperson_user_id = ${currentActorId}))`
      : Prisma.sql`1 = 0`);
  }
  if (isExternalLogisticsSupplierAccount(actor)) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM order_logistics_suppliers ols_scope
      WHERE ols_scope.order_id = ro.id
        AND ols_scope.supplier_id = ${nonEmpty(actor.supplierId)}
    )`);
  } else if (actorRole(actor) === "物流供应商") {
    conditions.push(Prisma.sql`1 = 0`);
  }
  if (filters.keyword) {
    const keyword = `%${filters.keyword}%`;
    conditions.push(Prisma.sql`(
      ro.order_no ILIKE ${keyword}
      OR ro.bl_no ILIKE ${keyword}
      OR ro.customer_name_snapshot ILIKE ${keyword}
      OR c.name ILIKE ${keyword}
      OR c.short_name ILIKE ${keyword}
      OR EXISTS (
        SELECT 1
        FROM order_logistics_suppliers ols_keyword
        JOIN suppliers s_keyword ON s_keyword.id = ols_keyword.supplier_id
        WHERE ols_keyword.order_id = ro.id
          AND (
            s_keyword.supplier_name ILIKE ${keyword}
            OR s_keyword.supplier_type ILIKE ${keyword}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM domestic_logistics_infos dli_keyword
        LEFT JOIN domestic_logistics_transport_items dti_keyword
          ON dti_keyword.logistics_info_id = dli_keyword.id
        WHERE dli_keyword.order_id = ro.id
          AND dli_keyword.deleted_at IS NULL
          AND (
            dli_keyword.remark_text ILIKE ${keyword}
            OR dti_keyword.container_no ILIKE ${keyword}
            OR dti_keyword.container_type ILIKE ${keyword}
            OR dti_keyword.seal_no ILIKE ${keyword}
          )
      )
    )`);
  }
  return Prisma.sql`${Prisma.join(conditions, " AND ")}`;
}

function domesticLogisticsSupplierStatusSql(actor: DomesticLogisticsActorInput, alias: "lb" | "le") {
  if (!isExternalLogisticsSupplierAccount(actor)) return Prisma.empty;
  const supplierId = nonEmpty(actor.supplierId);
  return alias === "lb"
    ? Prisma.sql`AND lb.supplier_id = ${supplierId}`
    : Prisma.sql`AND le.supplier_id = ${supplierId}`;
}

async function findDomesticLogisticsPageOrderIds(
  filters: DomesticLogisticsListFilters,
  actor: DomesticLogisticsActorInput,
  page: number,
  pageSize: number,
) {
  const whereSql = domesticLogisticsListSqlWhere(filters, actor);
  const offset = (page - 1) * pageSize;
  const billSupplierSql = domesticLogisticsSupplierStatusSql(actor, "lb");
  const expenseSupplierSql = domesticLogisticsSupplierStatusSql(actor, "le");
  const totalRows = await prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS total
    FROM receivable_orders ro
    JOIN customers c ON c.id = ro.customer_id
    WHERE ${whereSql}
  `);
  const total = Number(totalRows[0]?.total || 0);
  if (!total) return { orderIds: [], total };
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT ro.id
    FROM receivable_orders ro
    JOIN customers c ON c.id = ro.customer_id
    LEFT JOIN LATERAL (
      SELECT dli.remark_text
      FROM domestic_logistics_infos dli
      WHERE dli.order_id = ro.id
        AND dli.deleted_at IS NULL
      ORDER BY dli.updated_at DESC
      LIMIT 1
    ) latest_logistics ON true
    LEFT JOIN LATERAL (
      SELECT ranked_bill.status
      FROM (
        SELECT
          CASE
            WHEN lb.audit_status IN ('未通知', '已通知开票', '通知失败', '待开票 / 通知失败', '部分未通知', '部分已通知', '部分上传发票', '部分上传', '部分已上传', '部分已确认') THEN '待开票'
            WHEN lb.audit_status IN ('已上传', '已上传发票') THEN '已上传发票'
            WHEN lb.audit_status = '部分已付款' THEN '部分付款'
            WHEN lb.audit_status = '部分待付款' THEN '待付款'
            ELSE lb.audit_status
          END AS status,
          COALESCE(lb.updated_at, lb.created_at) AS status_updated_at,
          CASE
            WHEN lb.audit_status = '已驳回' THEN 10
            WHEN lb.audit_status = '草稿' THEN 20
            WHEN lb.audit_status = '待审核' THEN 30
            WHEN lb.audit_status IN ('待开票', '未通知', '已通知开票', '通知失败', '待开票 / 通知失败', '部分未通知', '部分已通知', '部分上传发票', '部分上传', '部分已上传', '部分已确认') THEN 40
            WHEN lb.audit_status IN ('已上传', '已上传发票') THEN 50
            WHEN lb.audit_status IN ('待付款', '部分待付款') THEN 60
            WHEN lb.audit_status IN ('部分付款', '部分已付款') THEN 70
            WHEN lb.audit_status = '已付款' THEN 80
            WHEN lb.audit_status = '审核通过' THEN 90
            ELSE 999
          END AS status_rank
        FROM logistics_bills lb
        WHERE lb.order_id = ro.id
          AND lb.deleted_at IS NULL
          AND COALESCE(lb.status, 'normal') <> 'voided'
          ${billSupplierSql}
      ) ranked_bill
      ORDER BY ranked_bill.status_rank ASC, ranked_bill.status_updated_at DESC
      LIMIT 1
    ) bill_status ON true
    LEFT JOIN LATERAL (
      SELECT ranked_expense.status
      FROM (
        SELECT
          CASE
            WHEN le.audit_status IN ('未通知', '已通知开票', '通知失败', '待开票 / 通知失败', '部分未通知', '部分已通知', '部分上传发票', '部分上传', '部分已上传', '部分已确认') THEN '待开票'
            WHEN le.audit_status IN ('已上传', '已上传发票') THEN '已上传发票'
            WHEN le.audit_status = '部分已付款' THEN '部分付款'
            WHEN le.audit_status = '部分待付款' THEN '待付款'
            ELSE le.audit_status
          END AS status,
          COALESCE(le.updated_at, le.created_at) AS status_updated_at,
          CASE
            WHEN le.audit_status = '已驳回' THEN 10
            WHEN le.audit_status = '草稿' THEN 20
            WHEN le.audit_status = '待审核' THEN 30
            WHEN le.audit_status IN ('待开票', '未通知', '已通知开票', '通知失败', '待开票 / 通知失败', '部分未通知', '部分已通知', '部分上传发票', '部分上传', '部分已上传', '部分已确认') THEN 40
            WHEN le.audit_status IN ('已上传', '已上传发票') THEN 50
            WHEN le.audit_status IN ('待付款', '部分待付款') THEN 60
            WHEN le.audit_status IN ('部分付款', '部分已付款') THEN 70
            WHEN le.audit_status = '已付款' THEN 80
            WHEN le.audit_status = '审核通过' THEN 90
            ELSE 999
          END AS status_rank
        FROM logistics_expenses le
        WHERE le.order_id = ro.id
          AND le.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM logistics_bills lb
            WHERE lb.id = le.bill_id
              AND COALESCE(lb.status, 'normal') = 'voided'
          )
          ${expenseSupplierSql}
      ) ranked_expense
      ORDER BY ranked_expense.status_rank ASC, ranked_expense.status_updated_at DESC
      LIMIT 1
    ) expense_status ON true
    WHERE ${whereSql}
    ORDER BY
      GREATEST(
        CASE
          WHEN latest_logistics.remark_text IS NULL OR latest_logistics.remark_text = '' THEN 1
          ELSE 4
        END,
        CASE COALESCE(bill_status.status, expense_status.status, '未录入')
          WHEN '已驳回' THEN 1
          WHEN '草稿' THEN 1
          WHEN '待审核' THEN 3
          WHEN '审核通过' THEN 5
          WHEN '待开票' THEN 5
          WHEN '已上传发票' THEN 5
          WHEN '待付款' THEN 5
          WHEN '部分付款' THEN 5
          WHEN '已付款' THEN 5
          WHEN '未录入' THEN 2
          ELSE 0
        END
      ) ASC,
      ro.updated_at DESC,
      ro.created_at DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `);
  return { orderIds: rows.map((row) => row.id), total };
}

async function findDomesticLogisticsOrdersForList(orderIds: string[]) {
  if (!orderIds.length) return [];
  const where: Prisma.ReceivableOrderWhereInput = {
    id: { in: orderIds },
    deletedAt: null,
  };
  try {
    return await prisma.receivableOrder.findMany({
      where,
      include: domesticLogisticsOrderInclude(),
      take: orderIds.length,
    });
  } catch (error: unknown) {
    if (!isShipsgoTrackingSchemaError(error)) throw error;
    logServerError("domestic logistics list fallback: ShipsGo tracking schema unavailable", error);
    return prisma.receivableOrder.findMany({
      where,
      include: domesticLogisticsOrderInclude({ shipsgoTrackings: false }),
      take: orderIds.length,
    });
  }
}

export async function listDomesticLogisticsOrders(query: DomesticLogisticsQuery, actor: DomesticLogisticsActorInput): Promise<{
  rows: DomesticLogisticsOrderDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  assertRead(actor, "domesticLogistics");
  const filters = domesticLogisticsListFiltersFromQuery(query);
  const { page, pageSize } = pageParams(query, 20, DOMESTIC_LOGISTICS_LIST_PAGE_SIZE_MAX);
  const { orderIds: pageOrderIds, total } = await findDomesticLogisticsPageOrderIds(filters, actor, page, pageSize);
  const pageOrders = await findDomesticLogisticsOrdersForList(pageOrderIds);
  const pageOrderById = new Map(pageOrders.map((order) => [order.id, order]));
  const rows = pageOrderIds
    .map((orderId) => pageOrderById.get(orderId))
    .filter((order): order is NonNullable<typeof order> => Boolean(order))
    .filter((order) => canAccessDomesticLogisticsOrder(actor, order))
    .map((order) => serializeDomesticLogisticsOrder(order, actor));
  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

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
