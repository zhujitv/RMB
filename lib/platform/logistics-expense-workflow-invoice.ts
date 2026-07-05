import { prisma } from "../prisma";
import {
  FILE_ASSET_SOURCE_TABLES,
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
} from "./logistics-invoice-groups";
import { canMarkLogisticsBillPaid, canUploadLogisticsBillInvoice } from "./logistics-bill-state-machine";
import { assertCanDeleteLogisticsInvoiceFile } from "./file-delete-policy";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  actorId,
  loadLogisticsExpenseBillRowsForAction,
  refreshLogisticsBillWorkflowStatus,
  rowAuditStatus,
  rowBillId,
  type ActorContext,
  type AuditRequestLike,
  type FormDataLike,
  type LogisticsExpenseRow,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";

function paymentStatusUpdateAfterInvoiceProgress(billRows: LogisticsExpenseRow[]) {
  const billInvoiceStatus = aggregateLogisticsExpenseInvoiceStatus(billRows);
  const billPaymentStatus = aggregateLogisticsExpenseStatus(billRows, "paymentStatus");
  return billPaymentStatus === "待开票"
    && ["已上传发票", "已上传", "已确认", "已确认发票"].includes(billInvoiceStatus)
    ? { paymentStatus: "待付款" }
    : {};
}

export async function uploadLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, formData: FormDataLike) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (!canUploadLogisticsBillInvoice({ auditStatus: rowAuditStatus(before) })) {
    throw codedError("只有审核通过的物流费用可以上传发票。", 400, "LOGISTICS_EXPENSE_NOT_APPROVED");
  }
  if (!canUploadLogisticsExpenseInvoice(actor, before)) throw permissionError("无权限上传该物流费用发票", 403);
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const requestedGroup = logisticsInvoiceGroupForKey(formData.get("invoiceGroup") || formData.get("invoiceGroupKey"));
  const fallbackGroup = logisticsInvoiceGroupForExpense(before);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const targetRows = rows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
  const groupViolation = targetRows.map((row) => logisticsInvoiceGroupCurrencyViolation(row, invoiceGroup)).find(Boolean);
  if (groupViolation) throw codedError(groupViolation, 400, "LOGISTICS_INVOICE_GROUP_CURRENCY_INVALID");
  if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用，不能上传该分组发票。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  const blocked = targetRows.find((row) => !canUploadLogisticsBillInvoice({ auditStatus: rowAuditStatus(row) }) || !row.costId);
  if (blocked) throw codedError("该发票分组包含尚未审核生成正式成本的费用，不能上传发票。", 400, "LOGISTICS_EXPENSE_COST_MISSING");
  const file = formData.get("file");
  if (!file || typeof file !== "object" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    throw codedError("请上传发票文件。", 400, "INVOICE_FILE_REQUIRED");
  }
  const document = await createLogisticsInvoiceDocument(request, actor, before, file, {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
  });
  const uploadedAt = new Date();
  const targetIds = targetRows.map((row) => row.id).filter(Boolean);
  const costIds = [...new Set(targetRows.map((row) => nonEmpty(row.costId)).filter(Boolean))];
  let savedRows: LogisticsExpenseRow[] = [];
  try {
    savedRows = await prisma.$transaction(async (tx) => {
      const expenseUpdate = await tx.logisticsExpense.updateMany({
        where: { id: { in: targetIds }, deletedAt: null },
        data: {
          invoiceDocumentId: document.id,
          invoiceStatus: "已上传",
          invoiceNotificationError: null,
          invoiceUploadedById: actorId(actor),
          invoiceUploadedAt: uploadedAt,
          updatedById: actorId(actor),
        },
      });
      if (expenseUpdate.count !== targetIds.length) {
        throw codedError("发票分组费用状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_GROUP_CHANGED");
      }
      if (costIds.length) {
        const costUpdate = await tx.orderCost.updateMany({
          where: { id: { in: costIds }, deletedAt: null },
          data: { invoiceStatus: "已收到" },
        });
        if (costUpdate.count !== costIds.length) {
          throw codedError("发票分组成本状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_COST_CHANGED");
        }
      }
      const rows = await tx.logisticsExpense.findMany({
        where: { id: { in: targetIds }, deletedAt: null },
        include: includeLogisticsExpenseRelations(),
        orderBy: [{ createdAt: "asc" }],
      });
      if (rows.length !== targetIds.length) {
        throw codedError("发票分组费用状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_GROUP_CHANGED");
      }
      return rows;
    });
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
    updatedIds: savedRows.map((row) => row.id),
  }));
  for (const orderId of [...new Set(savedRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId));
  }
  const billRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  await refreshLogisticsBillWorkflowStatus(billRows, actor, paymentStatusUpdateAfterInvoiceProgress(billRows));
  invalidateWorkbenchTodosCache();
  const finalRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}

