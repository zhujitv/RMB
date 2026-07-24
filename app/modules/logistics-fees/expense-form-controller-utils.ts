import {
  DEFAULT_BILLING_METHOD,
  emptyExpenseForm,
  emptyExpenseItem,
  type ExpenseForm,
  type ExpenseItemForm,
  type SupplierOption,
} from "./model";
import { lineSubtotal, validBillingQuantity } from "./shared";

export function createInitialExpenseForm({
  initialOrderId,
  initialSuppliers,
  isLockedSupplier,
  currentUserSupplierId,
}: {
  initialOrderId: string;
  initialSuppliers: SupplierOption[];
  isLockedSupplier: boolean;
  currentUserSupplierId: string;
}): ExpenseForm {
  return {
    ...emptyExpenseForm,
    orderId: initialOrderId,
    supplierId: isLockedSupplier
      ? currentUserSupplierId
      : initialSuppliers.length === 1
        ? initialSuppliers[0].id
        : "",
    items: [emptyExpenseItem()],
  };
}

export function normalizeExpenseSubmission(source: ExpenseItemForm[]) {
  const items = source.map((item) => ({
    costType: item.costType,
    billingMethod: DEFAULT_BILLING_METHOD,
    amount: lineSubtotal(item),
    billingQuantity: Number(item.appliedContainerCount || 1),
    appliedContainerCount: Number(item.appliedContainerCount || 1),
    currency: item.currency,
    exchangeRate: Number(item.exchangeRate),
    remark: item.remark.trim(),
  }));
  const invalidIndex = items.findIndex((item) => (
    !item.costType
    || !item.amount
    || item.amount <= 0
    || !item.currency
    || !item.exchangeRate
    || item.exchangeRate <= 0
    || !validBillingQuantity(item.appliedContainerCount)
    || item.appliedContainerCount <= 0
  ));
  return { items, invalidIndex };
}
