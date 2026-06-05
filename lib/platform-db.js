import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";

export const ROLES = ["管理员", "业务员", "财务", "成本录入员", "查看者"];
export const CURRENCIES = ["USD", "EUR", "GBP", "CNY", "HKD"];
export const ORDER_STATUSES = ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"];
export const PAYMENT_STATUSES = ["待确认", "已到账", "部分到账", "已退回", "已取消"];
export const PAYMENT_TYPES = ["预付款", "尾款", "补差款", "其他"];
export const COST_TYPES = ["工厂货款", "国内物流费", "报关费", "港杂费", "海运费", "保险费", "佣金", "样品费", "银行手续费", "其他费用"];
export const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
export const INVOICE_STATUSES = ["未收到", "已收到", "不需要发票"];
export const TRADE_TERMS = ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"];
export const PAYMENT_TERMS = ["预付款", "见提单付款", "见提单复印件付款", "OA账期", "到港后付款", "分批付款", "其他"];
export const SUPPLIER_TYPES = ["工厂供应商", "物流供应商", "报关供应商", "海运供应商", "其他供应商"];
export const SUPPLIER_STATUSES = ["启用", "停用"];

const DEFAULT_ADMIN = {
  id: "admin-user",
  name: "默认管理员",
  email: "admin@example.com",
  passwordHash: "ac0e7d037817094e9e0b4441f9bae3209d67b02fa484917065f71b16109a1a78",
  role: "管理员",
  isActive: true,
};

const WRITE_PERMISSIONS = {
  users: ["管理员"],
  customers: ["管理员", "业务员"],
  orders: ["管理员", "业务员"],
  payments: ["管理员", "财务"],
  costs: ["管理员", "成本录入员"],
  suppliers: ["管理员"],
  attachments: ["管理员", "业务员", "财务", "成本录入员"],
  settings: ["管理员"],
};

const CUSTOMER_VIEW_ALL_ROLES = ["管理员", "财务", "成本录入员", "查看者"];

export function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

export async function ensureDefaultUsers() {
  const count = await prisma.user.count();
  if (count === 0) {
    await prisma.user.create({ data: DEFAULT_ADMIN });
  }
  return prisma.user.findUnique({ where: { email: DEFAULT_ADMIN.email } });
}

export async function getActor(request) {
  await ensureDefaultUsers();
  const cookieUserId = request?.cookies?.get("fta_user_id")?.value;
  if (cookieUserId) {
    const user = await prisma.user.findFirst({
      where: { id: cookieUserId, isActive: true },
    });
    if (user) return user;
  }
  return prisma.user.findUnique({ where: { email: DEFAULT_ADMIN.email } });
}

export function canWrite(user, area) {
  return WRITE_PERMISSIONS[area]?.includes(user?.role) || false;
}

export function assertWrite(user, area) {
  if (!canWrite(user, area)) {
    const error = new Error("没有权限执行该操作");
    error.status = 403;
    throw error;
  }
}

export function apiError(error, fallback = "请求处理失败") {
  console.error(error);
  return NextResponse.json(
    { error: error?.message || fallback },
    { status: error?.status || 500 },
  );
}

export function ok(data = {}) {
  return NextResponse.json(data);
}

