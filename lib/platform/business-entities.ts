import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  codedError,
  logServerError,
  nonEmpty,
  requireText,
} from "./shared-base-utils";
import { assertRead, assertWrite, canRead, permissionError } from "./shared-access";
import { writeAudit } from "./shared-audit";

export const DEFAULT_BUSINESS_ENTITY_ID = "default-business-entity";
export const DEFAULT_BUSINESS_ENTITY_NAME = "浙江莱诺建材有限公司";

type ActorLike = {
  id?: string | null;
  role?: string | null;
} | null | undefined;

type AuditRequestLike = Parameters<typeof writeAudit>[0];

type BusinessEntityLike = {
  id?: string | null;
  name?: string | null;
  shortName?: string | null;
  isDefault?: boolean | null;
  status?: string | null;
  sortOrder?: number | null;
  remark?: string | null;
};

type BusinessEntityOrderLike = Record<string, unknown> & {
  businessEntityId?: string | null;
  businessEntityNameSnapshot?: string | null;
  businessEntity?: unknown;
};

type BusinessEntityInput = Record<string, unknown>;

function inputHasOwn(input: BusinessEntityInput | null | undefined, key: string) {
  return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

function activeBusinessEntityWhere(): Prisma.BusinessEntityWhereInput {
  return {
    deletedAt: null,
    status: { not: "停用" },
  };
}

export function serializeBusinessEntity(entity: BusinessEntityLike | null | undefined) {
  const name = nonEmpty(entity?.name || "");
  const shortName = nonEmpty(entity?.shortName || "");
  return {
    id: entity?.id || "",
    name,
    shortName,
    displayName: shortName || name,
    isDefault: Boolean(entity?.isDefault),
    status: entity?.status || "启用",
    sortOrder: Number(entity?.sortOrder || 0),
    remark: entity?.remark || "",
  };
}

export function businessEntityFieldsFromOrder(order: BusinessEntityOrderLike | null | undefined) {
  const entity = order?.businessEntity && typeof order.businessEntity === "object"
    ? order.businessEntity as BusinessEntityLike
    : null;
  const name = nonEmpty(order?.businessEntityNameSnapshot || entity?.name || "");
  const shortName = nonEmpty(entity?.shortName || "");
  return {
    businessEntityId: nonEmpty(order?.businessEntityId || entity?.id || ""),
    businessEntityName: name,
    businessEntityShortName: shortName,
    businessEntityDisplayName: shortName || name,
    businessEntityNameSnapshot: name,
    businessEntity: entity ? serializeBusinessEntity(entity) : null,
  };
}

export function businessEntityWhereFromQuery(value: unknown): Prisma.ReceivableOrderWhereInput {
  const text = nonEmpty(value);
  if (!text) return {};
  return {
    OR: [
      { businessEntityId: text },
      { businessEntityNameSnapshot: { contains: text, mode: "insensitive" } },
      { businessEntity: { is: { name: { contains: text, mode: "insensitive" } } } },
      { businessEntity: { is: { shortName: { contains: text, mode: "insensitive" } } } },
    ],
  };
}

function businessEntityText(input: BusinessEntityInput, key: string) {
  return nonEmpty(input[key]);
}

function businessEntityStatus(input: BusinessEntityInput) {
  const status = businessEntityText(input, "status") || "启用";
  return status === "停用" ? "停用" : "启用";
}

function businessEntitySortOrder(input: BusinessEntityInput) {
  const value = Number(input.sortOrder ?? 0);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function businessEntityPayload(input: BusinessEntityInput) {
  const name = requireText(input.name, "公司全称");
  const isDefault = Boolean(input.isDefault);
  const status = businessEntityStatus(input);
  if (isDefault && status === "停用") {
    throw codedError("默认业务主体不能停用", 400, "BUSINESS_ENTITY_DEFAULT_DISABLED");
  }
  return {
    name,
    shortName: businessEntityText(input, "shortName") || null,
    isDefault,
    status,
    sortOrder: businessEntitySortOrder(input),
    remark: businessEntityText(input, "remark") || null,
  };
}

async function ensureBusinessEntityNameUnique(name: string, exceptId = "") {
  const exists = await prisma.businessEntity.findFirst({
    where: {
      deletedAt: null,
      name,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (exists) {
    throw codedError("公司全称已存在", 409, "BUSINESS_ENTITY_NAME_DUPLICATED");
  }
}

export async function listBusinessEntities(actor: ActorLike, options: { includeInactive?: boolean } = {}) {
  assertRead(actor, "orders");
  const includeInactive = Boolean(options.includeInactive && canRead(actor, "settings"));
  const rows = await prisma.businessEntity.findMany({
    where: includeInactive ? { deletedAt: null } : activeBusinessEntityWhere(),
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(serializeBusinessEntity);
}

export async function listBusinessEntitySettings(actor: ActorLike) {
  assertRead(actor, "settings");
  const rows = await prisma.businessEntity.findMany({
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(serializeBusinessEntity);
}

export async function createBusinessEntitySetting(
  request: AuditRequestLike,
  actor: ActorLike,
  input: BusinessEntityInput,
) {
  assertWrite(actor, "settings");
  const payload = businessEntityPayload(input);
  await ensureBusinessEntityNameUnique(payload.name);
  const created = await prisma.$transaction(async (tx) => {
    if (payload.isDefault) {
      await tx.businessEntity.updateMany({
        where: { deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.businessEntity.create({ data: payload });
  });
  writeAudit(request, actor, "新增业务主体", "business_entities", created.id, null, created)
    .catch((error) => logServerError("新增业务主体日志写入失败", error, { businessEntityId: created.id }));
  return serializeBusinessEntity(created);
}

export async function updateBusinessEntitySetting(
  request: AuditRequestLike,
  actor: ActorLike,
  id: string,
  input: BusinessEntityInput,
) {
  assertWrite(actor, "settings");
  const payload = businessEntityPayload(input);
  const before = await prisma.businessEntity.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw codedError("业务主体不存在或已删除", 404, "BUSINESS_ENTITY_NOT_FOUND");
  await ensureBusinessEntityNameUnique(payload.name, id);
  if (before.isDefault && !payload.isDefault) {
    const anotherDefault = await prisma.businessEntity.findFirst({
      where: { deletedAt: null, id: { not: id }, isDefault: true, status: { not: "停用" } },
    });
    if (!anotherDefault) {
      throw codedError("至少保留一个默认业务主体", 400, "BUSINESS_ENTITY_DEFAULT_REQUIRED");
    }
  }
  if (before.isDefault && payload.status === "停用") {
    throw codedError("默认业务主体不能停用", 400, "BUSINESS_ENTITY_DEFAULT_DISABLED");
  }
  const after = await prisma.$transaction(async (tx) => {
    if (payload.isDefault) {
      await tx.businessEntity.updateMany({
        where: { deletedAt: null, id: { not: id }, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.businessEntity.update({
      where: { id },
      data: payload,
    });
  });
  writeAudit(request, actor, "修改业务主体", "business_entities", id, before, after)
    .catch((error) => logServerError("修改业务主体日志写入失败", error, { businessEntityId: id }));
  return serializeBusinessEntity(after);
}

export async function getDefaultBusinessEntity() {
  const existing = await prisma.businessEntity.findFirst({
    where: {
      deletedAt: null,
      isDefault: true,
      status: { not: "停用" },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (existing) return existing;
  return prisma.businessEntity.upsert({
    where: { name: DEFAULT_BUSINESS_ENTITY_NAME },
    create: {
      id: DEFAULT_BUSINESS_ENTITY_ID,
      name: DEFAULT_BUSINESS_ENTITY_NAME,
      shortName: "莱诺建材",
      isDefault: true,
      status: "启用",
      remark: "系统默认业务主体",
    },
    update: {
      isDefault: true,
      status: "启用",
    },
  });
}

export async function resolveBusinessEntityForOrderInput(input: BusinessEntityInput, before: BusinessEntityOrderLike | null = null) {
  const hasBusinessEntityInput = inputHasOwn(input, "businessEntityId") || inputHasOwn(input, "businessEntity");
  if (!hasBusinessEntityInput && before?.businessEntityId) {
    const beforeEntity = businessEntityFieldsFromOrder(before);
    return {
      id: before.businessEntityId,
      name: beforeEntity.businessEntityName,
    };
  }
  const requestedId = nonEmpty(input.businessEntityId || (input.businessEntity as BusinessEntityLike | null | undefined)?.id);
  const entity = requestedId
    ? await prisma.businessEntity.findFirst({
      where: {
        id: requestedId,
        ...activeBusinessEntityWhere(),
      },
    })
    : await getDefaultBusinessEntity();
  if (!entity) {
    throw codedError("请选择有效业务主体", 400, "BUSINESS_ENTITY_INVALID");
  }
  return {
    id: entity.id,
    name: entity.name,
  };
}

export async function transferOrderBusinessEntity(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  input: BusinessEntityInput,
) {
  assertWrite(actor, "orders");
  if (actor?.role !== "管理员") {
    throw permissionError("只有管理员可以转移订单业务主体", 403);
  }
  const targetEntityId = requireText(input.businessEntityId, "业务主体");
  const reason = requireText(input.reason || input.transferReason, "转移原因");
  const [before, targetEntity] = await Promise.all([
    prisma.receivableOrder.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { businessEntity: true },
    }),
    prisma.businessEntity.findFirst({
      where: {
        id: targetEntityId,
        ...activeBusinessEntityWhere(),
      },
    }),
  ]);
  if (!before) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
  if (!targetEntity) throw codedError("请选择有效业务主体", 400, "BUSINESS_ENTITY_INVALID");
  if (before.businessEntityId === targetEntity.id) {
    return {
      changed: false,
      order: {
        id: before.id,
        ...businessEntityFieldsFromOrder(before),
      },
    };
  }
  const after = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: {
      businessEntityId: targetEntity.id,
      businessEntityNameSnapshot: targetEntity.name,
      updatedById: actor?.id || null,
    },
    include: { businessEntity: true },
  });
  writeAudit(
    request,
    actor,
    "转移订单业务主体",
    "receivable_orders",
    orderId,
    before,
    {
      ...after,
      transferReason: reason,
      previousBusinessEntityName: before.businessEntityNameSnapshot || before.businessEntity?.name || "",
      nextBusinessEntityName: targetEntity.name,
    },
  ).catch((error) => logServerError("业务主体转移日志写入失败", error, { orderId }));
  return {
    changed: true,
    order: {
      id: after.id,
      ...businessEntityFieldsFromOrder(after),
    },
  };
}
