import { prisma } from "../prisma";
import { assertRead, assertWrite, canRead } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError, logServerError, nonEmpty, requireText } from "./shared-base-utils";
import {
  activeBusinessEntityWhere,
  serializeBusinessEntity,
} from "./business-entity-core";
import type { writeAudit as WriteAudit } from "./shared-audit";

type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type AuditRequestLike = Parameters<typeof WriteAudit>[0];
type BusinessEntityInput = Record<string, unknown>;

const BUSINESS_ENTITY_LIST_LIMIT = 1000;

function businessEntityPayload(input: BusinessEntityInput) {
  const name = requireText(input.name, "公司全称");
  const isDefault = Boolean(input.isDefault);
  const status = nonEmpty(input.status) === "停用" ? "停用" : "启用";
  const sortOrderValue = Number(input.sortOrder ?? 0);
  if (isDefault && status === "停用") {
    throw codedError("默认业务主体不能停用", 400, "BUSINESS_ENTITY_DEFAULT_DISABLED");
  }
  return {
    name,
    shortName: nonEmpty(input.shortName) || null,
    isDefault,
    status,
    sortOrder: Number.isFinite(sortOrderValue) ? Math.trunc(sortOrderValue) : 0,
    remark: nonEmpty(input.remark) || null,
  };
}

async function ensureBusinessEntityNameUnique(name: string, exceptId = "") {
  const exists = await prisma.businessEntity.findFirst({
    where: { deletedAt: null, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (exists) throw codedError("公司全称已存在", 409, "BUSINESS_ENTITY_NAME_DUPLICATED");
}

export async function listBusinessEntities(actor: ActorLike, options: { includeInactive?: boolean } = {}) {
  assertRead(actor, "orders");
  const includeInactive = Boolean(options.includeInactive && canRead(actor, "settings"));
  const rows = await prisma.businessEntity.findMany({
    where: includeInactive ? { deletedAt: null } : activeBusinessEntityWhere(),
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    take: BUSINESS_ENTITY_LIST_LIMIT,
  });
  return rows.map(serializeBusinessEntity);
}

export async function listBusinessEntitySettings(actor: ActorLike) {
  assertRead(actor, "settings");
  const rows = await prisma.businessEntity.findMany({
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    take: BUSINESS_ENTITY_LIST_LIMIT,
  });
  return rows.map(serializeBusinessEntity);
}

export async function createBusinessEntitySetting(request: AuditRequestLike, actor: ActorLike, input: BusinessEntityInput) {
  assertWrite(actor, "settings");
  const payload = businessEntityPayload(input);
  await ensureBusinessEntityNameUnique(payload.name);
  const created = await prisma.$transaction(async (tx) => {
    if (payload.isDefault) {
      await tx.businessEntity.updateMany({ where: { deletedAt: null, isDefault: true }, data: { isDefault: false } });
    }
    return tx.businessEntity.create({ data: payload });
  });
  writeAudit(request, actor, "新增业务主体", "business_entities", created.id, null, created)
    .catch((error) => logServerError("新增业务主体日志写入失败", error, { businessEntityId: created.id }));
  return serializeBusinessEntity(created);
}

export async function updateBusinessEntitySetting(request: AuditRequestLike, actor: ActorLike, id: string, input: BusinessEntityInput) {
  assertWrite(actor, "settings");
  const payload = businessEntityPayload(input);
  const before = await prisma.businessEntity.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw codedError("业务主体不存在或已删除", 404, "BUSINESS_ENTITY_NOT_FOUND");
  await ensureBusinessEntityNameUnique(payload.name, id);
  if (before.isDefault && !payload.isDefault) {
    const anotherDefault = await prisma.businessEntity.findFirst({
      where: { deletedAt: null, id: { not: id }, isDefault: true, status: { not: "停用" } },
    });
    if (!anotherDefault) throw codedError("至少保留一个默认业务主体", 400, "BUSINESS_ENTITY_DEFAULT_REQUIRED");
  }
  if (before.isDefault && payload.status === "停用") {
    throw codedError("默认业务主体不能停用", 400, "BUSINESS_ENTITY_DEFAULT_DISABLED");
  }
  const after = await prisma.$transaction(async (tx) => {
    if (payload.isDefault) {
      await tx.businessEntity.updateMany({ where: { deletedAt: null, id: { not: id }, isDefault: true }, data: { isDefault: false } });
    }
    return tx.businessEntity.update({ where: { id }, data: payload });
  });
  writeAudit(request, actor, "修改业务主体", "business_entities", id, before, after)
    .catch((error) => logServerError("修改业务主体日志写入失败", error, { businessEntityId: id }));
  return serializeBusinessEntity(after);
}