export function dateFromInput(value) {
  if (!value) return null;
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

export function dateToInput(value) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export function num(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function amountCny(amount, rate) {
  return Math.round(num(amount) * num(rate, 1) * 100) / 100;
}

export function nonEmpty(value) {
  return String(value ?? "").trim();
}

export function optional(value) {
  const text = nonEmpty(value);
  return text || null;
}

export function requirePositive(value, label) {
  const number = num(value);
  if (number <= 0) {
    const error = new Error(`${label}必须大于 0`);
    error.status = 400;
    throw error;
  }
  return number;
}

export function requireText(value, label) {
  const text = nonEmpty(value);
  if (!text) {
    const error = new Error(`${label}不能为空`);
    error.status = 400;
    throw error;
  }
  return text;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeUser(user) {
  return publicUser(user);
}

export function serializeCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    country: customer.country || "",
    defaultCurrency: customer.defaultCurrency,
    salespersonUserId: customer.salespersonUserId || "",
    salespersonName: customer.salesperson?.name || "",
    contactPerson: customer.contactPerson || "",
    contactEmail: customer.contactEmail || "",
    contactPhone: customer.contactPhone || "",
    remark: customer.remark || "",
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function serializeSupplier(supplier) {
  return {
    id: supplier.id,
    supplierName: supplier.supplierName,
    supplierType: supplier.supplierType,
    country: supplier.country || "",
    contactPerson: supplier.contactPerson || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    invoiceTitle: supplier.invoiceTitle || "",
    taxNumber: supplier.taxNumber || "",
    bankName: supplier.bankName || "",
    bankAccount: supplier.bankAccount || "",
    remark: supplier.remark || "",
    status: supplier.status,
    createdBy: serializeUser(supplier.createdBy),
    updatedBy: serializeUser(supplier.updatedBy),
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

function serializePayment(payment) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    orderNo: payment.order?.orderNo || "",
    customerName: payment.order?.customerNameSnapshot || payment.order?.customer?.name || "",
    paymentDate: dateToInput(payment.paymentDate),
    currency: payment.currency,
    exchangeRate: Number(payment.exchangeRate),
    amount: Number(payment.amount),
    amountCny: Number(payment.amountCny),
    paymentType: payment.paymentType || "尾款",
    status: payment.status,
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
    createdBy: serializeUser(payment.createdBy),
    updatedBy: serializeUser(payment.updatedBy),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

function serializeCost(cost) {
  return {
    id: cost.id,
    orderId: cost.orderId,
    orderNo: cost.order?.orderNo || "",
    blNo: cost.order?.blNo || "",
    billOfLadingNo: cost.order?.blNo || "",
    customerId: cost.order?.customerId || "",
    customerName: cost.order?.customerNameSnapshot || cost.order?.customer?.name || "",
    orderCurrency: cost.order?.currency || "",
    orderExchangeRate: Number(cost.order?.exchangeRate || 0),
    orderStatus: cost.order?.status || "",
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierNameSnapshot: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierType: cost.supplier?.supplierType || "",
    costType: cost.costType,
    vendorName: cost.supplierNameSnapshot || cost.vendorName,
    currency: cost.currency,
    exchangeRate: Number(cost.exchangeRate),
    amount: Number(cost.amount),
    amountCny: Number(cost.amountCny),
    paymentStatus: cost.paymentStatus,
    paymentDate: dateToInput(cost.paymentDate),
    invoiceStatus: cost.invoiceStatus,
    remark: cost.remark || "",
    createdBy: serializeUser(cost.createdBy),
    updatedBy: serializeUser(cost.updatedBy),
    createdAt: cost.createdAt,
    updatedAt: cost.updatedAt,
  };
}

function confirmedPayment(payment) {
  return ["已到账", "部分到账"].includes(payment.status) && !payment.deletedAt;
}

function validCost(cost) {
  return cost.paymentStatus !== "已取消" && !cost.deletedAt;
}

function calcReminderStatus({ outstandingCny, dueDate, reminderDays }) {
  if (outstandingCny <= 0) return { status: "已结清", overdueDays: 0 };
  if (!dueDate) return { status: "未到期", overdueDays: 0 };
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const diff = Math.round((due.getTime() - todayDate.getTime()) / 86400000);
  if (diff < 0) return { status: "已逾期", overdueDays: Math.abs(diff) };
  if (diff <= Number(reminderDays || 0)) return { status: "即将到期", overdueDays: 0 };
  return { status: "未到期", overdueDays: 0 };
}

export function summarizeOrder(order) {
  const estimatedAmount = Number(order.estimatedReceivableAmount ?? order.receivableAmount);
  const estimatedCny = Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny);
  const actualAmount = order.actualShipmentAmount == null ? null : Number(order.actualShipmentAmount);
  const actualCny = order.actualShipmentAmountCny == null ? null : Number(order.actualShipmentAmountCny);
  const finalAmount = Number(order.finalReceivableAmount ?? (actualAmount ?? estimatedAmount));
  const finalCny = Number(order.finalReceivableAmountCny ?? (actualCny ?? estimatedCny));
  const receivableCny = finalCny;
  const receivableAmount = finalAmount;
  const exchangeRate = Number(order.exchangeRate) || 1;
  const confirmedPaymentsCny = (order.payments || [])
    .filter(confirmedPayment)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const pendingPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "待确认" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny), 0);
  const totalCostCny = (order.costs || [])
    .filter(validCost)
    .reduce((sum, cost) => sum + Number(cost.amountCny), 0);
  const balanceCny = receivableCny - confirmedPaymentsCny;
  const outstandingCny = Math.max(balanceCny, 0);
  const overpaidCny = Math.max(-balanceCny, 0);
  const balanceAmount = receivableAmount - (confirmedPaymentsCny / exchangeRate);
  const outstandingAmount = Math.max(balanceAmount, 0);
  const overpaidAmount = Math.max(-balanceAmount, 0);
  const expectedGrossProfit = receivableCny - totalCostCny;
  const actualGrossProfit = confirmedPaymentsCny - totalCostCny;
  const grossMargin = receivableCny > 0 ? expectedGrossProfit / receivableCny : 0;
  const reminder = calcReminderStatus({
    outstandingCny,
    dueDate: order.dueDate,
    reminderDays: order.reminderDays,
  });

  return {
    receivableCny,
    receivableAmount,
    estimatedReceivableAmount: estimatedAmount,
    estimatedReceivableAmountCny: estimatedCny,
    actualShipmentAmount: actualAmount,
    actualShipmentAmountCny: actualCny,
    finalReceivableAmount: finalAmount,
    finalReceivableAmountCny: finalCny,
    confirmedPaymentsCny,
    pendingPaymentsCny,
    balanceCny,
    balanceAmount,
    outstandingCny,
    outstandingAmount,
    overpaidCny,
    overpaidAmount,
    isOverpaid: overpaidCny > 0,
    isUnderpaid: outstandingCny > 0,
    totalCostCny,
    expectedGrossProfit,
    actualGrossProfit,
    grossMargin,
    reminderStatus: reminder.status,
    overdueDays: reminder.overdueDays,
  };
}

export function serializeOrder(order) {
  const summary = summarizeOrder(order);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId,
    customerName: order.customerNameSnapshot || order.customer?.name || "",
    customerNameSnapshot: order.customerNameSnapshot || order.customer?.name || "",
    salespersonId: order.salespersonUserId || "",
    salespersonUserId: order.salespersonUserId || "",
    salespersonName: order.salesperson?.name || "",
    country: order.country || "",
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate),
    estimatedReceivableAmount: Number(order.estimatedReceivableAmount ?? order.receivableAmount),
    estimatedReceivableAmountCny: Number(order.estimatedReceivableAmountCny ?? order.receivableAmountCny),
    actualShipmentAmount: order.actualShipmentAmount == null ? "" : Number(order.actualShipmentAmount),
    actualShipmentAmountCny: order.actualShipmentAmountCny == null ? "" : Number(order.actualShipmentAmountCny),
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    receivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    tradeTerm: order.tradeTerm,
    paymentTerm: order.paymentTerm,
    expectedPaymentDate: dateToInput(order.expectedPaymentDate),
    creditDays: order.creditDays ?? "",
    dueDate: dateToInput(order.dueDate),
    reminderDays: order.reminderDays,
    status: order.status,
    remark: order.remark || "",
    createdBy: serializeUser(order.createdBy),
    updatedBy: serializeUser(order.updatedBy),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary,
  };
}

