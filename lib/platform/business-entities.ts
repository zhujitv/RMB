import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  codedError,
  nonEmpty,
  requireText,
} from "./shared-base-utils";
import { assertWrite, permissionError } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  activeBusinessEntityWhere,
  serializeBusinessEntity,
  type BusinessEntityLike,
} from "./business-entity-core";

export const DEFAULT_BUSINESS_ENTITY_ID = "default-business-entity";
export const DEFAULT_BUSINESS_ENTITY_NAME = "浙江莱诺建材有限公司";

export { serializeBusinessEntity };

export {
  createBusinessEntitySetting,
  listBusinessEntities,
  listBusinessEntitySettings,
  updateBusinessEntitySetting,
} from "./business-entity-settings";

type ActorLike = {
  id?: string | null;
  role?: string | null;
} | null | undefined;

type AuditRequestLike = Parameters<typeof writeAudit>[0];

type BusinessEntityOrderLike = Record<string, unknown> & {
  businessEntityId?: string | null;
  businessEntityNameSnapshot?: string | null;
  businessEntity?: unknown;
};

type BusinessEntityInput = Record<string, unknown>;

function inputHasOwn(input: BusinessEntityInput | null | undefined, key: string) {
  return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

export function businessEntityFieldsFromOrder(order: BusinessEntityOrderLike | null | undefined) {
  const entity = order?.businessEntity && typeof order.businessEntity === "object"
    ? order.businessEntity as BusinessEntityLike
    : null;
  const name = nonEmpty(order?.businessEntityNameSnapshot || entity?.name || "");
  const shortName = nonEmpty(entity?.shortName || "");
  const businessEntityIsDefault = typeof entity?.isDefault === "boolean" ? entity.isDefault : true;
  return {
    businessEntityId: nonEmpty(order?.businessEntityId || entity?.id || ""),
    businessEntityName: name,
    businessEntityShortName: shortName,
    businessEntityDisplayName: shortName || name,
    businessEntityNameSnapshot: name,
    businessEntityIsDefault,
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

export async function getDefaultBusinessEntity(client: Prisma.TransactionClient | typeof prisma = prisma) {
  const existing = await client.businessEntity.findFirst({
    where: {
      deletedAt: null,
      isDefault: true,
      status: { not: "停用" },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (existing) return existing;
  return client.businessEntity.upsert({
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

export async function resolveBusinessEntityForOrderInput(
  input: BusinessEntityInput,
  before: BusinessEntityOrderLike | null = null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
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
    ? await client.businessEntity.findFirst({
      where: {
        id: requestedId,
        ...activeBusinessEntityWhere(),
      },
    })
    : await getDefaultBusinessEntity(client);
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
  const result = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，转移业务主体前请先取消归档。",
    );
    await assertCommissionOrderWritableInTransaction(tx, orderId);
    const before = await tx.receivableOrder.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { businessEntity: true },
    });
    const targetEntity = await tx.businessEntity.findFirst({
      where: {
        id: targetEntityId,
        ...activeBusinessEntityWhere(),
      },
    });
    if (!before) throw codedError("应收订单不存在或已删除", 404, "ORDER_NOT_FOUND");
    if (!targetEntity) throw codedError("请选择有效业务主体", 400, "BUSINESS_ENTITY_INVALID");
    if (before.businessEntityId === targetEntity.id) return { before, after: before, changed: false };
    const after = await tx.receivableOrder.update({
      where: { id: orderId },
      data: {
        businessEntityId: targetEntity.id,
        businessEntityNameSnapshot: targetEntity.name,
        updatedById: actor?.id || null,
      },
      include: { businessEntity: true },
    });
    await writeAudit(
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
      tx,
    );
    return { before, after, changed: true };
  });
  return {
    changed: result.changed,
    order: {
      id: result.after.id,
      ...businessEntityFieldsFromOrder(result.after),
    },
  };
}
