import type { CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import {
  draftKey,
  emptyAllocation,
  emptySalesLine,
  numeric,
  salesItemDescription,
  type AllocationDraft,
  type FactoryPurchaseOrder,
  type SalesExecutionDraft,
  type SalesExecutionItem,
  type SalesExecutionRow,
  type SalesLineDraft,
} from "./types";

function dateInput(value: unknown) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 10) : "";
}

function allocationFromOrderItem(
  order: FactoryPurchaseOrder,
  item: NonNullable<FactoryPurchaseOrder["items"]>[number],
): AllocationDraft {
  return {
    key: `allocation-${item.id || `${order.id}-${item.executionItemId || item.salesExecutionItemId}`}`,
    id: item.id,
    executionItemId: String(item.executionItemId || item.salesExecutionItemId || ""),
    supplierId: String(order.supplierId || order.supplier?.id || ""),
    purchaseCurrency: String(order.purchaseCurrency || order.currency || "CNY").toUpperCase(),
    allocatedQuantity: String(item.allocatedQuantity ?? item.quantity ?? ""),
    purchaseUnitPrice: String(item.purchaseUnitPrice ?? item.unitPrice ?? ""),
    remark: String(item.remark || ""),
  };
}

function itemAllocations(row: SalesExecutionRow, itemId: string) {
  const allocations: AllocationDraft[] = [];
  for (const order of row.purchaseOrders || []) {
    for (const item of order.items || []) {
      if (String(item.executionItemId || item.salesExecutionItemId || "") === itemId) {
        allocations.push(allocationFromOrderItem(order, item));
      }
    }
  }
  return allocations.length ? allocations : [emptyAllocation(itemId)];
}

function lineFromItem(row: SalesExecutionRow, item: SalesExecutionItem, index: number): SalesLineDraft {
  const name = String(item.name || item.productNameSnapshot || item.description || "");
  const specification = String(item.specification || item.specificationSnapshot || "");
  return {
    key: `sales-line-${item.id || index}`,
    id: item.id,
    customerProductId: String(item.customerProductId || ""),
    name,
    specification,
    unit: String(item.unit || "PCS"),
    quantity: String(item.quantity ?? ""),
    salesUnitPrice: String(item.salesUnitPrice ?? item.unitPrice ?? ""),
    unitNetWeightKg: String(item.unitNetWeightKg ?? ""),
    salesPriceSource: "",
    remark: String(item.remark || ""),
    allocations: itemAllocations(row, item.id),
  };
}

export function draftFromExecution(row?: SalesExecutionRow | null): SalesExecutionDraft {
  if (!row) {
    return {
      customerId: "",
      businessEntityId: "",
      currency: "USD",
      tradeTerm: "FOB",
      paymentTerm: "",
      customerOrderNo: "",
      requestedDeliveryDate: "",
      remark: "",
      items: [emptySalesLine()],
    };
  }
  const items = (row.items || []).map((item, index) => lineFromItem(row, item, index));
  return {
    customerId: String(row.customerId || row.customer?.id || ""),
    businessEntityId: String(row.businessEntityId || row.businessEntity?.id || ""),
    currency: String(row.currency || "USD").toUpperCase(),
    tradeTerm: String(row.tradeTerm || ""),
    paymentTerm: String(row.paymentTerm || ""),
    customerOrderNo: String(row.customerOrderNo || ""),
    requestedDeliveryDate: dateInput(row.requestedDeliveryDate),
    remark: String(row.remark || ""),
    items: items.length ? items : [emptySalesLine()],
  };
}

export function executionCustomerOption(row?: SalesExecutionRow | null): CustomerAutocompleteOption | null {
  if (!row?.customerId && !row?.customer?.id) return null;
  return {
    id: String(row.customerId || row.customer?.id || ""),
    name: row.customer?.name || row.customerName || row.customerNameSnapshot || undefined,
    fullName: row.customer?.fullName,
    shortName: row.customer?.shortName || row.customerShortName || undefined,
    displayName: row.customer?.displayName,
    defaultCurrency: row.currency || undefined,
    defaultPaymentTermType: row.paymentTerm || undefined,
    defaultTradeTerm: row.tradeTerm || undefined,
  };
}

