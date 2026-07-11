import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import {
  analyzeTaxRefundLogisticsClosure,
  taxRefundLogisticsClosureErrorMessage,
} from "./tax-refund-business-closure-rules";

export async function assertTaxRefundLogisticsBusinessClosure(
  orderId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const rows = await client.logisticsExpense.findMany({
    where: { orderId, deletedAt: null },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      costId: true,
      costType: true,
      amount: true,
      amountCny: true,
      currency: true,
      supplierNameSnapshot: true,
      auditStatus: true,
      paymentStatus: true,
      invoiceDocumentId: true,
      invoiceValidationStatus: true,
      invoiceValidationMessage: true,
      deletedAt: true,
      supplier: { select: { supplierName: true } },
      bill: {
        select: {
          id: true,
          auditStatus: true,
          paymentStatus: true,
          paymentDate: true,
          status: true,
          deletedAt: true,
        },
      },
      cost: {
        select: {
          id: true,
          orderId: true,
          supplierId: true,
          costType: true,
          currency: true,
          amount: true,
          amountCny: true,
          sourceType: true,
          sourceId: true,
          invoiceStatus: true,
          paymentStatus: true,
          paid: true,
          paymentDate: true,
          status: true,
          deletedAt: true,
        },
      },
      invoiceDocument: {
        select: {
          id: true,
          uploadStatus: true,
          deletedAt: true,
        },
      },
    },
  });
  const summary = analyzeTaxRefundLogisticsClosure(rows);
  if (summary.complete) return summary;
  const error = codedError(taxRefundLogisticsClosureErrorMessage(summary.blockers), 400, "TAX_REFUND_LOGISTICS_NOT_SETTLED");
  error.details = summary;
  throw error;
}
