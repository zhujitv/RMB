import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  codedError,
  nonEmpty,
} from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
} from "./logistics-expense-shared";
import type { LogisticsExpenseLike } from "./logistics-expense-access-model";
import { logisticsInvoiceGroupForExpense } from "./logistics-invoice-groups";
import { isVoidedLogisticsBill } from "./logistics-bill-state-machine";
import {
  rowBillStatus,
} from "./logistics-expense-workflow-core";
export function assertLogisticsBillNotVoided(rows: LogisticsExpenseLike[] = [], message = "该物流费用账单已作废，仅允许查看详情和操作日志。") {
  if (rows.some((row) => isVoidedLogisticsBill({ status: rowBillStatus(row) }))) {
    throw codedError(message, 400, "LOGISTICS_BILL_VOIDED_ACTION_BLOCKED");
  }
}

export function paymentStatusUpdateAfterInvoiceProgress(billRows: LogisticsExpenseLike[]) {
		const billAuditStatus = aggregateLogisticsExpenseStatus(billRows, "auditStatus");
		const billInvoiceStatus = aggregateLogisticsExpenseInvoiceStatus(billRows);
		const billPaymentStatus = aggregateLogisticsExpenseStatus(billRows, "paymentStatus");
		if (billAuditStatus !== "审核通过" || ["已付款", "部分付款", "部分已付款"].includes(billPaymentStatus)) return {};
		return ["已确认", "已确认发票"].includes(billInvoiceStatus)
			? { paymentStatus: "待付款" }
			: { paymentStatus: "待开票" };
}

export async function assertActiveLogisticsInvoiceDocuments(
  tx: Prisma.TransactionClient | typeof prisma,
  rows: LogisticsExpenseLike[] = [],
) {
  const documentIds = [...new Set(rows.map((row) => nonEmpty(row.invoiceDocumentId)).filter(Boolean))];
  if (!rows.length || rows.some((row) => !nonEmpty(row.invoiceDocumentId))) {
    throw codedError("物流费用存在未关联有效 PDF 发票的明细，不能继续。", 409, "LOGISTICS_INVOICE_DOCUMENT_REQUIRED");
  }
  const activeDocuments = await tx.orderDocument.findMany({
    where: {
      id: { in: documentIds },
      deletedAt: null,
      uploadStatus: "SUCCESS",
      documentType: "SUPPLIER_INVOICE",
      relatedModule: "SUPPLIER",
    },
    select: { id: true, orderId: true, supplierId: true, mimeType: true, fileSize: true, storageKey: true },
    take: documentIds.length,
  });
  const documentById = new Map(activeDocuments.map((document) => [document.id, document]));
  const invalidRow = rows.find((row) => {
    const document = documentById.get(nonEmpty(row.invoiceDocumentId));
    return !document
      || document.orderId !== row.orderId
      || document.supplierId !== row.supplierId
      || nonEmpty(document.mimeType).toLowerCase() !== "application/pdf"
      || Number(document.fileSize || 0) <= 0
      || !nonEmpty(document.storageKey);
  });
  if (invalidRow || activeDocuments.length !== documentIds.length) {
    throw codedError("物流费用关联的 PDF 发票不存在、格式无效、已删除或尚未上传成功，请重新上传。", 409, "LOGISTICS_INVOICE_DOCUMENT_INVALID");
  }
}

export async function assertLogisticsInvoiceDocumentNotReusedOutsideRows(
  tx: Prisma.TransactionClient | typeof prisma,
  documentId: string,
  allowedRows: LogisticsExpenseLike[] = [],
) {
  const allowedRowIds = allowedRows.map((row) => nonEmpty(row.id)).filter(Boolean);
  const reusedRow = await tx.logisticsExpense.findFirst({
    where: {
      invoiceDocumentId: documentId,
      deletedAt: null,
      ...(allowedRowIds.length ? { id: { notIn: allowedRowIds } } : {}),
    },
    select: { id: true },
  });
  if (reusedRow) {
    throw codedError(
      "同一 PDF 已被其他发票分组或账单使用，请先修复重复关联。",
      409,
      "LOGISTICS_INVOICE_DOCUMENT_REUSED_ACROSS_GROUPS",
    );
  }
}

export function assertLogisticsInvoiceRowsConfirmed(rows: LogisticsExpenseLike[] = []) {
  const groupByDocumentId = new Map<string, string>();
  for (const row of rows) {
    const confirmedById = nonEmpty(
      row.invoiceConfirmedById
      || (row.invoiceConfirmedBy as { id?: unknown } | null | undefined)?.id,
    );
    if (row.invoiceStatus !== "已确认" || !row.invoiceConfirmedAt || !confirmedById) {
      throw codedError("物流费用仍有发票未由财务确认，不能进入付款。", 409, "LOGISTICS_INVOICE_CONFIRMATION_INCOMPLETE");
    }
    const group = logisticsInvoiceGroupForExpense(row);
    const documentId = nonEmpty(row.invoiceDocumentId);
    if (!group || !documentId) {
      throw codedError("物流费用存在未归入有效发票分组的明细，不能进入付款。", 409, "LOGISTICS_INVOICE_GROUP_INCOMPLETE");
    }
    const existingGroup = groupByDocumentId.get(documentId);
    if (existingGroup && existingGroup !== group.key) {
      throw codedError("不同发票分组不能共用同一 PDF，请重新上传并确认。", 409, "LOGISTICS_INVOICE_DOCUMENT_REUSED_ACROSS_GROUPS");
    }
    groupByDocumentId.set(documentId, group.key);
  }
}
