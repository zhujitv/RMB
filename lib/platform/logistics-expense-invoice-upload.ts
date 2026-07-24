import { prisma } from "../prisma";
import {
  FILE_ASSET_SOURCE_TABLES,
  codedError,
  deleteManagedStoredFile,
  nonEmpty,
  permissionError,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  softDeleteFileAssetBySource,
  writeAudit,
} from "./shared";
import {
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  canUploadLogisticsExpenseInvoice,
  createLogisticsInvoiceDocument,
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
import { createLogisticsInvoiceRecognitionTask } from "./logistics-invoice-validation";
import { canUploadLogisticsBillInvoice } from "./logistics-bill-state-machine";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  assertLogisticsBillRowsMatchHeader,
  loadLogisticsExpenseBillRowsForAction,
  lockLogisticsBillForWorkflow,
  rowAuditStatus,
  rowBillId,
  rowBillStatus,
  type ActorContext,
  type AuditRequestLike,
  type FormDataLike,
  type LogisticsExpenseRow,
} from "./logistics-expense-workflow-core";
import {
  assertNoSettledLogisticsCostConflict,
  syncLogisticsExpenseCostInvoiceStatus,
} from "./logistics-expense-cost-safety";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  assertLogisticsBillNotVoided,
  paymentStatusUpdateAfterInvoiceProgress,
} from "./logistics-expense-invoice-guards";

