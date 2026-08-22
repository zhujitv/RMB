import type { CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import type { ContainerLoad } from "../container-load";
import type { FactoryPurchaseOrder } from "./factory-purchase-order-types";
export type {
  FactoryPurchaseOrder,
  FactoryPurchaseOrderAdjustment,
  FactoryPurchaseOrderPriceCorrection,
  FactoryPurchaseOrderConfirmationEvent,
  FactoryPurchaseOrderPayment,
  FactoryPurchaseOrderProductionStatus,
  FactoryPurchaseOrderSettlement,
  FactoryPurchaseOrderStatus,
  FactoryConfirmationChannel,
  FactoryConfirmationEvidence,
  FactoryConfirmationSource,
  PurchaseOrderItem,
} from "./factory-purchase-order-types";

export const SALES_EXECUTION_PAGE_SIZE = 20;
export const SALES_CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
export const SALES_TRADE_TERMS = ["EXW", "FOB", "FCA", "CFR", "CIF", "DAP", "DDP"];

export type SalesExecutionSource = "DIRECT" | "QUOTATION";
export type SalesExecutionStatus = "DRAFT" | "DISPATCHED" | "VOIDED";

export type BusinessEntityOption = {
  id: string;
  name?: string | null;
  shortName?: string | null;
  displayName?: string | null;
  status?: string | null;
};

export type SupplierOption = {
  id: string;
  supplierName?: string | null;
  name?: string | null;
  supplierType?: string | null;
  status?: string | null;
  allowFactoryDocumentUpload?: boolean;
};

export type CustomerProduct = {
  id: string;
  name?: string | null;
  productName?: string | null;
  specification?: string | null;
  unit?: string | null;
  remark?: string | null;
  lastUnitPrice?: string | number | null;
  lastCurrency?: string | null;
};

export type SalesExecutionItem = {
  id: string;
  lineNumber?: number | null;
  customerProductId?: string | null;
  name?: string | null;
  productNameSnapshot?: string | null;
  description?: string | null;
  specification?: string | null;
  specificationSnapshot?: string | null;
  unit?: string | null;
  quantity?: string | number | null;
  salesUnitPrice?: string | number | null;
  unitPrice?: string | number | null;
  salesAmount?: string | number | null;
  amount?: string | number | null;
  unitNetWeightKg?: string | number | null;
  remark?: string | null;
};

export type SalesExecutionVersion = {
  id?: string;
  versionNumber?: number | null;
  createdAt?: string | null;
  createdBy?: { name?: string | null } | null;
};

export type ReceivableOrderSummary = {
  id: string;
  orderNo: string;
  status: string;
  deletedAt?: string | null;
  createdAt?: string | null;
};

export type SalesExecutionRow = {
  id: string;
  executionNo?: string | null;
  status?: SalesExecutionStatus | string | null;
  sourceType?: SalesExecutionSource | string | null;
  sourceQuotationId?: string | null;
  sourceQuotation?: { id?: string; quoteNo?: string | null; quotationNo?: string | null } | null;
  customerId?: string | null;
  customer?: CustomerAutocompleteOption | null;
  customerName?: string | null;
  customerNameSnapshot?: string | null;
  customerShortName?: string | null;
  businessEntityId?: string | null;
  businessEntity?: BusinessEntityOption | null;
  businessEntityNameSnapshot?: string | null;
  salesperson?: { id?: string; name?: string | null } | null;
  salespersonName?: string | null;
  currency?: string | null;
  tradeTerm?: string | null;
  paymentTerm?: string | null;
  customerOrderNo: string;
  requestedDeliveryDate: string;
  remark?: string | null;
  subtotal?: string | number | null;
  totalAmount?: string | number | null;
  currentVersionNumber?: number | null;
  revision?: number | null;
  items?: SalesExecutionItem[];
  purchaseOrders?: FactoryPurchaseOrder[];
  containerLoads?: ContainerLoad[];
  versions?: SalesExecutionVersion[];
  dispatchedAt?: string | null;
  dispatchedBy?: { id?: string; name?: string | null } | null;
  dispatchedVersionNumber?: number | null;
  shippingStartedAt?: string | null;
  shippingStartedBy?: { id?: string; name?: string | null } | null;
  receivableOrder?: ReceivableOrderSummary | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SalesExecutionsResponse = {
  success?: boolean;
  data?: { rows?: SalesExecutionRow[]; total?: number; page?: number; pageSize?: number; totalPages?: number };
  executions?: SalesExecutionRow[];
  message?: string;
};

export type SalesExecutionResponse = {
  success?: boolean;
  data?: SalesExecutionRow;
  execution?: SalesExecutionRow;
  message?: string;
};

export type SalesExecutionDeleteResponse = {
  success?: boolean;
  data?: {
    id?: string;
    customerOrderNo?: string;
    action?: "deleted";
    deletedPurchaseOrderCount?: number;
    deletedDocumentCount?: number;
    cleanupPending?: boolean;
  };
  message?: string;
};

export type SalesExecutionShippingResponse = SalesExecutionResponse & {
  receivableOrder?: ReceivableOrderSummary;
  created?: boolean;
  finalized?: boolean;
};

export type AllocationDraft = {
  key: string;
  id?: string;
  executionItemId: string;
  supplierId: string;
  purchaseCurrency: string;
  allocatedQuantity: string;
  purchaseUnitPrice: string;
  remark: string;
};

export type SalesLineDraft = {
  key: string;
  id?: string;
  customerProductId: string;
  name: string;
  specification: string;
  unit: string;
  quantity: string;
  salesUnitPrice: string;
  unitNetWeightKg: string;
  salesPriceSource: "" | "history" | "manual";
  remark: string;
  allocations: AllocationDraft[];
};

export type SalesExecutionDraft = {
  customerId: string;
  businessEntityId: string;
  currency: string;
  tradeTerm: string;
  paymentTerm: string;
  customerOrderNo: string;
  requestedDeliveryDate: string;
  remark: string;
  items: SalesLineDraft[];
};

let draftKeySequence = 0;
export function draftKey(prefix: string) {
  draftKeySequence += 1;
  return `${prefix}-${Date.now()}-${draftKeySequence}`;
}

export function emptyAllocation(executionItemId = ""): AllocationDraft {
  return { key: draftKey("allocation"), executionItemId, supplierId: "", purchaseCurrency: "CNY", allocatedQuantity: "", purchaseUnitPrice: "", remark: "" };
}

export function emptySalesLine(): SalesLineDraft {
  return { key: draftKey("sales-line"), customerProductId: "", name: "", specification: "", unit: "PCS", quantity: "", salesUnitPrice: "", unitNetWeightKg: "", salesPriceSource: "", remark: "", allocations: [emptyAllocation()] };
}

export function numeric(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function optionalNumeric(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function customerOrderNumber(row?: SalesExecutionRow | null) {
  return String(row?.customerOrderNo || "").trim();
}

export function executionCustomerName(row?: SalesExecutionRow | null) {
  return String(row?.customer?.shortName || row?.customerShortName || row?.customer?.displayName || row?.customerNameSnapshot || row?.customerName || row?.customer?.name || "-");
}

export function executionCustomerFullName(row?: SalesExecutionRow | null) {
  return String(row?.customer?.fullName || row?.customer?.name || row?.customerNameSnapshot || row?.customerName || executionCustomerName(row));
}

export function businessEntityName(entity?: BusinessEntityOption | null) {
  return String(entity?.displayName || entity?.shortName || entity?.name || "-");
}

export function supplierName(supplier?: SupplierOption | null) {
  return String(supplier?.supplierName || supplier?.name || "-");
}

export function filterSupplierOptions(suppliers: SupplierOption[], keyword: string) {
  const terms = String(keyword || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return suppliers;
  return suppliers.filter((supplier) => {
    const searchable = [supplierName(supplier), supplier.name, supplier.supplierType]
      .filter(Boolean)
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN");
    return terms.every((term) => searchable.includes(term));
  });
}

export function salesItemDescription(item?: SalesExecutionItem | SalesLineDraft | null) {
  if (!item) return "";
  const value = item as SalesExecutionItem & Partial<SalesLineDraft>;
  const name = String(value.name || value.productNameSnapshot || value.description || "").trim();
  const specification = String(value.specification || value.specificationSnapshot || "").trim();
  if (!specification || name.toLowerCase().includes(specification.toLowerCase())) return name;
  return `${name} (${specification.replace(/^\(|\)$/g, "")})`;
}

export function salesExecutionTotal(row?: SalesExecutionRow | null) {
  if (row?.totalAmount != null) return numeric(row.totalAmount);
  if (row?.subtotal != null) return numeric(row.subtotal);
  return (row?.items || []).reduce((sum, item) => sum + numeric(item.salesAmount ?? item.amount ?? numeric(item.quantity) * numeric(item.salesUnitPrice ?? item.unitPrice)), 0);
}
