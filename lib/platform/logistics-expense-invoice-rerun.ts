import { prisma } from "../prisma";
import {
  codedError,
  nonEmpty,
  optional,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import {
  aggregateLogisticsExpenseStatus,
  assertCanConfirmLogisticsInvoice,
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
  logisticsInvoiceGroupMixedCurrencyViolation,
} from "./logistics-invoice-groups";
import {
  createLogisticsInvoiceRecognitionTask,
  logisticsInvoiceOcrApiResult,
  runLogisticsInvoiceOcrTaskWithTimeout,
} from "./logistics-invoice-validation";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  assertLogisticsBillRowsMatchHeader,
  loadLogisticsExpenseBillRowsForAction,
  lockLogisticsBillForWorkflow,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { assertNoSettledLogisticsCostConflict } from "./logistics-expense-cost-safety";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  assertLogisticsBillNotVoided,
  assertActiveLogisticsInvoiceDocuments,
} from "./logistics-expense-invoice-guards";

export async function rerunLogisticsExpenseInvoiceRecognition(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  const requestedGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  const fallbackGroup = logisticsInvoiceGroupForExpense(before);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const billId = rowBillId(before);
  const reserved = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      nonEmpty(before.orderId),
      "该订单已提交退税并归档，不能重新识别物流费用发票。",
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
    if (aggregateLogisticsExpenseStatus(currentRows, "auditStatus") !== "审核通过") {
      throw codedError("只有审核通过的物流费用账单可以识别发票。", 400, "LOGISTICS_INVOICE_APPROVAL_REQUIRED");
    }
    const paymentStatus = aggregateLogisticsExpenseStatus(currentRows, "paymentStatus");
    if (["已付款", "部分付款", "部分已付款"].some((status) => paymentStatus.includes(status))) {
      throw codedError("已付款账单不能重新识别发票。", 400, "LOGISTICS_INVOICE_RECOGNITION_PAID_BLOCKED");
    }
    const targetRows = currentRows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
    const groupViolation = targetRows.map((row) => logisticsInvoiceGroupCurrencyViolation(row, invoiceGroup)).find(Boolean);
    if (groupViolation) throw codedError(groupViolation, 400, "LOGISTICS_INVOICE_GROUP_CURRENCY_INVALID");
    if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
    const mixedCurrencyViolation = logisticsInvoiceGroupMixedCurrencyViolation(targetRows, invoiceGroup);
    if (mixedCurrencyViolation) throw codedError(mixedCurrencyViolation, 400, "LOGISTICS_INVOICE_GROUP_MIXED_CURRENCY");
    if (targetRows.some((row) => row.invoiceStatus !== "已上传" || row.invoiceConfirmedAt)) {
      throw codedError("只有已上传且尚未确认的发票可以重新识别。", 400, "LOGISTICS_INVOICE_RECOGNITION_STATE_INVALID");
    }
    await assertNoSettledLogisticsCostConflict(tx, currentRows);
    const documentId = optional(input.documentId) || targetRows.find((row) => row.invoiceDocumentId)?.invoiceDocumentId || "";
    if (!documentId || targetRows.some((row) => row.invoiceDocumentId !== documentId)) {
      throw codedError("发票分组文件关联不一致，请重新上传。", 409, "LOGISTICS_INVOICE_DOCUMENT_SCOPE_INVALID");
    }
    await assertActiveLogisticsInvoiceDocuments(tx, targetRows);
    const targetIds = targetRows.map((row) => row.id).filter(Boolean);
    const reservation = await tx.logisticsExpense.updateMany({
      where: {
        id: { in: targetIds },
        deletedAt: null,
        invoiceDocumentId: documentId,
        invoiceStatus: "已上传",
        invoiceConfirmedAt: null,
      },
      data: {
        invoiceValidationStatus: "识别中",
        invoiceValidationMessage: null,
        updatedById: actorId(actor),
      },
    });
    if (reservation.count !== targetIds.length) {
      throw codedError("发票状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_RECOGNITION_STATE_CHANGED");
    }
    const ocrTask = await createLogisticsInvoiceRecognitionTask({
      documentId,
      invoiceGroupKey: invoiceGroup.key,
      rows: targetRows,
      actor,
    }, tx);
    return {
      targetRows,
      targetIds,
      documentId,
      ocrTask,
      fallbackRows: currentRows.map((row) => (
        targetIds.includes(row.id)
          ? {
              ...row,
              invoiceValidationStatus: "识别中",
              invoiceValidationMessage: null,
              invoiceOcrTaskId: ocrTask.id,
            }
          : row
      )),
    };
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  const ocrTaskResult = await runLogisticsInvoiceOcrTaskWithTimeout(reserved.ocrTask.id);
  const ocrResult = logisticsInvoiceOcrApiResult(ocrTaskResult);
  await runNonCriticalTask("物流发票重新识别日志写入", () => writeAudit(request, actor, "重新识别物流分组发票", "logistics_bills", billId, reserved.targetRows.map(serializeLogisticsExpense), {
    invoiceGroupKey: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId: reserved.documentId,
    taskId: reserved.ocrTask.id,
    rowIds: reserved.targetIds,
  }));
  for (const orderId of [...new Set(reserved.targetRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId), "物流发票重新识别后退税完整度刷新");
  }
  invalidateWorkbenchTodosCache();
  const reloadedRows = await runNonCriticalTask(
    "物流发票重新识别后读取账单",
    () => loadLogisticsExpenseBillRowsForAction(id, actor),
    { context: { billId, taskId: reserved.ocrTask.id } },
  );
  const finalRows = Array.isArray(reloadedRows) && reloadedRows.length ? reloadedRows : reserved.fallbackRows;
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
    ...ocrResult,
    ocrTask: ocrTaskResult,
  };
}
