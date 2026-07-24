import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  FILE_ASSET_SOURCE_TABLES,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
  codedError,
  dateFromInput,
  deleteManagedStoredFile,
  nonEmpty,
  optional,
  permissionError,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  softDeleteFileAssetBySource,
  writeAudit,
} from "./shared";
import {
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  assertCanConfirmLogisticsInvoice,
  assertCanReverseLogisticsPayment,
  canUploadLogisticsExpenseInvoice,
  createLogisticsInvoiceDocument,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { logisticsCostPaymentDataForStatus } from "./logistics-expense-cost-payment";
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
  summarizeInvoiceValidationBlockReason,
} from "./logistics-invoice-validation";
import { canMarkLogisticsBillPaid, canReverseLogisticsBillPayment, canUploadLogisticsBillInvoice, isVoidedLogisticsBill } from "./logistics-bill-state-machine";
import { assertCanDeleteLogisticsInvoiceFile } from "./file-delete-policy";
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
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { syncApprovedLogisticsExpenseCosts } from "./logistics-expense-workflow-review-helpers";
import {
  assertNoSettledLogisticsCostConflict,
  syncLogisticsExpenseCostInvoiceStatus,
} from "./logistics-expense-cost-safety";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";

function assertLogisticsBillNotVoided(rows: LogisticsExpenseRow[] = [], message = "该物流费用账单已作废，仅允许查看详情和操作日志。") {
  if (rows.some((row) => isVoidedLogisticsBill({ status: rowBillStatus(row) }))) {
    throw codedError(message, 400, "LOGISTICS_BILL_VOIDED_ACTION_BLOCKED");
  }
}

function paymentStatusUpdateAfterInvoiceProgress(billRows: LogisticsExpenseRow[]) {
		const billAuditStatus = aggregateLogisticsExpenseStatus(billRows, "auditStatus");
		const billInvoiceStatus = aggregateLogisticsExpenseInvoiceStatus(billRows);
		const billPaymentStatus = aggregateLogisticsExpenseStatus(billRows, "paymentStatus");
		if (billAuditStatus !== "审核通过" || ["已付款", "部分付款", "部分已付款"].includes(billPaymentStatus)) return {};
		return ["已确认", "已确认发票"].includes(billInvoiceStatus)
			? { paymentStatus: "待付款" }
			: { paymentStatus: "待开票" };
}

