import type { Prisma } from "../generated/prisma/client.js";
import { nonEmpty } from "./shared-base-utils";

export type BusinessEntityLike = {
  id?: string | null;
  name?: string | null;
  shortName?: string | null;
  isDefault?: boolean | null;
  status?: string | null;
  sortOrder?: number | null;
  remark?: string | null;
};

export function activeBusinessEntityWhere(): Prisma.BusinessEntityWhereInput {
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
