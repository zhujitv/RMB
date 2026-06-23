// @ts-nocheck
import { prisma } from "../prisma";
import {
  amountCny,
  nonEmpty,
  normalizedCostType,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  requireText,
  runNonCriticalTask,
  validEmail,
  writeAudit,
  codedError,
} from "./shared";
import {
  assertCanConfirmLogisticsInvoice,
  assertCanReviewLogisticsExpense,
  assertCanWriteLogisticsExpense,
  assertLogisticsExpenseOrder,
  assertLogisticsExpenseSupplier,
  buildLogisticsExpenseData,
  canUploadLogisticsExpenseInvoice,
  createLogisticsInvoiceDocument,
  createOrUpdateCostFromLogisticsExpense,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  aggregateLogisticsExpenseStatus,
  logisticsExpenseBillId,
  logisticsExpenseAccessWhere,
  notifyLogisticsSupplierInvoice,
  notifyLogisticsSupplierInvoiceBills,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
} from "./logistics-expense-shared";
import { logisticsInvoiceGroupForCostType, logisticsInvoiceGroupForKey } from "./logistics-invoice-groups";

const LOGISTICS_EXPENSE_BILLING_METHODS = ["按柜", "按票", "按次", "按重量", "按金额比例", "手工输入"];
const DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD = "按柜";

export async function saveLogisticsExpenses(request, actor, input = {}) {
  assertCanWriteLogisticsExpense(actor);
  const order = await assertLogisticsExpenseOrder(input, actor);
  const items = Array.isArray(input.items) && input.items.length ? input.items : [input];
  const rows = [];
  for (const item of items) {
    const supplier = await assertLogisticsExpenseSupplier(actor, order, { ...input, ...item });
    const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, ...item });
    rows.push(data);
  }
  const expenses = [];
  for (const data of rows) {
    const expense = await prisma.logisticsExpense.create({ data, include: includeLogisticsExpenseRelations() });
    expenses.push(expense);
    await runNonCriticalTask("物流费用提交日志写入", () => writeAudit(request, actor, data.auditStatus === "草稿" ? "保存物流费用草稿" : "提交物流费用审核", "logistics_expenses", expense.id, null, expense));
  }
  return {
    rows: expenses.map(serializeLogisticsExpense),
    totalAmountCny: expenses.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
  };
}

export async function reviewLogisticsExpense(request, actor, id, input = {}) {
  assertCanReviewLogisticsExpense(actor);
  const action = nonEmpty(input.action || input.reviewAction || input.auditAction);
  if (!["approve", "reject", "reopen"].includes(action)) throw codedError("请选择有效审核动作。", 400, "LOGISTICS_EXPENSE_ACTION_REQUIRED");
  if (action === "reject" && !nonEmpty(input.rejectReason || input.reason)) {
    throw codedError("驳回物流费用必须填写原因。", 400, "LOGISTICS_EXPENSE_REJECT_REASON_REQUIRED");
  }
  if (action === "approve") {
    const result = await reviewLogisticsExpenseBills(request, actor, { ...input, action, ids: [id] });
    if (result.success === false) {
      throw codedError(result.message || "审核物流费用失败。", 400, "LOGISTICS_EXPENSE_REVIEW_FAILED");
    }
    const firstExpense = result.expenses[0] || result.bills[0]?.items?.[0] || null;
    return {
      expense: firstExpense || null,
      bill: result.bills[0] || null,
      emailNotified: result.emailNotified,
      emailError: result.emailError,
      emailResults: result.emailResults,
    };
  }
  if (action === "reject") {
    const result = await rejectLogisticsExpenseBill(request, actor, id, input);
    const firstExpense = result.expenses[0] || result.bill?.items?.[0] || null;
    return {
      expense: firstExpense || null,
      bill: result.bill || null,
      expenses: result.expenses,
      emailNotified: false,
      emailError: "",
    };
  }
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  if (!rows.length) throw codedError("未找到可重新打开的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const ids = rows.map((row) => row.id).filter(Boolean);
  const reviewRemark = optional(input.reviewRemark || input.remark);
  await prisma.logisticsExpense.updateMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    data: {
      auditStatus: "待审核",
      reviewedById: null,
      reviewedAt: null,
      rejectReason: null,
      reviewRemark,
      updatedById: actor.id,
    },
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  await runNonCriticalTask("物流费用审核日志写入", () => writeAudit(request, actor, "重新打开物流费用账单", "logistics_expenses", logisticsExpenseBillId(rows[0]), rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
  }));
  return {
    expense: savedRows[0] ? serializeLogisticsExpense(savedRows[0]) : null,
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    emailNotified: false,
    emailError: "",
  };
}

