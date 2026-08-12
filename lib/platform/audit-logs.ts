import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  effectivePermissions,
  isPlainRecord,
  nonEmpty,
  pageParams,
  pageResult,
  serializeUser,
} from "./shared";
import { orderAccessWhere } from "./order-access";

type AuditLogOptions = {
  actor?: { id?: string; role?: string; customPermissions?: unknown } | null;
  defaultPageSize?: number;
  paginated?: boolean;
};
type PayloadLike = Record<string, unknown>;
type AuditActor = NonNullable<AuditLogOptions["actor"]>;
type AuditQuery = {
  get: (key: string) => string | null;
};

const AUDIT_ACCESS_ID_SCAN_LIMIT = 1000;

async function auditLogAccessWhere(actor: AuditActor | null | undefined): Promise<Prisma.AuditLogWhereInput> {
  if (!actor) return {};
  const scope = effectivePermissions(actor).dataScope;
  if (actor.role === "管理员" || scope === "ALL") return {};
  if (scope === "OWN") {
    const [customers, orders, salesExecutions] = await Promise.all([
      prisma.customer.findMany({
        where: { deletedAt: null, salespersonUserId: actor.id },
        select: { id: true },
        take: AUDIT_ACCESS_ID_SCAN_LIMIT,
      }),
      prisma.receivableOrder.findMany({
        where: { deletedAt: null, ...orderAccessWhere(actor) },
        select: { id: true },
        take: AUDIT_ACCESS_ID_SCAN_LIMIT,
      }),
      prisma.salesExecution.findMany({
        where: { salespersonUserId: actor.id },
        select: { id: true },
        take: AUDIT_ACCESS_ID_SCAN_LIMIT,
      }),
    ]);
    const customerIds = customers.map((item) => item.id);
    const orderIds = orders.map((item) => item.id);
    const salesExecutionIds = salesExecutions.map((item) => item.id);
    const [payments, costs, documents, domesticLogisticsInfos] = orderIds.length ? await Promise.all([
      prisma.payment.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true }, take: AUDIT_ACCESS_ID_SCAN_LIMIT }),
      prisma.orderCost.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true }, take: AUDIT_ACCESS_ID_SCAN_LIMIT }),
      prisma.orderDocument.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true }, take: AUDIT_ACCESS_ID_SCAN_LIMIT }),
      prisma.domesticLogisticsInfo.findMany({ where: { deletedAt: null, orderId: { in: orderIds } }, select: { id: true }, take: AUDIT_ACCESS_ID_SCAN_LIMIT }),
    ]) : [[], [], [], []];
    const entityFilters: Prisma.AuditLogWhereInput[] = [];
    if (customerIds.length) entityFilters.push({ entityType: "customers", entityId: { in: customerIds } });
    if (orderIds.length) entityFilters.push({ entityType: "receivable_orders", entityId: { in: orderIds } });
    if (salesExecutionIds.length) entityFilters.push({ entityType: "sales_executions", entityId: { in: salesExecutionIds } });
    if (payments.length) entityFilters.push({ entityType: "payments", entityId: { in: payments.map((item) => item.id) } });
    if (costs.length) entityFilters.push({ entityType: "order_costs", entityId: { in: costs.map((item) => item.id) } });
    if (documents.length) entityFilters.push({ entityType: "order_documents", entityId: { in: documents.map((item) => item.id) } });
    if (domesticLogisticsInfos.length) entityFilters.push({ entityType: "domestic_logistics_infos", entityId: { in: domesticLogisticsInfos.map((item) => item.id) } });
    return entityFilters.length ? { OR: entityFilters } : { entityId: "__no_audit_access__" };
  }
  return { entityId: "__no_audit_access__" };
}

export async function getAuditLogs(query: AuditQuery | null | undefined, options: AuditLogOptions = {}) {
  const keyword = nonEmpty(query?.get("keyword") || query?.get("q") || query?.get("search"));
  const action = nonEmpty(query?.get("action"));
  const filterWhere: Prisma.AuditLogWhereInput = {
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
  const where: Prisma.AuditLogWhereInput = Object.keys(accessWhere).length
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
  const entityTypeLabels: Record<string, string> = {
    receivable_orders: "订单",
    sales_executions: "销售执行单",
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
  const displayValue = (value: unknown = {}) => {
    const payload: PayloadLike = isPlainRecord(value) ? value : {};
    const order = isPlainRecord(payload.order) ? payload.order : undefined;
    const supplier = isPlainRecord(payload.supplier) ? payload.supplier : undefined;
    const customer = isPlainRecord(payload.customer) ? payload.customer : undefined;
    return [
    payload.orderNo,
    order?.orderNo,
    payload.fileName,
    payload.supplierName,
    payload.supplierNameSnapshot,
    payload.vendorName,
    payload.customerName,
    payload.customerNameSnapshot,
    payload.name,
    payload.email,
    supplier?.supplierName,
      customer?.name,
    ].map((item) => String(item || "").trim()).find(Boolean);
  };
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
