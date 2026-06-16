// @ts-nocheck
import { prisma } from "../prisma";
import {
  nonEmpty,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  requireText,
  runNonCriticalTask,
  validEmail,
  writeAudit,
  codedError,
  dateFromInput,
  requirePositive,
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
  notifyLogisticsSupplierInvoice,
  serializeLogisticsExpense,
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
} from "./logistics-expense-shared";

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
  const before = await loadLogisticsExpenseForAction(id, actor);
  const action = nonEmpty(input.action || input.reviewAction || input.auditAction);
  if (!["approve", "reject", "reopen"].includes(action)) throw codedError("请选择有效审核动作。", 400, "LOGISTICS_EXPENSE_ACTION_REQUIRED");
  if (action === "reject" && !nonEmpty(input.rejectReason || input.reason)) {
    throw codedError("驳回物流费用必须填写原因。", 400, "LOGISTICS_EXPENSE_REJECT_REASON_REQUIRED");
  }
  let saved;
  if (action === "approve") {
    saved = await prisma.$transaction(async (tx) => {
      const cost = await createOrUpdateCostFromLogisticsExpense(tx, before, actor);
      return tx.logisticsExpense.update({
        where: { id },
        data: {
          auditStatus: "审核通过",
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewRemark: optional(input.reviewRemark || input.remark),
          rejectReason: null,
          costId: cost.id,
          invoiceStatus: before.invoiceStatus === "已确认" || before.invoiceStatus === "已上传" ? before.invoiceStatus : "未通知",
          paymentStatus: before.paymentStatus || "待开票",
          updatedById: actor.id,
        },
        include: includeLogisticsExpenseRelations(),
      });
    });
    let notified = false;
    let emailError = "";
    try {
      await notifyLogisticsSupplierInvoice(saved);
      notified = true;
      saved = await prisma.logisticsExpense.update({
        where: { id },
        data: { invoiceStatus: "已通知开票", paymentStatus: "待开票", updatedById: actor.id },
        include: includeLogisticsExpenseRelations(),
      });
      if (saved.costId) {
        await prisma.orderCost.update({ where: { id: saved.costId }, data: { invoiceStatus: "已通知开票" } }).catch(() => null);
      }
    } catch (error) {
      emailError = error?.message || "邮件发送失败";
      await runNonCriticalTask("物流费用通知失败日志写入", () => writeAudit(request, actor, "物流费用开票通知失败", "logistics_expenses", id, before, { errorMessage: emailError }));
    }
    await runNonCriticalTask("物流费用审核日志写入", () => writeAudit(request, actor, "审核通过物流费用", "logistics_expenses", id, before, { ...saved, emailNotified: notified, emailError }));
    await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(saved.orderId));
    return { expense: serializeLogisticsExpense(saved), emailNotified: notified, emailError };
  }
  const data = action === "reject"
    ? {
      auditStatus: "已驳回",
      reviewedById: actor.id,
      reviewedAt: new Date(),
      rejectReason: requireText(input.rejectReason || input.reason, "驳回原因"),
      reviewRemark: optional(input.reviewRemark || input.remark),
      updatedById: actor.id,
    }
    : {
      auditStatus: "待审核",
      reviewedById: null,
      reviewedAt: null,
      rejectReason: null,
      reviewRemark: optional(input.reviewRemark || input.remark),
      updatedById: actor.id,
    };
  saved = await prisma.logisticsExpense.update({ where: { id }, data, include: includeLogisticsExpenseRelations() });
  await runNonCriticalTask("物流费用审核日志写入", () => writeAudit(request, actor, action === "reject" ? "驳回物流费用" : "重新打开物流费用", "logistics_expenses", id, before, saved));
  return { expense: serializeLogisticsExpense(saved), emailNotified: false, emailError: "" };
}