export async function rejectLogisticsExpenseBill(request, actor, identifier, input = {}) {
  assertCanReviewLogisticsExpense(actor);
  const rejectReason = requireText(input.rejectReason || input.reason, "驳回原因");
  const reviewRemark = optional(input.reviewRemark || input.remark);
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw codedError("未找到可驳回的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  for (const row of rows) {
    if (row.auditStatus !== "待审核") {
      throw codedError(`账单 ${row.order?.orderNo || row.orderId || ""}/${row.order?.blNo || "-"} 中存在非待审核费用，不能驳回。`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_INVALID");
    }
  }
  const now = new Date();
  const savedRows = [];
  for (const before of rows) {
    const saved = await prisma.logisticsExpense.update({
      where: { id: before.id },
      data: {
        auditStatus: "已驳回",
        invoiceStatus: "未通知",
        paymentStatus: "待开票",
        reviewedById: actor.id,
        reviewedAt: now,
        reviewRemark,
        rejectReason,
        invoiceNotifiedAt: null,
        invoiceNotificationError: null,
        updatedById: actor.id,
      },
      include: includeLogisticsExpenseRelations(),
    });
    savedRows.push(saved);
  }
  await runNonCriticalTask("物流费用账单驳回日志写入", () => writeAudit(request, actor, "驳回物流费用账单", "logistics_expenses", logisticsExpenseBillId(rows[0]), rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
    rejectReason,
    rejectedById: actor.id,
    rejectedAt: now,
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
  };
}

export async function reviewLogisticsExpenseBills(request, actor, input = {}) {
  assertCanReviewLogisticsExpense(actor);
  const action = nonEmpty(input.action || input.reviewAction || input.auditAction || "approve");
  if (action !== "approve") throw codedError("批量审核当前仅支持审核通过。", 400, "LOGISTICS_EXPENSE_BATCH_REVIEW_ACTION_INVALID");
  const identifiers = normalizeLogisticsExpenseReviewIdentifiers(input);
  if (!identifiers.length) {
    throw codedError("请选择需要审核的物流费用账单。", 400, "LOGISTICS_EXPENSE_BATCH_REVIEW_EMPTY");
  }
  const bills = [];
  const results = [];
  const seenBillIds = new Set();
  for (const identifier of identifiers) {
    try {
      const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
      if (!rows.length) throw codedError("未找到可审核的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
      const billId = logisticsExpenseBillId(rows[0]);
      if (seenBillIds.has(billId)) continue;
      seenBillIds.add(billId);
      const billAuditStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
      if (billAuditStatus !== "待审核") {
        results.push(logisticsExpenseReviewResultFromRows(rows, {
          auditStatus: billAuditStatus,
          notificationStatus: "not_sent",
          errorMessage: `账单状态不是待审核，当前状态：${billAuditStatus || "未知"}`,
        }));
        continue;
      }
      bills.push({ billId, rows });
    } catch (error) {
      results.push(logisticsExpenseReviewResultFromError(identifier, error));
    }
  }
  const reviewRemark = optional(input.reviewRemark || input.remark);
  const now = new Date();
  const approvedBills = [];
  for (const bill of bills) {
    try {
      const savedRows = await prisma.$transaction(async (tx) => {
        const billSavedRows = [];
        for (const before of bill.rows) {
          const cost = await createOrUpdateCostFromLogisticsExpense(tx, before, actor);
          const saved = await tx.logisticsExpense.update({
            where: { id: before.id },
            data: {
              auditStatus: "审核通过",
              reviewedById: actor.id,
              reviewedAt: now,
              reviewRemark,
              rejectReason: null,
              costId: cost.id,
              invoiceStatus: ["已上传", "已确认"].includes(before.invoiceStatus) ? before.invoiceStatus : "未通知",
              invoiceNotificationError: null,
              paymentStatus: "待付款",
              updatedById: actor.id,
            },
            include: includeLogisticsExpenseRelations(),
          });
          billSavedRows.push(saved);
        }
        return billSavedRows;
      });
      approvedBills.push({ ...bill, rows: savedRows });
      results.push(logisticsExpenseReviewResultFromRows(savedRows, {
        auditStatus: "审核通过",
        notificationStatus: "pending",
        errorMessage: "",
      }));
    } catch (error) {
      results.push(logisticsExpenseReviewResultFromRows(bill.rows, {
        auditStatus: aggregateLogisticsExpenseStatus(bill.rows, "auditStatus"),
        notificationStatus: "not_sent",
        errorMessage: error?.message || "数据库更新失败",
      }));
    }
  }
  const approvedRows = approvedBills.flatMap((bill) => bill.rows);
  let emailResults = [];
  let finalRows = approvedRows;
  if (approvedRows.length) {
    try {
      emailResults = await notifyLogisticsSupplierInvoiceBills(approvedRows);
    } catch (error) {
      emailResults = [logisticsExpenseNotificationFailureResult(approvedRows, error?.message || "邮件发送失败")];
    }
    try {
      finalRows = await applyLogisticsExpenseInvoiceNotificationResults(approvedRows, emailResults, actor, now);
    } catch (error) {
      const message = error?.message || "开票通知状态记录失败";
      emailResults = emailResults.length ? emailResults.map((result) => result.sent ? { ...result, sent: false, error: message } : result) : [logisticsExpenseNotificationFailureResult(approvedRows, message)];
      finalRows = approvedRows;
    }
  }
  const emailErrors = emailResults
    .filter((result) => !result.sent && !result.skipped)
    .map((result) => `${result.supplierName || "供应商"}：${result.error || "邮件发送失败"}`);
  const emailError = emailErrors.join("；");
  for (const bill of approvedBills) {
    const billRows = finalRows.filter((row) => logisticsExpenseBillId(row) === bill.billId);
    await runNonCriticalTask("物流费用批量审核日志写入", () => writeAudit(request, actor, "审核通过物流费用账单", "logistics_expenses", bill.billId, bill.rows.map(serializeLogisticsExpense), {
      bill: serializeLogisticsExpenseBill(billRows),
      emailResults,
    }));
  }
  for (const result of emailResults.filter((item) => !item.sent && !item.skipped)) {
    await runNonCriticalTask("物流费用通知失败日志写入", () => writeAudit(request, actor, "物流费用开票通知失败", "logistics_expenses", result.supplierId || "supplier", null, {
      supplierName: result.supplierName,
      errorMessage: result.error,
      expenseIds: result.expenseIds,
    }));
  }
  for (const orderId of [...new Set(finalRows.map((row) => row.orderId).filter(Boolean))]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(orderId));
  }
  markLogisticsExpenseReviewNotificationResults(results, finalRows, emailResults);
  const serializedBills = approvedBills.map((bill) => serializeLogisticsExpenseBill(finalRows.filter((row) => logisticsExpenseBillId(row) === bill.billId)));
  const successCount = results.filter((result) => result.auditStatus === "审核通过").length;
  const failedCount = results.length - successCount;
  return {
    success: successCount > 0,
    successCount,
    failedCount,
    results,
    bills: serializedBills,
    expenses: finalRows.map(serializeLogisticsExpense),
    emailResults,
    emailNotified: emailResults.some((result) => result.sent),
    emailError,
    message: logisticsExpenseReviewSummaryMessage(successCount, failedCount, results, emailError),
  };
}

function logisticsExpenseReviewResultFromRows(rows = [], overrides = {}) {
  const first = rows[0] || {};
  const order = first.order || {};
  return {
    billId: rows.length ? logisticsExpenseBillId(first) : (overrides.billId || ""),
    orderNo: order.orderNo || first.orderNo || first.orderId || "",
    blNo: order.blNo || first.blNo || first.billOfLadingNo || "-",
    auditStatus: overrides.auditStatus || aggregateLogisticsExpenseStatus(rows, "auditStatus") || "",
    notificationStatus: overrides.notificationStatus || "not_sent",
    errorMessage: overrides.errorMessage || "",
  };
}

function logisticsExpenseReviewResultFromError(identifier, error) {
  const message = error?.message || "审核物流费用失败";
  return {
    billId: nonEmpty(identifier),
    orderNo: "",
    blNo: "",
    auditStatus: "",
    notificationStatus: "not_sent",
    errorMessage: message,
  };
}

function logisticsExpenseNotificationFailureResult(rows = [], message = "邮件发送失败") {
  const first = rows[0] || {};
  return {
    supplierId: first.supplierId || "",
    supplierName: first.supplierNameSnapshot || first.supplier?.supplierName || "供应商",
    sent: false,
    error: message,
    expenseIds: rows.map((row) => row.id).filter(Boolean),
  };
}

function markLogisticsExpenseReviewNotificationResults(results = [], rows = [], emailResults = []) {
  const resultByBillId = new Map(results.map((result) => [result.billId, result]));
  for (const row of rows) {
    const billId = logisticsExpenseBillId(row);
    const result = resultByBillId.get(billId);
    if (!result || result.auditStatus !== "审核通过") continue;
    const rowEmailResults = emailResults.filter((item) => (item.expenseIds || []).includes(row.id));
    if (rowEmailResults.some((item) => item.skipped)) {
      result.notificationStatus = "skipped";
      result.errorMessage = "";
      continue;
    }
    const failed = rowEmailResults.find((item) => !item.sent);
    if (failed) {
      result.notificationStatus = "failed";
      result.errorMessage = failed.error ? `开票通知发送失败：${failed.error}` : "开票通知发送失败，可稍后重发";
      continue;
    }
    if (rowEmailResults.some((item) => item.sent)) {
      result.notificationStatus = "sent";
    }
  }
}

function logisticsExpenseReviewSummaryMessage(successCount = 0, failedCount = 0, results = [], emailError = "") {
  const failures = results.filter((result) => result.auditStatus !== "审核通过" && result.errorMessage);
  if (!successCount) {
    return failures.length
      ? failures.map((result) => `${result.orderNo || result.billId || "账单"}${result.blNo ? `/${result.blNo}` : ""}：${result.errorMessage}`).join("；")
      : "审核物流费用失败";
  }
  const parts = [`已审核 ${successCount} 票物流费用`];
  if (emailError) parts.push(`开票通知发送失败，可稍后重发：${emailError}`);
  if (failedCount) parts.push(`有 ${failedCount} 票未审核：${failures.map((result) => `${result.orderNo || result.billId || "账单"}${result.blNo ? `/${result.blNo}` : ""}：${result.errorMessage || "审核失败"}`).join("；")}`);
  return parts.join("；");
}

async function applyLogisticsExpenseInvoiceNotificationResults(rows = [], emailResults = [], actor, now = new Date()) {
  const resultByExpenseId = new Map();
  for (const result of emailResults) {
    for (const id of result.expenseIds || []) resultByExpenseId.set(id, result);
  }
  const finalRows = [];
  for (const row of rows) {
    const result = resultByExpenseId.get(row.id);
    if (!result) {
      finalRows.push(row);
      continue;
    }
    const isLockedInvoiceStatus = ["已上传", "已确认"].includes(row.invoiceStatus);
    const nextInvoiceStatus = isLockedInvoiceStatus
      ? row.invoiceStatus
      : (result.skipped ? row.invoiceStatus : (result.sent ? "已通知开票" : "通知失败"));
    const saved = await prisma.logisticsExpense.update({
      where: { id: row.id },
      data: {
        invoiceStatus: nextInvoiceStatus,
        invoiceNotifiedAt: result.sent ? now : row.invoiceNotifiedAt,
        invoiceNotificationError: result.sent || result.skipped ? null : (result.error || "邮件发送失败"),
        paymentStatus: "待付款",
        updatedById: actor.id,
      },
      include: includeLogisticsExpenseRelations(),
    });
    if (saved.costId && result.sent && !isLockedInvoiceStatus) {
      await prisma.orderCost.update({ where: { id: saved.costId }, data: { invoiceStatus: "已通知开票" } }).catch(() => null);
    }
    finalRows.push(saved);
  }
  return finalRows;
}

export async function resendLogisticsExpenseInvoiceNotice(request, actor, identifier) {
  assertCanReviewLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  if (!rows.length) throw codedError("未找到可通知开票的物流费用账单。", 404, "LOGISTICS_EXPENSE_BILL_NOT_FOUND");
  const blocked = rows.find((row) => row.auditStatus !== "审核通过");
  if (blocked) throw codedError("只有审核通过的物流费用账单可以重新发送开票通知。", 400, "LOGISTICS_EXPENSE_NOTICE_STATUS_INVALID");
  const emailResults = await notifyLogisticsSupplierInvoiceBills(rows);
  const finalRows = await applyLogisticsExpenseInvoiceNotificationResults(rows, emailResults, actor, new Date());
  const emailErrors = emailResults.filter((result) => !result.sent).map((result) => `${result.supplierName || "供应商"}：${result.error || "邮件发送失败"}`);
  const emailError = emailErrors.join("；");
  await runNonCriticalTask("物流费用开票通知重发日志写入", () => writeAudit(request, actor, "重新发送物流费用开票通知", "logistics_expenses", logisticsExpenseBillId(rows[0]), rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(finalRows),
    emailResults,
  }));
  return {
    bill: serializeLogisticsExpenseBill(finalRows),
    expenses: finalRows.map(serializeLogisticsExpense),
    emailResults,
    emailNotified: emailResults.some((result) => result.sent),
    emailError,
  };
}

export async function updateLogisticsExpense(request, actor, id, input = {}) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (input.action === "withdraw") {
    return withdrawLogisticsExpenseBill(request, actor, logisticsExpenseBillId(before));
  }
  if (input.action === "submit") {
    return submitLogisticsExpenseBill(request, actor, logisticsExpenseBillId(before));
  }
  const order = await assertLogisticsExpenseOrder({ orderId: before.orderId }, actor);
  const supplier = await assertLogisticsExpenseSupplier(actor, order, { supplierId: before.supplierId });
  const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, supplierId: before.supplierId }, before);
  const saved = await prisma.logisticsExpense.update({ where: { id }, data, include: includeLogisticsExpenseRelations() });
  await runNonCriticalTask("物流费用修改日志写入", () => writeAudit(request, actor, "修改物流费用", "logistics_expenses", id, before, saved));
  return serializeLogisticsExpense(saved);
}

