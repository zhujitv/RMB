import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  amountCny,
  CURRENCIES,
  dateFromInput,
  getExchangeRateQuote,
  nonEmpty,
  normalizedCostType,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  requireText,
  runNonCriticalTask,
  todayInputInChina,
  validEmail,
  writeAudit,
  codedError,
  FILE_ASSET_SOURCE_TABLES,
  softDeleteFileAssetBySource,
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
  ensureLogisticsExpenseBill,
  includeLogisticsExpenseRelations,
  loadLogisticsExpenseForAction,
  aggregateLogisticsExpenseStatus,
  aggregateLogisticsExpenseInvoiceStatus,
  logisticsExpenseRequestedAuditStatus,
  logisticsExpenseBillId,
  logisticsExpenseAccessWhere,
  notifyLogisticsSupplierInvoice,
  notifyLogisticsSupplierInvoiceBills,
  serializeLogisticsExpense,
  serializeLogisticsExpenseBill,
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
} from "./logistics-expense-shared";
import {
  logisticsInvoiceExpenseMatchesGroup,
  logisticsInvoiceGroupCurrencyViolation,
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupForKey,
} from "./logistics-invoice-groups";
import {
  LOGISTICS_COST_TYPES,
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeLocksCurrency,
} from "./logistics-cost-types";
import {
  canMarkLogisticsBillPaid,
  canRejectLogisticsBill,
  canSubmitLogisticsBill,
  canUploadLogisticsBillInvoice,
  canWithdrawLogisticsBill,
  logisticsBillDeleteBlock,
  logisticsBillEditBlockReason as logisticsBillStateEditBlockReason,
} from "./logistics-bill-state-machine";
import { assertCanDeleteLogisticsInvoiceFile } from "./file-delete-policy";

export const LOGISTICS_EXPENSE_BILLING_METHODS = ["按柜", "按票", "按次", "按重量", "按金额比例", "手工输入"];
export const DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD = "按柜";
export const LOGISTICS_EXPENSE_REVIEW_TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 10000 };
export const LOGISTICS_BILL_DETAIL_SCAN_LIMIT = 500;

export type UnknownRecord = Record<string, unknown>;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type WorkflowActor = { id?: string | null; role?: string | null; supplierId?: string | null } & UnknownRecord;
export type ActorContext = WorkflowActor | null | undefined;
export type FormDataLike = { get(name: string): unknown };
export type LogisticsExpenseRow = Prisma.LogisticsExpenseGetPayload<{ include: ReturnType<typeof includeLogisticsExpenseRelations> }> & UnknownRecord;
export type LogisticsExpenseSubmitRow = Prisma.LogisticsExpenseGetPayload<{ select: ReturnType<typeof logisticsExpenseSubmitSelect> }> & UnknownRecord;
export type LogisticsExpenseStateSnapshot = {
  costId?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
};
export type LogisticsExpenseCreateData = Prisma.LogisticsExpenseUncheckedCreateInput;
export type LogisticsExpenseUpdateData = Prisma.LogisticsExpenseUncheckedUpdateInput;
export type CostLink = { expenseId: string; costId: string };
export type ReviewBill = { billId: string; rows: LogisticsExpenseRow[] };
export type ReviewResult = {
  billId: string;
  orderNo: string;
  blNo: string;
  auditStatus: string;
  notificationStatus: string;
  errorMessage: string;
};
export type EmailResult = {
  supplierId?: string;
  supplierName?: string;
  sent?: boolean;
  skipped?: boolean;
  error?: string;
  expenseIds?: string[];
};
export type PreparedUpdate = { index?: number; before: LogisticsExpenseRow; data: LogisticsExpenseUpdateData };
export type PreparedCreate = { data: LogisticsExpenseCreateData };
export type DeleteBlock = { message: string; code: string } | null;
export type BatchExchangeSnapshot = {
  currency: string;
  exchangeRate: number;
  exchangeRateDate: Date | null;
  exchangeRateSource: string;
  exchangeRateType: string;
};

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

export function errorMessage(error: unknown, fallback = "") {
  if (error instanceof Error) return error.message;
  const message = asRecord(error).message;
  return typeof message === "string" && message ? message : fallback;
}

export function actorId(actor: ActorContext): string {
  return nonEmpty(actor?.id);
}

export function actorRole(actor: ActorContext): string {
  return nonEmpty(actor?.role);
}

export function rowBillRecord(row: UnknownRecord = {}) {
  return asRecord(row.bill);
}

export function rowAuditStatus(row: UnknownRecord = {}) {
  return nonEmpty(rowBillRecord(row).auditStatus || "草稿");
}