export async function uploadLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, formData: FormDataLike) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (!canUploadLogisticsBillInvoice({ auditStatus: rowAuditStatus(before), status: rowBillStatus(before) })) {
    throw codedError("只有审核通过的物流费用账单可以上传发票。", 400, "LOGISTICS_EXPENSE_NOT_READY_FOR_INVOICE");
  }
  if (!canUploadLogisticsExpenseInvoice(actor, before)) throw permissionError("无权限上传该物流费用发票", 403);
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  assertLogisticsBillNotVoided(rows);
  const requestedGroup = logisticsInvoiceGroupForKey(formData.get("invoiceGroup") || formData.get("invoiceGroupKey"));
  const fallbackGroup = logisticsInvoiceGroupForExpense(before);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const targetRows = rows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
  const groupViolation = targetRows.map((row) => logisticsInvoiceGroupCurrencyViolation(row, invoiceGroup)).find(Boolean);
  if (groupViolation) throw codedError(groupViolation, 400, "LOGISTICS_INVOICE_GROUP_CURRENCY_INVALID");
  if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用，不能上传该分组发票。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  const mixedCurrencyViolation = logisticsInvoiceGroupMixedCurrencyViolation(targetRows, invoiceGroup);
  if (mixedCurrencyViolation) throw codedError(mixedCurrencyViolation, 400, "LOGISTICS_INVOICE_GROUP_MIXED_CURRENCY");
  const blocked = targetRows.find((row) => !canUploadLogisticsBillInvoice({ auditStatus: rowAuditStatus(row), status: rowBillStatus(row) }));
  if (blocked) throw codedError("该发票分组包含尚未审核通过的费用，不能上传发票。", 400, "LOGISTICS_EXPENSE_INVOICE_UPLOAD_STATUS_BLOCKED");
  const file = formData.get("file");
  if (!file || typeof file !== "object" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    throw codedError("请上传发票文件。", 400, "INVOICE_FILE_REQUIRED");
  }
  const document = await createLogisticsInvoiceDocument(request, actor, before, file, {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
  });
  const uploadedAt = new Date();
  const billId = rowBillId(before);
  let targetIds: string[] = [];
  let ocrTaskId = "";
  let savedRows: LogisticsExpenseRow[] = [];
  try {
    savedRows = await prisma.$transaction(async (tx) => {
      await assertBusinessOrderWritableInTransaction(
        tx,
        nonEmpty(before.orderId),
        "该订单已提交退税并归档，不能上传物流费用发票。",
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
        throw codedError("只有审核通过的物流费用账单可以上传发票。", 400, "LOGISTICS_EXPENSE_NOT_READY_FOR_INVOICE");
      }
      const currentTargetRows = currentRows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
      if (!currentTargetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用，不能上传该分组发票。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
      const currentGroupViolation = currentTargetRows.map((row) => logisticsInvoiceGroupCurrencyViolation(row, invoiceGroup)).find(Boolean);
      if (currentGroupViolation) throw codedError(currentGroupViolation, 400, "LOGISTICS_INVOICE_GROUP_CURRENCY_INVALID");
      const currentMixedCurrencyViolation = logisticsInvoiceGroupMixedCurrencyViolation(currentTargetRows, invoiceGroup);
      if (currentMixedCurrencyViolation) throw codedError(currentMixedCurrencyViolation, 400, "LOGISTICS_INVOICE_GROUP_MIXED_CURRENCY");
      if (currentTargetRows.some((row) => row.invoiceDocumentId || ["已上传", "已确认"].includes(nonEmpty(row.invoiceStatus)))) {
        throw codedError("该发票分组已上传或已确认，请刷新后重试。", 409, "LOGISTICS_INVOICE_GROUP_ALREADY_UPLOADED");
      }
      await assertNoSettledLogisticsCostConflict(tx, currentRows);
      targetIds = currentTargetRows.map((row) => row.id).filter(Boolean);
      const expenseUpdate = await tx.logisticsExpense.updateMany({
        where: {
          id: { in: targetIds },
          deletedAt: null,
          invoiceDocumentId: null,
          invoiceStatus: { notIn: ["已上传", "已确认"] },
        },
        data: {
          invoiceDocumentId: document.id,
          invoiceStatus: "已上传",
          invoiceValidationStatus: "识别中",
          invoiceValidationMessage: null,
          invoiceNotificationError: null,
          invoiceUploadedById: actorId(actor),
          invoiceUploadedAt: uploadedAt,
          updatedById: actorId(actor),
        },
      });
      if (expenseUpdate.count !== targetIds.length) {
        throw codedError("发票分组费用状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_GROUP_CHANGED");
      }
      await syncLogisticsExpenseCostInvoiceStatus(tx, currentTargetRows, "已收到", actorId(actor));
      const projectedRows = currentRows.map((row) => (
        targetIds.includes(row.id)
          ? { ...row, invoiceDocumentId: document.id, invoiceDocument: document, invoiceStatus: "已上传" }
          : row
      ));
      const billUpdate = await tx.logisticsBill.updateMany({
        where: { id: billId, deletedAt: null, status: { not: "voided" }, auditStatus: "审核通过" },
        data: {
          invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(projectedRows),
          ...paymentStatusUpdateAfterInvoiceProgress(projectedRows),
          updatedById: actorId(actor) || null,
        },
      });
      if (billUpdate.count !== 1) {
        throw codedError("账单状态已变化，发票上传已取消，请刷新后重试。", 409, "LOGISTICS_INVOICE_UPLOAD_BILL_CHANGED");
      }
      const task = await createLogisticsInvoiceRecognitionTask({
        documentId: document.id,
        invoiceGroupKey: invoiceGroup.key,
        rows: currentTargetRows.map((row) => ({
          ...row,
          invoiceDocumentId: document.id,
          invoiceStatus: "已上传",
          invoiceValidationStatus: "识别中",
        })),
        actor,
      }, tx);
      ocrTaskId = task.id;
      return tx.logisticsExpense.findMany({
        where: { billId, deletedAt: null },
        include: includeLogisticsExpenseRelations(),
        orderBy: [{ createdAt: "asc" }],
      });
    }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  } catch (error: unknown) {
    await prisma.$transaction(async (tx) => {
      await tx.orderDocument.update({ where: { id: document.id }, data: { deletedAt: new Date() } }).catch(() => null);
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
        document.id,
        String(document.documentType || "SUPPLIER_INVOICE"),
        new Date(),
      ).catch(() => null);
    }).catch(() => null);
    if (document.storageKey) await deleteManagedStoredFile(document.storageKey).catch(() => null);
    throw error;
  }
  await runNonCriticalTask("物流发票上传状态日志写入", () => writeAudit(request, actor, "提交物流分组发票", "logistics_bills", rowBillId(before), targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId: document.id,
    updatedIds: targetIds,
  }));
  for (const orderId of [...new Set(savedRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId));
  }
  invalidateWorkbenchTodosCache();
  const reloadedRows = await runNonCriticalTask(
    "物流发票上传后重新读取账单",
    () => loadLogisticsExpenseBillRowsForAction(id, actor),
    { context: { billId, documentId: document.id } },
  );
  const finalRows = Array.isArray(reloadedRows) && reloadedRows.length ? reloadedRows : savedRows;
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
    ...(ocrTaskId ? { ocr: { status: "QUEUED", message: "发票已上传，系统将自动识别。", taskId: ocrTaskId } } : {}),
  };
}
