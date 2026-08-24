import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { customerContactSnapshotPatch } from "./crm-enhancement-rules";
import { assertCustomerScope, assertJsonObject, canRead, canWrite, codedError, normalizeEmail, runNonCriticalTask, validEmail, writeAudit } from "./shared";
import type { QuotationActor } from "./quotation-values";

type Actor = QuotationActor;
type AuditRequest = Parameters<typeof writeAudit>[0];

function actorId(actor: Actor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

function assertRead(actor: Actor) {
  if (!canRead(actor, "customers") && !canRead(actor, "quotations")) throw codedError("没有权限查看客户 CRM", 403, "PERMISSION_DENIED");
}

function assertWrite(actor: Actor) {
  if (!canWrite(actor, "customers") && !canWrite(actor, "quotations")) throw codedError("没有权限维护客户 CRM", 403, "PERMISSION_DENIED");
}

function text(value: unknown, label: string, max = 200, required = false) {
  const result = String(value || "").trim();
  if (required && !result) throw codedError(`请填写${label}`, 400, "VALIDATION_REQUIRED");
  if (result.length > max) throw codedError(`${label}不能超过 ${max} 个字符`, 400, "VALIDATION_TOO_LONG");
  return result || null;
}

async function customer(customerId: string, actor: Actor) {
  if (!customerId) throw codedError("请选择客户", 400, "CUSTOMER_REQUIRED");
  return assertCustomerScope(actor, customerId);
}

function contactData(input: unknown) {
  const body = assertJsonObject(input);
  const email = text(body.email, "邮箱", 200);
  if (email && !validEmail(normalizeEmail(email))) throw codedError(`邮箱格式错误：${email}`, 400, "INVALID_EMAIL_FORMAT");
  return {
    name: text(body.name, "联系人姓名", 100, true)!,
    title: text(body.title, "职务", 100), department: text(body.department, "部门", 100),
    phone: text(body.phone, "电话", 100), email: email ? normalizeEmail(email) : null,
    wechat: text(body.wechat, "微信", 100), preferredMethod: text(body.preferredMethod, "首选联系", 50),
    isPrimary: Boolean(body.isPrimary), remark: text(body.remark, "备注", 1000),
  };
}

async function lockCustomer(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "customers" WHERE "id" = ${customerId} FOR UPDATE`);
}

export async function listCustomerContacts(customerId: string, actor: Actor) {
  assertRead(actor); await customer(customerId, actor);
  return prisma.customerContact.findMany({ where: { customerId, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }] });
}

export async function saveCustomerContact(request: AuditRequest, actor: Actor, customerId: string, input: unknown, contactId?: string) {
  assertWrite(actor); const userId = actorId(actor); await customer(customerId, actor); const data = contactData(input);
  const result = await prisma.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    const before = contactId ? await tx.customerContact.findFirst({ where: { id: contactId, customerId, deletedAt: null } }) : null;
    if (contactId && !before) throw codedError("联系人不存在", 404, "NOT_FOUND");
    if (data.isPrimary) await tx.customerContact.updateMany({ where: { customerId, deletedAt: null, ...(contactId ? { id: { not: contactId } } : {}) }, data: { isPrimary: false, updatedById: userId } });
    const row = contactId
      ? await tx.customerContact.update({ where: { id: contactId }, data: { ...data, updatedById: userId } })
      : await tx.customerContact.create({ data: { ...data, customerId, createdById: userId, updatedById: userId } });
    const snapshot = customerContactSnapshotPatch(Boolean(before?.isPrimary), data);
    if (snapshot) await tx.customer.update({ where: { id: customerId }, data: snapshot });
    return { row, before };
  });
  await runNonCriticalTask("客户联系人操作日志写入", () => writeAudit(request, { id: userId }, contactId ? "更新客户联系人" : "新增客户联系人", "customer_contacts", result.row.id, result.before, result.row));
  return result.row;
}

export async function removeCustomerContact(request: AuditRequest, actor: Actor, customerId: string, contactId: string) {
  assertWrite(actor); const userId = actorId(actor); await customer(customerId, actor);
  const row = await prisma.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    const current = await tx.customerContact.findFirst({ where: { id: contactId, customerId, deletedAt: null } });
    if (!current) throw codedError("联系人不存在", 404, "NOT_FOUND");
    await tx.customerContact.update({ where: { id: current.id }, data: { deletedAt: new Date(), isPrimary: false, updatedById: userId } });
    if (!current.isPrimary) return current;
    const next = await tx.customerContact.findFirst({ where: { customerId, deletedAt: null, id: { not: current.id } }, orderBy: { updatedAt: "desc" } });
    if (next) await tx.customerContact.update({ where: { id: next.id }, data: { isPrimary: true, updatedById: userId } });
    await tx.customer.update({ where: { id: customerId }, data: { contactPerson: next?.name || null, contactPhone: next?.phone || null, contactEmail: next?.email || null } });
    return current;
  });
  await runNonCriticalTask("客户联系人移除日志写入", () => writeAudit(request, { id: userId }, "移除客户联系人", "customer_contacts", row.id, row, null));
}
