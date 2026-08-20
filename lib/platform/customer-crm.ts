import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  canRead,
  canWrite,
  codedError,
  normalizeEmail,
  optional,
  runNonCriticalTask,
  serializeCustomer,
  validEmail,
  writeAudit,
} from "./shared";
import { quotationText, type QuotationActor } from "./quotation-values";

type QueryLike = { get(key: string): string | null };
type AuditRequest = Parameters<typeof writeAudit>[0];
type CustomerCrmActor = QuotationActor;

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

function serializeFollowUp(row: Prisma.CustomerFollowUpGetPayload<{ include: { createdBy: { select: { name: true } }; updatedBy: { select: { name: true } } } }>) {
  return {
    id: row.id,
    customerId: row.customerId,
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

export async function listCustomerFollowUps(query: QueryLike, actor: CustomerCrmActor) {
  assertCustomerCrmRead(actor);
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
