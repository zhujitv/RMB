import { prisma } from "../prisma";
import type { OrderDocumentType, Prisma } from "../generated/prisma/client.js";
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
import { orderAccessWhere, orderOwnedBySalesperson, orderSalespersonOwnershipWhere } from "./order-access";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

type ClaimInput = Record<string, unknown>;
type SalespersonInput = Record<string, unknown>;
type CustomerLike = { salespersonUserId?: string | null } | null | undefined;
type DomesticOrderLike = {
  orderNo?: string | null;
  blNo?: string | null;
  salespersonUserId?: string | null;
  customer?: CustomerLike;
  logisticsSuppliers?: Array<{ supplierId?: string | null } | null> | null;
};
type ExternalLogisticsActor = Exclude<ActorLike, null | undefined> & { supplierId: string };

function actorId(actor: ActorLike) {
  return nonEmpty(actor?.id);
}

function actorRole(actor: ActorLike) {
  return nonEmpty(actor?.role);
}

function inputHasOwnKey(input: SalespersonInput, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export async function assertDomesticLogisticsSupplier(supplierId: string) {
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

export async function syncOrderLogisticsSuppliers(orderId: string, supplierIds: unknown[] = [], actor: ActorLike = null) {
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
      take: ids.length,
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

export function isInternalLogisticsOperator(actor: ActorLike) {
  return actorRole(actor) === LEGACY_LOGISTICS_OPERATOR_ROLE && !actor?.supplierId;
}

export function isExternalLogisticsSupplierAccount(actor: ActorLike): actor is ExternalLogisticsActor {
  return [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actorRole(actor)) && Boolean(actor?.supplierId);
}

export function canAccessDomesticLogisticsOrder(actor: ActorLike, order: DomesticOrderLike | null | undefined) {
  if (!canRead(actor, "domesticLogistics")) return false;
  if (["管理员", "财务"].includes(actorRole(actor))) return true;
  if (isInternalLogisticsOperator(actor)) return true;
  if (isExternalLogisticsSupplierAccount(actor)) {
    return (order?.logisticsSuppliers || []).some((row) => row?.supplierId === actor.supplierId);
  }
  if (actor?.role === "业务员") return orderOwnedBySalesperson(order, actorId(actor));
  return false;
}

export function canClaimDomesticLogisticsOrder(actor: ActorLike, order: DomesticOrderLike = {}, input: ClaimInput = {}) {
  if (!isInternalLogisticsOperator(actor)) return false;
  const inputOrderNo = nonEmpty(input.orderNo || input.order_no);
  const inputBlNo = nonEmpty(input.blNo || input.billOfLadingNo || input.bill_of_lading_no);
  return Boolean(
    (inputOrderNo && inputOrderNo.toLowerCase() === String(order.orderNo || "").toLowerCase())
    || (inputBlNo && inputBlNo.toLowerCase() === String(order.blNo || "").toLowerCase())
  );
}

export function canUseDomesticLogisticsDocumentScope(actor: ActorLike, documentType: string) {
  return canRead(actor, "domesticLogistics") && DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType as OrderDocumentType);
}

export function canViewAllCustomers(actor: ActorLike) {
  const permissions = effectivePermissions(actor);
  return CUSTOMER_VIEW_ALL_ROLES.includes(actorRole(actor)) || (canRead(actor, "customers") && permissions.dataScope === "ALL");
}

export function customerAccessWhere(actor: ActorLike): Prisma.CustomerWhereInput {
  if (!actor) return {};
  if (canViewAllCustomers(actor)) return {};
  if (actor.role === "业务员") return { salespersonUserId: actor.id };
  return { id: "__no_customer_access__" };
}

export async function assertCustomerScope(actor: ActorLike, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    include: { salesperson: true },
  });
  if (!customer) {
    throw codedError("请选择有效客户", 400, "CUSTOMER_REQUIRED");
  }
  if (!canViewAllCustomers(actor) && customer.salespersonUserId !== actorId(actor)) {
    throw codedError("无权限使用该客户", 403, "CUSTOMER_PERMISSION_DENIED");
  }
  return customer;
}

export async function resolveSalespersonUserId(
  input: SalespersonInput,
  actor: ActorLike,
  customer: CustomerLike,
  before: { salespersonUserId?: string | null } | null = null,
) {
  if (actor?.role === "业务员") return actorId(actor);
  const isAdmin = actorRole(actor) === "管理员";
  const hasRequestedField = inputHasOwnKey(input, "salespersonUserId") || inputHasOwnKey(input, "salespersonId");
  const requestedId = String(input.salespersonUserId ?? input.salespersonId ?? "").trim();
  if (hasRequestedField && !requestedId) {
    return isAdmin ? null : (before?.salespersonUserId || customer?.salespersonUserId || actorId(actor));
  }
  if (requestedId) {
    if (!isAdmin) return before?.salespersonUserId || customer?.salespersonUserId || actorId(actor);
    const user = await prisma.user.findFirst({ where: { id: requestedId, isActive: true } });
    if (!user) {
      throw codedError("请选择有效业务员", 400, "SALESPERSON_REQUIRED");
    }
    return user.id;
  }
  return before?.salespersonUserId || customer?.salespersonUserId || actorId(actor);
}

export async function resolveCustomerSalespersonUserId(
  input: SalespersonInput,
  actor: ActorLike,
  before: { salespersonUserId?: string | null } | null = null,
) {
  if (actor?.role === "业务员") return actorId(actor);
  if (!canWrite(actor, "customers")) return before?.salespersonUserId || null;
  const requestedId = String(input.salespersonUserId || "").trim();
  if (!requestedId) return null;
  const user = await prisma.user.findFirst({ where: { id: requestedId, isActive: true } });
  if (!user) {
    throw codedError("请选择有效负责业务员", 400, "SALESPERSON_REQUIRED");
  }
  return user.id;
}

export function costAccessWhere(actor: ActorLike): Prisma.OrderCostWhereInput {
  if (!canRead(actor, "costs")) return { id: "__no_cost_access__" };
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return {};
  if (scope === "OWN") {
    const currentActorId = actorId(actor);
    if (!currentActorId) return { id: "__no_cost_access__" };
    return { order: { is: orderSalespersonOwnershipWhere(currentActorId) } };
  }
  if (scope === "OWN_COST") {
    const currentActorId = actorId(actor);
    return currentActorId ? { createdById: currentActorId } : { id: "__no_cost_access__" };
  }
  return { id: "__no_cost_access__" };
}

export function documentOrderListAccessWhere(actor: ActorLike, documentType: string): Prisma.OrderDocumentWhereInput {
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
