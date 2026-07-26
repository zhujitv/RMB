import type { Prisma } from "../generated/prisma/client.js";
import { nonEmpty } from "./shared-base-utils";
import { DOMESTIC_LOGISTICS_SUPPLIER_TYPES } from "./shared-cost-constants";
import { SUPPLIER_STATUSES, SUPPLIER_TYPES } from "./shared-document-constants";
import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  PRODUCT_SUPPLIER_TYPES,
  supplierTypeStorageValue,
} from "./shared-party-constants";
import { effectivePermissions } from "./shared-permission-data";

export type SupplierSelectionActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

export type SupplierSelectionQuery = {
  get(name: string): string | null;
} | null | undefined;

export const AVAILABLE_SUPPLIER_SELECT = {
  id: true,
  supplierName: true,
  supplierType: true,
  status: true,
  allowDomesticLogisticsEntry: true,
  allowLogisticsExpenseEntry: true,
  allowLogisticsInvoiceUpload: true,
  allowFactoryDocumentUpload: true,
  isDefaultLogisticsSupplier: true,
  allowedLogisticsCostTypes: true,
} satisfies Prisma.SupplierSelect;

export function canListAvailableSupplierOptions(actor: SupplierSelectionActor) {
  const permissions = effectivePermissions(actor);
  return Boolean(
    permissions.reads.suppliers
    || permissions.writes.costs
    || permissions.writes.logistics
    || permissions.writes.domesticLogistics
    || permissions.writes.taxRefund,
  );
}

export function canReadFullSupplierRecords(actor: SupplierSelectionActor) {
  return Boolean(effectivePermissions(actor).reads.suppliers);
}

export function availableSupplierScopeId(actor: SupplierSelectionActor) {
  const role = nonEmpty(actor?.role);
  const supplierId = nonEmpty(actor?.supplierId);
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role) && supplierId) {
    return supplierId;
  }
  if (role === LOGISTICS_OPERATOR_ROLE) return "__no_supplier_bound__";
  return "";
}

export function supplierListWhere(
  query: SupplierSelectionQuery,
  actor: SupplierSelectionActor,
  onlyActive = false,
): Prisma.SupplierWhereInput {
  const keyword = nonEmpty(query?.get("q") || query?.get("keyword") || query?.get("party"));
  const typeText = nonEmpty(query?.get("type") || query?.get("supplierType"));
  const statusText = nonEmpty(query?.get("status"));
  const typeMap: Record<string, string | string[]> = {
    factory: PRODUCT_SUPPLIER_TYPES,
    logistics: "物流供应商",
    logisticsfee: DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
    "logistics-fee": DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
    logistics_fee: DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
    customs: "报关供应商",
    ocean: "海运供应商",
    shipping: "海运供应商",
    other: "其他供应商",
  };
  const statusMap: Record<string, string> = { active: "启用", enabled: "启用", inactive: "停用", disabled: "停用" };
  const supplierType = typeText ? (typeMap[typeText.toLowerCase()] || typeText) : "";
  const requestedStatus = statusText ? (statusMap[statusText.toLowerCase()] || statusText) : "";
  const scopedSupplierId = onlyActive ? availableSupplierScopeId(actor) : "";
  const fullRecordSearch = canReadFullSupplierRecords(actor);

  return {
    deletedAt: null,
    ...(scopedSupplierId ? { id: scopedSupplierId } : {}),
    ...((onlyActive || actor?.role !== "管理员")
      ? { status: "启用" }
      : (SUPPLIER_STATUSES.includes(requestedStatus) ? { status: requestedStatus } : {})),
    ...(Array.isArray(supplierType)
      ? { supplierType: { in: supplierType } }
      : (supplierType && PRODUCT_SUPPLIER_TYPES.includes(supplierType)
        ? { supplierType: { in: PRODUCT_SUPPLIER_TYPES } }
        : (supplierType && SUPPLIER_TYPES.includes(supplierType)
          ? { supplierType: supplierTypeStorageValue(supplierType) }
          : {}))),
    ...(keyword ? {
      OR: [
        { supplierName: { contains: keyword, mode: "insensitive" } },
        { supplierType: { contains: keyword, mode: "insensitive" } },
        ...(fullRecordSearch ? [
          { invoiceTitle: { contains: keyword, mode: "insensitive" as const } },
          { contactPerson: { contains: keyword, mode: "insensitive" as const } },
          { taxNumber: { contains: keyword, mode: "insensitive" as const } },
        ] : []),
      ],
    } : {}),
  };
}
