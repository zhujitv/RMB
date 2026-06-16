// @ts-nocheck
import { prisma } from "../prisma";
import {
  CURRENCIES,
  CUSTOMER_COMMISSION_STATUSES,
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

export async function listCustomers(query, actor = null, options = {}) {
  assertRead(actor, "customers");
  const keyword = (query?.get("keyword") || query?.get("q") || query?.get("party") || "").trim();
  const where = {
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
  });
  return customers.map(serializeCustomer);
}

export async function listAvailableCustomers(query, actor) {
  if (!canWrite(actor, "orders")) return [];
  return listCustomers(query, actor);
}

export async function listCustomerSalespeople(actor) {
  assertRead(actor, "customers");
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      approvalStatus: "APPROVED",
      role: { in: ["业务员", "管理员"] },
    },
    select: { id: true, name: true, role: true },
    orderBy: [{ name: "asc" }],
  });
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    isActive: true,
  }));
}

export async function saveCustomer(request, actor, input, id = null) {
  assertWrite(actor, "customers");
  const name = normalizeCustomerName(requireText(input.name, "客户"));
  const shortName = normalizeCustomerName(optional(input.shortName));
  const before = id
    ? await prisma.customer.findFirst({ where: { id, deletedAt: null }, include: { salesperson: true } })
    : null;
  if (id && !before) {
    const error = new Error("客户不存在或已删除");
    error.status = 404;
    throw error;
  }
  if (before && !canViewAllCustomers(actor) && before.salespersonUserId !== actor.id) {
    const error = new Error("无权限维护该客户");
    error.status = 403;
    throw error;
  }
  const salespersonUserId = await resolveCustomerSalespersonUserId(input, actor, before);
  const duplicate = await prisma.customer.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    const error = new Error("客户名称已存在，不能重复创建");
    error.status = 409;
    throw error;
  }
  const defaultCurrency = optional(input.defaultCurrency);
  if (defaultCurrency && !CURRENCIES.includes(defaultCurrency)) {
    const error = new Error("请选择有效默认币种");
    error.status = 400;
    throw error;
  }
  const contactEmail = optional(input.contactEmail);
  if (contactEmail && !validEmail(normalizeEmail(contactEmail))) {
    throw codedError(`联系邮箱格式错误：${contactEmail}`, 400, "INVALID_EMAIL_FORMAT");
  }
  const shippingDocsEmails = requireValidEmailList(input.shippingDocsEmails, "清关资料接收邮箱");
  const shippingDocsCcEmails = requireValidEmailList(input.shippingDocsCcEmails, "清关资料抄送邮箱");
  const autoSendDocumentTypes = normalizeShippingDocumentTypes(input.autoSendDocumentTypes);
  const clearanceEmailLanguage = input.clearanceEmailLanguage
    ? normalizeClearanceEmailLanguage(input.clearanceEmailLanguage, input.country)
    : (before?.clearanceEmailLanguage || defaultClearanceEmailLanguage(input.country));
  const data = {
    name,
    shortName: shortName || null,
    country: optional(input.country),
    defaultCurrency,
    salespersonUserId,
    commissionRate: Math.max(0, Math.round(num(input.commissionRate, before?.commissionRate || 0) * 100) / 100),
    commissionStatus: CUSTOMER_COMMISSION_STATUSES.includes(input.commissionStatus) ? input.commissionStatus : (before?.commissionStatus || "启用"),
    contactPerson: optional(input.contactPerson),
    contactEmail,
    contactPhone: optional(input.contactPhone),
    enableAutoShippingDocsNotification: booleanInput(input.enableAutoShippingDocsNotification, before?.enableAutoShippingDocsNotification || false),
    shippingDocsEmails,
    shippingDocsCcEmails,
    autoSendDocumentTypes,
    clearanceEmailLanguage,
    remark: optional(input.remark),
  };
  const customer = id
    ? await prisma.customer.update({ where: { id }, data, include: { salesperson: true } })
    : await prisma.customer.create({ data, include: { salesperson: true } });
  await runNonCriticalTask("客户操作日志写入", () => writeAudit(request, actor, id ? "更新客户" : "新增客户", "customers", customer.id, before, customer));
  return serializeCustomer(customer);
}

export async function deleteCustomer(request, actor, id) {
  assertWrite(actor, "customers");
  const before = await prisma.customer.findUnique({ where: { id } });
  if (before && !canViewAllCustomers(actor) && before.salespersonUserId !== actor.id) {
    const error = new Error("无权限删除该客户");
    error.status = 403;
    throw error;
  }
  const orderCount = await prisma.receivableOrder.count({ where: { customerId: id, deletedAt: null } });
  if (orderCount > 0) {
    const error = new Error("客户存在关联订单，不能删除，只能保留或修改客户资料");
    error.status = 400;
    throw error;
  }
  const row = await prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  await runNonCriticalTask("客户删除操作日志写入", () => writeAudit(request, actor, "删除客户", "customers", id, before, row));
}