export function comparableDraft(draft: SalesExecutionDraft) {
  return {
    ...draft,
    items: draft.items.map(({ key: _key, allocations, ...item }) => ({
      ...item,
      allocations: allocations.map(({ key: _allocationKey, ...allocation }) => allocation),
    })),
  };
}

export function comparableSalesData(draft: SalesExecutionDraft) {
  return {
    ...draft,
    items: draft.items.map(({ key: _key, allocations: _allocations, ...item }) => item),
  };
}

export function lineAllocatedQuantity(line: SalesLineDraft) {
  return line.allocations.reduce((sum, allocation) => sum + numeric(allocation.allocatedQuantity), 0);
}

export function linePendingQuantity(line: SalesLineDraft) {
  return numeric(line.quantity) - lineAllocatedQuantity(line);
}

export function allocationIsExact(line: SalesLineDraft) {
  return Math.abs(linePendingQuantity(line)) < 0.000001;
}

export function singleSupplierIdFromItems(items: SalesLineDraft[]) {
  if (!items.length || items.some((line) => line.allocations.length !== 1 || !line.allocations[0]?.supplierId)) return "";
  const supplierId = items[0]?.allocations[0]?.supplierId || "";
  return items.every((line) => line.allocations[0]?.supplierId === supplierId) ? supplierId : "";
}

export function applyDefaultSupplier(items: SalesLineDraft[], supplierId: string) {
  if (!supplierId) return items;
  return items.map((line) => {
    if (line.allocations.length !== 1 || line.allocations[0]?.supplierId) return line;
    return {
      ...line,
      allocations: [{ ...line.allocations[0], supplierId, allocatedQuantity: line.quantity }],
    };
  });
}

