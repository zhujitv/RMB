import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  canRead,
  canWrite,
  codedError,
  customerAccessWhere,
  normalizeEmail,
  optional,
  runNonCriticalTask,
  serializeCustomer,
  serializeOrderListRow,
  serializePayment,
  validEmail,
  writeAudit,
  includeOrderListRelations,
} from "./shared";
import { orderAccessWhere, scopeOrderForActor } from "./order-access";
import { quotationText, type QuotationActor } from "./quotation-values";

type QueryLike = { get(key: string): string | null };
type AuditRequest = Parameters<typeof writeAudit>[0];
type CustomerCrmActor = QuotationActor;
type CustomerBusinessRecord = ReturnType<typeof serializeOrderListRow>;
type CustomerPaymentRecord = ReturnType<typeof serializePayment>;

function requireActorId(actor: CustomerCrmActor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

function assertCustomerCrmRead(actor: CustomerCrmActor) {
  if (!canRead(actor, "customers") && !canRead(actor, "quotations")) {
    throw codedError("没有权限查看客户 CRM", 403, "PERMISSION_DENIED");
  }
}

function assertCustomerCrmWrite(actor: CustomerCrmActor) {
  if (!canWrite(actor, "customers") && !canWrite(actor, "quotations")) {
    throw codedError("没有权限维护客户 CRM", 403, "PERMISSION_DENIED");
  }
}

function dateInput(value: unknown, label: string) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw.length <= 10 ? `${raw}T00:00:00+08:00` : raw);
  if (Number.isNaN(date.getTime())) throw codedError(`${label}不是有效日期`, 400, "VALIDATION_INVALID_DATE");
  return date;
}

async function loadCustomer(customerId: string, actor: CustomerCrmActor) {
  if (!customerId) throw codedError("请选择客户", 400, "CUSTOMER_REQUIRED");
  return assertCustomerScope(actor, customerId);
}

export async function updateCustomerContactInfo(request: AuditRequest, actor: CustomerCrmActor, customerId: string, input: unknown) {
  assertCustomerCrmWrite(actor);
  const actorId = requireActorId(actor);
  const before = await loadCustomer(customerId, actor);
  const body = assertJsonObject(input);
  const contactEmail = optional(body.contactEmail);
  if (contactEmail && !validEmail(normalizeEmail(contactEmail))) {
    throw codedError(`联系邮箱格式错误：${contactEmail}`, 400, "INVALID_EMAIL_FORMAT");
  }
  const customer = await prisma.customer.update({
    where: { id: before.id },
    data: {
      contactPerson: optional(body.contactPerson),
      contactPhone: optional(body.contactPhone),
      contactEmail: contactEmail ? normalizeEmail(contactEmail) : null,
    },
    include: { salesperson: true },
  });
  await runNonCriticalTask("客户联系人操作日志写入", () => writeAudit(request, { id: actorId }, "更新客户联系人", "customers", customer.id, before, customer));
  return serializeCustomer(customer);
}

type FollowUpRow = Prisma.CustomerFollowUpGetPayload<{ include: { createdBy: { select: { name: true } }; updatedBy: { select: { name: true } } } }> & {
  customer?: { id: string; name: string | null; shortName: string | null } | null;
};

function serializeFollowUp(row: FollowUpRow) {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customer?.shortName || row.customer?.name || "",
    method: row.method || "",
    note: row.note,
    nextFollowUpAt: row.nextFollowUpAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByName: row.createdBy?.name || "",
    updatedByName: row.updatedBy?.name || "",
  };
}

function sumNumbers<T>(rows: T[], pick: (row: T) => unknown) {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
}

function paymentStatusAmount(rows: CustomerPaymentRecord[], status: string) {
  return sumNumbers(rows.filter((row) => row.status === status), (row) => row.amountCny);
}

function shippedOrderWhere(): Prisma.ReceivableOrderWhereInput {
  return {
    OR: [
      { actualShipmentDate: { not: null } },
      { actualShipmentAmount: { not: null } },
      { status: { contains: "发货" } },
    ],
  };
}

