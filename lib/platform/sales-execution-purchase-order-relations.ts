import { Prisma } from "../generated/prisma/client.js";
import { serializeProductionProgress } from "./factory-purchase-order-production-progress-values";
import {
  serializeInternalFactoryPurchaseLoadingResult,
  type FactoryPurchaseLoadingResultRow,
} from "./factory-purchase-order-loading-result-serialization";

type LooseRecord = Record<string, unknown>;

function record(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function decimalText(value: unknown, fallback = "0") {
  if (value === null || value === undefined || value === "") return fallback;
  return Prisma.Decimal.isDecimal(value) ? value.toString() : String(value);
}

function nullableDecimalText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return Prisma.Decimal.isDecimal(value) ? value.toString() : String(value);
}

export function serializePurchaseOrderRelations(order: LooseRecord) {
  const responseHistory = Array.isArray(order.supplierResponses)
    ? order.supplierResponses.map((responseValue) => {
      const response = record(responseValue);
      const respondedBy = record(response.respondedBy);
      const internalDecidedBy = record(response.internalDecidedBy);
      const evidenceFile = record(response.confirmationEvidenceFile);
      const evidenceUploadedBy = record(evidenceFile.uploadedBy);
      const priceChanges = Array.isArray(response.supplierPrices)
        ? response.supplierPrices.map((priceValue) => {
          const price = record(priceValue);
          return {
            purchaseOrderItemId: String(price.purchaseOrderItemId || ""),
            unitPrice: decimalText(price.unitPrice),
            amount: decimalText(price.amount),
          };
        })
        : [];
      const evidencePath = response.id
        ? `/api/sales-executions/${encodeURIComponent(String(order.executionId || ""))}/purchase-orders/${encodeURIComponent(String(order.id || ""))}/confirmation-evidence/SUPPLIER_RESPONSE/${encodeURIComponent(String(response.id))}`
        : "";
      return {
        id: String(response.id || ""), sequence: Number(response.responseSequence || 0),
        action: String(response.action || ""),
        deliveryDate: response.deliveryDate || null, remark: String(response.remark || ""),
        priceChanges,
        source: String(response.source || "SUPPLIER_PORTAL"),
        channel: String(response.channel || "PORTAL"),
        supplierContact: String(response.supplierContact || ""),
        supplierRespondedAt: response.supplierRespondedAt || response.respondedAt || null,
        evidenceNote: String(response.evidenceNote || ""),
        evidence: evidenceFile.id ? {
          id: String(evidenceFile.id),
          fileName: String(evidenceFile.fileName || "确认凭证"),
          mimeType: String(evidenceFile.mimeType || "application/octet-stream"),
          fileSize: Number(evidenceFile.fileSize || 0),
          uploadedAt: evidenceFile.uploadedAt || null,
          uploadedBy: evidenceUploadedBy.id ? {
            id: String(evidenceUploadedBy.id), name: String(evidenceUploadedBy.name || ""),
          } : null,
          previewUrl: evidencePath,
          downloadUrl: `${evidencePath}?download=1`,
        } : null,
        recordedAt: response.respondedAt || null,
        recordedBy: respondedBy.id
          ? { id: String(respondedBy.id), name: String(respondedBy.name || "") } : null,
        respondedAt: response.supplierRespondedAt || response.respondedAt || null,
        internalDecision: String(response.internalDecision || ""),
        internalDecisionRemark: String(response.internalDecisionRemark || ""),
        internalDecidedAt: response.internalDecidedAt || null,
        internalDecidedBy: internalDecidedBy.id
          ? { id: String(internalDecidedBy.id), name: String(internalDecidedBy.name || "") } : null,
      };
    }) : [];
  const payments = Array.isArray(order.payments)
    ? order.payments.map((paymentValue) => {
      const payment = record(paymentValue);
      return {
        id: String(payment.id || ""), sequenceNo: Number(payment.sequenceNo || 0),
        kind: String(payment.kind || "PREPAYMENT"), amount: decimalText(payment.amount),
        currency: String(payment.currency || order.purchaseCurrency || ""), paidAt: payment.paidAt || null,
        bankReference: String(payment.bankReference || ""), remark: String(payment.remark || ""),
        status: String(payment.status || "CONFIRMED"), voidedAt: payment.voidedAt || null,
        voidReason: String(payment.voidReason || ""),
      };
    }) : [];
  const adjustments = Array.isArray(order.adjustments)
    ? order.adjustments.map((adjustmentValue) => {
      const adjustment = record(adjustmentValue);
      return {
        id: String(adjustment.id || ""), sequenceNo: Number(adjustment.sequenceNo || 0),
        kind: String(adjustment.kind || "TEMPORARY_FEE"), direction: String(adjustment.direction || "INCREASE"),
        amount: decimalText(adjustment.amount), currency: String(adjustment.currency || order.purchaseCurrency || ""),
        description: String(adjustment.description || ""), occurredAt: adjustment.occurredAt || null,
        status: String(adjustment.status || "PROVISIONAL"),
      };
    }) : [];
  const priceCorrections = Array.isArray(order.priceCorrections)
    ? order.priceCorrections.map((correctionValue) => {
      const correction = record(correctionValue);
      const requestedBy = record(correction.requestedBy);
      const reviewedBy = record(correction.reviewedBy);
      return {
        id: String(correction.id || ""), sequenceNo: Number(correction.sequenceNo || 0),
        purchaseOrderItemId: String(correction.purchaseOrderItemId || ""),
        batchId: correction.batchId ? String(correction.batchId) : null,
        batchLineNo: correction.batchLineNo === null || correction.batchLineNo === undefined
          ? null : Number(correction.batchLineNo),
        batchLineCount: correction.batchLineCount === null || correction.batchLineCount === undefined
          ? null : Number(correction.batchLineCount),
        status: String(correction.status || "PENDING"),
        quantity: decimalText(correction.quantitySnapshot),
        oldUnitPrice: decimalText(correction.oldUnitPrice),
        newUnitPrice: decimalText(correction.newUnitPrice),
        oldAmount: decimalText(correction.oldAmount),
        newAmount: decimalText(correction.newAmount),
        deltaAmount: decimalText(correction.deltaAmount),
        currency: String(correction.currency || order.purchaseCurrency || ""),
        reason: String(correction.reason || ""),
        reviewRemark: String(correction.reviewRemark || ""),
        sourceUnitPriceType: String(correction.sourceUnitPriceType || "PURCHASE_ORDER"),
        adjustmentId: correction.adjustmentId ? String(correction.adjustmentId) : null,
        settlementStatusBefore: correction.settlementStatusBefore
          ? String(correction.settlementStatusBefore)
          : null,
        settlementStatusAfter: correction.settlementStatusAfter
          ? String(correction.settlementStatusAfter)
          : null,
        settlementFinalPayableBefore: nullableDecimalText(correction.settlementFinalPayableBefore),
        settlementFinalPayableAfter: nullableDecimalText(correction.settlementFinalPayableAfter),
        settlementRevisionBefore: correction.settlementRevisionBefore === null
          || correction.settlementRevisionBefore === undefined ? null : Number(correction.settlementRevisionBefore),
        settlementRevisionAfter: correction.settlementRevisionAfter === null
          || correction.settlementRevisionAfter === undefined ? null : Number(correction.settlementRevisionAfter),
        settlementIncreaseBefore: nullableDecimalText(correction.settlementIncreaseBefore),
        settlementIncreaseAfter: nullableDecimalText(correction.settlementIncreaseAfter),
        settlementDecreaseBefore: nullableDecimalText(correction.settlementDecreaseBefore),
        settlementDecreaseAfter: nullableDecimalText(correction.settlementDecreaseAfter),
        settlementPaidBefore: nullableDecimalText(correction.settlementPaidBefore),
        settlementPaidAfter: nullableDecimalText(correction.settlementPaidAfter),
        settlementSettledAtBefore: correction.settlementSettledAtBefore || null,
        settlementSettledAtAfter: correction.settlementSettledAtAfter || null,
        settlementSettledByBeforeId: correction.settlementSettledByBeforeId
          ? String(correction.settlementSettledByBeforeId) : null,
        settlementSettledByAfterId: correction.settlementSettledByAfterId
          ? String(correction.settlementSettledByAfterId) : null,
        requestedAt: correction.requestedAt || null,
        reviewedAt: correction.reviewedAt || null,
        requestedBy: requestedBy.id
          ? { id: String(requestedBy.id), name: String(requestedBy.name || "") }
          : null,
        reviewedBy: reviewedBy.id
          ? { id: String(reviewedBy.id), name: String(reviewedBy.name || "") }
          : null,
      };
    }) : [];
  const deliveryQuantityVariances = Array.isArray(order.deliveryQuantityVariances)
    ? order.deliveryQuantityVariances.map((varianceValue) => {
      const variance = record(varianceValue);
      const requestedBy = record(variance.requestedBy);
      const decidedBy = record(variance.decidedBy);
      return {
        id: String(variance.id || ""),
        purchaseOrderId: String(variance.purchaseOrderId || order.id || ""),
        sequenceNo: Number(variance.sequenceNo || 0),
        status: String(variance.status || "PENDING"),
        source: String(variance.source || "SUPPLIER_PORTAL"),
        channel: String(variance.channel || "PORTAL"),
        supplierContact: String(variance.supplierContact || ""),
        supplierRequestedAt: variance.supplierRequestedAt || null,
        requestedAt: variance.requestedAt || null,
        requestedBy: requestedBy.id
          ? { id: String(requestedBy.id), name: String(requestedBy.name || "") }
          : null,
        reason: String(variance.reason || ""),
        decidedAt: variance.decidedAt || null,
        decidedBy: decidedBy.id
          ? { id: String(decidedBy.id), name: String(decidedBy.name || "") }
          : null,
        decisionRemark: String(variance.decisionRemark || ""),
        items: Array.isArray(variance.items) ? variance.items.map((itemValue) => {
          const item = record(itemValue);
          const ordered = new Prisma.Decimal(decimalText(item.orderedQuantitySnapshot));
          const proposed = new Prisma.Decimal(decimalText(item.proposedQuantity));
          return {
            purchaseOrderItemId: String(item.purchaseOrderItemId || ""),
            orderedQuantity: ordered.toString(),
            proposedQuantity: proposed.toString(),
            differenceQuantity: proposed.sub(ordered).toString(),
          };
        }) : [],
      };
    }) : [];
  const approvedVariance = deliveryQuantityVariances.find((variance) => variance.status === "APPROVED");
  const loadingResults = Array.isArray(order.loadingResults)
    ? order.loadingResults.map((result) => serializeInternalFactoryPurchaseLoadingResult(
      result as FactoryPurchaseLoadingResultRow,
    ))
    : [];
  const productionProgress = serializeProductionProgress(
    Array.isArray(order.productionProgressReports)
      ? order.productionProgressReports.map((reportValue) => {
        const report = record(reportValue);
        const reportedBy = record(report.reportedBy);
        return {
          id: String(report.id || ""),
          sequenceNo: Number(report.sequenceNo || 0),
          source: String(report.source || "SUPPLIER_PORTAL"),
          channel: String(report.channel || "PORTAL"),
          supplierContact: String(report.supplierContact || ""),
          supplierReportedAt: report.supplierReportedAt as Date | string | null,
          reportedAt: report.reportedAt as Date | string | null,
          remark: String(report.remark || "") || null,
          reportedBy: { id: String(reportedBy.id || ""), name: String(reportedBy.name || "") },
          items: Array.isArray(report.items) ? report.items.map((itemValue) => {
            const item = record(itemValue);
            return {
              purchaseOrderItemId: String(item.purchaseOrderItemId || ""),
              completedQuantity: decimalText(item.completedQuantity),
            };
          }) : [],
        };
      })
      : [],
    Array.isArray(order.items) ? order.items.map((itemValue) => {
      const item = record(itemValue);
      return { id: String(item.id || ""), allocatedQuantity: decimalText(item.allocatedQuantity) };
    }) : [],
    approvedVariance,
  );
  return {
    responseHistory,
    payments,
    adjustments,
    priceCorrections,
    productionProgress,
    deliveryQuantityVariances,
    loadingResults,
  };
}

