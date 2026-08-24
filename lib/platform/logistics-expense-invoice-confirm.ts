import { prisma } from "../prisma";
import {
  codedError,
  nonEmpty,
  optional,
  permissionError,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  assertCanConfirmLogisticsInvoice,
  includeLogisticsExpenseListRelations,
  includeLogisticsExpenseRelations,
  logisticsExpenseAccessWhere,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import {
  logisticsInvoiceExpenseMatchesGroup,
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupForKey,
} from "./logistics-invoice-groups";
import { summarizeInvoiceValidationBlockReason } from "./logistics-invoice-validation";
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
  paymentStatusUpdateAfterInvoiceProgress,
  assertActiveLogisticsInvoiceDocuments,
  assertLogisticsInvoiceDocumentNotReusedOutsideRows,
} from "./logistics-expense-invoice-guards";

export async function confirmLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  // Before entering the locked workflow we only need identity and grouping
  // fields. Loading the full order/document/cost graph here duplicated the
  // expensive relation query performed by the transaction below.
  const before = await prisma.logisticsExpense.findFirst({
    where: {
      id,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    select: {
      id: true,
      billId: true,
      orderId: true,
      supplierId: true,
      costType: true,
      currency: true,
    },
  });
  if (!before) throw permissionError("物流费用不存在或无权访问", 404);
  const requestedGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  const fallbackGroup = logisticsInvoiceGroupForExpense(before);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const forceConfirmReason = optional(input.forceConfirmReason || input.reason);
  const confirmedAt = new Date();
  const billId = rowBillId(before);
  const confirmed = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      nonEmpty(before.orderId),
      "该订单已提交退税并归档，不能确认物流费用发票。",
    );
    await lockLogisticsBillForWorkflow(tx, billId);
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseListRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!currentRows.length) throw codedError("物流费用账单缺少费用明细。", 409, "LOGISTICS_INVOICE_ROWS_EMPTY");
    await assertLogisticsBillRowsMatchHeader(tx, billId, currentRows);
    assertLogisticsBillNotVoided(currentRows);
    if (aggregateLogisticsExpenseStatus(currentRows, "auditStatus") !== "审核通过") {
      throw codedError("只有审核通过的物流费用账单可以确认发票。", 400, "LOGISTICS_INVOICE_APPROVAL_REQUIRED");
    }
    const targetRows = currentRows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
    if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
    const documentId = optional(input.documentId) || targetRows.find((row) => row.invoiceDocumentId)?.invoiceDocumentId || "";
    if (!documentId) throw codedError("发票文件不能为空。", 400, "LOGISTICS_INVOICE_FILE_REQUIRED");
    if (targetRows.some((row) => row.invoiceDocumentId !== documentId)) {
      throw codedError("同一发票分组的文件关联不一致，请重新上传后再确认。", 409, "LOGISTICS_INVOICE_GROUP_DOCUMENT_MISMATCH");
    }
    if (targetRows.some((row) => !["已上传", "已确认"].includes(nonEmpty(row.invoiceStatus)))) {
      throw codedError("只有已上传发票的物流费用可以确认。", 400, "LOGISTICS_INVOICE_NOT_UPLOADED");
    }
    await assertNoSettledLogisticsCostConflict(tx, currentRows);
    await assertLogisticsInvoiceDocumentNotReusedOutsideRows(tx, documentId, targetRows);
    await assertActiveLogisticsInvoiceDocuments(tx, targetRows);
    const validationBlockReason = summarizeInvoiceValidationBlockReason(targetRows);
    if (validationBlockReason) {
      throw codedError(validationBlockReason, 400, "LOGISTICS_INVOICE_VALIDATION_BLOCKED");
    }
    const rowsToConfirm = targetRows.filter((row) => row.invoiceStatus !== "已确认");
    if (!rowsToConfirm.length) throw codedError("该分组发票已经确认。", 400, "LOGISTICS_INVOICE_ALREADY_CONFIRMED");
    const confirmIds = rowsToConfirm.map((row) => row.id).filter(Boolean);
    const expenseUpdate = await tx.logisticsExpense.updateMany({
      where: { id: { in: confirmIds }, deletedAt: null, invoiceDocumentId: documentId, invoiceStatus: "已上传" },
      data: {
        invoiceStatus: "已确认",
        invoiceConfirmedById: actorId(actor),
        invoiceConfirmedAt: confirmedAt,
        forceConfirmReason,
        updatedById: actorId(actor),
      },
    });
    if (expenseUpdate.count !== confirmIds.length) {
      throw codedError("发票分组状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_CONFIRM_STATE_CHANGED");
    }
    await syncLogisticsExpenseCostInvoiceStatus(tx, targetRows, "已收到", actorId(actor));
    const projectedRows = currentRows.map((row) => (
      confirmIds.includes(row.id)
        ? {
            ...row,
            invoiceStatus: "已确认",
            invoiceConfirmedById: actorId(actor),
            invoiceConfirmedAt: confirmedAt,
          }
        : row
    ));
    const invoiceStatus = aggregateLogisticsExpenseInvoiceStatus(projectedRows);
    const billUpdate = await tx.logisticsBill.updateMany({
      where: { id: billId, deletedAt: null, status: { not: "voided" }, auditStatus: "审核通过" },
      data: {
        invoiceStatus,
        ...paymentStatusUpdateAfterInvoiceProgress(projectedRows),
        updatedById: actorId(actor) || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("账单状态已变化，发票确认已取消，请刷新后重试。", 409, "LOGISTICS_INVOICE_CONFIRM_BILL_CHANGED");
    }
    const rows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      // The response serializer does not use the heavy cost relation or the
      // supplier operator list, so return the compact list graph here.
      include: includeLogisticsExpenseListRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    return { rows, targetRows, documentId, confirmIds };
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  const finalRows = confirmed.rows;
  await runNonCriticalTask("物流发票确认日志写入", () => writeAudit(request, actor, "确认物流发票", "logistics_bills", billId, confirmed.targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId: confirmed.documentId,
    confirmedIds: confirmed.confirmIds,
    bill: serializeLogisticsExpenseBill(finalRows),
  }));
  for (const orderId of [...new Set(confirmed.targetRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId));
  }
  invalidateWorkbenchTodosCache();
  const serializedExpenses = finalRows.map(serializeLogisticsExpense);
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: serializedExpenses,
    expense: serializedExpenses.find((row) => row.id === before.id) || serializedExpenses[0] || null,
    invoiceGroup: invoiceGroup.key,
  };
}