export async function deleteLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  const canManageInvoice = canUploadLogisticsExpenseInvoice(actor, before);
  assertCanDeleteLogisticsInvoiceFile({ canManageInvoice, invoiceConfirmed: false });
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const currentPaymentStatus = aggregateLogisticsExpenseStatus(rows, "paymentStatus");
  if (currentPaymentStatus.includes("已付款")) {
    throw codedError("已付款账单不能删除发票。", 400, "LOGISTICS_INVOICE_PAID_DELETE_BLOCKED");
  }
  const requestedGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  const fallbackGroup = logisticsInvoiceGroupForExpense(before);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const targetRows = rows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
  const groupViolation = targetRows.map((row) => logisticsInvoiceGroupCurrencyViolation(row, invoiceGroup)).find(Boolean);
  if (groupViolation) throw codedError(groupViolation, 400, "LOGISTICS_INVOICE_GROUP_CURRENCY_INVALID");
  if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  assertCanDeleteLogisticsInvoiceFile({
    canManageInvoice,
    invoiceConfirmed: targetRows.some((row) => row.invoiceStatus === "已确认" || row.invoiceConfirmedAt),
  });
  const documentId = optional(input.documentId) || targetRows.find((row) => row.invoiceDocumentId)?.invoiceDocumentId || "";
  if (!documentId) throw codedError("当前分组没有已上传发票。", 404, "LOGISTICS_INVOICE_DOCUMENT_NOT_FOUND");
  const targetDocumentRows = targetRows.filter((row) => row.invoiceDocumentId === documentId);
  if (!targetDocumentRows.length) throw codedError("该发票文件不属于当前账单分组。", 400, "LOGISTICS_INVOICE_DOCUMENT_SCOPE_INVALID");
  const document = await prisma.orderDocument.findUnique({ where: { id: documentId } });
  if (!document || document.deletedAt) throw codedError("发票文件不存在或已删除。", 404, "LOGISTICS_INVOICE_DOCUMENT_NOT_FOUND");
  const uploadedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.orderDocument.update({
      where: { id: documentId },
      data: { deletedAt: uploadedAt },
    });
    await softDeleteFileAssetBySource(
      tx,
      FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
      documentId,
      String(document.documentType || "SUPPLIER_INVOICE"),
      uploadedAt,
    );
    for (const row of targetDocumentRows) {
      await tx.logisticsExpense.update({
        where: { id: row.id },
        data: {
          invoiceDocumentId: null,
          invoiceUploadedById: null,
          invoiceUploadedAt: null,
          invoiceStatus: row.invoiceNotifiedAt ? "已通知开票" : "待开票",
          updatedById: actorId(actor),
        },
      });
      if (row.costId) {
        await tx.orderCost.update({ where: { id: row.costId }, data: { invoiceStatus: "未收到" } }).catch(() => null);
      }
    }
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  await runNonCriticalTask("物流发票删除状态日志写入", () => writeAudit(request, actor, "删除物流分组发票", "logistics_bills", rowBillId(before), targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId,
    updatedIds: targetDocumentRows.map((row) => row.id),
  }));
  for (const orderId of [...new Set(targetDocumentRows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId));
  }
  await refreshLogisticsBillWorkflowStatus(savedRows, actor, { paymentStatus: "待开票" });
  invalidateWorkbenchTodosCache();
  const finalRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}

