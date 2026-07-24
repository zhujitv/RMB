import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { logisticsInvoiceGroupForKey } from "./logistics-invoice-groups";
import {
  codedError,
  nonEmpty,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  writeAudit,
} from "./shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED,
  type ActorLike,
  type AuditRequestLike,
} from "./logistics-invoice-validation-model";
import {
  cancelProcessingLogisticsInvoiceOcrTasks,
} from "./logistics-invoice-validation-tasks";

export async function manuallyConfirmLogisticsInvoiceValidation(
  request: AuditRequestLike,
  actor: ActorLike,
  id: string,
  input: Record<string, unknown> = {},
) {
  if (!actor?.id || !["管理员", "财务"].includes(String(actor.role || ""))) {
    throw codedError("只有管理员或财务可以人工确认物流发票校验。", 403, "LOGISTICS_INVOICE_VALIDATION_CONFIRM_DENIED");
  }
  const reason = nonEmpty(input.reason || input.manualConfirmReason);
  if (!reason) throw codedError("人工确认原因不能为空。", 400, "LOGISTICS_INVOICE_VALIDATION_CONFIRM_REASON_REQUIRED");
  const invoiceGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const { assertLogisticsBillRowsMatchHeader, loadLogisticsExpenseBillRowsForAction } = await import("./logistics-expense-workflow-core");
  const { logisticsInvoiceExpenseMatchesGroup } = await import("./logistics-invoice-groups");
  const { serializeLogisticsExpense, serializeLogisticsExpenseBill } = await import("./logistics-expense-access-serialization");
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const initialTargetRows = rows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
  const targetIds = initialTargetRows.map((row) => row.id).filter(Boolean);
  if (!targetIds.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  const before = initialTargetRows.map(serializeLogisticsExpense);
  const billId = rows[0]?.billId || id;
  const confirmedAt = new Date();
  const confirmed = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "logistics_bills"
      WHERE "id" = ${billId}
        AND "deleted_at" IS NULL
        AND "status" <> 'voided'
      FOR UPDATE
    `);
    if (locked.length !== 1) {
      throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_WORKFLOW_LOCK_FAILED");
    }
    const currentRows = await tx.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: { bill: true },
      orderBy: [{ createdAt: "asc" }],
    });
    const currentBill = currentRows[0]?.bill;
    if (!currentRows.length || !currentBill) throw codedError("物流费用账单缺少费用明细。", 409, "LOGISTICS_INVOICE_ROWS_EMPTY");
    await assertLogisticsBillRowsMatchHeader(tx, String(billId), currentRows);
    if (currentBill.auditStatus !== "审核通过") {
      throw codedError("只有审核通过的物流费用账单可以人工确认发票校验。", 400, "LOGISTICS_INVOICE_APPROVAL_REQUIRED");
    }
    if (["已付款", "部分付款", "部分已付款"].some((status) => String(currentBill.paymentStatus || "").includes(status))) {
      throw codedError("已付款账单不能人工确认发票校验。", 400, "LOGISTICS_INVOICE_VALIDATION_PAID_BLOCKED");
    }
    const targetRows = currentRows.filter((row) => logisticsInvoiceExpenseMatchesGroup(row, invoiceGroup));
    if (!targetRows.length || targetRows.some((row) => row.invoiceStatus !== "已上传" || row.invoiceConfirmedAt)) {
      throw codedError("只有已上传且尚未确认的发票可以人工确认校验。", 400, "LOGISTICS_INVOICE_VALIDATION_STATE_INVALID");
    }
    const currentTargetIds = targetRows.map((row) => row.id).filter(Boolean);
    const documentIds = [...new Set(targetRows.map((row) => nonEmpty(row.invoiceDocumentId)).filter(Boolean))];
    if (documentIds.length !== 1 || targetRows.some((row) => row.invoiceDocumentId !== documentIds[0])) {
      throw codedError("发票分组文件关联不一致，请重新上传。", 409, "LOGISTICS_INVOICE_DOCUMENT_SCOPE_INVALID");
    }
    const document = await tx.orderDocument.findFirst({
      where: {
        id: documentIds[0],
        deletedAt: null,
        uploadStatus: "SUCCESS",
        documentType: "SUPPLIER_INVOICE",
        relatedModule: "SUPPLIER",
        orderId: targetRows[0].orderId,
        supplierId: targetRows[0].supplierId,
        mimeType: "application/pdf",
        fileSize: { gt: 0 },
        storageKey: { not: "" },
      },
      select: { id: true },
    });
    if (!document) throw codedError("发票文件不存在、已删除或关联错误。", 409, "LOGISTICS_INVOICE_DOCUMENT_INVALID");
    for (const documentId of documentIds) {
      await cancelProcessingLogisticsInvoiceOcrTasks({
        documentId,
        rowIds: currentTargetIds,
        reason: "已人工确认通过，旧识别任务已取消。",
      }, tx);
    }
    const updated = await tx.logisticsExpense.updateMany({
      where: {
        id: { in: currentTargetIds },
        deletedAt: null,
        invoiceStatus: "已上传",
        invoiceConfirmedAt: null,
        invoiceDocumentId: documentIds[0],
      },
      data: {
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED,
        invoiceValidationMessage: reason,
        invoiceManualConfirmedById: actor.id,
        invoiceManualConfirmedAt: confirmedAt,
        invoiceManualConfirmReason: reason,
        updatedById: actor.id,
      },
    });
    if (updated.count !== currentTargetIds.length) {
      throw codedError("发票状态已变化，请刷新后重试。", 409, "LOGISTICS_INVOICE_VALIDATION_STATE_CHANGED");
    }
    return { rows: targetRows, targetIds: currentTargetIds };
  });
  await runNonCriticalTask("物流发票校验人工确认日志写入", () => writeAudit(request, actor, "人工确认物流发票校验", "logistics_bills", billId, before, {
    invoiceGroup: invoiceGroup.key,
    reason,
    confirmedAt,
    rowIds: confirmed.targetIds,
  }));
  for (const orderId of [...new Set(confirmed.rows.map((row) => row.orderId).filter(Boolean))]) {
    scheduleTaxRefundCompletenessRefresh(String(orderId), "物流发票校验人工确认后退税完整度刷新");
  }
  invalidateWorkbenchTodosCache();
  const reloadedRows = await runNonCriticalTask(
    "物流发票人工校验后重新读取账单",
    () => loadLogisticsExpenseBillRowsForAction(id, actor),
    { context: { billId, invoiceGroup: invoiceGroup.key } },
  );
  const fallbackRows = rows.map((row) => (
    confirmed.targetIds.includes(row.id)
      ? {
          ...row,
          invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_MANUAL_PASSED,
          invoiceValidationMessage: reason,
          invoiceManualConfirmedById: actor.id,
          invoiceManualConfirmedAt: confirmedAt,
          invoiceManualConfirmReason: reason,
        }
      : row
  ));
  const finalRows = Array.isArray(reloadedRows) && reloadedRows.length ? reloadedRows : fallbackRows;
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}
