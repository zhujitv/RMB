import type { Prisma } from "../generated/prisma/client.js";
import { nonEmpty } from "./shared-base-utils";
import {
  serializeBusinessEntityBankAccounts,
  type BusinessEntityBankAccountLike,
} from "./business-entity-bank-accounts";

export type BusinessEntityLike = {
  id?: string | null;
  name?: string | null;
  shortName?: string | null;
  nameEn?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  showContactPhoneOnPi?: boolean | null;
  showContactEmailOnPi?: boolean | null;
  showWebsiteOnPi?: boolean | null;
  bankAccounts?: BusinessEntityBankAccountLike[] | null;
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

export function serializeBusinessEntitySettings(entity: BusinessEntityLike | null | undefined) {
  return {
    ...serializeBusinessEntity(entity),
    nameEn: entity?.nameEn || "",
    address: entity?.address || "",
    contactEmail: entity?.contactEmail || "",
    contactPhone: entity?.contactPhone || "",
    website: entity?.website || "",
    showContactPhoneOnPi: Boolean(entity?.showContactPhoneOnPi),
    showContactEmailOnPi: Boolean(entity?.showContactEmailOnPi),
    showWebsiteOnPi: Boolean(entity?.showWebsiteOnPi),
    bankAccounts: serializeBusinessEntityBankAccounts(entity?.bankAccounts),
  };
}