function nullableDecimalInput(value: string) {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

export function validateSalesExecutionDraft(draft: SalesExecutionDraft) {
  if (!draft.customerId) return "请选择已有客户";
  if (!draft.businessEntityId) return "请选择业务主体";
  if (!draft.currency) return "请选择销售币种";
  if (!draft.customerOrderNo.trim()) return "请填写客户订单号";
  if (!draft.requestedDeliveryDate) return "请选择客户要求交货日期";
  if (!draft.items.length) return "请至少添加一条销售明细";
  for (let index = 0; index < draft.items.length; index += 1) {
    const line = draft.items[index];
    if (!salesItemDescription(line).trim()) return `第 ${index + 1} 行请填写产品描述`;
    if (!line.unit.trim()) return `第 ${index + 1} 行请填写单位`;
    if (numeric(line.quantity) <= 0) return `第 ${index + 1} 行销售数量必须大于 0`;
    if (line.salesUnitPrice.trim() === "" || numeric(line.salesUnitPrice) < 0) return `第 ${index + 1} 行请填写有效销售单价`;
    if (line.unitNetWeightKg.trim() !== "" && numeric(line.unitNetWeightKg) <= 0) return `第 ${index + 1} 行单件/单套净重必须大于 0`;
    if (!line.allocations.length) return `第 ${index + 1} 行至少需要一条工厂分配`;
    const allocationGroups = new Set<string>();
    for (let allocationIndex = 0; allocationIndex < line.allocations.length; allocationIndex += 1) {
      const allocation = line.allocations[allocationIndex];
      if (!allocation.supplierId) return `第 ${index + 1} 行第 ${allocationIndex + 1} 条分配请选择工厂`;
      if (numeric(allocation.allocatedQuantity) <= 0) return `第 ${index + 1} 行第 ${allocationIndex + 1} 条分配数量必须大于 0`;
      if (!allocation.purchaseCurrency) return `第 ${index + 1} 行第 ${allocationIndex + 1} 条分配请选择采购币种`;
      if (allocation.purchaseUnitPrice.trim() !== "" && numeric(allocation.purchaseUnitPrice) < 0) return `第 ${index + 1} 行第 ${allocationIndex + 1} 条分配采购单价不能为负数`;
      const groupKey = `${allocation.supplierId}\u0000${allocation.purchaseCurrency.toUpperCase()}`;
      if (allocationGroups.has(groupKey)) return `第 ${index + 1} 行同一工厂和采购币种只能填写一条分配`;
      allocationGroups.add(groupKey);
    }
    const pending = linePendingQuantity(line);
    if (Math.abs(pending) >= 0.000001) {
      return pending > 0
        ? `第 ${index + 1} 行还有 ${pending.toLocaleString("zh-CN")} 未分配`
        : `第 ${index + 1} 行工厂分配超出 ${Math.abs(pending).toLocaleString("zh-CN")}`;
    }
  }
  return "";
}

export function directExecutionPayload(draft: SalesExecutionDraft) {
  return {
    sourceType: "DIRECT",
    customerId: draft.customerId,
    businessEntityId: draft.businessEntityId,
    currency: draft.currency.trim().toUpperCase(),
    tradeTerm: draft.tradeTerm.trim(),
    paymentTerm: draft.paymentTerm.trim(),
    customerOrderNo: draft.customerOrderNo.trim(),
    requestedDeliveryDate: draft.requestedDeliveryDate,
    remark: draft.remark.trim(),
    items: draft.items.map((item) => ({
      customerProductId: item.customerProductId || undefined,
      name: item.name.trim(),
      specification: item.specification.trim(),
      unit: item.unit.trim(),
      quantity: item.quantity.trim(),
      salesUnitPrice: item.salesUnitPrice.trim(),
      unitNetWeightKg: nullableDecimalInput(item.unitNetWeightKg),
      remark: item.remark.trim(),
    })),
  };
}

export function allocationPayload(saved: SalesExecutionRow, draft: SalesExecutionDraft) {
  const savedItems = [...(saved.items || [])].sort((left, right) => numeric(left.lineNumber) - numeric(right.lineNumber));
  const allocations = draft.items.flatMap((line, index) => {
    const executionItemId = savedItems[index]?.id || line.id || "";
    return line.allocations.map((allocation) => ({
      executionItemId,
      supplierId: allocation.supplierId,
      purchaseCurrency: allocation.purchaseCurrency.trim().toUpperCase(),
      purchaseUnitPrice: nullableDecimalInput(allocation.purchaseUnitPrice),
      allocatedQuantity: allocation.allocatedQuantity.trim(),
      remark: allocation.remark.trim(),
    }));
  });
  return { expectedRevision: Number(saved.revision || 1), allocations };
}

export function allocationPayloadByLine(draft: SalesExecutionDraft) {
  return draft.items.flatMap((line, index) => line.allocations.map((allocation) => ({
    executionLineNumber: index + 1,
    supplierId: allocation.supplierId,
    purchaseCurrency: allocation.purchaseCurrency.trim().toUpperCase(),
    purchaseUnitPrice: nullableDecimalInput(allocation.purchaseUnitPrice),
    allocatedQuantity: allocation.allocatedQuantity.trim(),
    remark: allocation.remark.trim(),
  })));
}

export function itemWeightsPayload(draft: SalesExecutionDraft) {
  return draft.items.map((item) => ({
    executionItemId: item.id || "",
    unitNetWeightKg: nullableDecimalInput(item.unitNetWeightKg),
  }));
}

export function duplicateSalesLine(lines: SalesLineDraft[], key: string) {
  const index = lines.findIndex((line) => line.key === key);
  if (index < 0) return lines;
  const source = lines[index];
  const duplicate: SalesLineDraft = {
    ...source,
    key: draftKey("sales-line-copy"),
    id: undefined,
    allocations: source.allocations.map((allocation) => ({ ...allocation, key: draftKey("allocation-copy"), id: undefined, executionItemId: "" })),
  };
  return [...lines.slice(0, index + 1), duplicate, ...lines.slice(index + 1)];
}
