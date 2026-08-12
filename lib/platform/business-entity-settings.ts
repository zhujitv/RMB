import { prisma } from "../prisma";
import { assertRead, assertWrite, canRead, permissionError } from "./shared-access";
import { writeAudit } from "./shared-audit";
import {
  codedError,
  logServerError,
  nonEmpty,
  normalizeEmail,
  requireText,
  validEmail,
} from "./shared-base-utils";
import {
  activeBusinessEntityWhere,
  serializeBusinessEntity,
  serializeBusinessEntitySettings,
} from "./business-entity-core";
import {
  BUSINESS_ENTITY_BANK_ACCOUNT_CURRENCIES,
  type BusinessEntityBankAccountCurrency,
} from "./business-entity-bank-accounts";
import type { writeAudit as WriteAudit } from "./shared-audit";

type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type AuditRequestLike = Parameters<typeof WriteAudit>[0];
type BusinessEntityInput = Record<string, unknown>;
type BankAccountPayload = {
  currency: BusinessEntityBankAccountCurrency;
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  accountNumber: string;
  swiftCode: string;
};

const BUSINESS_ENTITY_LIST_LIMIT = 1000;
const INVALID_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function own(input: BusinessEntityInput, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function optionalBusinessText(value: unknown, label: string, maxLength: number, multiline = false) {
  const text = nonEmpty(value).normalize("NFKC");
  if (!text) return null;
  if (INVALID_CONTROL_PATTERN.test(text) || (!multiline && /[\r\n]/.test(text))) {
    throw codedError(`${label}包含无效控制字符`, 400, "BUSINESS_ENTITY_TEXT_INVALID");
  }
  if (text.length > maxLength) {
    throw codedError(`${label}不能超过 ${maxLength} 个字符`, 400, "BUSINESS_ENTITY_TEXT_TOO_LONG");
  }
  return multiline ? text.replace(/\r\n?/g, "\n") : text;
}

function optionalBusinessEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!email) return null;
  if (email.length > 254 || !validEmail(email)) {
    throw codedError("联系邮箱格式错误", 400, "BUSINESS_ENTITY_EMAIL_INVALID");
  }
  return email;
}

function optionalBusinessWebsite(value: unknown) {
  const text = optionalBusinessText(value, "官网地址", 500);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsafe URL");
    return url.toString();
  } catch {
    throw codedError("官网地址格式错误，仅支持 http/https", 400, "BUSINESS_ENTITY_WEBSITE_INVALID");
  }
}

function bankAccountPayload(input: BusinessEntityInput) {
  if (!own(input, "bankAccounts")) {
    return {
      provided: false,
      currencies: [] as BusinessEntityBankAccountCurrency[],
      accounts: [] as BankAccountPayload[],
    };
  }
  const raw = input.bankAccounts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw codedError("收款账户资料格式错误", 400, "BUSINESS_ENTITY_BANK_ACCOUNTS_INVALID");
  }
  const values = raw as BusinessEntityInput;
  const currencies = Object.keys(values);
  const unsupported = currencies.filter(
    (currency) => !BUSINESS_ENTITY_BANK_ACCOUNT_CURRENCIES.includes(currency as BusinessEntityBankAccountCurrency),
  );
  if (unsupported.length) {
    throw codedError("当前仅支持人民币和美元收款账户", 400, "BUSINESS_ENTITY_BANK_CURRENCY_INVALID");
  }
  const accounts: BankAccountPayload[] = [];
  for (const currency of BUSINESS_ENTITY_BANK_ACCOUNT_CURRENCIES) {
    const value = values[currency];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw codedError(`${currency} 收款账户格式错误`, 400, "BUSINESS_ENTITY_BANK_ACCOUNT_INVALID");
    }
    const account = value as BusinessEntityInput;
    const beneficiaryName = optionalBusinessText(account.beneficiaryName, `${currency} 收款人名称`, 200);
    const beneficiaryAddress = optionalBusinessText(account.beneficiaryAddress, `${currency} 收款人地址`, 1000, true);
    const bankName = optionalBusinessText(account.bankName, `${currency} 银行名称`, 300);
    const accountNumber = optionalBusinessText(account.accountNumber, `${currency} 银行账号`, 100);
    const swiftCode = optionalBusinessText(account.swiftCode, `${currency} SWIFT / BIC Code`, 11)?.replace(/\s+/g, "").toUpperCase() || null;
    const fields = [beneficiaryName, beneficiaryAddress, bankName, accountNumber, swiftCode];
    if (fields.every((field) => !field)) continue;
    if (fields.some((field) => !field)) {
      throw codedError(
        `${currency} 收款账户请完整填写收款人名称、收款人地址、银行名称、银行账号和 SWIFT / BIC Code`,
        400,
        "BUSINESS_ENTITY_BANK_ACCOUNT_INCOMPLETE",
      );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 .\-/]{0,99}$/.test(accountNumber || "")) {
      throw codedError(`${currency} 银行账号格式错误`, 400, "BUSINESS_ENTITY_ACCOUNT_NUMBER_INVALID");
    }
    if (!/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(swiftCode || "")) {
      throw codedError(`${currency} SWIFT / BIC Code 应为 8 或 11 位`, 400, "BUSINESS_ENTITY_SWIFT_INVALID");
    }
    accounts.push({
      currency,
      beneficiaryName: beneficiaryName as string,
      beneficiaryAddress: beneficiaryAddress as string,
      bankName: bankName as string,
      accountNumber: accountNumber as string,
      swiftCode: swiftCode as string,
    });
  }
  return {
    provided: true,
    currencies: currencies as BusinessEntityBankAccountCurrency[],
    accounts,
  };
}

