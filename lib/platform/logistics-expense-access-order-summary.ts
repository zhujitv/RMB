import {
  customerBusinessName,
  customerShortName,
  dateFromInput,
  dateToInput,
  nonEmpty,
} from "./shared";
import { businessEntityFieldsFromOrder } from "./business-entities";
import {
  LogisticsBillLike,
  LogisticsExpenseLike,
  LogisticsOrderLike,
  asRecord,
} from "./logistics-expense-access-model";

export function logisticsExpenseBillOfLadingNo(order: LogisticsOrderLike = {}) {
  return nonEmpty(order.blNo || order.orderNo || "no-bl");
}

export function logisticsExpenseBillKey(orderId: unknown, billOfLadingNo: unknown, supplierId: unknown = "") {
  const id = nonEmpty(orderId);
  const blNo = nonEmpty(billOfLadingNo || "no-bl").toLowerCase();
  const supplier = nonEmpty(supplierId || "no-supplier");
  return id ? `${id}::${blNo}::${supplier}` : "";
}

export function logisticsExpenseLegacyBillKey(orderId: unknown, billOfLadingNo: unknown) {
  const id = nonEmpty(orderId);
  const blNo = nonEmpty(billOfLadingNo || "no-bl").toLowerCase();
  return id ? `${id}::${blNo}` : "";
}

export function logisticsExpenseBillKeyForOrder(order: LogisticsOrderLike = {}, supplierId: unknown = "") {
  return logisticsExpenseBillKey(order.id, logisticsExpenseBillOfLadingNo(order), supplierId);
}

export function logisticsExpenseBillRecord(expense: LogisticsExpenseLike = {}): LogisticsBillLike {
  return asRecord(expense.bill) as LogisticsBillLike;
}

export function logisticsExpenseBillField(expense: LogisticsExpenseLike = {}, field: keyof LogisticsBillLike, fallback: unknown = "") {
  const bill = logisticsExpenseBillRecord(expense);
  return bill[field] ?? fallback;
}

export function logisticsExpenseBillAuditStatusValue(expense: LogisticsExpenseLike = {}) {
  return nonEmpty(logisticsExpenseBillRecord(expense).auditStatus || "草稿");
}

export function logisticsExpenseBillInvoiceStatusValue(expense: LogisticsExpenseLike = {}) {
  return nonEmpty(logisticsExpenseBillRecord(expense).invoiceStatus || "待开票");
}

const LOGISTICS_PAYMENT_NOT_READY_INVOICE_STATUSES = new Set([
  "待开票",
  "未通知",
  "已通知开票",
  "通知失败",
  "待开票 / 通知失败",
  "部分未通知",
  "部分已通知",
  "部分待开票",
  "部分上传发票",
  "部分已确认",
  "部分已上传",
  "部分上传",
]);

export function normalizeLogisticsBillPaymentStatus(invoiceStatus: unknown, paymentStatus: unknown) {
  const invoice = nonEmpty(invoiceStatus || "待开票");
  const payment = nonEmpty(paymentStatus || "待开票");
  if (payment === "待付款" && LOGISTICS_PAYMENT_NOT_READY_INVOICE_STATUSES.has(invoice)) return "待开票";
  return payment;
}

export function logisticsExpenseBillPaymentStatusValue(expense: LogisticsExpenseLike = {}) {
  const bill = logisticsExpenseBillRecord(expense);
  return normalizeLogisticsBillPaymentStatus(bill.invoiceStatus, bill.paymentStatus);
}

export function logisticsExpenseDetailInvoiceStatusValue(expense: LogisticsExpenseLike = {}) {
  return nonEmpty(expense.detailInvoiceStatus || expense.invoiceStatus || "未通知");
}

export function resolveLogisticsExpenseVesselVoyage(order: LogisticsOrderLike = {}) {
  const info = (order.domesticLogisticsInfos || [])[0] || {};
  const firstItem = (info.transportItems || [])[0] || {};
  const shippingInfo = asRecord(info.shippingInfo || order.shippingInfo);
  const sailingSchedule = asRecord(info.sailingSchedule || order.sailingSchedule);
  const containerShipment = asRecord(info.containerShipment || order.containerShipment);
  return nonEmpty(
    order.vesselVoyage ||
    order.vessel_voyage ||
    info.vesselVoyage ||
    info.vessel_voyage ||
    firstItem.vesselVoyage ||
    firstItem.vessel_voyage ||
    shippingInfo.vesselVoyage ||
    shippingInfo.vessel_voyage ||
    sailingSchedule.vesselVoyage ||
    sailingSchedule.vessel_voyage ||
    containerShipment.vesselVoyage ||
    containerShipment.vessel_voyage
  );
}

export function logisticsExpenseOrderSummary(order: LogisticsOrderLike = {}) {
  const info = (order.domesticLogisticsInfos || [])[0] || {};
  const firstItem = (info.transportItems || [])[0] || {};
  const transportItems = (info.transportItems || []).map((item) => ({
    id: item.id || "",
    containerNo: item.containerNo || "",
    containerType: item.containerType || item.container_type || "",
    sealNo: item.sealNo || item.seal_no || "",
    truckPlateNo: item.truckPlateNo || "",
    departureDate: dateToInput(dateFromInput(item.departureDate)),
    departurePlace: item.departurePlace || "",
    arrivalPlace: item.arrivalPlace || "",
    cargoName: item.cargoName || "",
  }));
  const containerNos = transportItems.map((item) => item.containerNo).filter(Boolean);
  const containerTypes = [...new Set(transportItems.map((item) => item.containerType).filter(Boolean))];
  return {
    orderId: order.id || "",
    orderNo: order.orderNo || "",
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerShortName: customerShortName(order.customer),
    customerName: customerBusinessName(order.customer, nonEmpty(order.customerNameSnapshot)),
    ...businessEntityFieldsFromOrder(order),
    vesselVoyage: resolveLogisticsExpenseVesselVoyage(order),
    containerType: containerTypes.length === 1 ? containerTypes[0] : "",
    containerTypes,
    port: firstItem.arrivalPlace || info.destinationPlace || "",
    loadingAddress: firstItem.departurePlace || info.departurePlace || "",
    sailingDate: dateToInput(dateFromInput(firstItem.departureDate || info.departureDate || order.actualShipmentDate || order.blDate || order.expectedShipmentDate)),
    truckPlateNo: firstItem.truckPlateNo || info.truckPlateNo || "",
    cargoName: firstItem.cargoName || info.cargoDescription || "",
    transportItems,
    containerNos,
    containerCount: containerNos.length || transportItems.length || 0,
  };
}