export function includeOrderRelations() {
  return {
    customer: true,
    salesperson: true,
    createdBy: true,
    updatedBy: true,
    payments: {
      where: { deletedAt: null },
      include: { createdBy: true, updatedBy: true },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    },
    costs: {
      where: { deletedAt: null },
      include: { createdBy: true, updatedBy: true },
      orderBy: [{ createdAt: "desc" }],
    },
  };
}

export async function writeAudit(request, user, action, entityType, entityId, beforeData, afterData) {
  await prisma.auditLog.create({
    data: {
      userId: user?.id,
      action,
      entityType,
      entityId,
      beforeData: beforeData ?? undefined,
      afterData: afterData ?? undefined,
      ipAddress: request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    },
  });
}

export function applyCommonFilters(rows, query) {
  const monthValue = (value) => {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 7);
    return String(value).slice(0, 7);
  };
  const month = query.get("month") || "";
  const orderText = (query.get("order") || "").toLowerCase();
  const party = (query.get("party") || "").toLowerCase();
  const country = (query.get("country") || "").toLowerCase();
  const currency = query.get("currency") || "";
  const orderStatus = query.get("orderStatus") || "";
  const paymentStatus = query.get("paymentStatus") || "";
  const reminderStatus = query.get("reminderStatus") || "";
  const costType = query.get("costType") || "";

  return rows.filter((row) => {
    const createdMonth = monthValue(row.createdAt);
    const dateMonth = monthValue(row.paymentDate || row.paymentDateText || row.paymentDate || row.createdAt);
    if (month && createdMonth !== month && dateMonth !== month) return false;
    if (orderText && !`${row.orderNo || ""} ${row.blNo || ""}`.toLowerCase().includes(orderText)) return false;
    if (party && !`${row.customerName || ""} ${row.supplierName || row.vendorName || ""} ${row.salespersonName || ""}`.toLowerCase().includes(party)) return false;
    if (country && !String(row.country || "").toLowerCase().includes(country)) return false;
    if (currency && row.currency !== currency) return false;
    if (orderStatus && row.summary && row.status !== orderStatus) return false;
    if (paymentStatus && row.paymentStatus !== undefined && row.paymentStatus !== paymentStatus) return false;
    if (paymentStatus && row.paymentStatus === undefined && row.bankReference !== undefined && row.status !== paymentStatus) return false;
    if (reminderStatus && row.summary?.reminderStatus !== reminderStatus && row.reminderStatus !== reminderStatus) return false;
    if (costType && row.costType !== undefined && row.costType !== costType) return false;
    return true;
  });
}

export async function listUsers() {
  await ensureDefaultUsers();
  const users = await prisma.user.findMany({ orderBy: [{ createdAt: "asc" }] });
  return users.map(serializeUser);
}