function businessEntityPayload(input: BusinessEntityInput) {
  const name = optionalBusinessText(requireText(input.name, "公司全称"), "公司全称", 200) as string;
  const isDefault = Boolean(input.isDefault);
  const status = nonEmpty(input.status) === "停用" ? "停用" : "启用";
  const sortOrderValue = Number(input.sortOrder ?? 0);
  if (isDefault && status === "停用") {
    throw codedError("默认业务主体不能停用", 400, "BUSINESS_ENTITY_DEFAULT_DISABLED");
  }
  return {
    name,
    shortName: optionalBusinessText(input.shortName, "公司简称", 100),
    nameEn: optionalBusinessText(input.nameEn, "英文抬头", 200),
    address: optionalBusinessText(input.address, "公司地址", 1000, true),
    contactEmail: optionalBusinessEmail(input.contactEmail),
    contactPhone: optionalBusinessText(input.contactPhone, "联系电话", 100),
    website: optionalBusinessWebsite(input.website),
    showContactPhoneOnPi: Boolean(input.showContactPhoneOnPi),
    showContactEmailOnPi: Boolean(input.showContactEmailOnPi),
    showWebsiteOnPi: Boolean(input.showWebsiteOnPi),
    isDefault,
    status,
    sortOrder: Number.isFinite(sortOrderValue) ? Math.trunc(sortOrderValue) : 0,
    remark: optionalBusinessText(input.remark, "备注", 2000, true),
  };
}

function businessEntityAuditValue(entity: BusinessEntityInput | null | undefined) {
  if (!entity) return entity;
  const safeEntity = { ...entity };
  delete safeEntity.bankAccount;
  const accounts = Array.isArray(entity.bankAccounts)
    ? entity.bankAccounts.map((account) => ({
      currency: nonEmpty((account as BusinessEntityInput | null)?.currency),
      configured: true,
    }))
    : [];
  return {
    ...safeEntity,
    bankAccounts: accounts,
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
  if (!canRead(actor, "orders") && !canRead(actor, "quotations") && !canRead(actor, "salesExecution")) {
    throw permissionError("没有权限查看业务主体");
  }
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
    include: { bankAccounts: { orderBy: { currency: "asc" } } },
    take: BUSINESS_ENTITY_LIST_LIMIT,
  });
  return rows.map(serializeBusinessEntitySettings);
}

export async function createBusinessEntitySetting(request: AuditRequestLike, actor: ActorLike, input: BusinessEntityInput) {
  assertWrite(actor, "settings");
  const payload = businessEntityPayload(input);
  const bankAccounts = bankAccountPayload(input);
  await ensureBusinessEntityNameUnique(payload.name);
  const created = await prisma.$transaction(async (tx) => {
    if (payload.isDefault) {
      await tx.businessEntity.updateMany({ where: { deletedAt: null, isDefault: true }, data: { isDefault: false } });
    }
    return tx.businessEntity.create({
      data: {
        ...payload,
        ...(bankAccounts.accounts.length ? { bankAccounts: { create: bankAccounts.accounts } } : {}),
      },
      include: { bankAccounts: { orderBy: { currency: "asc" } } },
    });
  });
  writeAudit(request, actor, "新增业务主体", "business_entities", created.id, null, businessEntityAuditValue(created))
    .catch((error) => logServerError("新增业务主体日志写入失败", error, { businessEntityId: created.id }));
  return serializeBusinessEntitySettings(created);
}

export async function updateBusinessEntitySetting(request: AuditRequestLike, actor: ActorLike, id: string, input: BusinessEntityInput) {
  assertWrite(actor, "settings");
  const payload = businessEntityPayload(input);
  const bankAccounts = bankAccountPayload(input);
  const before = await prisma.businessEntity.findFirst({
    where: { id, deletedAt: null },
    include: { bankAccounts: { orderBy: { currency: "asc" } } },
  });
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
    await tx.businessEntity.update({ where: { id }, data: payload });
    if (bankAccounts.provided) {
      for (const currency of bankAccounts.currencies) {
        const account = bankAccounts.accounts.find((item) => item.currency === currency);
        if (!account) {
          await tx.businessEntityBankAccount.deleteMany({ where: { businessEntityId: id, currency } });
          continue;
        }
        await tx.businessEntityBankAccount.upsert({
          where: { businessEntityId_currency: { businessEntityId: id, currency } },
          create: { businessEntityId: id, ...account },
          update: account,
        });
      }
    }
    const saved = await tx.businessEntity.findUnique({
      where: { id },
      include: { bankAccounts: { orderBy: { currency: "asc" } } },
    });
    if (!saved) throw codedError("业务主体不存在或已删除", 404, "BUSINESS_ENTITY_NOT_FOUND");
    return saved;
  });
  writeAudit(
    request,
    actor,
    "修改业务主体",
    "business_entities",
    id,
    businessEntityAuditValue(before),
    businessEntityAuditValue(after),
  )
    .catch((error) => logServerError("修改业务主体日志写入失败", error, { businessEntityId: id }));
  return serializeBusinessEntitySettings(after);
}
