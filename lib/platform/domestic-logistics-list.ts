import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  assertRead,
  logServerError,
  pageParams,
} from "./shared";
import {
  domesticLogisticsOrderInclude,
  serializeDomesticLogisticsOrder,
  type DomesticLogisticsOrderDto,
} from "./domestic-logistics-ops";
import { canAccessDomesticLogisticsOrder } from "./masters-access";
import {
  DOMESTIC_LOGISTICS_LIST_PAGE_SIZE_MAX,
  domesticLogisticsListFiltersFromQuery,
  type DomesticLogisticsActorInput,
  type DomesticLogisticsListFilters,
  type DomesticLogisticsQuery,
} from "./domestic-logistics-context";
import {
  domesticLogisticsListSqlWhere,
  domesticLogisticsSupplierStatusSql,
  isShipsgoTrackingSchemaError,
} from "./domestic-logistics-list-sql";

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
