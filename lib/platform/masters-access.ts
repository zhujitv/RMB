// @ts-nocheck
import { prisma } from "../prisma";
import {
  CUSTOMER_VIEW_ALL_ROLES,
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  canRead,
  canWrite,
  codedError,
  effectivePermissions,
  nonEmpty,
} from "./shared";
import { orderAccessWhere } from "./order-access";

export async function assertDomesticLogisticsSupplier(supplierId) {
  const { assertSupplierActive } = await import("./supplier-masters");
  const supplier = await assertSupplierActive(supplierId);
  if (!DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
    throw codedError("只有物流、报关、海运、港杂费用供应商可以录入物流信息。", 400, "SUPPLIER_TYPE_NOT_ALLOWED");
  }
  if (!supplier.allowDomesticLogisticsEntry) {
    throw codedError("该供应商尚未开启物流信息录入权限。", 400, "SUPPLIER_ENTRY_NOT_ALLOWED");
  }
  return supplier;
}

export async function defaultOrderLogisticsSupplier() {
  return prisma.supplier.findFirst({
    where: {
      deletedAt: null,
      status: "启用",
      isDefaultLogisticsSupplier: true,
      supplierType: { in: DOMESTIC_LOGISTICS_SUPPLIER_TYPES },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function syncOrderLogisticsSuppliers(orderId, supplierIds = [], actor = null) {
  const { getExchangeRateSettings } = await import("./shared-exchange");
  const { normalizedStringArray } = await import("./shared-serialization");
  const settings = await getExchangeRateSettings();
  let ids = normalizedStringArray(supplierIds).filter((item, index, arr) => item && arr.indexOf(item) === index);
  if (!settings.allowMultipleOrderLogisticsSuppliers) {
    const defaultSupplier = await defaultOrderLogisticsSupplier();
    if (!defaultSupplier) {
      throw codedError("请先在供应商资料中设置默认物流供应商。", 400, "DEFAULT_LOGISTICS_SUPPLIER_REQUIRED");
    }
    ids = [defaultSupplier.id];
  }
  if (ids.length) {
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: ids }, deletedAt: null, status: "启用" },
      select: { id: true, supplierType: true },
    });
    if (suppliers.length !== ids.length) throw codedError("请选择有效物流供应商。", 400, "LOGISTICS_SUPPLIER_INVALID");
    const invalid = suppliers.find((supplier) => !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType));
    if (invalid) throw codedError("订单物流供应商只能选择物流、报关、海运或港杂费用供应商。", 400, "LOGISTICS_SUPPLIER_TYPE_INVALID");
  }
  await prisma.$transaction([
    prisma.orderLogisticsSupplier.deleteMany({
      where: { orderId, ...(ids.length ? { supplierId: { notIn: ids } } : {}) },
    }),
    ...ids.map((supplierId) => prisma.orderLogisticsSupplier.upsert({
      where: { orderId_supplierId: { orderId, supplierId } },
      update: { assignedById: actor?.id || null, assignedAt: new Date() },
      create: { orderId, supplierId, assignedById: actor?.id || null },
    })),
  ]);
}

export function isInternalLogisticsOperator(actor) {
  return actor?.role === LEGACY_LOGISTICS_OPERATOR_ROLE && !actor.supplierId;
}

export function isExternalLogisticsSupplierAccount(actor) {
  return [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actor?.role) && Boolean(actor.supplierId);
}

export function canAccessDomesticLogisticsOrder(actor, order) {
  if (!canRead(actor, "domesticLogistics")) return false;
  if (["管理员", "财务"].includes(actor?.role)) return true;
  if (isInternalLogisticsOperator(actor)) return true;
  if (isExternalLogisticsSupplierAccount(actor)) {
    return (order.logisticsSuppliers || []).some((row) => row.supplierId === actor.supplierId);
  }
  if (actor?.role === "业务员") return order?.customer?.salespersonUserId === actor.id;
  return false;
}

export function canClaimDomesticLogisticsOrder(actor, order = {}, input = {}) {
  if (!isInternalLogisticsOperator(actor)) return false;
  const inputOrderNo = nonEmpty(input.orderNo || input.order_no);
  const inputBlNo = nonEmpty(input.blNo || input.billOfLadingNo || input.bill_of_lading_no);
  return Boolean(
    (inputOrderNo && inputOrderNo.toLowerCase() === String(order.orderNo || "").toLowerCase())
    || (inputBlNo && inputBlNo.toLowerCase() === String(order.blNo || "").toLowerCase())
  );
}

export function canUseDomesticLogisticsDocumentScope(actor, documentType) {
  return canRead(actor, "domesticLogistics") && DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType);
}

export function canViewAllCustomers(actor) {
  const permissions = effectivePermissions(actor);
  return CUSTOMER_VIEW_ALL_ROLES.includes(actor?.role) || (canRead(actor, "customers") && permissions.dataScope === "ALL");
}

export function customerAccessWhere(actor) {
  if (!actor) return {};
  if (canViewAllCustomers(actor)) return {};
  if (actor.role === "业务员") return { salespersonUserId: actor.id };
  return { id: "__no_customer_access__" };
}

export async function assertCustomerScope(actor, customerId) {
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

export async function resolveSalespersonUserId(input, actor, customer, before = null) {
  if (actor.role === "业务员") return actor.id;
  const requestedId = String(input.salespersonUserId || input.salespersonId || "").trim();
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

export async function resolveCustomerSalespersonUserId(input, actor, before = null) {
  if (actor.role === "业务员") return actor.id;
  if (!canWrite(actor, "customers")) return before?.salespersonUserId || null;
  const requestedId = String(input.salespersonUserId || "").trim();
  if (!requestedId) return null;
  const user = await prisma.user.findFirst({ where: { id: requestedId, isActive: true } });
  if (!user) {
    const error = new Error("请选择有效负责业务员");
    error.status = 400;
    throw error;
  }
  return user.id;
}

export function costAccessWhere(actor) {
  if (!canRead(actor, "costs")) return { id: "__no_cost_access__" };
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return {};
  if (scope === "OWN") {
    return { order: { is: { customer: { is: { salespersonUserId: actor.id } } } } };
  }
  if (scope === "OWN_COST") return { createdById: actor.id };
  return { id: "__no_cost_access__" };
}

export function documentOrderListAccessWhere(actor, documentType) {
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return {};
  if (scope === "OWN_COST") return { order: { is: orderAccessWhere(actor) } };
  if (canUseDomesticLogisticsDocumentScope(actor, documentType)) {
    if (isInternalLogisticsOperator(actor)) return {};
    if (isExternalLogisticsSupplierAccount(actor)) {
      return { order: { is: { logisticsSuppliers: { some: { supplierId: actor.supplierId } } } } };
    }
  }
  return { order: { is: orderAccessWhere(actor) } };
}
