import { Prisma } from "../generated/prisma/client.js";
import { calculateFactoryDelayPenalty, factoryPrepaymentRequiredAmount } from "./factory-purchase-order-financials";
import { serializeSalesExecutionShipping } from "./sales-execution-shipping-serialization";
import { serializePurchaseOrderRelations, serializePurchaseOrderSettlement } from "./sales-execution-purchase-order-relations";
import { effectivePurchaseOrderSubtotal, serializePurchaseOrderItem } from "./sales-execution-purchase-order-item-serialization";
import { serializeFactoryConfirmationEvents } from "./sales-execution-confirmation-events";
import { serializeInternalContainerLoad, type InternalContainerLoadRow } from "./sales-execution-container-load-serialization";
type LooseRecord = Record<string, unknown>;
export function executionRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}
export function decimalText(value: unknown, fallback = "0") {
  if (value === null || value === undefined || value === "") return fallback;
  return Prisma.Decimal.isDecimal(value) ? value.toString() : String(value);
}
export function nullableDecimalText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return Prisma.Decimal.isDecimal(value) ? value.toString() : String(value);
}
function serializeExecutionItem(value: unknown) {
  const item = executionRecord(value);
  const name = String(item.productNameSnapshot || "");
  const specification = String(item.specificationSnapshot || "");
  const unit = String(item.unitSnapshot || "");
  const salesAmount = decimalText(item.salesAmount);
  return {
    id: String(item.id || ""),
    lineNumber: Number(item.lineNumber || 0),
    sourceQuotationItemId: item.sourceQuotationItemId ? String(item.sourceQuotationItemId) : null,
    customerProductId: item.customerProductId ? String(item.customerProductId) : null,
    productFingerprintSnapshot: String(item.productFingerprintSnapshot || ""),
    productNameSnapshot: name,
    name,
    productName: name,
    specificationSnapshot: specification,
    specification,
    unitSnapshot: unit,
    unit,
    currencySnapshot: String(item.currencySnapshot || ""),
    quantity: decimalText(item.quantity),
    unitNetWeightKg: nullableDecimalText(item.unitNetWeightKg),
    salesUnitPrice: decimalText(item.salesUnitPrice),
    salesAmount,
    amount: salesAmount,
    remark: String(item.remark || ""),
    createdAt: item.createdAt,
  };
}
function serializePurchaseOrder(value: unknown) {
  const order = executionRecord(value);
  const supplier = executionRecord(order.supplier);
  const dispatchedBy = executionRecord(order.dispatchedBy);
  const respondedBy = executionRecord(order.respondedBy);
  const productionStartedBy = executionRecord(order.productionStartedBy);
  const productionCompletedBy = executionRecord(order.productionCompletedBy);
  const actualDeliveryRecordedBy = executionRecord(order.actualDeliveryRecordedBy);
  const {
    responseHistory,
    payments,
    adjustments,
    priceCorrections,
    productionProgress,
    deliveryQuantityVariances,
    loadingResults,
  } = serializePurchaseOrderRelations(order);
  const latestApprovedCorrectionByItemId = new Map<string, (typeof priceCorrections)[number]>();
  priceCorrections.forEach((correction) => {
    if (correction.status !== "APPROVED" || !correction.purchaseOrderItemId) return;
    const current = latestApprovedCorrectionByItemId.get(correction.purchaseOrderItemId);
    if (!current || correction.sequenceNo > current.sequenceNo) {
      latestApprovedCorrectionByItemId.set(correction.purchaseOrderItemId, correction);
    }
  });
  const items = Array.isArray(order.items) ? order.items.map((itemValue) => {
    const item = executionRecord(itemValue);
    return serializePurchaseOrderItem(
      itemValue,
      latestApprovedCorrectionByItemId.get(String(item.id || "")),
    );
  }) : [];
  const effectiveSubtotal = effectivePurchaseOrderSubtotal(items);
  const penaltyBaseAmount = nullableDecimalText(order.penaltyBaseAmount) ?? effectiveSubtotal;
  const prepaymentRequiredAmount = factoryPrepaymentRequiredAmount(
    penaltyBaseAmount,
    order.prepaymentRatio as Prisma.Decimal | string | number | null | undefined,
  ).toString();
  const paidPrepaymentAmount = payments
    .filter((payment) => payment.status === "CONFIRMED" && payment.kind === "PREPAYMENT")
    .reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0))
    .toDecimalPlaces(2)
    .toString();
  const confirmedPaymentAmount = payments
    .filter((payment) => payment.status === "CONFIRMED")
    .reduce((sum, payment) => (
      payment.kind === "REFUND" ? sum.sub(payment.amount) : sum.add(payment.amount)
    ), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
  const estimatedPenalty = calculateFactoryDelayPenalty({
    initialDeliveryDate: order.initialSupplierDeliveryDate as Date | string | null | undefined,
    actualDeliveryDate: (order.actualDeliveryDate || new Date()) as Date | string,
    penaltyBaseAmount,
    graceDays: Number(order.delayGraceDays ?? 10),
    ratePerDay: order.delayPenaltyRatePerDay as Prisma.Decimal | string | number | null | undefined,
    capRatio: order.delayPenaltyCapRatio as Prisma.Decimal | string | number | null | undefined,
  });
  const { completionEvent, confirmationEvents } = serializeFactoryConfirmationEvents(
    order,
    responseHistory,
    productionCompletedBy,
  );
  return {
    id: String(order.id || ""),
    replacementForId: order.replacementForId ? String(order.replacementForId) : null,
    executionId: String(order.executionId || ""),
    sequenceNo: Number(order.sequenceNo || 0),
    poNo: String(order.poNo || ""),
    supplierId: String(order.supplierId || supplier.id || ""),
    supplierNameSnapshot: String(order.supplierNameSnapshot || ""),
    supplier: supplier.id ? {
      id: String(supplier.id),
      name: String(supplier.supplierName || ""),
      supplierName: String(supplier.supplierName || ""),
    } : null,
    status: String(order.status || "DRAFT"),
    purchaseCurrency: String(order.purchaseCurrency || ""),
    subtotal: nullableDecimalText(order.subtotal),
    effectiveSubtotal,
    requestedDeliveryDate: order.requestedDeliveryDate || null,
    paymentTerm: String(order.paymentTerm || ""),
    prepaymentRatio: decimalText(order.prepaymentRatio),
    prepaymentRequiredAmount,
    paidPrepaymentAmount,
    prepaymentRequiredBeforeProduction: Boolean(order.prepaymentRequiredBeforeProduction),
    deliveryQuantityToleranceRatio: decimalText(order.deliveryQuantityToleranceRatio, "0.05"),
    initialSupplierDeliveryDate: order.initialSupplierDeliveryDate || null,
    confirmedSupplierDeliveryDate: order.confirmedSupplierDeliveryDate || null,
    penaltyBaseAmount,
    delayGraceDays: Number(order.delayGraceDays ?? 10),
    delayPenaltyRatePerDay: decimalText(order.delayPenaltyRatePerDay, "0.00003"),
    delayPenaltyCapRatio: nullableDecimalText(order.delayPenaltyCapRatio),
    estimatedPenaltyDays: estimatedPenalty.delayDays,
    estimatedPenaltyAmount: estimatedPenalty.amount.toString(),
    productionStatus: String(order.productionStatus || "WAITING_SUPPLIER"),
    productionStartedAt: order.productionStartedAt || null,
    productionStartedBy: productionStartedBy.id ? { id: String(productionStartedBy.id), name: String(productionStartedBy.name || "") } : null,
    productionCompletedAt: order.productionCompletedAt || null,
    productionCompletedBy: productionCompletedBy.id ? { id: String(productionCompletedBy.id), name: String(productionCompletedBy.name || "") } : null,
    productionCompletionSource: String(order.productionCompletionSource || ""),
    productionCompletionChannel: String(order.productionCompletionChannel || ""),
    productionCompletionContact: String(order.productionCompletionContact || ""),
    productionCompletionRecordedAt: order.productionCompletionRecordedAt || null,
    productionCompletionRemark: String(order.productionCompletionRemark || ""),
    productionCompletionEvidenceNote: String(order.productionCompletionEvidenceNote || ""),
    productionCompletionEvidence: completionEvent?.evidence || null,
    productionProgress,
    deliveryQuantityVariances,
    loadingResults,
    actualDeliveryDate: order.actualDeliveryDate || null,
    actualDeliveryRecordedAt: order.actualDeliveryRecordedAt || null,
    actualDeliveryRecordedBy: actualDeliveryRecordedBy.id ? { id: String(actualDeliveryRecordedBy.id), name: String(actualDeliveryRecordedBy.name || "") } : null,
    remark: String(order.remark || ""),
    revision: Number(order.revision || 1),
    dispatchedAt: order.dispatchedAt || null,
    dispatchedBy: dispatchedBy.id ? { id: String(dispatchedBy.id), name: String(dispatchedBy.name || "") } : null,
    dispatchVersionNumber: order.dispatchVersionNumber ? Number(order.dispatchVersionNumber) : null,
    dispatchEmailStatus: order.dispatchEmailStatus ? String(order.dispatchEmailStatus) : null,
    dispatchEmailSentAt: order.dispatchEmailSentAt || null,
    dispatchEmailError: String(order.dispatchEmailError || ""),
    dispatchSmsStatus: order.dispatchSmsStatus ? String(order.dispatchSmsStatus) : null,
    dispatchSmsSentAt: order.dispatchSmsSentAt || null,
    dispatchSmsError: String(order.dispatchSmsError || ""),
    supplierDeliveryDate: order.supplierDeliveryDate || null,
    supplierResponseRemark: String(order.supplierResponseRemark || ""),
    supplierResponseSequence: Number(order.supplierResponseSequence || 0),
    supplierResponseHistory: responseHistory,
    confirmationEvents,
    respondedAt: order.respondedAt || null,
    respondedBy: respondedBy.id ? { id: String(respondedBy.id), name: String(respondedBy.name || "") } : null,
    payments,
    adjustments,
    priceCorrections,
    settlement: serializePurchaseOrderSettlement(order, confirmedPaymentAmount),
    items,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
export function serializeSalesExecution(value: unknown, includeDetail = false) {
  const execution = executionRecord(value);
  const customer = executionRecord(execution.customer);
  const entity = executionRecord(execution.businessEntity);
  const salesperson = executionRecord(execution.salesperson);
  const dispatchedBy = executionRecord(execution.dispatchedBy);
  const sourceQuotation = executionRecord(execution.sourceQuotation);
  const versions = Array.isArray(execution.versions) ? execution.versions : [];
  const items = Array.isArray(execution.items) ? execution.items.map(serializeExecutionItem) : [];
  const purchaseOrders = Array.isArray(execution.purchaseOrders) ? execution.purchaseOrders.map(serializePurchaseOrder) : [];
  const containerLoads = Array.isArray(execution.containerLoads)
    ? execution.containerLoads.map((container) => serializeInternalContainerLoad(container as InternalContainerLoadRow))
    : [];
  const customerName = String(customer.name || execution.customerNameSnapshot || "");
  const customerShortName = String(customer.shortName || execution.customerShortNameSnapshot || "");
  const entityName = String(entity.name || execution.businessEntityNameSnapshot || "");
  const entityShortName = String(entity.shortName || execution.businessEntityShortNameSnapshot || "");
  return {
    id: String(execution.id || ""),
    executionNo: String(execution.executionNo || ""),
    executionDate: execution.executionDate,
    status: String(execution.status || "DRAFT"),
    statusLabel: (execution.shippingStartedAt || execution.receivableOrder) && executionRecord(execution.receivableOrder).status === "已取消"
      ? "关联订单已取消"
      : execution.shippingStartedAt || execution.receivableOrder
        ? "已进入发货"
      : String(execution.status) === "VOIDED"
        ? "已作废"
        : String(execution.status) === "DISPATCHED" ? "已下发" : "草稿",
    sourceType: String(execution.sourceType || "DIRECT"),
    sourceQuotationId: execution.sourceQuotationId ? String(execution.sourceQuotationId) : null,
    sourceQuotation: sourceQuotation.id ? {
      id: String(sourceQuotation.id),
      quoteNo: String(sourceQuotation.quoteNo || ""),
      invoiceNo: sourceQuotation.invoiceNo ? String(sourceQuotation.invoiceNo) : null,
    } : null,
    customerId: String(execution.customerId || customer.id || ""),
    customer: {
      id: String(customer.id || execution.customerId || ""),
      name: customerName,
      fullName: customerName,
      shortName: customerShortName,
      displayName: customerShortName || customerName,
    },
    businessEntityId: String(execution.businessEntityId || entity.id || ""),
    businessEntity: {
      id: String(entity.id || execution.businessEntityId || ""),
      name: entityName,
      shortName: entityShortName,
      displayName: entityShortName || entityName,
    },
    salespersonUserId: String(execution.salespersonUserId || salesperson.id || ""),
    salesperson: salesperson.id ? { id: String(salesperson.id), name: String(salesperson.name || "") } : null,
    currency: String(execution.currency || ""),
    exchangeRate: decimalText(execution.exchangeRate, "1"),
    tradeTerm: String(execution.tradeTerm || ""),
    paymentTerm: String(execution.paymentTerm || ""),
    customerOrderNo: String(execution.customerOrderNo || ""),
    requestedDeliveryDate: execution.requestedDeliveryDate || null,
    subtotal: decimalText(execution.subtotal),
    totalAmount: decimalText(execution.totalAmount),
    remark: String(execution.remark || ""),
    currentVersionNumber: Number(execution.currentVersionNumber || 1),
    revision: Number(execution.revision || 1),
    dispatchedAt: execution.dispatchedAt || null,
    dispatchedBy: dispatchedBy.id ? { id: String(dispatchedBy.id), name: String(dispatchedBy.name || "") } : null,
    dispatchedVersionNumber: execution.dispatchedVersionNumber ? Number(execution.dispatchedVersionNumber) : null,
    ...serializeSalesExecutionShipping(execution),
    ...(includeDetail ? {
      items,
      purchaseOrders,
      containerLoads,
      versions: versions.map((versionValue) => {
        const version = executionRecord(versionValue);
        return {
          id: String(version.id || ""),
          versionNumber: Number(version.versionNumber || 0),
          createdAt: version.createdAt,
        };
      }),
    } : {}),
    voidedAt: execution.voidedAt || null,
    voidReason: String(execution.voidReason || ""),
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
  };
}
export function salesExecutionSnapshot(value: unknown) { const { versions: _versions, ...snapshot } = serializeSalesExecution(value, true); return snapshot as unknown as Prisma.InputJsonValue; }
