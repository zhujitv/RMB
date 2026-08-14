import { dateToInput } from "./shared-base-utils";
import { TAX_REFUND_STATUS_LABELS } from "./shared-constants";
import {
  safeSerializeCost,
  serializeCustomsRecognition,
  serializeDomesticLogisticsInfo,
  serializeOrderDocument,
  serializeShippingDocumentNotification,
  serializeSupplier,
} from "./shared-serialization";
import { taxDocumentCompleteness, derivedTaxRefundStatus } from "./shared-tax";
import { serializeUser } from "./shared-users";
import { summarizeOrderWithCommissionSnapshot } from "./shared-commission-summary";
import {
  asShippingOrder,
  type OrderPaymentInstallmentLike,
} from "./shared-order-serialization-types";
import { serializeOrderListRow } from "./shared-order-list-serialization";
import { shippingDocumentDraft } from "./shared-order-shipping-documents";
import { isBusinessArchived } from "./business-archive";

export function serializeOrder(
  orderInput: unknown,
  commissionFormulaSettings?: Record<string, unknown> | null,
) {
  const order = asShippingOrder(orderInput);
  const summary = summarizeOrderWithCommissionSnapshot(
    order as Parameters<typeof summarizeOrderWithCommissionSnapshot>[0],
    commissionFormulaSettings,
  );
  const paymentInstallments = Array.isArray(order.paymentInstallments) ? order.paymentInstallments as OrderPaymentInstallmentLike[] : [];
  const documents = (order.documents || []).map((document) => serializeOrderDocument(document, order));
  const costs = (order.costs || []).map(safeSerializeCost);
  const shippingNotifications = order.shippingDocumentNotifications || [];
  const latestShippingNotification = shippingNotifications[0] || null;
  const completeness = taxDocumentCompleteness(order as Parameters<typeof taxDocumentCompleteness>[0]);
  const taxRefundStatus = derivedTaxRefundStatus(order as Parameters<typeof derivedTaxRefundStatus>[0], order.documents || []);
  const domesticLogisticsRows = Array.isArray(order.domesticLogisticsInfos) ? order.domesticLogisticsInfos : [];
  const domesticLogisticsInfo = serializeDomesticLogisticsInfo(domesticLogisticsRows[0]);
  return {
    ...serializeOrderListRow(order, commissionFormulaSettings),
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    exchangeRate: Number(order.exchangeRate),
    commissionStatus: summary.commissionStatus,
    paymentInstallments,
    paymentInstallmentText: paymentInstallments.map((item) => (
      `${item.condition || "-"}：${Number(item.ratio || 0)}% / ${Number(item.amount || 0).toFixed(2)}`
    )).join("；"),
    taxRefundStatus,
    taxRefundStatusLabel: (TAX_REFUND_STATUS_LABELS as Record<string, string>)[taxRefundStatus] || taxRefundStatus,
    taxArchived: isBusinessArchived({
      taxArchived: order.taxArchived,
      taxRefundStatus,
      taxRefundArchivedAt: order.taxRefundArchivedAt,
      taxSubmittedAt: order.taxSubmittedAt,
    }),
    taxRefundArchivedById: order.taxRefundArchivedById || "",
    taxRefundArchivedByName: order.taxRefundArchivedBy?.name || "",
    taxRefundArchivedAt: order.taxRefundArchivedAt || null,
    taxRefundArchiveRemark: order.taxRefundArchiveRemark || "",
    taxSubmittedById: order.taxSubmittedById || "",
    taxSubmittedByName: order.taxSubmittedBy?.name || order.taxRefundArchivedBy?.name || "",
    taxSubmittedAt: order.taxSubmittedAt || order.taxRefundArchivedAt || null,
    ...serializeCustomsRecognition(order),
    documentCompleteness: completeness,
    domesticLogisticsInfo,
    documents,
    logisticsSupplierIds: (order.logisticsSuppliers || []).map((row) => row.supplierId),
    logisticsSuppliers: (order.logisticsSuppliers || []).map((row) => serializeSupplier(row.supplier)).filter((item) => item.id),
    shippingDocumentNotifications: shippingNotifications.map((row) => serializeShippingDocumentNotification(row, order)),
    shippingDocumentNotification: serializeShippingDocumentNotification(latestShippingNotification, order),
    shippingDocumentManualDraft: shippingDocumentDraft(order),
    costs,
    creditDays: order.creditDays ?? "",
    dueDate: dateToInput(order.dueDate),
    reminderDays: order.reminderDays,
    status: order.status,
    remark: order.remark || "",
    createdBy: serializeUser(order.createdBy),
    updatedBy: serializeUser(order.updatedBy),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary,
  };
}

export type SerializedOrderDto = ReturnType<typeof serializeOrder>;
