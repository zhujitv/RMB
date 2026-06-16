// @ts-nocheck
import { prisma } from "../prisma";
import {
  effectivePermissions,
  nonEmpty,
  pageParams,
  pageResult,
  serializeUser,
} from "./shared";
import { orderAccessWhere } from "./order-access";

async function auditLogAccessWhere(actor) {
  if (!actor) return {};
  const scope = effectivePermissions(actor).dataScope;
  if (actor.role === "管理员" || scope === "ALL") return {};
  if (scope === "OWN") {
    const [customers, orders] = await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null, salespersonUserId: actor.id },
        select: { id: true },
      }),
      prisma.receivableOrder.findMany({
        where: { deletedAt: null, ...orderAccessWhere(actor) },
        select: { id: true },
      }),
    ]);
    const customerIds = customers.map((item) => item.id);
    const orderIds = orders.map((item) => item.id);
    const [payments, costs, documents, domesticLogisticsInfos] = orderIds.length ? await Promise.all([
      prisma.payment.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true } }),
      prisma.orderCost.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true } }),
      prisma.orderDocument.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true } }),
      prisma.domesticLogisticsInfo.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true } }),
    ]) : [[], [], [], []];
    const entityFilters = [
      customerIds.length ? { entityType: "customers", entityId: { in: customerIds } } : null,
      orderIds.length ? { entityType: "receivable_orders", entityId: { in: orderIds } } : null,
      payments.length ? { entityType: "payments", entityId: { in: payments.map((item) => item.id) } } : null,
      costs.length ? { entityType: "order_costs", entityId: { in: costs.map((item) => item.id) } } : null,
      documents.length ? { entityType: "order_documents", entityId: { in: documents.map((item) => item.id) } } : null,
      domesticLogisticsInfos.length ? { entityType: "domestic_logistics_infos", entityId: { in: domesticLogisticsInfos.map((item) => item.id) } } : null,
    ].filter(Boolean);
    return entityFilters.length ? { OR: entityFilters } : { entityId: "__no_audit_access__" };
  }
  return { entityId: "__no_audit_access__" };
}

export async function getAuditLogs(query, options = {}) {
  const keyword = nonEmpty(query?.get("keyword") || query?.get("q") || query?.get("search"));
  const action = nonEmpty(query?.get("action"));
  const filterWhere = {
    entityType: { not: "shipping_document_notifications" },
    ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
    ...(keyword ? {
      OR: [
        { action: { contains: keyword, mode: "insensitive" } },
        { entityType: { contains: keyword, mode: "insensitive" } },
        { entityId: { contains: keyword, mode: "insensitive" } },
        { ipAddress: { contains: keyword, mode: "insensitive" } },
        { user: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { user: { is: { email: { contains: keyword, mode: "insensitive" } } } },
      ],
    } : {}),
  };
  const accessWhere = await auditLogAccessWhere(options.actor);
  const where = Object.keys(accessWhere).length
    ? { AND: [accessWhere, filterWhere] }
    : filterWhere;
  const { page, pageSize } = pageParams(query, options.defaultPageSize || 50, 200);
  const [total, logs] = options.paginated ? await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { user: true },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]) : [0, await prisma.auditLog.findMany({
    where,
    include: { user: true },
    orderBy: [{ createdAt: "desc" }],
    take: Math.min(200, Math.max(20, Number(query?.get("limit") || 100))),
  })];
  const production = process.env.NODE_ENV === "production";
  const entityTypeLabels = {
    receivable_orders: "订单",
    payments: "收款",
    order_costs: "成本",
    customers: "客户",
    suppliers: "供应商",
    users: "用户",
    order_documents: "文件",
    shipping_document_notifications: "清关资料通知",
    attachments: "附件",
    exchange_rates: "汇率",
    exchange_rate_settings: "汇率设置",
  };
  const displayValue = (payload = {}) => [
    payload.orderNo,
    payload.order?.orderNo,
    payload.fileName,
    payload.supplierName,
    payload.supplierNameSnapshot,
    payload.vendorName,
    payload.customerName,
    payload.customerNameSnapshot,
    payload.name,
    payload.email,
    payload.supplier?.supplierName,
    payload.customer?.name,
  ].map((value) => String(value || "").trim()).find(Boolean);
  const rows = logs.map((log) => ({
    id: log.id,
    user: serializeUser(log.user),
    action: log.action,
    entityType: log.entityType,
    entityLabel: `${entityTypeLabels[log.entityType] || log.entityType || "业务对象"}：${displayValue(log.afterData || {}) || displayValue(log.beforeData || {}) || "业务记录"}`,
    ...(production ? {} : {
      entityId: log.entityId,
      beforeData: log.beforeData,
      afterData: log.afterData,
    }),
    ipAddress: log.ipAddress || "",
    createdAt: log.createdAt,
  }));
  return options.paginated ? pageResult(rows, total, page, pageSize) : rows;
}