export function rowBillSubmittedAt(row: UnknownRecord = {}) {
  return rowBillRecord(row).submittedAt || row.submittedAt || null;
}

export function rowBillReviewedAt(row: UnknownRecord = {}) {
  return rowBillRecord(row).reviewedAt || row.reviewedAt || null;
}

export function rowBillId(row: UnknownRecord = {}) {
  return nonEmpty(row.billId || rowBillRecord(row).id || logisticsExpenseBillId(row));
}

export async function refreshLogisticsBillWorkflowStatus(rows: LogisticsExpenseRow[] = [], actor: ActorContext, overrides: Prisma.LogisticsBillUncheckedUpdateInput = {}) {
  if (!rows.length || !rows[0]?.billId) return;
  await prisma.logisticsBill.update({
    where: { id: rowBillId(rows[0]) },
    data: {
      invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(rows),
      updatedById: actorId(actor) || null,
      ...overrides,
    },
  });
}

export async function reloadLogisticsExpenseRowsForBillIds(billIds: string[] = [], actor: ActorContext) {
  const rows: LogisticsExpenseRow[] = [];
  const uniqueBillIds = [...new Set(billIds.map(nonEmpty).filter(Boolean))];
  const directBillIds = uniqueBillIds.filter((billId) => !billId.startsWith("bill:"));
  if (directBillIds.length) {
    rows.push(...await prisma.logisticsExpense.findMany({
      where: {
        billId: { in: directBillIds },
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ billId: "asc" }, { createdAt: "asc" }],
      take: directBillIds.length * LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    }));
  }
  for (const legacyBillId of uniqueBillIds.filter((billId) => billId.startsWith("bill:"))) {
    rows.push(...await loadLogisticsExpenseBillRowsForAction(legacyBillId, actor));
  }
  return rows;
}

export function groupLogisticsExpenseRowsByBillId(rows: LogisticsExpenseRow[] = []) {
  const groups = new Map<string, LogisticsExpenseRow[]>();
  for (const row of rows) {
    const billId = rowBillId(row);
    if (!billId) continue;
    if (!groups.has(billId)) groups.set(billId, []);
    groups.get(billId)!.push(row);
  }
  return groups;
}

export function exchangeActor(actor: ActorContext): { role?: string } | null {
  const role = actorRole(actor);
  return role ? { role } : null;
}

export function assertWorkflowActor(actor: ActorContext): asserts actor is WorkflowActor {
  if (!actor) throw permissionError("请先登录", 401);
}

export function batchSaveLogisticsExpenseBillIdentifier(input: UnknownRecord = {}, updates: UnknownRecord[] = [], deletes: unknown[] = []) {
  const update = updates.find((item) => nonEmpty(item?.groupKey || item?.billId || item?.id)) || {};
  return nonEmpty(input.groupKey || input.billId || input.id || update.groupKey || update.billId || update.id || deletes[0]);
}

