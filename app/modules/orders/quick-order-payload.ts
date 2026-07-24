import type { QuickOrderForm } from "./model";

type QuickOrderPayloadOptions = {
  isEdit: boolean;
  expectedUpdatedAt?: string;
  canManageOrderAssignments: boolean;
  logisticsSupplierIds: string[];
};

export function quickOrderPayload(form: QuickOrderForm, options: QuickOrderPayloadOptions) {
  return {
    ...(options.isEdit ? { expectedUpdatedAt: form.expectedUpdatedAt || options.expectedUpdatedAt || undefined } : {}),
    customerId: form.customerId,
    orderNo: form.orderNo.trim(),
    blNo: form.blNo.trim(),
    currency: form.currency,
    exchangeRate: Number(form.exchangeRate),
    exchangeRateDate: form.exchangeRateDate || undefined,
    exchangeRateSource: form.exchangeRateSource || undefined,
    exchangeRateType: form.exchangeRateType || undefined,
    estimatedReceivableAmount: Number(form.estimatedReceivableAmount),
    finalReceivableAmount: form.finalReceivableAmount ? Number(form.finalReceivableAmount) : undefined,
    actualShipmentAmount: form.actualShipmentAmount ? Number(form.actualShipmentAmount) : undefined,
    actualShipmentDate: form.actualShipmentDate || undefined,
    tradeTerm: form.tradeTerm,
    paymentTermType: form.paymentTermType,
    blDate: form.blDate || undefined,
    expectedArrivalDate: form.expectedArrivalDate || undefined,
    expectedPaymentDate: form.expectedPaymentDate || undefined,
    dueDate: form.dueDate || undefined,
    creditDays: ["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType)
      ? Number(form.creditDays || 0)
      : undefined,
    paymentInstallments: form.paymentTermType === "INSTALLMENT"
      ? form.paymentInstallments.map((row) => ({ ratio: Number(row.ratio), condition: row.condition.trim() }))
      : undefined,
    reminderDays: Number(form.reminderDays || 7),
    status: form.status,
    businessEntityId: form.businessEntityId || undefined,
    ...(options.canManageOrderAssignments ? { salespersonUserId: form.salespersonUserId } : {}),
    logisticsSupplierIds: options.logisticsSupplierIds,
    remark: form.remark.trim(),
  };
}
