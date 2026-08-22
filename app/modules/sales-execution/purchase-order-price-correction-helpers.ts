import { formatCurrencyAmount } from "../../formatters";
import {
  numeric,
  type FactoryPurchaseOrder,
  type FactoryPurchaseOrderPriceCorrection,
  type PurchaseOrderItem,
} from "./types";

export const BIG_ZERO = BigInt(0);
const BIG_TWO = BigInt(2);
const BIG_TEN = BigInt(10);
const BIG_HUNDRED = BigInt(100);

type CorrectionGroup = {
  key: string;
  batchId: string | null;
  corrections: FactoryPurchaseOrderPriceCorrection[];
};

export function itemName(item: PurchaseOrderItem, index?: number) {
  return String(item.productDescription || item.productNameSnapshot || (index === undefined ? "产品行" : `第 ${index + 1} 行`)).trim();
}

function decimalInputValue(value: unknown) {
  const result = String(value ?? "").trim();
  return /^(?:0|[1-9]\d{0,17})(?:\.\d+)?$/.test(result) ? result : "";
}

export function itemCurrentPrice(item: PurchaseOrderItem) {
  return decimalInputValue(item.effectivePurchaseUnitPrice ?? item.purchaseUnitPrice);
}

export function itemCorrectionQuantity(item: PurchaseOrderItem) {
  return decimalInputValue(item.actualDeliveredQuantity ?? item.allocatedQuantity ?? item.quantity);
}

export function productName(order: FactoryPurchaseOrder, itemId: string) {
  const item = (order.items || []).find((candidate) => candidate.id === itemId);
  return itemName(item || {});
}

export function formatPrice(value: unknown) {
  const parsed = numeric(value);
  return Number.isFinite(parsed) ? parsed.toFixed(3) : "-";
}

export function formatQuantity(value: unknown) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(numeric(value));
}

function decimalParts(value: unknown) {
  const normalized = decimalInputValue(value);
  if (!normalized) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function roundedProductCents(quantity: unknown, unitPrice: unknown) {
  const quantityParts = decimalParts(quantity);
  const priceParts = decimalParts(unitPrice);
  if (!quantityParts || !priceParts) return null;
  const coefficient = quantityParts.coefficient * priceParts.coefficient;
  const divisor = BIG_TEN ** BigInt(quantityParts.scale + priceParts.scale);
  return (coefficient * BIG_HUNDRED + divisor / BIG_TWO) / divisor;
}

export function priceCorrectionDeltaCents(quantity: unknown, oldPrice: unknown, newPrice: unknown) {
  const oldAmount = roundedProductCents(quantity, oldPrice);
  const newAmount = roundedProductCents(quantity, newPrice);
  return oldAmount === null || newAmount === null ? null : newAmount - oldAmount;
}

export function centsText(value: bigint) {
  const absolute = value < BIG_ZERO ? -value : value;
  const whole = absolute / BIG_HUNDRED;
  const fraction = String(absolute % BIG_HUNDRED).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function formatDeltaCents(currency: string, value: bigint) {
  const prefix = value > BIG_ZERO ? "+" : value < BIG_ZERO ? "-" : "";
  return `${prefix}${formatCurrencyAmount(currency, centsText(value))}`;
}

export function formatRecordedDelta(currency: string, value: unknown) {
  const parsed = numeric(value);
  const prefix = parsed > 0 ? "+" : parsed < 0 ? "-" : "";
  return `${prefix}${formatCurrencyAmount(currency, Math.abs(parsed))}`;
}

function statusText(status?: string | null) {
  if (status === "APPROVED") return "已通过";
  if (status === "REJECTED") return "已驳回";
  return "待管理员审核";
}

export function settlementStatusText(status?: string | null) {
  if (status === "PENDING_PAYMENT") return "待补付";
  if (status === "PENDING_REFUND") return "待供应商退款";
  if (status === "SETTLED") return "已结清";
  return status || "-";
}

export function requestKey(ref: { current: { fingerprint: string; key: string } | null }, fingerprint: string) {
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: `factory-price-correction-${Date.now()}-${crypto.randomUUID()}` };
  }
  return ref.current.key;
}

export function unavailableReason(order: FactoryPurchaseOrder, canRequest: boolean, itemCount: number) {
  if (!canRequest) return "没有采购价格更正权限";
  if (!itemCount) return "该采购单没有产品行，不能申请采购价格更正";
  if (order.status !== "ACCEPTED") return "工厂采购单确认接受后，才可以申请采购价格更正";
  return "";
}

export function correctionSettlementNotice(order: FactoryPurchaseOrder, activePaymentCount: number) {
  if (order.settlement) {
    return "该采购单已有最终应付确认。整批审核通过后系统会保留原结算，生成一版结算更正凭证，并按更正后的应付金额计算补付或供应商退款。";
  }
  if (activePaymentCount > 0) {
    return "该采购单已有付款记录。审核通过后系统会保留原付款流水，并为本批次生成可审计的价格差额凭证。";
  }
  return "";
}

export function groupCorrections(corrections: FactoryPurchaseOrderPriceCorrection[]) {
  const grouped = new Map<string, CorrectionGroup>();
  corrections.forEach((correction) => {
    const batchId = correction.batchId || null;
    const key = batchId ? `batch:${batchId}` : `single:${correction.id}`;
    const group = grouped.get(key) || { key, batchId, corrections: [] };
    group.corrections.push(correction);
    grouped.set(key, group);
  });
  return [...grouped.values()].map((group) => ({
    ...group,
    corrections: [...group.corrections].sort((left, right) => (
      numeric(left.batchLineNo ?? left.sequenceNo) - numeric(right.batchLineNo ?? right.sequenceNo)
    )),
  }));
}

export function correctionCanReview(correction: FactoryPurchaseOrderPriceCorrection, canReview: boolean) {
  return correction.status === "PENDING" && canReview;
}

export function groupStatus(group: CorrectionGroup) {
  const statuses = new Set(group.corrections.map((correction) => correction.status || "PENDING"));
  return statuses.size === 1 ? statusText(group.corrections[0]?.status) : "批次状态异常";
}

export function groupSettlementSnapshot(group: CorrectionGroup) {
  return group.corrections.find((correction) => (
    correction.settlementFinalPayableAfter !== null && correction.settlementFinalPayableAfter !== undefined
  ));
}