export function loadLogisticsExpenseBatchBillRow(rowById: Map<string, LogisticsExpenseRow>, id: unknown, index: number, actionLabel = "保存") {
  const expenseId = nonEmpty(id);
  if (!expenseId) {
    throw codedError(`第 ${index + 1} 行${actionLabel}失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
  }
  const row = rowById.get(expenseId);
  if (!row) {
    throw codedError(`第 ${index + 1} 行${actionLabel}失败：该费用明细不属于当前账单。`, 400, "LOGISTICS_EXPENSE_BATCH_ITEM_OUT_OF_BILL");
  }
  return row;
}

export async function loadLogisticsExpenseForBatchItem(id: unknown, actor: ActorContext, index: number) {
  const expenseId = nonEmpty(id);
  if (!expenseId) {
    throw codedError(`第 ${index + 1} 行保存失败：缺少物流费用ID。`, 400, "LOGISTICS_EXPENSE_BATCH_ID_REQUIRED");
  }
  return loadLogisticsExpenseForAction(expenseId, actor);
}

export async function logisticsExpenseBatchUpdateData(item: UnknownRecord, before: LogisticsExpenseRow, actor: ActorContext, index: number): Promise<LogisticsExpenseUpdateData> {
  const costType = normalizedCostType(nonEmpty(item.feeType || item.expenseType || item.costType || before.costType));
  if (!LOGISTICS_COST_TYPES.includes(costType)) {
    throw codedError(`第 ${index + 1} 行请选择费用类型`, 400, "LOGISTICS_EXPENSE_BATCH_COST_TYPE_INVALID");
  }
  const rawUnitAmount = item.unitAmount ?? item.unit_amount ?? item.amount;
  if (!nonEmpty(rawUnitAmount)) {
    throw codedError(`第 ${index + 1} 行金额不能为空`, 400, "LOGISTICS_EXPENSE_BATCH_AMOUNT_REQUIRED");
  }
  const unitAmount = Number(rawUnitAmount);
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
  const currency = logisticsCostTypeDefaultCurrency(costType) === "USD"
    ? "USD"
    : nonEmpty(item.currency || before.currency || "CNY").toUpperCase();
  if (!CURRENCIES.includes(currency)) throw codedError(`第 ${index + 1} 行请选择有效币种。`, 400, "CURRENCY_REQUIRED");
  const exchange = await resolveLogisticsExpenseBatchExchange(costType, item, before, actor, currency, index);
  const exchangeRate = Number(exchange.exchangeRate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw codedError(`第 ${index + 1} 行汇率必须大于 0。`, 400, "EXCHANGE_RATE_REQUIRED");
  }
  return {
    costType,
    currency: exchange.currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchangeRate),
	    ...(hasContainerType ? { containerType: optional(item.containerType ?? item.container_type) } : {}),
	    appliedContainerCount,
	    billingMethod,
	    billingQuantity,
	    remark: optional(item.remark),
    updatedById: actorId(actor),
  };
}

export async function resolveLogisticsExpenseBatchExchange(costType: string, item: UnknownRecord, before: LogisticsExpenseRow, actor: ActorContext, currency: string, index: number): Promise<BatchExchangeSnapshot> {
  if (logisticsCostTypeLocksCurrency(costType)) {
    const quote = await getExchangeRateQuote({
      currency: "USD",
      date: item.exchangeRateDate || item.rateDate || todayInputInChina(),
    }, exchangeActor(actor));
    const exchangeRate = Number(quote.rateToCny ?? quote.exchangeRate ?? quote.rate ?? 0);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：未找到可用美元汇率，请先刷新系统汇率。`, 400, "EXCHANGE_RATE_REQUIRED");
    }
    return {
      currency: "USD",
      exchangeRate,
      exchangeRateDate: dateFromInput(quote.rateDate || todayInputInChina()),
      exchangeRateSource: quote.source || "系统",
      exchangeRateType: quote.rateType || "",
    };
  }
  return {
    currency,
    exchangeRate: Number(item.exchangeRate ?? item.exchange_rate ?? before.exchangeRate ?? 1),
    exchangeRateDate: before.exchangeRateDate,
    exchangeRateSource: before.exchangeRateSource || "",
    exchangeRateType: before.exchangeRateType || "",
  };
}

export async function loadBatchSaveBaseExpense(input: UnknownRecord, actor: ActorContext) {
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

export function parseLogisticsExpenseGroupKey(groupKey: unknown) {
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

export function rowMatchesLegacyBillKey(row: UnknownRecord = {}, legacyBillId: unknown) {
  const parsed = parseLogisticsExpenseGroupKey(legacyBillId);
  if (!parsed.orderId) return false;
  const order = asRecord(row.order);
  const rowOrderId = nonEmpty(row.orderId || order.id);
  const rowBillKey = nonEmpty(order.blNo || order.orderNo || "no-bl").toLowerCase();
  return rowOrderId === parsed.orderId && rowBillKey === nonEmpty(parsed.billKey || "no-bl").toLowerCase();
}

export function normalizeLogisticsExpenseReviewIdentifiers(input: UnknownRecord = {}) {
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

export function logisticsExpenseSubmitSelect() {
  return {
    id: true,
    orderId: true,
    supplierId: true,
    auditStatus: true,
    invoiceStatus: true,
    paymentStatus: true,
    submittedAt: true,
    billId: true,
    bill: {
      select: {
        id: true,
        auditStatus: true,
        invoiceStatus: true,
        paymentStatus: true,
        submittedAt: true,
        reviewedAt: true,
      },
    },
    order: {
      select: {
        id: true,
        orderNo: true,
        blNo: true,
      },
    },
  };
}

export async function loadLogisticsExpenseBillRowsForSubmit(identifier: unknown, actor: ActorContext): Promise<LogisticsExpenseSubmitRow[]> {
  const text = requireText(identifier, "物流费用账单");
  if (!text.startsWith("bill:")) {
    const billRows = await prisma.logisticsExpense.findMany({
      where: {
        billId: text,
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      select: logisticsExpenseSubmitSelect(),
      orderBy: [{ createdAt: "asc" }],
      take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    if (billRows.length) return billRows;
  }
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
      take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    return rows.filter((row) => rowMatchesLegacyBillKey(row, text));
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
  const billId = rowBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(before.billId ? { billId: before.billId } : { orderId: before.orderId }),
      ...logisticsExpenseAccessWhere(actor),
    },
    select: logisticsExpenseSubmitSelect(),
    orderBy: [{ createdAt: "asc" }],
    take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
  });
  return before.billId ? rows : rows.filter((row) => rowMatchesLegacyBillKey(row, billId));
}

export async function loadLogisticsExpenseBillRowsForAction(identifier: unknown, actor: ActorContext): Promise<LogisticsExpenseRow[]> {
  const text = requireText(identifier, "物流费用账单");
  if (!text.startsWith("bill:")) {
    const billRows = await prisma.logisticsExpense.findMany({
      where: {
        billId: text,
        deletedAt: null,
        ...logisticsExpenseAccessWhere(actor),
      },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
      take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    if (billRows.length) return billRows;
  }
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
      take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
    });
    return rows.filter((row) => rowMatchesLegacyBillKey(row, text));
  }
  const before = await loadLogisticsExpenseForAction(text, actor);
  const billId = rowBillId(before);
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(before.billId ? { billId: before.billId } : { orderId: before.orderId }),
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
    orderBy: [{ createdAt: "asc" }],
    take: LOGISTICS_BILL_DETAIL_SCAN_LIMIT,
  });
  return before.billId ? rows : rows.filter((row) => rowMatchesLegacyBillKey(row, billId));
}