export async function updateLogisticsExpense(request, actor, id, input = {}) {
  assertCanWriteLogisticsExpense(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (input.action === "withdraw") {
    if (before.auditStatus !== "待审核") throw codedError("只有待审核费用可以撤回。", 400, "LOGISTICS_EXPENSE_WITHDRAW_NOT_ALLOWED");
    const saved = await prisma.logisticsExpense.update({
      where: { id },
      data: { auditStatus: "草稿", submittedAt: null, updatedById: actor.id },
      include: includeLogisticsExpenseRelations(),
    });
    await runNonCriticalTask("物流费用撤回日志写入", () => writeAudit(request, actor, "撤回物流费用", "logistics_expenses", id, before, saved));
    return serializeLogisticsExpense(saved);
  }
  const order = await assertLogisticsExpenseOrder({ orderId: before.orderId }, actor);
  const supplier = await assertLogisticsExpenseSupplier(actor, order, { supplierId: before.supplierId });
  const data = await buildLogisticsExpenseData(order, supplier, actor, { ...input, supplierId: before.supplierId }, before);
  const saved = await prisma.logisticsExpense.update({ where: { id }, data, include: includeLogisticsExpenseRelations() });
  await runNonCriticalTask("物流费用修改日志写入", () => writeAudit(request, actor, "修改物流费用", "logistics_expenses", id, before, saved));
  return serializeLogisticsExpense(saved);
}

export async function uploadLogisticsExpenseInvoice(request, actor, id, formData) {
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (before.auditStatus !== "审核通过") throw codedError("只有审核通过的物流费用可以上传发票。", 400, "LOGISTICS_EXPENSE_NOT_APPROVED");
  if (!before.costId) throw codedError("该物流费用尚未生成正式成本，不能上传发票。", 400, "LOGISTICS_EXPENSE_COST_MISSING");
  if (!canUploadLogisticsExpenseInvoice(actor, before)) throw permissionError("无权限上传该物流费用发票", 403);
  const invoiceNo = requireText(formData.get("invoiceNo"), "发票号码");
  const invoiceDate = dateFromInput(formData.get("invoiceDate"));
  if (!invoiceDate) throw codedError("请选择开票日期。", 400, "INVOICE_DATE_REQUIRED");
  const invoiceAmount = requirePositive(formData.get("invoiceAmount"), "发票金额");
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw codedError("请上传发票 PDF。", 400, "INVOICE_FILE_REQUIRED");
  const document = await createLogisticsInvoiceDocument(request, actor, before, file, { invoiceNo });
  const saved = await prisma.logisticsExpense.update({
    where: { id },
    data: {
      invoiceNo,
      invoiceDate,
      invoiceAmount,
      invoiceRemark: optional(formData.get("remark")),
      invoiceDocumentId: document.id,
      invoiceStatus: "已上传",
      paymentStatus: "已开票",
      invoiceUploadedById: actor.id,
      invoiceUploadedAt: new Date(),
      updatedById: actor.id,
    },
    include: includeLogisticsExpenseRelations(),
  });
  await prisma.orderCost.update({ where: { id: before.costId }, data: { invoiceStatus: "已收到" } }).catch(() => null);
  await runNonCriticalTask("物流发票上传状态日志写入", () => writeAudit(request, actor, "提交物流发票", "logistics_expenses", id, before, saved));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(saved.orderId));
  return serializeLogisticsExpense(saved);
}

export async function confirmLogisticsExpenseInvoice(request, actor, id, input = {}) {
  assertCanConfirmLogisticsInvoice(actor);
  const before = await loadLogisticsExpenseForAction(id, actor);
  if (before.invoiceStatus !== "已上传") throw codedError("只有已上传发票的物流费用可以确认。", 400, "LOGISTICS_INVOICE_NOT_UPLOADED");
  if (!before.invoiceDocumentId) throw codedError("发票文件不能为空。", 400, "LOGISTICS_INVOICE_FILE_REQUIRED");
  const invoiceAmount = Number(before.invoiceAmount || 0);
  const approvedAmount = Number(before.amount || 0);
  const forceConfirmReason = optional(input.forceConfirmReason || input.reason);
  if (invoiceAmount > approvedAmount && actor.role !== "管理员") {
    throw codedError("发票金额不能大于审核通过金额，请联系管理员处理。", 400, "LOGISTICS_INVOICE_AMOUNT_EXCEEDS_APPROVED");
  }
  if (invoiceAmount > approvedAmount && !forceConfirmReason) {
    throw codedError("发票金额大于审核通过金额，管理员强制确认必须填写原因。", 400, "LOGISTICS_INVOICE_FORCE_REASON_REQUIRED");
  }
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
