import { Prisma, type CustomerOpportunityActivityType, type CustomerOpportunityStage } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { OPPORTUNITY_STAGE_PROBABILITY, opportunityAttention, opportunityLifecycle } from "./crm-enhancement-rules";
import { assertCustomerScope, assertJsonObject, canRead, canWrite, codedError, optional, runNonCriticalTask, writeAudit } from "./shared";
import type { QuotationActor } from "./quotation-values";

type Actor = QuotationActor;
type AuditRequest = Parameters<typeof writeAudit>[0];
const STAGES = new Set<CustomerOpportunityStage>(["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]);
const ACTIVITY_TYPES = new Set<CustomerOpportunityActivityType>(["WECHAT", "PHONE", "EMAIL", "WHATSAPP", "MEETING", "SAMPLE", "QUOTATION", "FOLLOW_UP", "OTHER"]);
const LOST_REASONS = new Set(["PRICE", "PRODUCT", "DELIVERY", "COMPETITOR", "BUDGET", "NO_DECISION", "OTHER"]);

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

function date(value: unknown, label: string, withTime = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(withTime ? raw : `${raw.slice(0, 10)}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw codedError(`${label}无效`, 400, "VALIDATION_INVALID_DATE");
  return parsed;
}

function stringList(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function roleMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(value).map(([id, role]) => [id, String(role || "").trim().slice(0, 100)]));
}

function opportunityInput(input: unknown) {
  const body = assertJsonObject(input);
  const stage = String(body.stage || "LEAD") as CustomerOpportunityStage;
  if (!STAGES.has(stage)) throw codedError("商机阶段无效", 400, "VALIDATION_INVALID_STAGE");
  const nextAction = text(body.nextAction, "下一步动作", 500);
  const nextActionDueAt = date(body.nextActionDueAt, "行动截止日期");
  if (stage !== "WON" && stage !== "LOST" && (!nextAction || !nextActionDueAt)) throw codedError("进行中的商机必须填写下一步动作和截止日期", 400, "NEXT_ACTION_REQUIRED");
  const lostReasonCode = stage === "LOST" ? String(body.lostReasonCode || "") : "";
  if (stage === "LOST" && !LOST_REASONS.has(lostReasonCode)) throw codedError("请选择丢单原因", 400, "LOST_REASON_REQUIRED");
  return {
    data: {
      name: text(body.name, "采购项目名称", 200, true)!, stage,
      probability: OPPORTUNITY_STAGE_PROBABILITY[stage], expectedCloseDate: date(body.expectedCloseDate, "预计成交日期"),
      nextAction: stage === "WON" || stage === "LOST" ? null : nextAction,
      nextActionDueAt: stage === "WON" || stage === "LOST" ? null : nextActionDueAt,
      lostReasonCode: lostReasonCode || null, lostReason: stage === "LOST" ? text(body.lostReason, "丢单说明", 500) : null,
      remark: text(body.remark, "需求说明", 2000),
    },
    contactIds: stringList(body.contactIds), contactRoles: roleMap(body.contactRoles), quotationIds: stringList(body.quotationIds),
    primaryContactId: optional(body.primaryContactId),
    ownerWasProvided: Object.prototype.hasOwnProperty.call(body, "ownerUserId"), requestedOwnerId: optional(body.ownerUserId),
  };
}

async function validateLinks(tx: Prisma.TransactionClient, customerId: string, opportunityId: string | undefined, parsed: ReturnType<typeof opportunityInput>) {
  const contacts = await tx.customerContact.findMany({ where: { id: { in: parsed.contactIds }, customerId, deletedAt: null }, select: { id: true } });
  if (contacts.length !== parsed.contactIds.length) throw codedError("所选联系人不属于当前客户或已停用", 400, "INVALID_CONTACT_LINK");
  if (parsed.primaryContactId && !parsed.contactIds.includes(parsed.primaryContactId)) throw codedError("主联系人必须包含在商机联系人中", 400, "INVALID_PRIMARY_CONTACT");
  const quotations = await tx.salesQuotation.findMany({
    where: { id: { in: parsed.quotationIds }, customerId, status: { not: "VOIDED" } },
    include: { versions: { where: { versionNumber: { gt: 0 } }, orderBy: { versionNumber: "desc" }, take: 1 }, salesExecution: { select: { id: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (quotations.length !== parsed.quotationIds.length) throw codedError("所选报价不属于当前客户或已作废", 400, "INVALID_QUOTATION_LINK");
  if (quotations.some((row) => row.opportunityId && row.opportunityId !== opportunityId)) throw codedError("所选报价已关联其他商机", 409, "QUOTATION_ALREADY_LINKED");
  if (["QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"].includes(parsed.data.stage) && !contacts.length) throw codedError("确认需求后至少关联一位客户联系人", 400, "CONTACT_GATE_REQUIRED");
  if (["PROPOSAL", "NEGOTIATION", "WON"].includes(parsed.data.stage) && !quotations.length) throw codedError("进入报价阶段前必须关联一份有效报价", 400, "QUOTATION_GATE_REQUIRED");
  if (parsed.data.stage === "WON" && !quotations.some((row) => row.status === "ACCEPTED" || row.salesExecution)) throw codedError("赢单必须关联已接受或已生成订单的报价", 400, "WON_GATE_REQUIRED");
  return quotations;
}

const opportunityInclude = {
  owner: { select: { id: true, name: true } },
  contactLinks: { where: { deletedAt: null }, include: { contact: true }, orderBy: [{ isPrimary: "desc" as const }, { updatedAt: "desc" as const }] },
  quotations: { where: { status: { not: "VOIDED" as const } }, include: { versions: { orderBy: { versionNumber: "desc" as const }, take: 1 }, salesExecution: { select: { id: true, status: true } } }, orderBy: { updatedAt: "desc" as const } },
  activities: { where: { deletedAt: null }, include: { contact: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } }, orderBy: { occurredAt: "desc" as const }, take: 30 },
  stageHistory: { include: { changedBy: { select: { id: true, name: true } } }, orderBy: { changedAt: "desc" as const }, take: 30 },
} satisfies Prisma.CustomerOpportunityInclude;

export async function listCustomerOpportunities(customerId: string, actor: Actor) {
  assertRead(actor); await assertCustomerScope(actor, customerId);
  const [opportunities, contacts] = await Promise.all([
    prisma.customerOpportunity.findMany({ where: { customerId, deletedAt: null }, include: opportunityInclude, orderBy: [{ closedAt: "asc" }, { nextActionDueAt: "asc" }, { updatedAt: "desc" }] }),
    prisma.customerContact.findMany({ where: { customerId, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] }),
  ]);
  return { contacts, opportunities: opportunities.map((row) => ({ ...row, attention: opportunityAttention(row.stage, row.nextActionDueAt) })) };
}

export async function saveCustomerOpportunity(request: AuditRequest, actor: Actor, customerId: string, input: unknown, opportunityId?: string) {
  assertWrite(actor); const userId = actorId(actor); await assertCustomerScope(actor, customerId); const parsed = opportunityInput(input);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "customers" WHERE "id" = ${customerId} FOR UPDATE`);
    const before = opportunityId ? await tx.customerOpportunity.findFirst({ where: { id: opportunityId, customerId, deletedAt: null } }) : null;
    if (opportunityId && !before) throw codedError("商机不存在", 404, "NOT_FOUND");
    if (parsed.ownerWasProvided && parsed.requestedOwnerId) {
      const owner = await tx.user.findFirst({ where: { id: parsed.requestedOwnerId, isActive: true, deletedAt: null }, select: { id: true } });
      if (!owner) throw codedError("商机负责人无效", 400, "INVALID_OWNER");
    }
    const quotations = await validateLinks(tx, customerId, opportunityId, parsed);
    const latestVersion = quotations[0]?.versions[0];
    const lifecycle = opportunityLifecycle(before, parsed.data.stage, parsed.requestedOwnerId, parsed.ownerWasProvided, userId);
    const values = { ...parsed.data, ...lifecycle, amount: latestVersion?.totalAmount ?? null, currency: latestVersion?.currency || "CNY", updatedById: userId };
    const row = opportunityId
      ? await tx.customerOpportunity.update({ where: { id: opportunityId }, data: values })
      : await tx.customerOpportunity.create({ data: { ...values, customerId, createdById: userId } });
    await tx.customerOpportunityContact.updateMany({ where: { opportunityId: row.id, contactId: { notIn: parsed.contactIds }, deletedAt: null }, data: { deletedAt: new Date(), isPrimary: false, updatedById: userId } });
    for (const contactId of parsed.contactIds) await tx.customerOpportunityContact.upsert({
      where: { opportunityId_contactId: { opportunityId: row.id, contactId } },
      create: { opportunityId: row.id, contactId, role: parsed.contactRoles[contactId] || null, isPrimary: contactId === parsed.primaryContactId, createdById: userId, updatedById: userId },
      update: { deletedAt: null, role: parsed.contactRoles[contactId] || null, isPrimary: contactId === parsed.primaryContactId, updatedById: userId },
    });
    await tx.salesQuotation.updateMany({ where: { opportunityId: row.id, id: { notIn: parsed.quotationIds } }, data: { opportunityId: null } });
    if (parsed.quotationIds.length) await tx.salesQuotation.updateMany({ where: { id: { in: parsed.quotationIds } }, data: { opportunityId: row.id } });
    if (!before || before.stage !== row.stage) await tx.customerOpportunityStageHistory.create({ data: { opportunityId: row.id, fromStage: before?.stage || null, toStage: row.stage, changedById: userId } });
    return { row: await tx.customerOpportunity.findUniqueOrThrow({ where: { id: row.id }, include: opportunityInclude }), before };
  });
  await runNonCriticalTask("商机操作日志写入", () => writeAudit(request, { id: userId }, opportunityId ? "更新客户采购项目" : "新增客户采购项目", "customer_opportunities", result.row.id, result.before, result.row));
  return { ...result.row, attention: opportunityAttention(result.row.stage, result.row.nextActionDueAt) };
}