export async function logisticsExpenseBillEditBlockReason(expense: LogisticsExpenseStateSnapshot & UnknownRecord, actor: ActorContext) {
  const rows = await loadLogisticsExpenseBillRowsForAction(rowBillId(expense), actor);
  const billStatus = aggregateLogisticsExpenseStatus(rows, "auditStatus");
  if (!logisticsBillStateEditBlockReason({ auditStatus: billStatus })) return "";
  return `账单${billStatus || "当前状态"}，不能修改明细，请先撤回为草稿。`;
}

export function normalizeBatchBillingMethod(item: UnknownRecord = {}, before: LogisticsExpenseStateSnapshot & UnknownRecord | null = null) {
  const method = nonEmpty(item.billingMethod ?? item.billing_method ?? before?.billingMethod ?? DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  if (!LOGISTICS_EXPENSE_BILLING_METHODS.includes(method)) {
    throw codedError("请选择有效计费方式。", 400, "LOGISTICS_EXPENSE_BILLING_METHOD_INVALID");
  }
  return method;
}

export function integerBillingMethod(method: string) {
  return ["按柜", "按票", "按次"].includes(method);
}

export function normalizeBatchBillingQuantity(item: UnknownRecord = {}, billingMethod = DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD, costType = "物流费用", index = 0) {
  const raw = item.billingQuantity
    ?? item.billing_quantity
    ?? item.appliedQuantity
    ?? item.applied_quantity
    ?? item.appliedContainerCount
    ?? item.containerCount
    ?? item.applied_container_count
    ?? 1;
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：适用数量/范围必须大于 0。`, 400, "LOGISTICS_EXPENSE_BATCH_QUANTITY_INVALID");
  }
  if (integerBillingMethod(billingMethod) && !Number.isInteger(quantity)) {
    throw codedError(`第 ${index + 1} 行${costType}保存失败：按柜、按票、按次的适用数量/范围必须为正整数。`, 400, "LOGISTICS_EXPENSE_BATCH_QUANTITY_INTEGER_REQUIRED");
  }
  return quantity;
}

export function legacyAppliedContainerCount(quantity: unknown) {
  return Math.max(1, Math.ceil(Number(quantity || 1)));
}

export function billingAmountFromUnit(unitAmount: number, billingQuantity: number, billingMethod: string) {
  return billingMethod === "手工输入" ? unitAmount : unitAmount * billingQuantity;
}

export function logisticsExpenseUpdateBlockReason(expense: LogisticsExpenseStateSnapshot) {
  return logisticsBillStateEditBlockReason({
    auditStatus: rowAuditStatus(expense),
    invoiceStatus: expense.invoiceStatus,
    paymentStatus: expense.paymentStatus,
    costSynced: Boolean(expense.costId),
  });
}

export function logisticsExpenseDeleteBlock(expense: LogisticsExpenseStateSnapshot): DeleteBlock {
  return logisticsBillDeleteBlock({
    auditStatus: rowAuditStatus(expense),
    invoiceStatus: expense.invoiceStatus,
    paymentStatus: expense.paymentStatus,
    costSynced: Boolean(expense.costId),
  });
}