async function assertActiveLogisticsInvoiceDocuments(
  tx: Prisma.TransactionClient | typeof prisma,
  rows: LogisticsExpenseRow[] = [],
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

async function assertLogisticsInvoiceDocumentNotReusedOutsideRows(
  tx: Prisma.TransactionClient | typeof prisma,
  documentId: string,
  allowedRows: LogisticsExpenseRow[] = [],
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

function assertLogisticsInvoiceRowsConfirmed(rows: LogisticsExpenseRow[] = []) {
  const groupByDocumentId = new Map<string, string>();
  for (const row of rows) {
    const confirmedById = nonEmpty(row.invoiceConfirmedById || row.invoiceConfirmedBy?.id);
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

export async function confirmLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
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
      include: includeLogisticsExpenseRelations(),
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
      include: includeLogisticsExpenseRelations(),
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

export async function updateLogisticsExpensePaymentStatus(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const billRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  if (!billRows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  assertLogisticsBillNotVoided(billRows);
  const before = billRows[0];
  const paymentStatus = nonEmpty(input.paymentStatus || input.status || "已付款");
  if (!LOGISTICS_EXPENSE_PAYMENT_STATUSES.includes(paymentStatus)) {
    throw codedError("请选择有效付款状态。", 400, "LOGISTICS_PAYMENT_STATUS_INVALID");
  }
  if (paymentStatus !== "已付款") {
    throw codedError("待付款状态只能在发票全部确认后由系统自动生成。", 400, "LOGISTICS_PAYMENT_STATUS_MANAGED");
  }
  const billAuditStatus = aggregateLogisticsExpenseStatus(billRows, "auditStatus");
  const billInvoiceStatus = aggregateLogisticsExpenseInvoiceStatus(billRows);
  const billPaymentStatus = aggregateLogisticsExpenseStatus(billRows, "paymentStatus");
  if (billPaymentStatus === "已付款") {
    throw codedError("该物流费用账单已付款，不能重复标记。", 400, "LOGISTICS_PAYMENT_ALREADY_PAID");
  }
  if (!canMarkLogisticsBillPaid({
    auditStatus: billAuditStatus,
    invoiceStatus: billInvoiceStatus,
    paymentStatus: billPaymentStatus,
    status: rowBillStatus(before),
  })) {
    throw codedError("需审核通过、发票全部确认且状态为待付款后才可标记付款。", 400, "LOGISTICS_PAYMENT_STATE_INVALID");
  }
  const blockReason = summarizeInvoiceValidationBlockReason(billRows);
  if (blockReason) {
    throw codedError(blockReason, 400, "LOGISTICS_INVOICE_VALIDATION_BLOCKED");
  }
  const paymentDate = dateFromInput(input.paymentDate || input.paidAt || input.paidDate);
  if (!paymentDate) {
    throw codedError("标记已付款时必须填写付款时间。", 400, "LOGISTICS_PAYMENT_DATE_REQUIRED");
  }
  const billId = rowBillId(before);
  const orderId = nonEmpty(before.orderId);
  const savedRows = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，不能再修改物流费用付款状态。",
    );
    await lockLogisticsBillForWorkflow(tx, billId);
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!currentRows.length) {
      throw codedError("物流费用账单缺少费用明细，不能同步付款。", 409, "LOGISTICS_PAYMENT_ROWS_EMPTY");
    }
    await assertLogisticsBillRowsMatchHeader(tx, billId, currentRows);
    assertLogisticsBillNotVoided(currentRows);
    assertLogisticsInvoiceRowsConfirmed(currentRows);
    await assertActiveLogisticsInvoiceDocuments(tx, currentRows);
    const currentAuditStatus = aggregateLogisticsExpenseStatus(currentRows, "auditStatus");
    const currentInvoiceStatus = aggregateLogisticsExpenseInvoiceStatus(currentRows);
    const currentPaymentStatus = aggregateLogisticsExpenseStatus(currentRows, "paymentStatus");
    if (!canMarkLogisticsBillPaid({
      auditStatus: currentAuditStatus,
      invoiceStatus: currentInvoiceStatus,
      paymentStatus: currentPaymentStatus,
      status: rowBillStatus(currentRows[0]),
    })) {
      throw codedError("账单状态已变化，需审核通过、发票全部确认且状态为待付款后才可标记付款。", 409, "LOGISTICS_PAYMENT_STATE_CHANGED");
    }
    const currentBlockReason = summarizeInvoiceValidationBlockReason(currentRows);
    if (currentBlockReason) {
      throw codedError(currentBlockReason, 400, "LOGISTICS_INVOICE_VALIDATION_BLOCKED");
    }
    if (currentAuditStatus !== "审核通过") {
      throw codedError("物流费用尚未审核通过，不能同步成本付款状态。", 400, "LOGISTICS_COST_SYNC_AUDIT_REQUIRED");
    }
    await assertNoSettledLogisticsCostConflict(tx, currentRows);
    const costLinks = await syncApprovedLogisticsExpenseCosts(tx, currentRows, actor, {
      settledCostMode: "preserve-existing",
      allowCommissionSettled: true,
      orderLocksAlreadyHeld: true,
      expectedOrderIds: [orderId],
    });
    const costIds = [...new Set(costLinks.map((link) => nonEmpty(link.costId)).filter(Boolean))];
    if (costIds.length !== currentRows.length) {
      throw codedError("物流费用未完整生成对应成本，付款状态未更新。", 409, "LOGISTICS_COST_SYNC_INCOMPLETE");
    }
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: "voided" },
        auditStatus: "审核通过",
        invoiceStatus: { in: ["已确认", "已确认发票"] },
        paymentStatus: "待付款",
      },
      data: {
        paymentStatus,
        paymentDate,
        invoiceStatus: currentInvoiceStatus,
        updatedById: actorId(actor) || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("物流费用账单状态已变化，付款和成本同步已取消。", 409, "LOGISTICS_PAYMENT_BILL_CHANGED");
    }
    const costPaymentData = logisticsCostPaymentDataForStatus(paymentStatus, paymentDate);
    const costUpdate = await tx.orderCost.updateMany({
      where: {
        id: { in: costIds },
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        sourceType: { in: LOGISTICS_GENERATED_COST_SOURCE_TYPES },
      },
      data: {
        paymentStatus: costPaymentData.paymentStatus,
        paid: costPaymentData.paid,
        paidAt: costPaymentData.paidAt,
        paymentDate: costPaymentData.paymentDate,
      },
    });
    if (costUpdate.count !== costIds.length) {
      throw codedError("成本付款状态同步不完整，物流付款已取消，请重试。", 409, "LOGISTICS_COST_PAYMENT_SYNC_INCOMPLETE");
    }
    const rows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (rows.length !== currentRows.length) {
      throw codedError("物流费用明细状态已变化，付款和成本同步已取消。", 409, "LOGISTICS_PAYMENT_ROWS_CHANGED");
    }
    return rows;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  void runNonCriticalTask("物流付款状态日志写入", () => writeAudit(request, actor, "更新物流费用付款状态", "logistics_bills", billId, billRows.map(serializeLogisticsExpense), savedRows.map(serializeLogisticsExpense)), { context: { billId } });
  invalidateWorkbenchTodosCache();
  const serializedExpenses = savedRows.map(serializeLogisticsExpense);
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: serializedExpenses,
    expense: serializedExpenses.find((row) => row.id === before.id) || serializedExpenses[0] || null,
  };
}

