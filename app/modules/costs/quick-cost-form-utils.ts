import { isProductSupplierPaymentFormLocked } from "./helpers";
import type { CostItemForm, SupplierOption } from "./model";

export function validateQuickCostItems(
  items: CostItemForm[],
  suppliers: SupplierOption[],
  canManageFactoryPayments: boolean,
) {
  for (const [index, item] of items.entries()) {
    if (!item.supplierId) return `第 ${index + 1} 条成本请选择供应商`;
    if (!item.amount || Number(item.amount) <= 0) return `第 ${index + 1} 条成本请填写供应商成本金额`;
    if (!Number(item.exchangeRate)) return `第 ${index + 1} 条成本请填写汇率；CNY 成本汇率应自动为 1`;
    const supplier = suppliers.find((option) => option.id === item.supplierId) || null;
    const paymentEditable = isProductSupplierPaymentFormLocked(
      item,
      supplier,
      canManageFactoryPayments,
    );
    if (!paymentEditable && item.paymentStatus === "已支付" && !item.paymentDate) {
      return `第 ${index + 1} 条成本已支付时必须填写付款日期`;
    }
  }
  return "";
}

export function quickCostPayloadItems(items: CostItemForm[]) {
  return items.map((item) => ({
    supplierId: item.supplierId,
    costType: item.costType,
    amount: Number(item.amount),
    currency: item.currency,
    exchangeRate: Number(item.exchangeRate),
    exchangeRateDate: item.exchangeRateDate || undefined,
    exchangeRateSource: item.exchangeRateSource || undefined,
    exchangeRateType: item.exchangeRateType || undefined,
    paymentStatus: item.paymentStatus,
    paymentDate: item.paymentDate || undefined,
    costConfirmed: item.costConfirmed === "true",
    remark: item.remark.trim(),
  }));
}
