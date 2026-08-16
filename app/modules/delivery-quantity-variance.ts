import { productionQuantityUnits } from "./production-progress-quantity";

const QUANTITY_SCALE = BigInt(10_000);
const RATIO_SCALE = BigInt(1_000_000);

export type DeliveryQuantityVarianceStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DeliveryQuantityVarianceSource = "SUPPLIER_PORTAL" | "INTERNAL_OFFLINE";
export type DeliveryQuantityVarianceChannel = "PORTAL" | "WECHAT" | "PHONE" | "EMAIL" | "PAPER" | "OTHER";

export type DeliveryQuantityVarianceItem = {
  purchaseOrderItemId: string;
  orderedQuantity: string;
  proposedQuantity: string;
  differenceQuantity: string;
};

export type DeliveryQuantityVariance = {
  id: string;
  purchaseOrderId: string;
  sequenceNo: number;
  status: DeliveryQuantityVarianceStatus;
  source: DeliveryQuantityVarianceSource;
  channel: DeliveryQuantityVarianceChannel;
  supplierContact: string;
  supplierRequestedAt: string | null;
  requestedAt: string | null;
  requestedById?: string | null;
  requestedBy?: { id?: string; name?: string | null } | null;
  reason: string;
  decidedAt: string | null;
  decidedById?: string | null;
  decidedBy?: { id?: string; name?: string | null } | null;
  decisionRemark?: string;
  items: DeliveryQuantityVarianceItem[];
};

function formatScaled(value: bigint, scale: bigint, digits: number) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function ratioUnits(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|0\.\d{1,6})$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * RATIO_SCALE + BigInt(fraction.padEnd(6, "0"));
}

export function formatQuantity(value: unknown) {
  const units = productionQuantityUnits(value);
  return units === null ? "-" : formatScaled(units, QUANTITY_SCALE, 4);
}

export function formatSignedDifference(base: unknown, proposed: unknown) {
  const baseUnits = productionQuantityUnits(base);
  const proposedUnits = productionQuantityUnits(proposed);
  if (baseUnits === null || proposedUnits === null) return "-";
  const difference = proposedUnits - baseUnits;
  return `${difference > BigInt(0) ? "+" : ""}${formatScaled(difference, QUANTITY_SCALE, 4)}`;
}

export function formatDifferenceRate(base: unknown, proposed: unknown) {
  const baseUnits = productionQuantityUnits(base);
  const proposedUnits = productionQuantityUnits(proposed);
  if (!baseUnits || proposedUnits === null) return "-";
  const difference = proposedUnits - baseUnits;
  const roundedHundredths = (difference * BigInt(10_000) + (difference >= BigInt(0) ? baseUnits / BigInt(2) : -(baseUnits / BigInt(2)))) / baseUnits;
  return `${roundedHundredths > BigInt(0) ? "+" : ""}${formatScaled(roundedHundredths, BigInt(100), 2)}%`;
}

export function formatTolerancePercent(ratio: unknown) {
  const units = ratioUnits(ratio);
  return units === null ? "5" : formatScaled(units * BigInt(100), RATIO_SCALE, 6);
}

export function quantityToleranceRange(base: unknown, ratio: unknown) {
  const baseUnits = productionQuantityUnits(base);
  const toleranceUnits = ratioUnits(ratio);
  if (baseUnits === null || toleranceUnits === null) return null;
  const allowedDifference = baseUnits * toleranceUnits / RATIO_SCALE;
  return {
    minimum: formatScaled(baseUnits - allowedDifference, QUANTITY_SCALE, 4),
    maximum: formatScaled(baseUnits + allowedDifference, QUANTITY_SCALE, 4),
  };
}

export function quantityWithinTolerance(base: unknown, proposed: unknown, ratio: unknown) {
  const baseUnits = productionQuantityUnits(base);
  const proposedUnits = productionQuantityUnits(proposed);
  const toleranceUnits = ratioUnits(ratio);
  if (baseUnits === null || proposedUnits === null || toleranceUnits === null) return false;
  const difference = proposedUnits >= baseUnits ? proposedUnits - baseUnits : baseUnits - proposedUnits;
  return difference * RATIO_SCALE <= baseUnits * toleranceUnits;
}

export function quantitiesEqual(left: unknown, right: unknown) {
  const leftUnits = productionQuantityUnits(left);
  const rightUnits = productionQuantityUnits(right);
  return leftUnits !== null && rightUnits !== null && leftUnits === rightUnits;
}

export function varianceStatusLabel(status: string) {
  if (status === "APPROVED") return "已批准";
  if (status === "REJECTED") return "已拒绝";
  return "待审批";
}

export function varianceChannelLabel(channel: string) {
  const labels: Record<string, string> = { PORTAL: "供应商门户", WECHAT: "微信", PHONE: "电话", EMAIL: "邮件", PAPER: "纸质", OTHER: "其他" };
  return labels[channel] || channel || "-";
}
