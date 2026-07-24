import { codedError, nonEmpty, optional } from "./shared";
import { logisticsExpenseOrderSummary } from "./logistics-expense-access-serialization";
import {
  DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD,
  LOGISTICS_EXPENSE_BILLING_METHODS,
  type LogisticsExpenseLike,
  type LogisticsOrderLike,
  type UnknownRecord,
  normalizeBillingMethodValue,
} from "./logistics-expense-access-model";

export function integerBillingMethod(method: unknown) {
  return ["按柜", "按票", "按次"].includes(normalizeBillingMethodValue(method));
}

export function normalizeLogisticsExpenseBillingMethod(input: UnknownRecord = {}, before: LogisticsExpenseLike | null = null): string {
  const hasBillingMethodInput = Object.prototype.hasOwnProperty.call(input, "billingMethod")
    || Object.prototype.hasOwnProperty.call(input, "billing_method");
  if (!hasBillingMethodInput && before) return normalizeBillingMethodValue(before.billingMethod);
  const requested = nonEmpty(input.billingMethod ?? input.billing_method ?? DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  if (!LOGISTICS_EXPENSE_BILLING_METHODS.includes(requested)) {
    throw codedError("请选择有效计费方式。", 400, "LOGISTICS_BILLING_METHOD_INVALID");
  }
  return requested;
}

export function normalizeLogisticsExpenseBillingQuantity(input: UnknownRecord = {}, billingMethod = DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD, before: LogisticsExpenseLike | null = null): number {
  const hasQuantityInput = Object.prototype.hasOwnProperty.call(input, "billingQuantity")
    || Object.prototype.hasOwnProperty.call(input, "billing_quantity")
    || Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
    || Object.prototype.hasOwnProperty.call(input, "containerCount")
    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasQuantityInput && before) return Number(before.billingQuantity ?? before.appliedContainerCount ?? 1);
  const raw = input.billingQuantity ?? input.billing_quantity ?? input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return 1;
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw codedError("适用数量/范围必须大于 0。", 400, "LOGISTICS_BILLING_QUANTITY_INVALID");
  }
  if (integerBillingMethod(billingMethod) && !Number.isInteger(quantity)) {
    throw codedError("按柜、按票、按次的适用数量/范围必须为正整数。", 400, "LOGISTICS_BILLING_QUANTITY_INTEGER_REQUIRED");
  }
  return quantity;
}

export function normalizeLogisticsExpenseContainerType(input: UnknownRecord = {}, order: LogisticsOrderLike = {}, before: LogisticsExpenseLike | null = null): string | null {
  const hasContainerTypeInput = Object.prototype.hasOwnProperty.call(input, "containerType")
    || Object.prototype.hasOwnProperty.call(input, "container_type");
  if (!hasContainerTypeInput && before) return before.containerType || null;
  const requested = optional(input.containerType ?? input.container_type);
  if (!requested) return null;
  const summary = logisticsExpenseOrderSummary(order);
  const allowedTypes = summary.containerTypes || [];
  if (allowedTypes.length && !allowedTypes.includes(requested)) {
    throw codedError("请选择有效集装箱柜型。", 400, "LOGISTICS_CONTAINER_TYPE_INVALID");
  }
  return requested;
}

export function normalizeAppliedContainerCount(input: UnknownRecord = {}, order: LogisticsOrderLike = {}, before: LogisticsExpenseLike | null = null, billingQuantity = 1): number {
  const hasContainerCountInput = Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
	    || Object.prototype.hasOwnProperty.call(input, "containerCount")
	    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasContainerCountInput && before) return Number(before.appliedContainerCount ?? 1);
  const raw = input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return Math.max(1, Math.ceil(Number(billingQuantity || 1)));
  const count = Number(text);
  if (!Number.isFinite(count) || count <= 0) {
	    throw codedError("适用数量必须为正整数。", 400, "LOGISTICS_CONTAINER_COUNT_INVALID");
  }
  return Math.max(1, Math.ceil(count));
}
