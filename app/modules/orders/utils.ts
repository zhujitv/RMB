
import type { OrderRow, PaymentInstallment, QuickOrderForm, SupplierOption } from "./model";
import { PAYMENT_TERMS, emptyQuickOrderForm } from "./model";

export function orderFormFromRow(order?: OrderRow | null): QuickOrderForm {
  if (!order) return { ...emptyQuickOrderForm };
  const paymentTermType = order.paymentTermType
    || PAYMENT_TERMS.find((term) => term.label === order.paymentTerm)?.value
    || "CUSTOM";
  return {
    expectedUpdatedAt: order.updatedAt || "",
    customerId: order.customerId || "",
    orderNo: order.orderNo || "",
    blNo: order.blNo || order.billOfLadingNo || "",
    currency: order.currency || "",
    exchangeRate: order.exchangeRate == null ? "" : String(order.exchangeRate),
    exchangeRateDate: order.exchangeRateDate || "",
    exchangeRateSource: order.exchangeRateSource || "",
    exchangeRateType: order.exchangeRateType || "",
    estimatedReceivableAmount: order.estimatedReceivableAmount == null ? "" : String(order.estimatedReceivableAmount),
    finalReceivableAmount: order.finalReceivableAmount == null ? "" : String(order.finalReceivableAmount),
    actualShipmentAmount: order.actualShipmentAmount == null || order.actualShipmentAmount === "" ? "" : String(order.actualShipmentAmount),
    actualShipmentDate: order.actualShipmentDate || "",
    tradeTerm: order.tradeTerm || "FOB",
    paymentTermType,
    paymentTerm: order.paymentTerm || "",
    blDate: order.blDate || "",
    expectedArrivalDate: order.expectedArrivalDate || "",
    expectedPaymentDate: order.expectedPaymentDate || "",
    dueDate: order.dueDate || "",
    creditDays: order.creditDays == null || order.creditDays === "" ? "30" : String(order.creditDays),
    reminderDays: order.reminderDays == null || order.reminderDays === "" ? "7" : String(order.reminderDays),
    status: order.status || "草稿",
    businessEntityId: order.businessEntityId || order.businessEntity?.id || "",
    salespersonUserId: order.salespersonUserId || order.salespersonId || "",
    logisticsSupplierIds: order.logisticsSupplierIds || [],
    paymentInstallments: order.paymentInstallments?.length
      ? order.paymentInstallments.map((row) => ({ ratio: String(row.ratio || ""), condition: row.condition || "" }))
      : [{ ratio: "100", condition: "按约定付款" }],
    remark: order.remark || "",
  };
}

export function derivedDueDate(form: QuickOrderForm) {
  if (form.paymentTermType === "COPY_BL") return form.blDate || form.actualShipmentDate || "";
  if (form.paymentTermType === "AFTER_ARRIVAL") return addDaysText(form.expectedArrivalDate, Number(form.creditDays || 0));
  if (form.paymentTermType === "OA") return addDaysText(new Date().toISOString().slice(0, 10), Number(form.creditDays || 0));
  return form.dueDate;
}

export function addDaysText(dateText: string, days: number) {
  if (!dateText || !Number.isFinite(days)) return "";
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Math.round(days));
  return date.toISOString().slice(0, 10);
}

export function installmentTotal(rows: PaymentInstallment[]) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.ratio || 0), 0) * 100) / 100;
}

export function supplierName(supplier?: SupplierOption) {
  return supplier?.supplierName || supplier?.name || "-";
}

export function logisticsSupplierText(suppliers: SupplierOption[] = []) {
  return suppliers.length ? suppliers.map((supplier) => `${supplierName(supplier)}${supplier.supplierType ? `（${supplier.supplierType}）` : ""}`).join("；") : "-";
}

export function paymentTermText(order: OrderRow) {
  const base = order.paymentTermDisplay || order.paymentTerm || "-";
  return order.paymentInstallmentText ? `${base}：${order.paymentInstallmentText}` : base;
}

export function rateMeta(order: OrderRow) {
  const source = order.exchangeRateSource || "待获取";
  const type = order.exchangeRateType || "-";
  return `来源：${source} / 类型：${type}${order.exchangeRateDate ? ` / 日期：${order.exchangeRateDate}` : ""}`;
}

export function orderCurrencyAmount(order: OrderRow, cnyAmount: unknown) {
  const currency = String(order.currency || "CNY").toUpperCase();
  const exchangeRate = Number(order.exchangeRate || 0);
  const cny = Number(cnyAmount || 0);
  if (currency === "CNY" || !(exchangeRate > 0)) return undefined;
  return cny / exchangeRate;
}
