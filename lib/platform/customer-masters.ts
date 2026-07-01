import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  CURRENCIES,
  CUSTOMER_COMMISSION_STATUSES,
  assertJsonObject,
  assertRead,
  assertWrite,
  booleanInput,
  canViewAllCustomers,
  canWrite,
  codedError,
  customerAccessWhere,
  defaultClearanceEmailLanguage,
  normalizeClearanceEmailLanguage,
  normalizeCustomerName,
  normalizeEmail,
  normalizeShippingDocumentTypes,
  num,
  optional,
  pageParams,
  pageResult,
  requireText,
  requireValidEmailList,
  runNonCriticalTask,
  serializeCustomer,
  validEmail,
  writeAudit,
} from "./shared";
import { resolveCustomerSalespersonUserId } from "./shared-admin";

type ListOptions = { paginated?: boolean };
type CustomerInput = Record<string, unknown>;
type CustomerQuery = {
  get(key: string): string | null;
};
type CustomerActorInput = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type CustomerActor = {
  id: string;
  role?: string | null;
  customPermissions?: unknown;
};
type AuditRequestLike = Parameters<typeof writeAudit>[0];

function requireCustomerActor(actor: CustomerActorInput): CustomerActor {
  if (!actor?.id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return {
    id: actor.id,
    role: actor.role,
    customPermissions: actor.customPermissions,
  };
}

export async function listCustomers(query: CustomerQuery | null | undefined, actor: CustomerActorInput = null, options: ListOptions = {}) {
  assertRead(actor, "customers");
  const keyword = (query?.get("keyword") || query?.get("q") || query?.get("party") || "").trim();
  const where: Prisma.CustomerWhereInput = {
    deletedAt: null,
    ...customerAccessWhere(actor),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { shortName: { contains: keyword, mode: "insensitive" } },
            { contactPerson: { contains: keyword, mode: "insensitive" } },
            { contactEmail: { contains: keyword, mode: "insensitive" } },
            { contactPhone: { contains: keyword, mode: "insensitive" } },
            { country: { contains: keyword, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 100);
    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: { salesperson: true },
        orderBy: [{ name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageResult(customers.map(serializeCustomer), total, page, pageSize);
  }
  const customers = await prisma.customer.findMany({
    where,
    include: { salesperson: true },
    orderBy: [{ name: "asc" }],
    take: 1000,
  });
  return customers.map(serializeCustomer);
}

export async function listAvailableCustomers(query: CustomerQuery, actor: CustomerActorInput) {
  if (!canWrite(actor, "orders")) return [];
  return listCustomers(query, actor);
}

export async function listCustomerSalespeople(actor: CustomerActorInput) {
  assertRead(actor, "customers");
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      approvalStatus: "APPROVED",
      role: { in: ["业务员", "管理员"] },
    },
    select: { id: true, name: true, role: true },
    orderBy: [{ name: "asc" }],
    take: 200,
  });
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    isActive: true,
  }));
}

export async function saveCustomer(request: AuditRequestLike, actor: CustomerActorInput, input: unknown, id: string | null = null) {
  assertWrite(actor, "customers");
  const currentActor = requireCustomerActor(actor);
  const body: CustomerInput = assertJsonObject(input);
  const name = normalizeCustomerName(requireText(body.name, "客户"));
  const shortName = normalizeCustomerName(optional(body.shortName) || undefined);
  const before = id
    ? await prisma.customer.findFirst({ where: { id, deletedAt: null }, include: { salesperson: true } })
    : null;
  if (id && !before) {
    throw codedError("客户不存在或已删除", 404, "CUSTOMER_NOT_FOUND");
  }
  if (before && !canViewAllCustomers(currentActor) && before.salespersonUserId !== currentActor.id) {
    throw codedError("无权限维护该客户", 403, "CUSTOMER_PERMISSION_DENIED");
  }
  const salespersonUserId = await resolveCustomerSalespersonUserId(body, currentActor, before || null);
  const duplicate = await prisma.customer.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    throw codedError("客户名称已存在，不能重复创建", 409, "CUSTOMER_DUPLICATE");
  }
  const defaultCurrency = optional(body.defaultCurrency);
  if (defaultCurrency && !CURRENCIES.includes(defaultCurrency)) {
    throw codedError("请选择有效默认币种", 400, "CUSTOMER_DEFAULT_CURRENCY_INVALID");
  }
  const contactEmail = optional(body.contactEmail);
  if (contactEmail && !validEmail(normalizeEmail(contactEmail))) {
    throw codedError(`联系邮箱格式错误：${contactEmail}`, 400, "INVALID_EMAIL_FORMAT");
  }
  const shippingDocsEmails = requireValidEmailList(body.shippingDocsEmails, "清关资料接收邮箱");
  const shippingDocsCcEmails = requireValidEmailList(body.shippingDocsCcEmails, "清关资料抄送邮箱");
  const autoSendDocumentTypes = normalizeShippingDocumentTypes(body.autoSendDocumentTypes);
  const country = optional(body.country);
  const clearanceEmailLanguage = body.clearanceEmailLanguage
    ? normalizeClearanceEmailLanguage(optional(body.clearanceEmailLanguage) || "", country || undefined)
    : (before?.clearanceEmailLanguage || defaultClearanceEmailLanguage(country || undefined));
  const commissionStatus = optional(body.commissionStatus) || "";
  const data = {
    name,
    shortName: shortName || null,
    country,
    defaultCurrency,
    salespersonUserId,
    commissionRate: Math.max(0, Math.round(num(body.commissionRate, Number(before?.commissionRate || 0)) * 100) / 100),
    commissionStatus: CUSTOMER_COMMISSION_STATUSES.includes(commissionStatus) ? commissionStatus : (before?.commissionStatus || "启用"),
    contactPerson: optional(body.contactPerson),
    contactEmail,
    contactPhone: optional(body.contactPhone),
    enableAutoShippingDocsNotification: booleanInput(body.enableAutoShippingDocsNotification, before?.enableAutoShippingDocsNotification || false),
    shippingDocsEmails,
    shippingDocsCcEmails,
    autoSendDocumentTypes,
    clearanceEmailLanguage,
    remark: optional(body.remark),
  };
  const customer = id
    ? await prisma.customer.update({ where: { id }, data, include: { salesperson: true } })
    : await prisma.customer.create({ data, include: { salesperson: true } });
  await runNonCriticalTask("客户操作日志写入", () => writeAudit(request, currentActor, id ? "更新客户" : "新增客户", "customers", customer.id, before, customer));
  return serializeCustomer(customer);
}

export async function deleteCustomer(request: AuditRequestLike, actor: CustomerActorInput, id: string) {
  assertWrite(actor, "customers");
  const currentActor = requireCustomerActor(actor);
  const before = await prisma.customer.findUnique({ where: { id } });
  if (!before || before.deletedAt) {
    throw codedError("客户不存在或已删除", 404, "CUSTOMER_NOT_FOUND");
  }
  if (!canViewAllCustomers(currentActor) && before.salespersonUserId !== currentActor.id) {
    throw codedError("无权限删除该客户", 403, "CUSTOMER_DELETE_PERMISSION_DENIED");
  }
  const orderCount = await prisma.receivableOrder.count({ where: { customerId: id, deletedAt: null } });
  if (orderCount > 0) {
    throw codedError("客户存在关联订单，不能删除，只能保留或修改客户资料", 400, "CUSTOMER_HAS_ORDERS");
  }
  const row = await prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  await runNonCriticalTask("客户删除操作日志写入", () => writeAudit(request, currentActor, "删除客户", "customers", id, before, row));
}