export async function saveUser(request, actor, input, id = null) {
  assertWrite(actor, "users");
  const role = ROLES.includes(input.role) ? input.role : "查看者";
  const data = {
    name: requireText(input.name, "姓名"),
    email: requireText(input.email, "邮箱"),
    role,
    isActive: input.isActive !== false,
  };
  if (input.password) data.passwordHash = hashPassword(input.password);
  if (!id && !data.passwordHash) data.passwordHash = hashPassword("123456");

  const before = id ? await prisma.user.findUnique({ where: { id } }) : null;
  const user = id
    ? await prisma.user.update({ where: { id }, data })
    : await prisma.user.create({ data });
  await writeAudit(request, actor, id ? "更新用户" : "新增用户", "users", user.id, before, user);
  return serializeUser(user);
}

function canViewAllCustomers(actor) {
  return CUSTOMER_VIEW_ALL_ROLES.includes(actor?.role);
}

function customerAccessWhere(actor) {
  if (!actor) return {};
  if (canViewAllCustomers(actor)) return {};
  if (actor.role === "业务员") return { salespersonUserId: actor.id };
  return { id: "__no_customer_access__" };
}

async function assertCustomerScope(actor, customerId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    include: { salesperson: true },
  });
  if (!customer) {
    const error = new Error("请选择有效客户");
    error.status = 400;
    throw error;
  }
  if (!canViewAllCustomers(actor) && customer.salespersonUserId !== actor.id) {
    const error = new Error("无权限使用该客户");
    error.status = 403;
    throw error;
  }
  return customer;
}

async function resolveSalespersonUserId(input, actor, customer, before = null) {
  if (actor.role === "业务员") return actor.id;
  const requestedId = optional(input.salespersonUserId || input.salespersonId);
  if (requestedId) {
    const user = await prisma.user.findFirst({ where: { id: requestedId, isActive: true } });
    if (!user) {
      const error = new Error("请选择有效业务员");
      error.status = 400;
      throw error;
    }
    return user.id;
  }
  return before?.salespersonUserId || customer.salespersonUserId || actor.id;
}

async function resolveCustomerSalespersonUserId(input, actor, before = null) {
  if (actor.role === "业务员") return actor.id;
  if (actor.role !== "管理员") return before?.salespersonUserId || null;
  const requestedId = optional(input.salespersonUserId);
  if (!requestedId) return null;
  const user = await prisma.user.findFirst({ where: { id: requestedId, isActive: true } });
  if (!user) {
    const error = new Error("请选择有效负责业务员");
    error.status = 400;
    throw error;
  }
  return user.id;
}

