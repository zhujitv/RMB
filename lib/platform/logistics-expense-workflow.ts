// @ts-nocheck
import { prisma } from "../prisma";
import {
  amountCny,
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
  logisticsExpenseAccessWhere,
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
    const appliedContainerCount = Number(item.appliedContainerCount ?? item.containerCount ?? item.applied_container_count ?? 1);
    if (!Number.isFinite(unitAmount) || unitAmount < 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
    }
    if (!Number.isInteger(appliedContainerCount) || appliedContainerCount <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：适用数量必须为正整数。`, 400, "LOGISTICS_EXPENSE_BATCH_CONTAINER_COUNT_INVALID");
    }
    const blockReason = logisticsExpenseUpdateBlockReason(before);
    if (blockReason) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
    }
    const amount = unitAmount * appliedContainerCount;
    prepared.push({
      index,
      before,
      data: {
        amount,
        amountCny: amountCny(amount, before.exchangeRate || 1),
        appliedContainerCount,
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
    const data = logisticsExpenseBatchUpdateData(item, before, actor, index);
    preparedUpdates.push({ before, data });
  }
  for (let index = 0; index < deletes.length; index += 1) {
    const before = await loadLogisticsExpenseForBatchItem(deletes[index], actor, index);
    const block = logisticsExpenseDeleteBlock(before);
    if (block) {
      throw codedError(`第 ${index + 1} 行${before.costType || "物流费用"}删除失败：${block.message}`, 400, block.code);
    }
    preparedDeletes.push(before);
  }
  const baseExpense = preparedUpdates[0]?.before || preparedDeletes[0] || await loadBatchSaveBaseExpense(input, actor);
  const order = await assertLogisticsExpenseOrder({ orderId: baseExpense.orderId }, actor);
  const supplier = await assertLogisticsExpenseSupplier(actor, order, { supplierId: baseExpense.supplierId });
  const preparedCreates = [];
  for (let index = 0; index < creates.length; index += 1) {
    const item = creates[index] || {};
    const costType = nonEmpty(item.expenseType || item.costType);
    if (!costType) {
      throw codedError(`第 ${index + 1} 行请选择费用类型`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_COST_TYPE_REQUIRED");
    }
    const unitAmount = Number(item.amount);
    const appliedContainerCount = Number(item.appliedContainerCount ?? item.containerCount ?? item.applied_container_count ?? 1);
    if (!nonEmpty(item.amount)) {
      throw codedError(`第 ${index + 1} 行金额不能为空`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_REQUIRED");
    }
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_AMOUNT_INVALID");
    }
    if (!Number.isInteger(appliedContainerCount) || appliedContainerCount <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：适用数量必须为正整数。`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_CONTAINER_COUNT_INVALID");
    }
    const blockReason = logisticsExpenseUpdateBlockReason(baseExpense);
    if (blockReason) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_CREATE_STATUS_BLOCKED");
    }
    const amount = unitAmount * appliedContainerCount;
    const data = await buildLogisticsExpenseData(order, supplier, actor, {
      costType,
      amount,
      appliedContainerCount,
      currency: baseExpense.currency || "CNY",
      exchangeRate: baseExpense.exchangeRate || 1,
      exchangeRateDate: baseExpense.exchangeRateDate,
      exchangeRateSource: baseExpense.exchangeRateSource,
      exchangeRateType: baseExpense.exchangeRateType,
      remark: item.remark,
      auditStatus: ["草稿", "待审核", "已驳回"].includes(baseExpense.auditStatus) ? baseExpense.auditStatus : "草稿",
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
  const appliedContainerCount = Number(item.appliedContainerCount ?? item.containerCount ?? item.applied_container_count ?? 1);
  if (!Number.isFinite(unitAmount) || unitAmount < 0) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：金额必须大于或等于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_INVALID");
  }
  if (!Number.isInteger(appliedContainerCount) || appliedContainerCount <= 0) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：适用数量必须为正整数。`, 400, "LOGISTICS_EXPENSE_BATCH_CONTAINER_COUNT_INVALID");
  }
  const blockReason = logisticsExpenseUpdateBlockReason(before);
  if (blockReason) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：${blockReason}`, 400, "LOGISTICS_EXPENSE_BATCH_STATUS_BLOCKED");
  }
  const amount = unitAmount * appliedContainerCount;
  return {
    amount,
    amountCny: amountCny(amount, before.exchangeRate || 1),
    appliedContainerCount,
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

function logisticsExpenseUpdateBlockReason(expense) {
  if (expense.costId) return "该费用已同步到成本，不能修改。";
  if (expense.auditStatus === "审核通过") return "已审核，不能修改。";
  if (["已上传", "已确认"].includes(expense.invoiceStatus)) return "已开票，不能修改。";
  if (["已开票", "待付款", "已付款"].includes(expense.paymentStatus)) return "已付款流程中，不能修改。";
  if (!["草稿", "待审核", "已驳回"].includes(expense.auditStatus)) return "当前状态不能修改。";
  return "";
}

function logisticsExpenseDeleteBlock(expense) {
  if (expense.costId) return { message: "该费用已同步到成本，请先取消同步后再删除。", code: "LOGISTICS_EXPENSE_SYNCED_COST_DELETE_BLOCKED" };
  if (expense.auditStatus === "审核通过") return { message: "已审核通过的物流费用不能删除。", code: "LOGISTICS_EXPENSE_APPROVED_DELETE_BLOCKED" };
  if (["已上传", "已确认"].includes(expense.invoiceStatus) || ["已开票", "待付款", "已付款"].includes(expense.paymentStatus)) {
    return { message: "已开票或已付款的物流费用不能删除。", code: "LOGISTICS_EXPENSE_INVOICED_DELETE_BLOCKED" };
  }
  if (!["草稿", "待审核", "已驳回"].includes(expense.auditStatus)) {
    return { message: "当前状态的物流费用不能删除。", code: "LOGISTICS_EXPENSE_DELETE_STATUS_BLOCKED" };
  }
  return null;
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
