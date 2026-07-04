import { prisma } from "../prisma";
import {
  amountCny,
  codedError,
  dateFromInput,
  getExchangeRateQuote,
  nonEmpty,
  normalizedCostType,
  optional,
  todayInputInChina,
} from "./shared";
import { includeLogisticsExpenseRelations, loadLogisticsExpenseForAction, logisticsExpenseAccessWhere } from "./logistics-expense-shared";
import { LOGISTICS_EXPENSE_CURRENCIES, LOGISTICS_COST_TYPES, logisticsCostTypeDefaultCurrency } from "./logistics-cost-types";
import { logisticsBillDeleteBlock, logisticsBillEditBlockReason as logisticsBillStateEditBlockReason } from "./logistics-bill-state-machine";
import { parseLogisticsExpenseGroupKey } from "./logistics-expense-workflow-loaders";
import {
  DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD,
  LOGISTICS_EXPENSE_BILLING_METHODS,
  actorId,
  exchangeActor,
  rowAuditStatus,
  type ActorContext,
  type BatchExchangeSnapshot,
  type DeleteBlock,
  type LogisticsExpenseCreateData,
  type LogisticsExpenseRow,
  type LogisticsExpenseStateSnapshot,
  type LogisticsExpenseUpdateData,
  type UnknownRecord,
} from "./logistics-expense-workflow-model";

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
  const currency = nonEmpty(
    item.currency || before.currency || logisticsCostTypeDefaultCurrency(costType),
  ).toUpperCase();
  if (!LOGISTICS_EXPENSE_CURRENCIES.includes(currency)) {
    throw codedError(`第 ${index + 1} 行请选择有效币种。`, 400, "CURRENCY_REQUIRED");
  }
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
  if (currency === "CNY") {
    return {
      currency: "CNY",
      exchangeRate: 1,
      exchangeRateDate: dateFromInput(item.exchangeRateDate || item.rateDate || todayInputInChina()),
      exchangeRateSource: "系统",
      exchangeRateType: "",
    };
  }
  if (currency === "USD") {
    const quote = await getExchangeRateQuote({
      currency,
      date: item.exchangeRateDate || item.rateDate || todayInputInChina(),
    }, exchangeActor(actor));
    const exchangeRate = Number(quote.rateToCny ?? quote.exchangeRate ?? quote.rate ?? 0);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw codedError(`第 ${index + 1} 行${costType}保存失败：未找到可用美元汇率，请先刷新系统汇率。`, 400, "EXCHANGE_RATE_REQUIRED");
    }
    return {
      currency,
      exchangeRate,
      exchangeRateDate: dateFromInput(quote.rateDate || todayInputInChina()),
      exchangeRateSource: quote.source || "系统",
      exchangeRateType: quote.rateType || "",
    };
  }
  throw codedError(`第 ${index + 1} 行请选择有效币种。`, 400, "CURRENCY_REQUIRED");
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
