import { productionQuantityUnits } from "./production-progress-quantity";

const QUANTITY_SCALE = BigInt(10_000);

export type ContainerLoadStatus = "DRAFT" | "OPEN" | "RELEASED" | "VOIDED";
export type ContainerLoadingResultStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ContainerLoadingReason = "EXACT" | "WEIGHT_LIMIT" | "VOLUME_LIMIT" | "OTHER";

export type ContainerLoadAllocation = {
  id: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  plannedQuantity: string;
};

export type ContainerLoadingResultItem = {
  purchaseOrderItemId: string;
  plannedQuantity: string;
  deliveryTargetQuantity: string;
  completedQuantity: string;
  previouslyApprovedLoadedQuantity: string;
  loadedQuantity: string;
  cumulativeApprovedLoadedQuantity: string;
  warehouseRetainedQuantity: string;
};

export type ContainerLoadingResult = {
  id: string;
  containerLoadId: string;
  purchaseOrderId: string;
  sequenceNo: number;
  status: ContainerLoadingResultStatus | string;
  reason: ContainerLoadingReason | string;
  reasonDetail: string;
  source: string;
  channel: string;
  supplierContact: string;
  loadingDate: string | null;
  requestedAt: string | null;
  requestedBy?: { id?: string; name?: string | null } | null;
  decidedAt: string | null;
  decidedBy?: { id?: string; name?: string | null } | null;
  decisionRemark?: string;
  legacyBackfill: boolean;
  items: ContainerLoadingResultItem[];
};

export type ContainerLoad = {
  id: string;
  executionId?: string;
  sequenceNo: number;
  status: ContainerLoadStatus | string;
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  loadingDate: string | null;
  revision: number;
  releasedAt?: string | null;
  releasedBy?: { id?: string; name?: string | null } | null;
  releaseRemark?: string;
  voidedAt?: string | null;
  voidedBy?: { id?: string; name?: string | null } | null;
  voidReason?: string;
  allocations: ContainerLoadAllocation[];
  loadingResults: ContainerLoadingResult[];
};

function unitsText(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = (absolute % QUANTITY_SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function containerQuantityText(value: unknown) {
  const units = productionQuantityUnits(value);
  return units === null ? "-" : unitsText(units);
}

export function containerQuantitySum(values: unknown[]) {
  let total = BigInt(0);
  for (const value of values) {
    const units = productionQuantityUnits(value);
    if (units === null) return null;
    total += units;
  }
  return unitsText(total);
}

export function containerQuantityTotalPositive(values: unknown[]) {
  const total = containerQuantitySum(values);
  return total !== null && (productionQuantityUnits(total) || BigInt(0)) > BigInt(0);
}

export function containerQuantityWithin(value: unknown, maximum: unknown, allowZero = false) {
  const units = productionQuantityUnits(value);
  const maximumUnits = productionQuantityUnits(maximum);
  return units !== null && maximumUnits !== null
    && (allowZero ? units >= BigInt(0) : units > BigInt(0))
    && units <= maximumUnits;
}

export function containerQuantityRemaining(target: unknown, values: unknown[]) {
  const targetUnits = productionQuantityUnits(target);
  if (targetUnits === null) return "-";
  let used = BigInt(0);
  for (const value of values) {
    const units = productionQuantityUnits(value);
    if (units === null) return "-";
    used += units;
  }
  return unitsText(targetUnits > used ? targetUnits - used : BigInt(0));
}

export function containerAllocationReservedQuantity(load: ContainerLoad, allocation: ContainerLoadAllocation) {
  if (load.status === "VOIDED") return "0";
  const approved = load.loadingResults
    .find((result) => result.status === "APPROVED" && result.purchaseOrderId === allocation.purchaseOrderId)
    ?.items.find((item) => item.purchaseOrderItemId === allocation.purchaseOrderItemId);
  return approved?.loadedQuantity || allocation.plannedQuantity;
}

export function containerQuantitiesEqual(left: unknown, right: unknown) {
  const leftUnits = productionQuantityUnits(left);
  const rightUnits = productionQuantityUnits(right);
  return leftUnits !== null && rightUnits !== null && leftUnits === rightUnits;
}

export function containerLoadStatusLabel(status: string) {
  const labels: Record<string, string> = { DRAFT: "草稿", OPEN: "开放填报", RELEASED: "已放行", VOIDED: "已作废" };
  return labels[status] || status || "-";
}

export function containerLoadingResultStatusLabel(status: string) {
  const labels: Record<string, string> = { PENDING: "待审批", APPROVED: "已确认", REJECTED: "已拒绝" };
  return labels[status] || status || "-";
}

export function containerLoadingReasonLabel(reason: string) {
  const labels: Record<string, string> = { EXACT: "按计划装柜", WEIGHT_LIMIT: "集装箱限重", VOLUME_LIMIT: "集装箱限容", OTHER: "其它原因" };
  return labels[reason] || reason || "-";
}
