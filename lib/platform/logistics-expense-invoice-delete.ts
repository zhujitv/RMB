import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  FILE_ASSET_SOURCE_TABLES,
  codedError,
  nonEmpty,
  optional,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  softDeleteFileAssetBySource,
  writeAudit,
} from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  canUploadLogisticsExpenseInvoice,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import {
  logisticsInvoiceExpenseMatchesGroup,
  logisticsInvoiceGroupCurrencyViolation,
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupForKey,
} from "./logistics-invoice-groups";
import { assertCanDeleteLogisticsInvoiceFile } from "./file-delete-policy";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  assertLogisticsBillRowsMatchHeader,
  lockLogisticsBillForWorkflow,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import {
  assertNoSettledLogisticsCostConflict,
  syncLogisticsExpenseCostInvoiceStatus,
} from "./logistics-expense-cost-safety";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  assertLogisticsBillNotVoided,
  assertLogisticsInvoiceDocumentNotReusedOutsideRows,
} from "./logistics-expense-invoice-guards";

export async function deleteLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  const canManageInvoice = canUploadLogisticsExpenseInvoice(actor, before);
  assertCanDeleteLogisticsInvoiceFile({ canManageInvoice, invoiceConfirmed: false });
  const requestedGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  const fallbackGroup = logisticsInvoiceGroupForExpense(before);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const billId = rowBillId(before);
  const deletedAt = new Date();
  const deleted = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      nonEmpty(before.orderId),
      "该订单已提交退税并归档，不能删除物流费用发票。",
    );
    await lockLogisticsBillForWorkflow(tx, billId);
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!currentRows.length) throw codedError("物流费用账单缺少费用明细。", 409, "LOGISTICS_INVOICE_ROWS_EMPTY");
    await assertLogisticsBillRowsMatchHeader(tx, billId, currentRows);
    assertLogisticsBillNotVoided(currentRows);
    const currentPaymentStatus = aggregateLogisticsExpenseStatus(currentRows, "paymentStatus");
    if (["已付款", "部分付款", "部分已付款"].some((status) => currentPaymentStatus.includes(status))) {
      throw codedError("已付款账单不能删除发票。", 400, "LOGISTICS_INVOICE_PAID_DELETE_BLOCKED");
    }
    const targetRows = currentRows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
    const groupViolation = targetRows.map((row) => logisticsInvoiceGroupCurrencyViolation(row, invoiceGroup)).find(Boolean);
    if (groupViolation) throw codedError(groupViolation, 400, "LOGISTICS_INVOICE_GROUP_CURRENCY_INVALID");
    if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
    await assertNoSettledLogisticsCostConflict(tx, currentRows);
    assertCanDeleteLogisticsInvoiceFile({
      canManageInvoice,
      invoiceConfirmed: targetRows.some((row) => row.invoiceStatus === "已确认" || row.invoiceConfirmedAt),
    });
    const documentId = optional(input.documentId) || targetRows.find((row) => row.invoiceDocumentId)?.invoiceDocumentId || "";
    if (!documentId) throw codedError("当前分组没有已上传发票。", 404, "LOGISTICS_INVOICE_DOCUMENT_NOT_FOUND");
    const targetDocumentRows = targetRows.filter((row) => row.invoiceDocumentId === documentId);
    if (!targetDocumentRows.length) throw codedError("该发票文件不属于当前账单分组。", 400, "LOGISTICS_INVOICE_DOCUMENT_SCOPE_INVALID");
    await assertLogisticsInvoiceDocumentNotReusedOutsideRows(tx, documentId, targetDocumentRows);
    const document = await tx.orderDocument.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        uploadStatus: "SUCCESS",
        documentType: "SUPPLIER_INVOICE",
        relatedModule: "SUPPLIER",
        orderId: targetDocumentRows[0].orderId,
        supplierId: targetDocumentRows[0].supplierId,
      },
    });
    if (!document) throw codedError("发票文件不存在、已删除或关联错误。", 404, "LOGISTICS_INVOICE_DOCUMENT_NOT_FOUND");
    const documentUpdate = await tx.orderDocument.updateMany({
      where: { id: documentId, deletedAt: null, uploadStatus: "SUCCESS" },
      data: { deletedAt },
    });
    if (documentUpdate.count !== 1) {
      throw codedError("发票文件状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_DELETE_DOCUMENT_CHANGED");
    }
    await softDeleteFileAssetBySource(
      tx,
      FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
      documentId,
      String(document.documentType || "SUPPLIER_INVOICE"),
      deletedAt,
    );
    const targetIds = targetDocumentRows.map((row) => row.id).filter(Boolean);
    const expenseUpdate = await tx.logisticsExpense.updateMany({
      where: {
        id: { in: targetIds },
        deletedAt: null,
        invoiceDocumentId: documentId,
        invoiceStatus: "已上传",
        invoiceConfirmedAt: null,
      },
      data: {
        invoiceDocumentId: null,
        invoiceUploadedById: null,
        invoiceUploadedAt: null,
        invoiceValidationStatus: "未上传",
        invoiceValidationMessage: null,
        invoiceValidationJson: Prisma.JsonNull,
        invoiceOcrTaskId: null,
        invoiceRecognizedNo: null,
        invoiceRecognizedDate: null,
        invoiceRecognizedSeller: null,
        invoiceRecognizedBuyer: null,
        invoiceRecognizedAmount: null,
        invoiceRecognizedName: null,
        invoiceManualConfirmedById: null,
        invoiceManualConfirmedAt: null,
        invoiceManualConfirmReason: null,
        invoiceStatus: "待开票",
        updatedById: actorId(actor),
      },
    });
    if (expenseUpdate.count !== targetIds.length) {
      throw codedError("发票分组状态已变化，删除已取消，请刷新后重试。", 409, "LOGISTICS_INVOICE_DELETE_STATE_CHANGED");
    }
    await syncLogisticsExpenseCostInvoiceStatus(tx, targetDocumentRows, "未收到", actorId(actor));
    const projectedRows = currentRows.map((row) => (
      targetIds.includes(row.id)
        ? { ...row, invoiceDocumentId: null, invoiceDocument: null, invoiceStatus: "待开票" }
        : row
    ));
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: "voided" },
        paymentStatus: { notIn: ["已付款", "部分付款", "部分已付款"] },
      },
      data: {
        invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(projectedRows),
        paymentStatus: "待开票",
        updatedById: actorId(actor) || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("账单状态已变化，发票删除已取消，请刷新后重试。", 409, "LOGISTICS_INVOICE_DELETE_BILL_CHANGED");
    }
    const rows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    return { rows, targetRows, targetDocumentRows, targetIds, documentId };
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  const finalRows = deleted.rows;
  await runNonCriticalTask("物流发票删除状态日志写入", () => writeAudit(request, actor, "删除物流分组发票", "logistics_bills", billId, deleted.targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId: deleted.documentId,
    updatedIds: deleted.targetIds,
  }));
  for (const orderId of [...new Set(deleted.targetDocumentRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId));
  }
  invalidateWorkbenchTodosCache();
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}
