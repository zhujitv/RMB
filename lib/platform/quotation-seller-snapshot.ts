import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { activeBusinessEntityWhere } from "./business-entity-core";
import { codedError, nonEmpty } from "./shared";
import {
  quotationBankAccountSnapshot,
  type BusinessEntityBankAccountLike,
} from "./business-entity-bank-accounts";

type QuotationClient = Prisma.TransactionClient | typeof prisma;

type CompanyProfileLike = {
  companyNameZh?: string | null;
  companyNameEn?: string | null;
  shortName?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
};

type BusinessEntityLike = {
  id: string;
  name: string;
  shortName: string | null;
  nameEn: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  showContactPhoneOnPi: boolean;
  showContactEmailOnPi: boolean;
  showWebsiteOnPi: boolean;
  bankAccounts: BusinessEntityBankAccountLike[];
  isDefault: boolean;
};

type SellerSnapshotLike = {
  businessEntityNameSnapshot?: unknown;
  sellerNameEnSnapshot?: unknown;
  sellerBankAccountSnapshot?: unknown;
  currency?: unknown;
  documentTemplateVersion?: unknown;
};

async function withBankAccounts(client: QuotationClient, entity: Omit<BusinessEntityLike, "bankAccounts">) {
  const bankAccounts = await client.businessEntityBankAccount.findMany({
    where: { businessEntityId: entity.id },
    orderBy: { currency: "asc" },
  });
  return { ...entity, bankAccounts };
}

export async function resolveQuotationBusinessEntity(
  client: QuotationClient,
  requestedId: unknown,
  existingId = "",
) {
  const normalizedRequestedId = nonEmpty(requestedId);
  if (existingId && normalizedRequestedId && normalizedRequestedId !== existingId) {
    throw codedError("报价创建后不能更换业务主体，请新建报价", 409, "QUOTATION_BUSINESS_ENTITY_IMMUTABLE");
  }
  if (existingId) {
    const existing = await client.businessEntity.findUnique({ where: { id: existingId } });
    if (!existing) throw codedError("报价业务主体不存在", 409, "QUOTATION_BUSINESS_ENTITY_MISSING");
    return withBankAccounts(client, existing);
  }
  if (!normalizedRequestedId) {
    throw codedError("请选择业务主体", 400, "BUSINESS_ENTITY_REQUIRED");
  }
  const entity = await client.businessEntity.findFirst({
    where: { id: normalizedRequestedId, ...activeBusinessEntityWhere() },
  });
  if (!entity) throw codedError("请选择有效业务主体", 400, "BUSINESS_ENTITY_INVALID");
  return withBankAccounts(client, entity);
}

export function buildQuotationSellerSnapshot(
  entity: BusinessEntityLike,
  profile: CompanyProfileLike,
  currency: unknown,
) {
  const profileMatchesEntity = entity.isDefault
    || [profile.companyNameZh, profile.shortName].some((value) => nonEmpty(value) === entity.name || nonEmpty(value) === nonEmpty(entity.shortName));
  const profileValue = (entityValue: unknown, fallbackValue: unknown) => (
    nonEmpty(entityValue) || (profileMatchesEntity ? nonEmpty(fallbackValue) : "") || null
  );
  return {
    businessEntityNameSnapshot: entity.name,
    businessEntityShortNameSnapshot: entity.shortName || null,
    sellerNameEnSnapshot: profileValue(entity.nameEn, profile.companyNameEn) || entity.name,
    sellerAddressSnapshot: profileValue(entity.address, profile.address),
    sellerEmailSnapshot: entity.showContactEmailOnPi
      ? profileValue(entity.contactEmail, profile.contactEmail)
      : null,
    sellerPhoneSnapshot: entity.showContactPhoneOnPi
      ? profileValue(entity.contactPhone, profile.contactPhone)
      : null,
    sellerWebsiteSnapshot: entity.showWebsiteOnPi
      ? profileValue(entity.website, profile.website)
      : null,
    sellerBankAccountSnapshot: quotationBankAccountSnapshot(entity.bankAccounts, currency),
    documentTemplateVersion: "PI_V5",
  };
}

export function assertQuotationCurrencyBankAccountSnapshot(version: SellerSnapshotLike) {
  const currency = nonEmpty(version.currency).toUpperCase();
  if ((currency === "CNY" || currency === "USD") && !nonEmpty(version.sellerBankAccountSnapshot)) {
    throw codedError(
      `该报价版本未包含 ${currency} 收款账户，请先在后台业务主体中完整配置对应账户，再编辑报价生成新版本`,
      409,
      "QUOTATION_BANK_ACCOUNT_REQUIRED",
    );
  }
}

export function assertQuotationSellerSnapshot(version: SellerSnapshotLike) {
  if (
    !nonEmpty(version.businessEntityNameSnapshot)
    || !nonEmpty(version.sellerNameEnSnapshot)
    || !nonEmpty(version.documentTemplateVersion)
  ) {
    throw codedError(
      "历史报价缺少卖方资料快照，请编辑报价并生成新版本后再生成形式发票",
      409,
      "QUOTATION_SELLER_SNAPSHOT_REQUIRED",
    );
  }
  if (!["PI_V1", "PI_V2", "PI_V3", "PI_V4", "PI_V5"].includes(nonEmpty(version.documentTemplateVersion))) {
    throw codedError(
      "当前服务不支持该报价文档模板版本",
      409,
      "QUOTATION_DOCUMENT_TEMPLATE_UNSUPPORTED",
    );
  }
}