export async function listCustomerBusinessRecords(query: QueryLike, actor: CustomerCrmActor) {
  assertCustomerCrmRead(actor);
  const customerId = String(query.get("customerId") || "").trim();
  await loadCustomer(customerId, actor);
  const canReadOrders = canRead(actor, "orders");
  const canReadPayments = canRead(actor, "payments");
  if (!canReadOrders && !canReadPayments) {
    throw codedError("没有权限查看客户发货订单和应收款", 403, "PERMISSION_DENIED");
  }
  const orderWhere: Prisma.ReceivableOrderWhereInput = {
    AND: [{ customerId, deletedAt: null }, shippedOrderWhere(), orderAccessWhere(actor)],
  };
  const [orderRecords, paymentRecords] = await Promise.all([
    canReadOrders ? prisma.receivableOrder.findMany({
      where: orderWhere,
      include: includeOrderListRelations(),
      orderBy: [{ actualShipmentDate: "desc" }, { createdAt: "desc" }],
      take: 120,
    }) : Promise.resolve([]),
    canReadPayments ? prisma.payment.findMany({
      where: { deletedAt: null, order: { is: orderWhere } },
      include: { order: { include: { customer: true, businessEntity: true, salesperson: true } }, createdBy: true, updatedBy: true },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: 120,
    }) : Promise.resolve([]),
  ]);
  const orders = orderRecords.map((order) => serializeOrderListRow(scopeOrderForActor(order, actor)));
  const payments = paymentRecords.map(serializePayment);
  return {
    canReadOrders,
    canReadPayments,
    summary: {
      orderCount: orders.length,
      shippedCount: orders.filter((order) => order.actualShipmentDate || String(order.status || "").includes("发货")).length,
      overdueCount: orders.filter((order) => Number(order.summary?.overdueDays || 0) > 0 || String(order.summary?.reminderStatus || "").includes("逾期")).length,
      receivableCny: sumNumbers(orders, (order) => order.finalReceivableAmountCny),
      receivedCny: sumNumbers(orders, (order) => order.summary?.arrivedPaymentsCny ?? order.summary?.confirmedPaymentsCny),
      outstandingCny: sumNumbers(orders, (order) => order.summary?.outstandingCny),
      paymentCount: payments.length,
      arrivedPaymentCny: paymentStatusAmount(payments, "已到账"),
      pendingPaymentCny: paymentStatusAmount(payments, "待确认"),
    },
    orders: orders.slice(0, 8),
    payments: payments.slice(0, 8),
  };
}

export async function listCustomerFollowUps(query: QueryLike, actor: CustomerCrmActor) {
  assertCustomerCrmRead(actor);
  if (String(query.get("scope") || "").trim() === "workspace") return listWorkspaceCustomerFollowUps(query, actor);
  const customerId = String(query.get("customerId") || "").trim();
  await loadCustomer(customerId, actor);
  const rows = await prisma.customerFollowUp.findMany({
    where: { customerId },
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
    orderBy: [{ completedAt: "asc" }, { nextFollowUpAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return { rows: rows.map(serializeFollowUp) };
}

async function listWorkspaceCustomerFollowUps(query: QueryLike, actor: CustomerCrmActor) {
  const pageSize = Math.min(50, Math.max(1, Number(query.get("pageSize") || 24) || 24));
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 7);
  const rows = await prisma.customerFollowUp.findMany({
    where: {
      completedAt: null,
      nextFollowUpAt: { not: null, lte: horizon },
      customer: { is: { ...customerAccessWhere(actor), deletedAt: null } },
    },
    include: {
      customer: { select: { id: true, name: true, shortName: true } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
    orderBy: [{ nextFollowUpAt: "asc" }, { createdAt: "desc" }],
    take: pageSize,
  });
  return { rows: rows.map(serializeFollowUp) };
}

export async function saveCustomerFollowUp(request: AuditRequest, actor: CustomerCrmActor, input: unknown) {
  assertCustomerCrmWrite(actor);
  const actorId = requireActorId(actor);
  const body = assertJsonObject(input);
  const customerId = String(body.customerId || "").trim();
  await loadCustomer(customerId, actor);
  const data = {
    customerId,
    method: quotationText(body.method, "跟进方式", 50) || null,
    note: quotationText(body.note, "跟进内容", 2000, true),
    nextFollowUpAt: dateInput(body.nextFollowUpAt, "下次跟进日期"),
    createdById: actorId,
    updatedById: actorId,
  };
  const row = await prisma.customerFollowUp.create({
    data,
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  await runNonCriticalTask("客户跟进操作日志写入", () => writeAudit(request, { id: actorId }, "新增客户跟进", "customer_follow_ups", row.id, null, row));
  return serializeFollowUp(row);
}

export async function completeCustomerFollowUp(request: AuditRequest, actor: CustomerCrmActor, id: string) {
  assertCustomerCrmWrite(actor);
  const actorId = requireActorId(actor);
  const before = await prisma.customerFollowUp.findUnique({ where: { id } });
  if (!before) throw codedError("跟进记录不存在", 404, "CUSTOMER_FOLLOW_UP_NOT_FOUND");
  await loadCustomer(before.customerId, actor);
  const row = await prisma.customerFollowUp.update({
    where: { id },
    data: { completedAt: new Date(), updatedById: actorId },
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  await runNonCriticalTask("客户跟进完成日志写入", () => writeAudit(request, { id: actorId }, "完成客户跟进", "customer_follow_ups", row.id, before, row));
  return serializeFollowUp(row);
}
