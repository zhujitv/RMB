
import { customerDisplayName } from "../../utils";
import {
  COST_TYPES,
  LOGISTICS_FEE_SUPPLIER_TYPES,
  type ExpenseItemForm,
  type ExpenseOrderOption,
  type LogisticsExpense,
  type LogisticsExpenseContainerSummary,
  type SupplierOption,
} from "./model";

export function normalizeExpenseOrder(
  order: Partial<ExpenseOrderOption>,
): ExpenseOrderOption {
  const id = order.orderId || order.id || "";
  const transportItems = Array.isArray(order.transportItems)
    ? order.transportItems
    : [];
  const containerNos = Array.isArray(order.containerNos)
    ? order.containerNos.filter(Boolean)
    : transportItems.map((item) => item.containerNo || "").filter(Boolean);
  const containerTypes = uniqueContainerTypes([
    order.containerType,
    ...(order.containerTypes || []),
    ...transportItems.map((item) => item.containerType),
  ]);
  return {
    ...order,
    id,
    orderId: id,
    transportItems,
    containerNos,
    containerTypes,
    containerType:
      order.containerType ||
      (containerTypes.length === 1 ? containerTypes[0] : ""),
    containerCount: Number(
      order.containerCount || containerNos.length || transportItems.length || 0,
    ),
    logisticsSuppliers: filterLogisticsFeeSuppliers(
      order.logisticsSuppliers || [],
    ),
  };
}

export function mergeOrders(
  current: ExpenseOrderOption[],
  next: ExpenseOrderOption[],
) {
  const merged = [...current];
  for (const order of next.map((item) => normalizeExpenseOrder(item))) {
    if (order.id && !merged.some((item) => item.id === order.id))
      merged.push(order);
  }
  return merged;
}

export function mergeSuppliers(
  current: SupplierOption[],
  next: SupplierOption[],
) {
  const merged = filterLogisticsFeeSuppliers(current);
  for (const supplier of filterLogisticsFeeSuppliers(next)) {
    if (supplier.id && !merged.some((item) => item.id === supplier.id))
      merged.push(supplier);
  }
  return merged;
}

export function orderLabel(order: ExpenseOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}

export function supplierLabel(supplier: SupplierOption) {
  const name = supplier.supplierName || supplier.name || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}

export function filterLogisticsFeeSuppliers(suppliers: SupplierOption[]) {
  return suppliers.filter((supplier) =>
    LOGISTICS_FEE_SUPPLIER_TYPES.includes(supplier.supplierType || ""),
  );
}

export function allowedCostTypeOptions(
  supplier: SupplierOption | null,
  shouldRestrict: boolean,
) {
  if (!shouldRestrict) return COST_TYPES;
  const allowed =
    supplier?.allowedLogisticsCostTypes?.filter((type) =>
      COST_TYPES.includes(type),
    ) || [];
  const baseTypes = allowed.length ? allowed : COST_TYPES;
  return [...baseTypes, "港杂费"].filter((type, index, rows) =>
    COST_TYPES.includes(type) && rows.indexOf(type) === index,
  );
}

export function normalizeExpenseItemCostType(
  item: ExpenseItemForm,
  options: string[],
) {
  if (!options.length || options.includes(item.costType)) return item;
  return { ...item, costType: options[0] || item.costType };
}

export function validBillingQuantity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  return Number.isInteger(numeric);
}

export function billingQuantityLegacyInteger(value: unknown) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.max(1, Math.ceil(numeric));
}

export function normalizeContainerType(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function uniqueContainerTypes(values: unknown[]) {
  return values
    .map(normalizeContainerType)
    .filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );
}

export function uniqueTextValues(values: unknown[]) {
  return values
    .map((value) => String(value || "").trim())
    .filter(
      (value, index, arr) => Boolean(value) && arr.indexOf(value) === index,
    );
}

export function logisticsExpenseContainerSummary(
  expense: Partial<LogisticsExpense>,
  items: LogisticsExpense[] = [],
): LogisticsExpenseContainerSummary {
  const rows = [expense, ...(items.length ? items : [])];
  const seenTransportItems = new Set<string>();
  const transportItems: Array<{ containerNo: string; containerType: string }> =
    [];
  const fallbackNos: string[] = [];
  const fallbackTypes: unknown[] = [];
  let fallbackCount = 0;

  for (const row of rows) {
    const order = row.order || {};
    const orderTransportItems = Array.isArray(order.transportItems)
      ? order.transportItems
      : [];
    fallbackNos.push(...(order.containerNos || []));
    fallbackTypes.push(order.containerType, ...(order.containerTypes || []));
    fallbackCount = Math.max(fallbackCount, Number(order.containerCount || 0));
    for (const item of orderTransportItems) {
      const containerNo = String(item.containerNo || "").trim();
      const containerType = normalizeContainerType(item.containerType);
      const key =
        item.id ||
        `${containerNo}|${containerType}|${String(item.sealNo || "").trim()}`;
      if ((!containerNo && !containerType) || seenTransportItems.has(key))
        continue;
      seenTransportItems.add(key);
      transportItems.push({ containerNo, containerType });
    }
  }

  const typeCounts = new Map<string, number>();
  if (transportItems.length) {
    for (const item of transportItems) {
      if (!item.containerType) continue;
      typeCounts.set(
        item.containerType,
        (typeCounts.get(item.containerType) || 0) + 1,
      );
    }
  } else {
    const types = uniqueContainerTypes(fallbackTypes);
    const nos = uniqueTextValues(fallbackNos);
    if (types.length === 1) {
      typeCounts.set(types[0], nos.length || fallbackCount || 1);
    } else {
      for (const type of types) typeCounts.set(type, 0);
    }
  }

  const typeLines = [...typeCounts.entries()].map(([type, count]) =>
    count > 0 ? `${type} × ${count}` : type,
  );
  const containerNoLines = transportItems.length
    ? uniqueTextValues(transportItems.map((item) => item.containerNo))
    : uniqueTextValues(fallbackNos);
  const hasContainers = Boolean(typeLines.length || containerNoLines.length);
  return {
    hasContainers,
    typeLines,
    containerNoLines,
    shortText:
      hasContainers && typeLines.length
        ? typeLines.map((line) => line.replace(/\s×\s/g, "×")).join(" / ")
        : "未录入",
  };
}

export function containerSummaryText(order?: ExpenseOrderOption | null) {
  const count = Number(order?.containerCount || 0);
  if (!count) return "未录入集装箱明细";
  const nos = order?.containerNos?.length
    ? `：${order.containerNos.join(" / ")}`
    : "";
  return `${count} 个柜${nos}`;
}

export function logisticsExpenseLineContainerType(expense: LogisticsExpense) {
  const types = uniqueContainerTypes([
    expense.containerType,
    expense.order?.containerType,
    ...(expense.order?.containerTypes || []),
    ...(expense.order?.transportItems || []).map((item) => item.containerType),
  ]);
  if (!types.length) return "-";
  return types.length === 1 ? types[0] : types.join(" / ");
}