export async function listCustomers(query, actor = null) {
  const keyword = (query.get("keyword") || query.get("party") || "").trim();
  const where = {
    deletedAt: null,
    ...customerAccessWhere(actor),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { country: { contains: keyword, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const customers = await prisma.customer.findMany({
    where,
    include: { salesperson: true },
    orderBy: [{ name: "asc" }],
  });
  return customers.map(serializeCustomer);
}

export async function listAvailableCustomers(query, actor) {
  return listCustomers(query, actor);
}

export async function saveCustomer(request, actor, input, id = null) {
  assertWrite(actor, "customers");
  const name = requireText(input.name, "客户");
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
  const data = {
    name,
    country: optional(input.country),
    defaultCurrency: input.defaultCurrency || "USD",
    salespersonUserId,
    contactPerson: optional(input.contactPerson),
    contactEmail: optional(input.contactEmail),
    contactPhone: optional(input.contactPhone),
    remark: optional(input.remark),
  };
  const customer = id
    ? await prisma.customer.update({ where: { id }, data, include: { salesperson: true } })
    : await prisma.customer.create({ data, include: { salesperson: true } });
  await writeAudit(request, actor, id ? "更新客户" : "新增客户", "customers", customer.id, before, customer);
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
  await writeAudit(request, actor, "删除客户", "customers", id, before, row);
}

export async function listSuppliers(query, actor = null, onlyActive = false) {
  const keyword = nonEmpty(query.get("q") || query.get("keyword") || query.get("party"));
  const where = {
    deletedAt: null,
    ...(onlyActive ? { status: "启用" } : {}),
    ...(keyword ? {
      OR: [
        { supplierName: { contains: keyword, mode: "insensitive" } },
        { invoiceTitle: { contains: keyword, mode: "insensitive" } },
        { contactPerson: { contains: keyword, mode: "insensitive" } },
        { supplierType: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
  };
  const suppliers = await prisma.supplier.findMany({
    where,
    include: { createdBy: true, updatedBy: true },
    orderBy: [{ supplierName: "asc" }],
    take: onlyActive ? 50 : undefined,
  });
  return suppliers.map(serializeSupplier);
}

export async function listAvailableSuppliers(query, actor) {
  return listSuppliers(query, actor, true);
}

async function assertSupplierActive(supplierId) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    include: { createdBy: true, updatedBy: true },
  });
  if (!supplier) {
    const error = new Error("请选择有效供应商");
    error.status = 400;
    throw error;
  }
  if (supplier.status !== "启用") {
    const error = new Error("供应商已停用，不能用于成本录入");
    error.status = 400;
    throw error;
  }
  return supplier;
}

export async function saveSupplier(request, actor, input, id = null) {
  assertWrite(actor, "suppliers");
  const supplierName = requireText(input.supplierName || input.name, "供应商名称");
  const before = id
    ? await prisma.supplier.findFirst({ where: { id, deletedAt: null }, include: { createdBy: true, updatedBy: true } })
    : null;
  if (id && !before) {
    const error = new Error("供应商不存在或已删除");
    error.status = 404;
    throw error;
  }
  const duplicate = await prisma.supplier.findFirst({
    where: {
      supplierName: { equals: supplierName, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    const error = new Error("供应商名称已存在，不能重复创建");
    error.status = 409;
    throw error;
  }
  const data = {
    supplierName,
    supplierType: SUPPLIER_TYPES.includes(input.supplierType) ? input.supplierType : "其他供应商",
    country: optional(input.country),
    contactPerson: optional(input.contactPerson),
    phone: optional(input.phone),
    email: optional(input.email),
    address: optional(input.address),
    invoiceTitle: optional(input.invoiceTitle),
    taxNumber: optional(input.taxNumber),
    bankName: optional(input.bankName),
    bankAccount: optional(input.bankAccount),
    remark: optional(input.remark),
    status: SUPPLIER_STATUSES.includes(input.status) ? input.status : "启用",
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  const supplier = id
    ? await prisma.supplier.update({ where: { id }, data, include: { createdBy: true, updatedBy: true } })
    : await prisma.supplier.create({ data, include: { createdBy: true, updatedBy: true } });
  await writeAudit(request, actor, id ? "更新供应商" : "新增供应商", "suppliers", supplier.id, before, supplier);
  return serializeSupplier(supplier);
}

export async function deleteSupplier(request, actor, id) {
  assertWrite(actor, "suppliers");
  const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!before) {
    const error = new Error("供应商不存在或已删除");
    error.status = 404;
    throw error;
  }
  const costCount = await prisma.orderCost.count({ where: { supplierId: id, deletedAt: null } });
  if (costCount > 0) {
    const error = new Error("该供应商已有成本记录，不能删除，只能停用。");
    error.status = 400;
    throw error;
  }
  const row = await prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.id } });
  await writeAudit(request, actor, "删除供应商", "suppliers", id, before, row);
}

function validateDuplicateOrder(orderNo, id = null) {
  return prisma.receivableOrder.findFirst({
    where: {
      orderNo,
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
}

function orderAccessWhere(actor) {
  return actor?.role === "业务员" ? { OR: [{ createdById: actor.id }, { salespersonUserId: actor.id }] } : {};
}

function canAccessOrder(actor, order) {
  return actor?.role !== "业务员" || order.createdById === actor.id || order.salespersonUserId === actor.id;
}

export async function listOrders(query, actor) {
  const where = {
    deletedAt: null,
    ...orderAccessWhere(actor),
  };
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
  return applyCommonFilters(orders.map(serializeOrder), query);
}

export async function getOrder(id, actor) {
  const order = await prisma.receivableOrder.findFirst({
    where: {
      id,
      deletedAt: null,
      ...orderAccessWhere(actor),
    },
    include: includeOrderRelations(),
  });
  if (!order) {
    const error = new Error("应收订单不存在或无权查看");
    error.status = 404;
    throw error;
  }
  return serializeOrder(order);
}

export async function searchReceivableOrders(query, actor) {
  const q = nonEmpty(query.get("q"));
  const filters = [
    orderAccessWhere(actor),
    q ? {
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { blNo: { contains: q, mode: "insensitive" } },
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    } : {},
  ].filter((item) => Object.keys(item).length);
  const where = {
    deletedAt: null,
    ...(filters.length ? { AND: filters } : {}),
  };
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
    take: 20,
  });
  return orders.map(serializeOrder);
}

export async function saveOrder(request, actor, input, id = null) {
  assertWrite(actor, "orders");
  const before = id
    ? await prisma.receivableOrder.findFirst({ where: { id, deletedAt: null }, include: includeOrderRelations() })
    : null;
  if (id && !before) {
    const error = new Error("应收订单不存在或已删除");
    error.status = 404;
    throw error;
  }
  if (before && actor.role === "业务员" && before.createdById !== actor.id && before.salespersonUserId !== actor.id) {
    const error = new Error("无权限修改该应收订单");
    error.status = 403;
    throw error;
  }
  const customer = await assertCustomerScope(actor, requireText(input.customerId, "客户"));
  const orderNo = requireText(input.orderNo, "订单号");
  const blNo = optional(input.blNo || input.billOfLadingNo);
  const duplicate = await validateDuplicateOrder(orderNo, id);
  if (duplicate) {
    const error = new Error("订单号已存在，不能重复提交");
    error.status = 409;
    throw error;
  }
  const estimatedReceivableAmount = requirePositive(input.estimatedReceivableAmount ?? input.receivableAmount, "预计应收金额");
  const actualShipmentAmount = input.actualShipmentAmount === "" || input.actualShipmentAmount == null
    ? null
    : requirePositive(input.actualShipmentAmount, "实际发货金额");
  const finalReceivableAmount = input.finalReceivableAmount === "" || input.finalReceivableAmount == null
    ? (actualShipmentAmount ?? estimatedReceivableAmount)
    : requirePositive(input.finalReceivableAmount, "最终应收金额");
  const currency = requireText(input.currency, "币种");
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const exchangeRate = requirePositive(input.exchangeRate, "汇率");
  const salespersonUserId = await resolveSalespersonUserId(input, actor, customer, before);
  const createdAt = before?.createdAt || new Date();
  const dueDate = dateFromInput(input.dueDate);
  if (dueDate && createdAt && dueDate < new Date(createdAt.toISOString().slice(0, 10))) {
    const error = new Error("到期日不能早于订单创建日期");
    error.status = 400;
    throw error;
  }
  const data = {
    orderNo,
    blNo,
    customerId: customer.id,
    customerNameSnapshot: before && before.customerId === customer.id ? before.customerNameSnapshot : customer.name,
    salespersonUserId,
    country: optional(input.country || customer.country),
    currency,
    exchangeRate,
    estimatedReceivableAmount,
    estimatedReceivableAmountCny: amountCny(estimatedReceivableAmount, exchangeRate),
    actualShipmentAmount,
    actualShipmentAmountCny: actualShipmentAmount == null ? null : amountCny(actualShipmentAmount, exchangeRate),
    finalReceivableAmount,
    finalReceivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    receivableAmount: finalReceivableAmount,
    receivableAmountCny: amountCny(finalReceivableAmount, exchangeRate),
    tradeTerm: TRADE_TERMS.includes(input.tradeTerm) ? input.tradeTerm : "FOB",
    paymentTerm: PAYMENT_TERMS.includes(input.paymentTerm) ? input.paymentTerm : "OA账期",
    expectedPaymentDate: dateFromInput(input.expectedPaymentDate),
    creditDays: input.creditDays === "" || input.creditDays == null ? null : Math.round(num(input.creditDays)),
    dueDate,
    reminderDays: Math.max(0, Math.round(num(input.reminderDays, 7))),
    status: ORDER_STATUSES.includes(input.status) ? input.status : "已确认",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  if (before && before.status === "已关闭" && actor.role !== "管理员") {
    const error = new Error("已关闭订单不能修改");
    error.status = 400;
    throw error;
  }
  const order = id
    ? await prisma.receivableOrder.update({ where: { id }, data, include: includeOrderRelations() })
    : await prisma.receivableOrder.create({ data, include: includeOrderRelations() });
  await writeAudit(request, actor, id ? "更新应收订单" : "新增应收订单", "receivable_orders", order.id, before, order);
  const shouldSyncStatus = data.actualShipmentAmount != null || order.payments?.some(confirmedPayment);
  const synced = shouldSyncStatus ? await syncOrderStatus(order.id) : order;
  return serializeOrder(synced || order);
}

export async function deleteOrder(request, actor, id) {
  assertWrite(actor, "orders");
  const before = await prisma.receivableOrder.findUnique({ where: { id }, include: includeOrderRelations() });
  if (before && actor.role === "业务员" && before.createdById !== actor.id && before.salespersonUserId !== actor.id) {
    const error = new Error("无权限删除该应收订单");
    error.status = 403;
    throw error;
  }
  const row = await prisma.receivableOrder.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await writeAudit(request, actor, "删除应收订单", "receivable_orders", id, before, row);
}

async function assertOrderOpen(orderId, actor) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { customer: true },
  });
  if (!order) {
    const error = new Error("请选择有效应收订单");
    error.status = 400;
    throw error;
  }
  if (!canAccessOrder(actor, order)) {
    const error = new Error("无权限访问该应收订单");
    error.status = 403;
    throw error;
  }
  if (["已关闭", "已取消"].includes(order.status) && actor.role !== "管理员") {
    const error = new Error("已关闭或已取消订单不能继续新增收款或成本");
    error.status = 400;
    throw error;
  }
  return order;
}

async function assertOrderCanReceivePayment(order) {
  if (["已关闭", "已取消"].includes(order.status)) {
    const error = new Error("已关闭或已取消订单不能新增收款");
    error.status = 400;
    throw error;
  }
  const confirmed = await prisma.payment.aggregate({
    where: {
      orderId: order.id,
      deletedAt: null,
      status: { in: ["已到账", "部分到账"] },
    },
    _sum: { amountCny: true },
  });
  const finalReceivableCny = Number(order.finalReceivableAmountCny ?? order.receivableAmountCny);
  const outstandingCny = finalReceivableCny - Number(confirmed._sum.amountCny || 0);
  if (outstandingCny <= 0) {
    const error = new Error("订单已收齐，不能新增收款");
    error.status = 400;
    throw error;
  }
}

export async function syncOrderStatus(orderId) {
  const order = await prisma.receivableOrder.findUnique({
    where: { id: orderId },
    include: includeOrderRelations(),
  });
  if (!order || ["草稿", "已关闭", "已取消"].includes(order.status)) return order;
  const summary = summarizeOrder(order);
  let status = order.actualShipmentAmount == null ? "已确认" : "已发货";
  if (summary.overpaidCny > 0) status = "多收款";
  else if (summary.outstandingCny <= 0) status = "已收齐";
  else if (summary.confirmedPaymentsCny > 0) status = "部分收款";
  if (status !== order.status) {
    return prisma.receivableOrder.update({
      where: { id: orderId },
      data: { status },
      include: includeOrderRelations(),
    });
  }
  return order;
}

export async function listPayments(query, actor = null) {
  const rows = await prisma.payment.findMany({
    where: {
      deletedAt: null,
      ...(actor?.role === "业务员"
        ? { order: { is: { OR: [{ createdById: actor.id }, { salespersonUserId: actor.id }] } } }
        : {}),
    },
    include: { order: { include: { customer: true } }, createdBy: true, updatedBy: true },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
  });
  return applyCommonFilters(rows.map(serializePayment), query);
}

export async function savePayment(request, actor, input, id = null) {
  assertWrite(actor, "payments");
  const before = id ? await prisma.payment.findFirst({ where: { id, deletedAt: null } }) : null;
  if (id && !before) {
    const error = new Error("收款记录不存在或已删除");
    error.status = 404;
    throw error;
  }
  const order = await assertOrderOpen(requireText(input.orderId, "关联订单"), actor);
  if (!id || before.orderId !== order.id) {
    await assertOrderCanReceivePayment(order);
  }
  const amount = requirePositive(input.amount, "收款金额");
  const exchangeRate = requirePositive(input.exchangeRate, "汇率");
  const data = {
    orderId: order.id,
    paymentDate: dateFromInput(input.paymentDate) || dateFromInput(new Date().toISOString().slice(0, 10)),
    currency: input.currency || order.currency,
    exchangeRate,
    amount,
    amountCny: amountCny(amount, exchangeRate),
    paymentType: PAYMENT_TYPES.includes(input.paymentType) ? input.paymentType : "尾款",
    status: PAYMENT_STATUSES.includes(input.status) ? input.status : "待确认",
    bankReference: optional(input.bankReference),
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  const payment = id
    ? await prisma.payment.update({ where: { id }, data, include: { order: { include: { customer: true } }, createdBy: true, updatedBy: true } })
    : await prisma.payment.create({ data, include: { order: { include: { customer: true } }, createdBy: true, updatedBy: true } });
  await syncOrderStatus(order.id);
  await writeAudit(request, actor, id ? "更新收款" : "新增收款", "payments", payment.id, before, payment);
  return serializePayment(payment);
}

export async function deletePayment(request, actor, id) {
  assertWrite(actor, "payments");
  const before = await prisma.payment.findUnique({ where: { id } });
  const payment = await prisma.payment.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await syncOrderStatus(payment.orderId);
  await writeAudit(request, actor, "删除收款", "payments", id, before, payment);
}

export async function listCosts(query, actor = null) {
  const rows = await prisma.orderCost.findMany({
    where: {
      deletedAt: null,
      ...(actor?.role === "业务员"
        ? { order: { is: { OR: [{ createdById: actor.id }, { salespersonUserId: actor.id }] } } }
        : {}),
    },
    include: includeCostRelations(),
    orderBy: [{ createdAt: "desc" }],
  });
  return applyCommonFilters(rows.map(serializeCost), query);
}

async function buildCostData(order, actor, input, id = null) {
  const supplier = await assertSupplierActive(requireText(input.supplierId || input.supplier_id, "供应商"));
  const amount = requirePositive(input.amount, "成本金额");
  const exchangeRate = requirePositive(input.exchangeRate, "汇率");
  const currency = requireText(input.currency || "CNY", "币种");
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效成本币种");
    error.status = 400;
    throw error;
  }
  const costType = COST_TYPES.includes(input.costType) ? input.costType : "其他费用";
  const data = {
    orderId: order.id,
    supplierId: supplier.id,
    supplierNameSnapshot: supplier.supplierName,
    costType,
    vendorName: supplier.supplierName,
    currency,
    exchangeRate,
    amount,
    amountCny: amountCny(amount, exchangeRate),
    paymentStatus: COST_PAYMENT_STATUSES.includes(input.paymentStatus) ? input.paymentStatus : "待支付",
    paymentDate: dateFromInput(input.paymentDate),
    invoiceStatus: INVOICE_STATUSES.includes(input.invoiceStatus) ? input.invoiceStatus : "未收到",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  return data;
}

function includeCostRelations() {
  return { order: { include: { customer: true } }, supplier: true, createdBy: true, updatedBy: true };
}

export async function saveCost(request, actor, input, id = null) {
  assertWrite(actor, "costs");
  const order = await assertOrderOpen(requireText(input.orderId || input.receivableOrderId || input.order_id, "关联订单"), actor);
  const data = await buildCostData(order, actor, input, id);
  const before = id ? await prisma.orderCost.findUnique({ where: { id } }) : null;
  const cost = id
    ? await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() })
    : await prisma.orderCost.create({ data, include: includeCostRelations() });
  await writeAudit(request, actor, id ? "更新成本" : "新增成本", "order_costs", cost.id, before, cost);
  return serializeCost(cost);
}

export async function saveCosts(request, actor, input) {
  assertWrite(actor, "costs");
  const order = await assertOrderOpen(requireText(input.orderId || input.receivableOrderId || input.order_id, "关联订单"), actor);
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) {
    const error = new Error("请至少录入一条供应商成本");
    error.status = 400;
    throw error;
  }
  const rows = await Promise.all(items.map((item) => buildCostData(order, actor, {
    ...input,
    ...item,
    costType: item.costType || input.costType,
    paymentStatus: item.paymentStatus || input.paymentStatus,
    paymentDate: item.paymentDate ?? input.paymentDate,
    invoiceStatus: item.invoiceStatus || input.invoiceStatus,
    remark: item.remark ?? input.remark,
  })));
  const costs = await prisma.$transaction(
    rows.map((data) => prisma.orderCost.create({ data, include: includeCostRelations() })),
  );
  await Promise.all(costs.map((cost) => writeAudit(request, actor, "新增成本", "order_costs", cost.id, null, cost)));
  return costs.map(serializeCost);
}

export async function deleteCost(request, actor, id) {
  assertWrite(actor, "costs");
  const before = await prisma.orderCost.findUnique({ where: { id } });
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await writeAudit(request, actor, "删除成本", "order_costs", id, before, cost);
}

export async function getProfitAnalysis(query, actor) {
  return listOrders(query, actor);
}

export async function getReminders(query, actor) {
  const orders = await listOrders(query, actor);
  return orders
    .filter((order) => ["即将到期", "已逾期"].includes(order.summary.reminderStatus))
    .sort((a, b) => {
      if (b.summary.overdueDays !== a.summary.overdueDays) return b.summary.overdueDays - a.summary.overdueDays;
      return String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"));
    });
}

export async function getOverview(query, actor) {
  const [orders, payments, costs] = await Promise.all([
    listOrders(query, actor),
    listPayments(query, actor),
    listCosts(query, actor),
  ]);
  const total = orders.reduce((acc, order) => {
    acc.receivable += order.summary.receivableCny;
    acc.confirmed += order.summary.confirmedPaymentsCny;
    acc.pending += order.summary.pendingPaymentsCny;
    acc.outstanding += order.summary.outstandingCny;
    acc.cost += order.summary.totalCostCny;
    acc.expectedProfit += order.summary.expectedGrossProfit;
    acc.actualProfit += order.summary.actualGrossProfit;
    if (order.summary.reminderStatus === "已逾期") acc.overdueOrders += 1;
    if (order.summary.reminderStatus === "即将到期") acc.dueSoonOrders += 1;
    return acc;
  }, {
    receivable: 0,
    confirmed: 0,
    pending: 0,
    outstanding: 0,
    cost: 0,
    expectedProfit: 0,
    actualProfit: 0,
    overdueOrders: 0,
    dueSoonOrders: 0,
  });
  total.grossMargin = total.receivable > 0 ? total.expectedProfit / total.receivable : 0;

  const groupBy = (items, labelFn, valueFn) => Object.values(items.reduce((acc, item) => {
    const label = labelFn(item) || "未填写";
    acc[label] ||= { label, amount: 0, count: 0 };
    acc[label].amount += valueFn(item);
    acc[label].count += 1;
    return acc;
  }, {})).sort((a, b) => b.amount - a.amount);

  return {
    totals: { ...total, orderCount: orders.length, paymentCount: payments.length, costCount: costs.length },
    orderProfits: orders,
    costStructure: groupBy(costs, (cost) => cost.costType, (cost) => cost.amountCny),
    reminders: await getReminders(query, actor),
    bySalesperson: groupBy(orders, (order) => order.salespersonName, (order) => order.summary.receivableCny),
    byCustomer: groupBy(orders, (order) => order.customerName, (order) => order.summary.receivableCny),
    byMonth: groupBy(orders, (order) => String(order.createdAt).slice(0, 7), (order) => order.summary.receivableCny),
  };
}

export async function getAuditLogs(query) {
  const logs = await prisma.auditLog.findMany({
    include: { user: true },
    orderBy: [{ createdAt: "desc" }],
    take: Math.min(200, Math.max(20, Number(query.get("limit") || 100))),
  });
  return logs.map((log) => ({
    id: log.id,
    user: serializeUser(log.user),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    beforeData: log.beforeData,
    afterData: log.afterData,
    ipAddress: log.ipAddress || "",
    createdAt: log.createdAt,
  }));
}