export async function withdrawLogisticsExpenseBill(request, actor, identifier) {
  assertCanWriteLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const blocked = rows.find((row) => row.auditStatus !== "待审核");
  if (blocked) throw codedError("只有待审核费用可以撤回。", 400, "LOGISTICS_EXPENSE_WITHDRAW_NOT_ALLOWED");
  const ids = rows.map((row) => row.id).filter(Boolean);
  await prisma.logisticsExpense.updateMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    data: {
      auditStatus: "草稿",
      submittedAt: null,
      updatedById: actor.id,
    },
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  void runNonCriticalTask("物流费用账单撤回日志写入", () => writeAudit(request, actor, "撤回物流费用账单", "logistics_expenses", logisticsExpenseBillId(rows[0]), rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
    updatedIds: ids,
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
  };
}

export async function submitLogisticsExpenseBill(request, actor, identifier) {
  assertCanWriteLogisticsExpense(actor);
  const rows = await loadLogisticsExpenseBillRowsForSubmit(identifier, actor);
  if (!rows.length) throw permissionError("物流费用账单不存在或无权访问", 404);
  const blocked = rows.find((row) => !["草稿", "已驳回"].includes(row.auditStatus || "草稿"));
  if (blocked) {
    throw codedError("只有草稿或已驳回费用可以提交审核。", 400, "LOGISTICS_EXPENSE_SUBMIT_NOT_ALLOWED");
  }
  const submittedAt = new Date();
  const ids = rows.map((row) => row.id).filter(Boolean);
  await prisma.logisticsExpense.updateMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    data: {
      auditStatus: "待审核",
      submittedAt,
      rejectReason: null,
      invoiceNotificationError: null,
      updatedById: actor.id,
    },
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(identifier, actor);
  void runNonCriticalTask("物流费用提交审核日志写入", () => writeAudit(request, actor, "提交物流费用审核", "logistics_expenses", logisticsExpenseBillId(rows[0]), rows.map(serializeLogisticsExpense), {
    bill: serializeLogisticsExpenseBill(savedRows),
    updatedIds: ids,
    auditStatus: "待审核",
    submittedAt,
    submittedById: actor.id,
  }));
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    updatedIds: ids,
    auditStatus: "待审核",
    submittedAt: submittedAt.toISOString(),
  };
}

