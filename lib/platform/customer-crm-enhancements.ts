import { Prisma, type CustomerOpportunityStage } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { customerContactSnapshotPatch, opportunityLifecycle } from "./crm-enhancement-rules";
import { assertCustomerScope, assertJsonObject, canRead, canWrite, codedError, normalizeEmail, optional, runNonCriticalTask, validEmail, writeAudit } from "./shared";
import type { QuotationActor } from "./quotation-values";

type Actor = QuotationActor;
type AuditRequest = Parameters<typeof writeAudit>[0];
const STAGES = new Set(["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]);

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

function date(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const result = new Date(`${raw.slice(0, 10)}T00:00:00+08:00`);
  if (Number.isNaN(result.getTime())) throw codedError("预计成交日期无效", 400, "VALIDATION_INVALID_DATE");
  return result;
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

function opportunityData(input: unknown) {
  const body = assertJsonObject(input);
  const stage = String(body.stage || "LEAD").trim();
  if (!STAGES.has(stage)) throw codedError("销售阶段无效", 400, "VALIDATION_INVALID_STAGE");
  const amountText = String(body.amount ?? "").trim();
  const amount = amountText ? Number(amountText) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw codedError("预计金额必须大于或等于 0", 400, "VALIDATION_INVALID_AMOUNT");
  const probability = Math.round(Number(body.probability ?? 10));
  if (!Number.isFinite(probability) || probability < 0 || probability > 100) throw codedError("成交概率必须在 0 到 100 之间", 400, "VALIDATION_INVALID_PROBABILITY");
  return { data: {
    name: text(body.name, "机会名称", 200, true)!, stage: stage as CustomerOpportunityStage,
    amount, currency: String(body.currency || "CNY").trim().toUpperCase().slice(0, 10) || "CNY", probability,
    expectedCloseDate: date(body.expectedCloseDate), nextAction: text(body.nextAction, "下一步", 500),
    lostReason: stage === "LOST" ? text(body.lostReason, "丢单原因", 500) : null, remark: text(body.remark, "备注", 2000),
  }, ownerWasProvided: Object.prototype.hasOwnProperty.call(body, "ownerUserId"), requestedOwnerId: optional(body.ownerUserId) };
}

async function lockCustomer(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "customers" WHERE "id" = ${customerId} FOR UPDATE`);
}

async function lockOpportunity(tx: Prisma.TransactionClient, customerId: string, opportunityId: string) {
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "customer_opportunities" WHERE "id" = ${opportunityId} AND "customer_id" = ${customerId} FOR UPDATE`);
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

export async function listCustomerOpportunities(customerId: string, actor: Actor) {
  assertRead(actor); await customer(customerId, actor);
  return prisma.customerOpportunity.findMany({ where: { customerId, deletedAt: null }, include: { owner: { select: { id: true, name: true } } }, orderBy: [{ closedAt: "asc" }, { expectedCloseDate: "asc" }, { updatedAt: "desc" }] });
}

export async function saveCustomerOpportunity(request: AuditRequest, actor: Actor, customerId: string, input: unknown, opportunityId?: string) {
  assertWrite(actor); const userId = actorId(actor); await customer(customerId, actor); const parsed = opportunityData(input);
  const result = await prisma.$transaction(async (tx) => {
    if (opportunityId) await lockOpportunity(tx, customerId, opportunityId);
    const before = opportunityId ? await tx.customerOpportunity.findFirst({ where: { id: opportunityId, customerId, deletedAt: null } }) : null;
    if (opportunityId && !before) throw codedError("销售机会不存在", 404, "NOT_FOUND");
    if (parsed.ownerWasProvided && parsed.requestedOwnerId) {
      const owner = await tx.user.findFirst({ where: { id: parsed.requestedOwnerId, isActive: true, deletedAt: null }, select: { id: true } });
      if (!owner) throw codedError("销售机会负责人无效", 400, "INVALID_OWNER");
    }
    const lifecycle = opportunityLifecycle(before, parsed.data.stage, parsed.requestedOwnerId, parsed.ownerWasProvided, userId);
    const row = opportunityId
      ? await tx.customerOpportunity.update({ where: { id: opportunityId }, data: { ...parsed.data, ...lifecycle, updatedById: userId }, include: { owner: { select: { id: true, name: true } } } })
      : await tx.customerOpportunity.create({ data: { ...parsed.data, ...lifecycle, customerId, createdById: userId, updatedById: userId }, include: { owner: { select: { id: true, name: true } } } });
    return { row, before };
  });
  await runNonCriticalTask("销售机会操作日志写入", () => writeAudit(request, { id: userId }, opportunityId ? "更新销售机会" : "新增销售机会", "customer_opportunities", result.row.id, result.before, result.row));
  return result.row;
}

export async function removeCustomerOpportunity(request: AuditRequest, actor: Actor, customerId: string, opportunityId: string) {
  assertWrite(actor); const userId = actorId(actor); await customer(customerId, actor);
  const row = await prisma.$transaction(async (tx) => {
    await lockOpportunity(tx, customerId, opportunityId);
    const current = await tx.customerOpportunity.findFirst({ where: { id: opportunityId, customerId, deletedAt: null } });
    if (!current) throw codedError("销售机会不存在", 404, "NOT_FOUND");
    await tx.customerOpportunity.update({ where: { id: current.id }, data: { deletedAt: new Date(), updatedById: userId } });
    return current;
  });
  await runNonCriticalTask("销售机会移除日志写入", () => writeAudit(request, { id: userId }, "移除销售机会", "customer_opportunities", row.id, row, null));
}