export async function reverseLogisticsExpensePayment(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanReverseLogisticsPayment(actor);
  const reason = optional(input.reason || input.correctionReason || input.reversalReason);
  if (!reason) {
    throw codedError("付款更正必须填写冲销原因。", 400, "LOGISTICS_PAYMENT_REVERSAL_REASON_REQUIRED");
  }
  const billRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  if (!billRows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  assertLogisticsBillNotVoided(billRows);
  const billId = rowBillId(billRows[0]);
  const orderId = nonEmpty(billRows[0]?.orderId);
  const reversedAt = new Date();
  const savedRows = await prisma.$transaction(async (tx) => {
    await assertBusinessOrderWritableInTransaction(
      tx,
      orderId,
      "该订单已提交退税并归档，不能冲销物流费用付款。",
    );
    await lockLogisticsBillForWorkflow(tx, billId);
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!currentRows.length) {
      throw codedError("物流费用账单缺少费用明细，不能冲销付款。", 409, "LOGISTICS_PAYMENT_REVERSAL_ROWS_EMPTY");
    }
    await assertLogisticsBillRowsMatchHeader(tx, billId, currentRows);
    assertLogisticsBillNotVoided(currentRows);
    const auditStatus = aggregateLogisticsExpenseStatus(currentRows, "auditStatus");
    const paymentStatus = aggregateLogisticsExpenseStatus(currentRows, "paymentStatus");
    if (!canReverseLogisticsBillPayment({
      auditStatus,
      paymentStatus,
      status: rowBillStatus(currentRows[0]),
    })) {
      throw codedError("只有审核通过且已付款的物流费用账单可以冲销付款。", 409, "LOGISTICS_PAYMENT_REVERSAL_STATE_INVALID");
    }
    const costLinks = await syncApprovedLogisticsExpenseCosts(tx, currentRows, actor, {
      settledCostMode: "preserve-required",
      allowCommissionSettled: true,
      orderLocksAlreadyHeld: true,
      expectedOrderIds: [orderId],
    });
    const costIds = [...new Set(costLinks.map((link) => nonEmpty(link.costId)).filter(Boolean))];
    if (costIds.length !== currentRows.length) {
      throw codedError("物流费用未完整关联成本，付款冲销已取消。", 409, "LOGISTICS_PAYMENT_REVERSAL_COST_LINK_INCOMPLETE");
    }
    const billUpdate = await tx.logisticsBill.updateMany({
      where: {
        id: billId,
        deletedAt: null,
        status: { not: "voided" },
        paymentStatus: "已付款",
      },
      data: {
        paymentStatus: "待付款",
        paymentDate: null,
        updatedById: actorId(actor) || null,
      },
    });
    if (billUpdate.count !== 1) {
      throw codedError("物流费用付款状态已变化，冲销已取消，请刷新后重试。", 409, "LOGISTICS_PAYMENT_REVERSAL_BILL_CHANGED");
    }
    const costUpdate = await tx.orderCost.updateMany({
      where: {
        id: { in: costIds },
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        sourceType: { in: LOGISTICS_GENERATED_COST_SOURCE_TYPES },
      },
      data: {
        paymentStatus: "待支付",
        paid: false,
        paidAt: null,
        paymentDate: null,
        updatedById: actorId(actor) || null,
      },
    });
    if (costUpdate.count !== costIds.length) {
      throw codedError("成本付款冲销不完整，物流付款冲销已取消。", 409, "LOGISTICS_PAYMENT_REVERSAL_COST_SYNC_INCOMPLETE");
    }
    await writeAudit(
      request,
      actor,
      "冲销物流费用付款",
      "logistics_bills",
      billId,
      {
        paymentStatus,
        paymentDate: currentRows[0]?.bill?.paymentDate || null,
        costs: currentRows.map((row) => ({ id: row.costId || row.cost?.id || null, paymentStatus: row.cost?.paymentStatus || null })),
      },
      {
        paymentStatus: "待付款",
        paymentDate: null,
        costIds,
        costPaymentStatus: "待支付",
        reason,
        reversedAt,
      },
      tx,
    );
    const rows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (rows.length !== currentRows.length) {
      throw codedError("物流费用明细状态已变化，付款冲销已取消。", 409, "LOGISTICS_PAYMENT_REVERSAL_ROWS_CHANGED");
    }
    return rows;
  }, LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS);
  invalidateWorkbenchTodosCache();
  const serializedExpenses = savedRows.map(serializeLogisticsExpense);
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: serializedExpenses,
    expense: serializedExpenses.find((row) => row.id === billRows[0]?.id) || serializedExpenses[0] || null,
  };
}