export async function batchUpdateLogisticsExpenses(request, actor, input = {}) {
  assertCanWriteLogisticsExpense(actor);
  const items = Array.isArray(input)
    ? input
    : (Array.isArray(input.items) ? input.items : (Array.isArray(input.rows) ? input.rows : []));
  if (!items.length) {
    throw codedError("请提供需要保存的物流费用明细。", 400, "LOGISTICS_EXPENSE_BATCH_EMPTY");
  }
  const prepared = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const id = nonEmpty(item.id);
    if (!id) {
      throw codedError(`第 ${index + 1} 行保存失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
    }
    const before = await loadLogisticsExpenseForAction(id, actor);
    const costType = before.costType || "物流费用";
    const unitAmount = Number(item.amount);
    const billingMethod = normalizeBatchBillingMethod(item, before);
    const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
    const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
	    if (!Number.isFinite(unitAmount) || unitAmount < 0) {
	      throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
	    }
	    const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
	    if (billBlockReason) {
	      throw codedError(`第 ${index + 1} 行${costType}保存失败：${billBlockReason}`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
	    }
	    const blockReason = logisticsExpenseUpdateBlockReason(before);
	    if (blockReason) {
	      throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
	    }
	    const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
	    const hasContainerType = Object.prototype.hasOwnProperty.call(item, "containerType")
	      || Object.prototype.hasOwnProperty.call(item, "container_type");
	    prepared.push({
      index,
      before,
      data: {
        amount,
        amountCny: amountCny(amount, before.exchangeRate || 1),
	        ...(hasContainerType ? { containerType: optional(item.containerType ?? item.container_type) } : {}),
	        appliedContainerCount,
	        billingMethod,
	        billingQuantity,
	        remark: optional(item.remark),
        updatedById: actor.id,
      },
    });
  }
  const savedRows = [];
  for (const item of prepared) {
    const saved = await prisma.logisticsExpense.update({
      where: { id: item.before.id },
      data: item.data,
      include: includeLogisticsExpenseRelations(),
    });
    savedRows.push(saved);
    await runNonCriticalTask("物流费用批量修改日志写入", () => writeAudit(request, actor, "批量修改物流费用明细", "logistics_expenses", item.before.id, item.before, saved));
  }
  for (const orderId of [...new Set(savedRows.map((row) => row.orderId).filter(Boolean))]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(orderId));
  }
  return savedRows.map(serializeLogisticsExpense);
}

export async function batchSaveLogisticsExpenses(request, actor, input = {}) {
  assertCanWriteLogisticsExpense(actor);
  const updates = Array.isArray(input.updates) ? input.updates : [];
  const creates = Array.isArray(input.creates) ? input.creates : [];
  const deletes = Array.isArray(input.deletes) ? input.deletes : [];
  if (!updates.length && !creates.length && !deletes.length) {
    throw codedError("请提供需要保存的物流费用明细。", 400, "LOGISTICS_EXPENSE_BATCH_SAVE_EMPTY");
  }
  const preparedUpdates = [];
  const preparedDeletes = [];
  for (let index = 0; index < updates.length; index += 1) {
    const item = updates[index] || {};
    const before = await loadLogisticsExpenseForBatchItem(item.id, actor, index);
    const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
    if (billBlockReason) {
      throw codedError(`第 ${index + 1} 行${before.costType || "物流费用"}保存失败：${billBlockReason}`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
    }
    const data = logisticsExpenseBatchUpdateData(item, before, actor, index);
    preparedUpdates.push({ before, data });
  }
  for (let index = 0; index < deletes.length; index += 1) {
    const before = await loadLogisticsExpenseForBatchItem(deletes[index], actor, index);
    const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
    if (billBlockReason) {
      throw codedError(`第 ${index + 1} 行${before.costType || "物流费用"}删除失败：${billBlockReason.replace("修改", "删除")}`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
    }
    const block = logisticsExpenseDeleteBlock(before);
    if (block) {
      throw codedError(`第 ${index + 1} 行${before.costType || "物流费用"}删除失败：${block.message}`, 400, block.code);
    }
    preparedDeletes.push(before);
  }
  const baseExpense = preparedUpdates[0]?.before || preparedDeletes[0] || await loadBatchSaveBaseExpense(input, actor);
  const order = await assertLogisticsExpenseOrder({ orderId: baseExpense.orderId }, actor);
  const supplier = await assertLogisticsExpenseSupplier(actor, order, { supplierId: baseExpense.supplierId });
  const createBillBlockReason = await logisticsExpenseBillEditBlockReason(baseExpense, actor);
  if (createBillBlockReason) {
    throw codedError(`新增费用明细失败：${createBillBlockReason}`, 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
  }
  const preparedCreates = [];
  for (let index = 0; index < creates.length; index += 1) {
    const item = creates[index] || {};
    const costType = nonEmpty(item.expenseType || item.costType);
    if (!costType) {
      throw codedError(`第 ${index + 1} 行请选择费用类型`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_COST_TYPE_REQUIRED");
    }
    const unitAmount = Number(item.amount);
    const billingMethod = normalizeBatchBillingMethod(item);
    const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
    const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
	    if (!nonEmpty(item.amount)) {
	      throw codedError(`第 ${index + 1} 行金额不能为空`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_REQUIRED");
	    }
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_INVALID");
    }
	    const blockReason = logisticsExpenseUpdateBlockReason(baseExpense);
    if (blockReason) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_STATUS_BLOCKED");
    }
	    const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
	    const data = await buildLogisticsExpenseData(order, supplier, actor, {
	      costType,
	      amount,
	      appliedContainerCount,
	      billingMethod,
	      billingQuantity,
	      currency: baseExpense.currency || "CNY",
      exchangeRate: baseExpense.exchangeRate || 1,
      exchangeRateDate: baseExpense.exchangeRateDate,
      exchangeRateSource: baseExpense.exchangeRateSource,
      exchangeRateType: baseExpense.exchangeRateType,
      remark: item.remark,
      auditStatus: ["草稿", "已驳回"].includes(baseExpense.auditStatus) ? baseExpense.auditStatus : "草稿",
      supplierId: baseExpense.supplierId,
    });
    preparedCreates.push({ data });
  }
  const savedRows = [];
  for (const item of preparedUpdates) {
    const saved = await prisma.logisticsExpense.update({
      where: { id: item.before.id },
      data: item.data,
      include: includeLogisticsExpenseRelations(),
    });
    savedRows.push(saved);
    await runNonCriticalTask("物流费用批量保存日志写入", () => writeAudit(request, actor, "批量保存物流费用明细", "logistics_expenses", item.before.id, item.before, saved));
  }
  for (const item of preparedCreates) {
    const saved = await prisma.logisticsExpense.create({
      data: item.data,
      include: includeLogisticsExpenseRelations(),
    });
    savedRows.push(saved);
    await runNonCriticalTask("物流费用批量新增日志写入", () => writeAudit(request, actor, "批量新增物流费用明细", "logistics_expenses", saved.id, null, saved));
  }
  const deletedIds = [];
  for (const before of preparedDeletes) {
    const saved = await prisma.logisticsExpense.update({
      where: { id: before.id },
      data: { deletedAt: new Date(), updatedById: actor.id },
      include: includeLogisticsExpenseRelations(),
    });
    deletedIds.push(before.id);
    await runNonCriticalTask("物流费用批量删除日志写入", () => writeAudit(request, actor, "批量删除物流费用明细", "logistics_expenses", before.id, before, saved));
  }
  const affectedOrderIds = [
    ...savedRows.map((row) => row.orderId),
    ...preparedDeletes.map((row) => row.orderId),
  ].filter(Boolean);
  for (const orderId of [...new Set(affectedOrderIds)]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(orderId));
  }
  return {
    items: savedRows.map(serializeLogisticsExpense),
    deletedIds,
  };
}

export async function deleteLogisticsExpense(request, actor, id) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  const billBlockReason = await logisticsExpenseBillEditBlockReason(before, actor);
  if (billBlockReason) throw codedError(billBlockReason.replace("修改", "删除"), 400, "LOGISTICS_EXPENSE_BILL_STATUS_BLOCKED");
  const block = logisticsExpenseDeleteBlock(before);
  if (block) throw codedError(block.message, 400, block.code);
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
    include: includeLogisticsExpenseRelations(),
  });
  await runNonCriticalTask("物流费用删除日志写入", () => writeAudit(request, actor, "删除物流费用明细", "logistics_expenses", id, before, saved));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(saved.orderId));
  return serializeLogisticsExpense(saved);
}

async function loadLogisticsExpenseForBatchItem(id, actor, index) {
  const expenseId = nonEmpty(id);
  if (!expenseId) {
    throw codedError(`第 ${index + 1} 行保存失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
  }
  return loadLogisticsExpenseForAction(expenseId, actor);
}

function logisticsExpenseBatchUpdateData(item, before, actor, index) {
  const costType = before.costType || "物流费用";
  if (!nonEmpty(item.amount)) {
    throw codedError(`第 ${index + 1} 行金额不能为空`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_REQUIRED");
  }
  const unitAmount = Number(item.amount);
  const billingMethod = normalizeBatchBillingMethod(item, before);
  const billingQuantity = normalizeBatchBillingQuantity(item, billingMethod, costType, index);
  const appliedContainerCount = legacyAppliedContainerCount(billingQuantity);
	  if (!Number.isFinite(unitAmount) || unitAmount < 0) {
	    throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
	  }
  const blockReason = logisticsExpenseUpdateBlockReason(before);
  if (blockReason) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
  }
  const amount = billingAmountFromUnit(unitAmount, billingQuantity, billingMethod);
  const hasContainerType = Object.prototype.hasOwnProperty.call(item, "containerType")
    || Object.prototype.hasOwnProperty.call(item, "container_type");
  return {
    amount,
    amountCny: amountCny(amount, before.exchangeRate || 1),
	    ...(hasContainerType ? { containerType: optional(item.containerType ?? item.container_type) } : {}),
	    appliedContainerCount,
	    billingMethod,
	    billingQuantity,
	    remark: optional(item.remark),
    updatedById: actor?.id,
  };
}

async function loadBatchSaveBaseExpense(input, actor) {
  const parsed = parseLogisticsExpenseGroupKey(input.groupKey);
  const orderId = nonEmpty(input.orderId || parsed.orderId);
  if (!orderId) {
    throw codedError("新增费用明细缺少账单分组信息。", 400, "LOGISTICS_EXPENSE_BATCH_GROUP_REQUIRED");
  }
  const expense = await prisma.logisticsExpense.findFirst({
    where: {
      deletedAt: null,
      orderId,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!expense) {
    throw codedError("未找到账单分组，无法新增费用明细。", 404, "LOGISTICS_EXPENSE_BATCH_GROUP_NOT_FOUND");
  }
  return expense;
}

function parseLogisticsExpenseGroupKey(groupKey) {
  const text = nonEmpty(groupKey);
  if (!text.startsWith("bill:")) return {};
  const rest = text.slice(5);
  const separator = rest.indexOf(":");
  if (separator < 0) return { orderId: rest };
  return {
    orderId: rest.slice(0, separator),
    billKey: rest.slice(separator + 1),
  };
}

function normalizeLogisticsExpenseReviewIdentifiers(input = {}) {
  const values = [
    ...(Array.isArray(input.billIds) ? input.billIds : []),
    ...(Array.isArray(input.groupKeys) ? input.groupKeys : []),
    ...(Array.isArray(input.ids) ? input.ids : []),
    ...(Array.isArray(input.expenseIds) ? input.expenseIds : []),
    input.billId,
    input.groupKey,
    input.id,
  ];
  return values.map(nonEmpty).filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function logisticsExpenseSubmitSelect() {
  return {
    id: true,
    orderId: true,
    supplierId: true,
    auditStatus: true,
    submittedAt: true,
    order: {
      select: {
        id: true,
        orderNo: true,
        blNo: true,
      },
    },
  };
}

async function loadLogisticsExpenseBillRowsForSubmit(identifier, actor) {
  const text = requireText(identifier, "物流费用账单");
  if (text.startsWith("bill:")) {
    const parsed = parseLogisticsExpenseGroupKey(text);
    if (!parsed.orderId) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_ID_INVALID");
    const rows = await prisma.logisticsExpense.findMany({
      where: {
        deletedAt: null,
        orderId: parsed.orderId,
        ...logisticsExpenseAccessWhere(actor),
      },
      select: logisticsExpenseSubmitSelect(),
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.filter((row) => logisticsExpenseBillId(row) === text);
  }
  const before = await prisma.logisticsExpense.findFirst({
    where: {
      id: text,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    select: logisticsExpenseSubmitSelect(),
  });
  if (!before) throw permissionError("物流费用不存在或无权访问", 404);
  const billId = logisticsExpenseBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      orderId: before.orderId,
      ...logisticsExpenseAccessWhere(actor),
    },
    select: logisticsExpenseSubmitSelect(),
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.filter((row) => logisticsExpenseBillId(row) === billId);
}

async function loadLogisticsExpenseBillRowsForAction(identifier, actor) {
  const text = requireText(identifier, "物流费用账单");
  if (text.startsWith("bill:")) {
    const parsed = parseLogisticsExpenseGroupKey(text);
    if (!parsed.orderId) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_ID_INVALID");
    const rows = await prisma.logisticsExpense.findMany({
      where: {
        deletedAt: null,
        orderId: parsed.orderId,
        ...logisticsExpenseAccessWhere(actor),
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.filter((row) => logisticsExpenseBillId(row) === text);
  }
  const before = await loadLogisticsExpenseForAction(text, actor);
  const billId = logisticsExpenseBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      orderId: before.orderId,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.filter((row) => logisticsExpenseBillId(row) === billId);
}

async function logisticsExpenseBillEditBlockReason(expense, actor) {
  const rows = await loadLogisticsExpenseBillRowsForAction(logisticsExpenseBillId(expense), actor);
  const billStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  if (["草稿", "已驳回"].includes(billStatus || "草稿")) return "";
  return `账单${billStatus || "当前状态"}，不能修改明细，请先撤回为草稿。`;
}

function normalizeBatchBillingMethod(item = {}, before = null) {
  const method = nonEmpty(item.billingMethod ?? item.billing_method ?? before?.billingMethod ?? DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  if (!LOGISTICS_EXPENSE_BILLING_METHODS.includes(method)) {
    throw codedError("请选择有效计费方式。", 400, "LOGISTICS_EXPENSE_BILLING_METHOD_INVALID");
  }
  return method;
}

function integerBillingMethod(method) {
  return ["按柜", "按票", "按次"].includes(method);
}

function normalizeBatchBillingQuantity(item = {}, billingMethod = DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD, costType = "物流费用", index = 0) {
  const raw = item.billingQuantity ?? item.billing_quantity ?? item.appliedContainerCount ?? item.containerCount ?? item.applied_container_count ?? 1;
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：适用数量/范围必须大于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_QUANTITY_INVALID");
  }
  if (integerBillingMethod(billingMethod) && !Number.isInteger(quantity)) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：按柜、按票、按次的适用数量/范围必须为正整数。`, 400, "LOGISTICS_EXPENSE_BATCH_QUANTITY_INTEGER_REQUIRED");
  }
  return quantity;
}

function legacyAppliedContainerCount(quantity) {
  return Math.max(1, Math.ceil(Number(quantity || 1)));
}

function billingAmountFromUnit(unitAmount, billingQuantity, billingMethod) {
  return billingMethod === "手工输入" ? unitAmount : unitAmount * billingQuantity;
}

function logisticsExpenseUpdateBlockReason(expense) {
  if (expense.costId) return "该费用已同步到成本，不能修改。";
  if (expense.auditStatus === "审核通过") return "已审核，不能修改。";
  if (expense.auditStatus === "待审核") return "待审核账单不能修改，请先撤回为草稿。";
  if (["已上传", "已确认"].includes(expense.invoiceStatus)) return "已开票，不能修改。";
  if (["已开票", "待付款", "已付款"].includes(expense.paymentStatus)) return "已付款流程中，不能修改。";
  if (!["草稿", "已驳回"].includes(expense.auditStatus)) return "当前状态不能修改。";
  return "";
}

function logisticsExpenseDeleteBlock(expense) {
  if (expense.costId) return { message: "该费用已同步到成本，请先取消同步后再删除。", code: "LOGISTICS_EXPENSE_SYNCED_COST_DELETE_BLOCKED" };
  if (expense.auditStatus === "审核通过") return { message: "已审核通过的物流费用不能删除。", code: "LOGISTICS_EXPENSE_APPROVED_DELETE_BLOCKED" };
  if (expense.auditStatus === "待审核") return { message: "待审核账单不能删除明细，请先撤回为草稿。", code: "LOGISTICS_EXPENSE_PENDING_DELETE_BLOCKED" };
  if (["已上传", "已确认"].includes(expense.invoiceStatus) || ["已开票", "待付款", "已付款"].includes(expense.paymentStatus)) {
    return { message: "已开票或已付款的物流费用不能删除。", code: "LOGISTICS_EXPENSE_INVOICED_DELETE_BLOCKED" };
  }
  if (!["草稿", "已驳回"].includes(expense.auditStatus)) {
    return { message: "当前状态的物流费用不能删除。", code: "LOGISTICS_EXPENSE_DELETE_STATUS_BLOCKED" };
  }
  return null;
}

export async function uploadLogisticsExpenseInvoice(request, actor, id, formData) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (before.auditStatus !== "审核通过") throw codedError("只有审核通过的物流费用可以上传发票。", 400, "LOGISTICS_EXPENSE_NOT_APPROVED");
  if (!canUploadLogisticsExpenseInvoice(actor, before)) throw permissionError("无权限上传该物流费用发票", 403);
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const requestedGroup = logisticsInvoiceGroupForKey(formData.get("invoiceGroup") || formData.get("invoiceGroupKey"));
  const fallbackGroup = logisticsInvoiceGroupForCostType(before.costType);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const targetRows = rows.filter((row) => invoiceGroup.costTypes.includes(normalizedCostType(row.costType)));
  if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用，不能上传该分组发票。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  const blocked = targetRows.find((row) => row.auditStatus !== "审核通过" || !row.costId);
  if (blocked) throw codedError("该发票分组包含尚未审核生成正式成本的费用，不能上传发票。", 400, "LOGISTICS_EXPENSE_COST_MISSING");
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw codedError("请上传发票 PDF。", 400, "INVOICE_FILE_REQUIRED");
  const document = await createLogisticsInvoiceDocument(request, actor, before, file, {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
  });
  const uploadedAt = new Date();
  const savedRows = [];
  for (const row of targetRows) {
    const saved = await prisma.logisticsExpense.update({
      where: { id: row.id },
      data: {
        invoiceDocumentId: document.id,
        invoiceStatus: "已上传",
        paymentStatus: "已开票",
        invoiceNotificationError: null,
        invoiceUploadedById: actor.id,
        invoiceUploadedAt: uploadedAt,
        updatedById: actor.id,
      },
      include: includeLogisticsExpenseRelations(),
    });
    savedRows.push(saved);
    if (saved.costId) await prisma.orderCost.update({ where: { id: saved.costId }, data: { invoiceStatus: "已收到" } }).catch(() => null);
  }
  await runNonCriticalTask("物流发票上传状态日志写入", () => writeAudit(request, actor, "提交物流分组发票", "logistics_expenses", logisticsExpenseBillId(before), targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId: document.id,
    updatedIds: savedRows.map((row) => row.id),
  }));
  for (const orderId of [...new Set(savedRows.map((row) => row.orderId).filter(Boolean))]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(orderId));
  }
  return {
    bill: serializeLogisticsExpenseBill(await loadLogisticsExpenseBillRowsForAction(id, actor)),
    expenses: savedRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}

export async function deleteLogisticsExpenseInvoice(request, actor, id, input = {}) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (!canUploadLogisticsExpenseInvoice(actor, before)) throw permissionError("无权限删除该物流费用发票", 403);
  const rows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  const requestedGroup = logisticsInvoiceGroupForKey(input.invoiceGroup || input.invoiceGroupKey);
  const fallbackGroup = logisticsInvoiceGroupForCostType(before.costType);
  const invoiceGroup = requestedGroup || fallbackGroup;
  if (!invoiceGroup) throw codedError("请选择有效发票分组。", 400, "LOGISTICS_INVOICE_GROUP_INVALID");
  const targetRows = rows.filter((row) => invoiceGroup.costTypes.includes(normalizedCostType(row.costType)));
  if (!targetRows.length) throw codedError(`当前账单没有${invoiceGroup.label}对应费用。`, 400, "LOGISTICS_INVOICE_GROUP_EMPTY");
  if (targetRows.some((row) => row.invoiceStatus === "已确认" || row.invoiceConfirmedAt)) {
    throw codedError("已确认发票不能删除。", 400, "LOGISTICS_INVOICE_CONFIRMED_DELETE_BLOCKED");
  }
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
    for (const row of targetDocumentRows) {
      await tx.logisticsExpense.update({
        where: { id: row.id },
        data: {
          invoiceDocumentId: null,
          invoiceUploadedById: null,
          invoiceUploadedAt: null,
          invoiceStatus: row.invoiceNotifiedAt ? "已通知开票" : "待开票",
          paymentStatus: "待开票",
          updatedById: actor.id,
        },
      });
      if (row.costId) {
        await tx.orderCost.update({ where: { id: row.costId }, data: { invoiceStatus: "未收到" } }).catch(() => null);
      }
    }
  });
  const savedRows = await loadLogisticsExpenseBillRowsForAction(id, actor);
  await runNonCriticalTask("物流发票删除状态日志写入", () => writeAudit(request, actor, "删除物流分组发票", "logistics_expenses", logisticsExpenseBillId(before), targetRows.map(serializeLogisticsExpense), {
    invoiceGroup: invoiceGroup.key,
    invoiceGroupLabel: invoiceGroup.label,
    documentId,
    updatedIds: targetDocumentRows.map((row) => row.id),
  }));
  for (const orderId of [...new Set(targetDocumentRows.map((row) => row.orderId).filter(Boolean))]) {
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(orderId));
  }
  return {
    bill: serializeLogisticsExpenseBill(savedRows),
    expenses: savedRows.map(serializeLogisticsExpense),
    invoiceGroup: invoiceGroup.key,
  };
}

export async function confirmLogisticsExpenseInvoice(request, actor, id, input = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (before.invoiceStatus !== "已上传") throw codedError("只有已上传发票的物流费用可以确认。", 400, "LOGISTICS_INVOICE_NOT_UPLOADED");
  if (!before.invoiceDocumentId) throw codedError("发票文件不能为空。", 400, "LOGISTICS_INVOICE_FILE_REQUIRED");
  const forceConfirmReason = optional(input.forceConfirmReason || input.reason);
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: {
      invoiceStatus: "已确认",
      paymentStatus: "待付款",
      invoiceConfirmedById: actor.id,
      invoiceConfirmedAt: new Date(),
      forceConfirmReason,
      updatedById: actor.id,
    },
    include: includeLogisticsExpenseRelations(),
  });
  if (before.costId) await prisma.orderCost.update({ where: { id: before.costId }, data: { invoiceStatus: "已收到" } }).catch(() => null);
  await runNonCriticalTask("物流发票确认日志写入", () => writeAudit(request, actor, "确认物流发票", "logistics_expenses", id, before, saved));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(saved.orderId));
  return serializeLogisticsExpense(saved);
}

export async function updateLogisticsExpensePaymentStatus(request, actor, id, input = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  const paymentStatus = nonEmpty(input.paymentStatus || input.status || "已付款");
  if (!LOGISTICS_EXPENSE_PAYMENT_STATUSES.includes(paymentStatus)) {
    throw codedError("请选择有效付款状态。", 400, "LOGISTICS_PAYMENT_STATUS_INVALID");
  }
  if (paymentStatus === "已付款" && before.invoiceStatus !== "已确认") {
    throw codedError("发票确认后才能标记已付款。", 400, "LOGISTICS_PAYMENT_REQUIRES_CONFIRMED_INVOICE");
  }
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: { paymentStatus, updatedById: actor.id },
    include: includeLogisticsExpenseRelations(),
  });
  if (before.costId) {
    await prisma.orderCost.update({
      where: { id: before.costId },
      data: { paymentStatus: paymentStatus === "已付款" ? "已支付" : "待支付" },
    }).catch(() => null);
  }
  await runNonCriticalTask("物流付款状态日志写入", () => writeAudit(request, actor, "更新物流费用付款状态", "logistics_expenses", id, before, saved));
  return serializeLogisticsExpense(saved);
}