export async function removeCustomerOpportunity(request: AuditRequest, actor: Actor, customerId: string, opportunityId: string) {
  assertWrite(actor); const userId = actorId(actor); await assertCustomerScope(actor, customerId);
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.customerOpportunity.findFirst({ where: { id: opportunityId, customerId, deletedAt: null } });
    if (!current) throw codedError("商机不存在", 404, "NOT_FOUND");
    await tx.salesQuotation.updateMany({ where: { opportunityId }, data: { opportunityId: null } });
    return tx.customerOpportunity.update({ where: { id: opportunityId }, data: { deletedAt: new Date(), updatedById: userId } });
  });
  await runNonCriticalTask("商机移除日志写入", () => writeAudit(request, { id: userId }, "移除客户采购项目", "customer_opportunities", row.id, row, null));
}

export async function addCustomerOpportunityActivity(request: AuditRequest, actor: Actor, customerId: string, opportunityId: string, input: unknown) {
  assertWrite(actor); const userId = actorId(actor); await assertCustomerScope(actor, customerId); const body = assertJsonObject(input);
  const type = String(body.type || "FOLLOW_UP") as CustomerOpportunityActivityType;
  if (!ACTIVITY_TYPES.has(type)) throw codedError("跟进方式无效", 400, "INVALID_ACTIVITY_TYPE");
  const contactId = optional(body.contactId);
  const opportunity = await prisma.customerOpportunity.findFirst({ where: { id: opportunityId, customerId, deletedAt: null }, select: { id: true } });
  if (!opportunity) throw codedError("商机不存在", 404, "NOT_FOUND");
  if (contactId) {
    const contact = await prisma.customerContact.findFirst({ where: { id: contactId, customerId, deletedAt: null }, select: { id: true } });
    if (!contact) throw codedError("联系人无效", 400, "INVALID_CONTACT_LINK");
  }
  const row = await prisma.customerOpportunityActivity.create({ data: {
    opportunityId, contactId, type, subject: text(body.subject, "跟进主题", 200, true)!, note: text(body.note, "跟进内容", 2000),
    outcome: text(body.outcome, "跟进结果", 1000), occurredAt: date(body.occurredAt, "跟进时间", true) || new Date(), createdById: userId,
  }, include: { contact: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } } });
  await runNonCriticalTask("商机跟进日志写入", () => writeAudit(request, { id: userId }, "记录商机跟进", "customer_opportunity_activities", row.id, null, row));
  return row;
}
