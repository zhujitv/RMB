import { prisma } from "../prisma";
import {
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
  codedError,
  dateFromInput,
  nonEmpty,
  permissionError,
  runNonCriticalTask,
  writeAudit,
} from "./shared";
import {
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
  aggregateLogisticsExpenseInvoiceStatus,
  aggregateLogisticsExpenseStatus,
  assertCanConfirmLogisticsInvoice,
  includeLogisticsExpenseRelations,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
} from "./logistics-expense-shared";
import { logisticsCostPaymentDataForStatus } from "./logistics-expense-cost-payment";
import { summarizeInvoiceValidationBlockReason } from "./logistics-invoice-validation";
import { canMarkLogisticsBillPaid } from "./logistics-bill-state-machine";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS,
  actorId,
  assertLogisticsBillRowsMatchHeader,
  loadLogisticsExpenseBillRowsForAction,
  lockLogisticsBillForWorkflow,
  rowBillId,
  rowBillStatus,
  type ActorContext,
  type AuditRequestLike,
  type UnknownRecord,
} from "./logistics-expense-workflow-core";
import { syncApprovedLogisticsExpenseCosts } from "./logistics-expense-workflow-review-helpers";
import { assertNoSettledLogisticsCostConflict } from "./logistics-expense-cost-safety";
import { lockBusinessOrderForUpdate } from "./business-archive";
import {
  assertLogisticsBillNotVoided,
  assertActiveLogisticsInvoiceDocuments,
  assertLogisticsInvoiceRowsConfirmed,
} from "./logistics-expense-invoice-guards";

export async function updateLogisticsExpensePaymentStatus(request: AuditRequestLike, actor: ActorContext, id: string, input: UnknownRecord = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const billRows = await loadLogisticsExpenseBillRowsForAction(id, actor, { allowArchivedPayment: true });
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
    await lockBusinessOrderForUpdate(tx, orderId);
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