export function serializePurchaseOrderSettlement(
  order: LooseRecord,
  confirmedPaymentAmount: Prisma.Decimal,
) {
  const settlement = record(order.settlement);
  if (!settlement.id) return null;
  const finalPayable = new Prisma.Decimal(decimalText(settlement.finalPayableAmount));
  const remaining = finalPayable.sub(confirmedPaymentAmount);
  const remainingRefund = confirmedPaymentAmount.sub(finalPayable);
  const createdBy = record(settlement.createdBy);
  const settledBy = record(settlement.settledBy);
  return {
    id: String(settlement.id), revision: Number(settlement.revision || 1),
    baseAmount: decimalText(settlement.baseAmount),
    increaseAmount: decimalText(settlement.increaseAmount), decreaseAmount: decimalText(settlement.decreaseAmount),
    delayDays: Number(settlement.delayDays || 0), delayPenaltyAmount: decimalText(settlement.delayPenaltyAmount),
    finalPayableAmount: finalPayable.toString(), currency: String(settlement.currency || order.purchaseCurrency || ""),
    exchangeRate: decimalText(settlement.exchangeRate, "1"), exchangeRateDate: settlement.exchangeRateDate || null,
    paidAmountAtSettlement: decimalText(settlement.paidAmountAtSettlement),
    currentPaidAmount: confirmedPaymentAmount.toString(),
    remainingAmount: (remaining.gt(0) ? remaining : new Prisma.Decimal(0)).toDecimalPlaces(2).toString(),
    remainingRefundAmount: (remainingRefund.gt(0) ? remainingRefund : new Prisma.Decimal(0)).toDecimalPlaces(2).toString(),
    status: String(settlement.status || "PENDING_PAYMENT"), settledAt: settlement.settledAt || null,
    createdAt: settlement.createdAt || null, updatedAt: settlement.updatedAt || null,
    createdBy: createdBy.id ? { id: String(createdBy.id), name: String(createdBy.name || "") } : null,
    settledBy: settledBy.id ? { id: String(settledBy.id), name: String(settledBy.name || "") } : null,
  };
}