export async function confirmLogisticsExpenseInvoice(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (before.invoiceStatus !== "已上传") throw codedError("只有已上传发票的物流费用可以确认。", 400, "LOGISTICS_INVOICE_NOT_UPLOADED");
  if (!before.invoiceDocumentId) throw codedError("发票文件不能为空。", 400, "LOGISTICS_INVOICE_FILE_REQUIRED");
  const forceConfirmReason = optional(input.forceConfirmReason || input.reason);
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: {
      invoiceStatus: "已确认",
      invoiceConfirmedById: actorId(actor),
      invoiceConfirmedAt: new Date(),
      forceConfirmReason,
      updatedById: actorId(actor),
    },
    include: includeLogisticsExpenseRelations(),
  });
  if (before.costId) await prisma.orderCost.update({ where: { id: before.costId }, data: { invoiceStatus: "已收到" } }).catch(() => null);
  await runNonCriticalTask("物流发票确认日志写入", () => writeAudit(request, actor, "确认物流发票", "logistics_expenses", id, before, saved));
  scheduleTaxRefundCompletenessRefresh(saved.orderId);
  const billRows = await loadLogisticsExpenseBillRowsForAction(rowBillId(saved), actor);
  await refreshLogisticsBillWorkflowStatus(billRows, actor, paymentStatusUpdateAfterInvoiceProgress(billRows));
  invalidateWorkbenchTodosCache();
  const reloadedRows = await loadLogisticsExpenseBillRowsForAction(rowBillId(saved), actor);
  return serializeLogisticsExpense(reloadedRows.find((row) => row.id === saved.id) || saved);
}

export async function updateLogisticsExpensePaymentStatus(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const billRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  if (!billRows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const before = billRows[0];
  const paymentStatus = nonEmpty(input.paymentStatus || input.status || "已付款");
  if (!LOGISTICS_EXPENSE_PAYMENT_STATUSES.includes(paymentStatus)) {
    throw codedError("请选择有效付款状态。", 400, "LOGISTICS_PAYMENT_STATUS_INVALID");
  }
  const billAuditStatus = aggregateLogisticsExpenseStatus(billRows, "auditStatus");
  const billInvoiceStatus = aggregateLogisticsExpenseInvoiceStatus(billRows);
  const billPaymentStatus = aggregateLogisticsExpenseStatus(billRows, "paymentStatus");
  if (paymentStatus === "已付款" && billPaymentStatus === "已付款") {
    throw codedError("该物流费用账单已付款，不能重复标记。", 400, "LOGISTICS_PAYMENT_ALREADY_PAID");
  }
  if (paymentStatus === "已付款" && !canMarkLogisticsBillPaid({
    auditStatus: billAuditStatus,
    invoiceStatus: billInvoiceStatus,
    paymentStatus: billPaymentStatus,
  })) {
    throw codedError("需审核通过且已上传发票后才可标记付款。", 400, "LOGISTICS_PAYMENT_STATE_INVALID");
  }
  const paymentDate = paymentStatus === "已付款" ? dateFromInput(input.paymentDate || input.paidAt || input.paidDate) : null;
  if (paymentStatus === "已付款" && !paymentDate) {
    throw codedError("标记已付款时必须填写付款时间。", 400, "LOGISTICS_PAYMENT_DATE_REQUIRED");
  }
  const billId = rowBillId(before);
  await prisma.logisticsBill.update({
    where: { id: billId },
    data: { paymentStatus, paymentDate, updatedById: actorId(actor) || null },
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  const costIds = [...new Set(savedRows.map((row) => nonEmpty(row.costId)).filter(Boolean))];
  if (costIds.length) {
    await prisma.orderCost.updateMany({
      where: { id: { in: costIds } },
      data: {
        paymentStatus: paymentStatus === "已付款" ? "已支付" : "待支付",
        paymentDate,
      },
    }).catch(() => null);
  }
  const saved = savedRows.find((row) => row.id === before.id) || savedRows[0] || before;
  await runNonCriticalTask("物流付款状态日志写入", () => writeAudit(request, actor, "更新物流费用付款状态", "logistics_bills", billId, billRows.map(serializeLogisticsExpense), savedRows.map(serializeLogisticsExpense)));
  await refreshLogisticsBillWorkflowStatus(savedRows, actor, { paymentStatus, paymentDate });
  invalidateWorkbenchTodosCache();
  const reloadedRows = await loadLogisticsExpenseBillRowsForAction(billId, actor);
  return serializeLogisticsExpense(reloadedRows.find((row) => row.id === saved.id) || reloadedRows[0] || saved);
}
