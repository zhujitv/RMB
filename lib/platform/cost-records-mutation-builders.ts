import { assertSupplierActive } from "./supplier-masters";
import {
  COST_PAYMENT_STATUSES, COST_TYPES, CURRENCIES, FACTORY_SUPPLIER_COST_TYPES, LOGISTICS_COST_TYPES,
  amountCny, booleanInput, canConfirmLogisticsCost, codedError, confirmedFactorySupplierMismatch,
  costTypeAllowsForeignCurrency, dateFromInput, inputHasOwn, isLogisticsGeneratedCostSourceType,
  isLogisticsCostType, isProductSupplierType, nonEmpty, normalizedCostType, num, optional, permissionError,
  requirePositive, requireText, resolveExchangeRateSnapshot, todayInputInChina,
} from "./shared";
import { isOwnCostScope, isPaidCost, isProductSupplierPaymentCost,
  type CostActor, type CostInput, type CostOrderLike, type CostWithOrder } from "./cost-records-mutation-core";
import { assertOrderCostAllowedByTradeTerm } from "./trade-term-cost-policy";

export async function buildCostData(order: CostOrderLike, actor: CostActor, input: CostInput, id: string | null = null, before: CostWithOrder | null = null) {
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  if (!supplierId) throw codedError("请选择供应商", 400, "SUPPLIER_REQUIRED");
  const supplier = await assertSupplierActive(supplierId);
  if (!nonEmpty(input.amount)) throw codedError("请填写供应商成本金额", 400, "COST_AMOUNT_REQUIRED");
  const amount = num(input.amount);
  if (!(amount > 0)) throw codedError("供应商成本金额必须大于 0", 400, "COST_AMOUNT_REQUIRED");
  const inputCostType = normalizedCostType(nonEmpty(input.costType));
  const costType = COST_TYPES.includes(inputCostType) ? inputCostType : "其他费用";
  assertOrderCostAllowedByTradeTerm(order.tradeTerm, costType);
  const sourceType = nonEmpty(input.sourceType || before?.sourceType || "MANUAL");
  const sourceId = nonEmpty(input.sourceId || before?.sourceId || "");
  if (!id && !isLogisticsGeneratedCostSourceType(sourceType) && isLogisticsCostType(costType)) {
    throw codedError("该类费用请从物流费用录入模块提交，审核通过后自动进入成本。", 400, "LOGISTICS_COST_REQUIRES_EXPENSE_WORKFLOW");
  }
  const requestedCurrency = nonEmpty(input.currency || "CNY").toUpperCase();
  const allowsForeignCurrency = costTypeAllowsForeignCurrency(costType);
  if (allowsForeignCurrency && !CURRENCIES.includes(requestedCurrency)) throw codedError("请选择有效成本币种", 400, "CURRENCY_REQUIRED");
  const currency = allowsForeignCurrency ? requestedCurrency : "CNY";
  const rateInput = currency === "CNY" ? 1 : input.exchangeRate;
  if (!nonEmpty(rateInput)) throw codedError("请填写汇率；CNY 成本汇率应自动为 1", 400, "EXCHANGE_RATE_REQUIRED");
  if (!(num(rateInput) > 0)) throw codedError("成本汇率必须大于 0", 400, "EXCHANGE_RATE_REQUIRED");
  const exchangeInput = currency === "CNY" ? { ...input, currency: "CNY", exchangeRate: 1,
    exchangeRateSource: "系统", exchangeRateDate: input.exchangeRateDate || input.rateDate || input.paymentDate || todayInputInChina(),
    exchangeRateType: input.exchangeRateType || input.rateType } : { ...input, exchangeRate: rateInput };
  const exchange = await resolveExchangeRateSnapshot(exchangeInput, actor, { currency,
    defaultDate: input.paymentDate || todayInputInChina(), allowHistoricalSource: before?.exchangeRateSource === "历史录入" });
  if (FACTORY_SUPPLIER_COST_TYPES.includes(costType) && !isProductSupplierType(supplier.supplierType) && !confirmedFactorySupplierMismatch(input)) {
    throw codedError("当前成本类型为工厂货款，但供应商类型不是产品供应商，请确认是否修改供应商资料。", 409, "FACTORY_SUPPLIER_MISMATCH");
  }
  const requestedConfirmed = booleanInput(input.costConfirmed, before?.costConfirmed || false);
  const canConfirm = ["管理员", "业务员"].includes(actor.role || "");
  if (isOwnCostScope(actor) && before?.costConfirmed) throw codedError("已确认成本不能继续修改，请联系管理员处理。", 403, "CONFIRMED_COST_LOCKED");
  if (requestedConfirmed && !canConfirm) throw codedError("当前角色无权限确认成本。", 403, "COST_CONFIRMATION_REQUIRES_REVIEWER");
  const costConfirmed = canConfirm ? requestedConfirmed : Boolean(before?.costConfirmed);
  const requestedPaymentStatus = COST_PAYMENT_STATUSES.includes(nonEmpty(input.paymentStatus)) ? nonEmpty(input.paymentStatus) : "待支付";
  const requestedPaymentDate = dateFromInput(input.paymentDate);
  const productPaymentCost = isProductSupplierPaymentCost({ costType, sourceType, supplier });
  const canManagePayment = actor.role === "管理员" || actor.role === "财务";
  const paymentStatus = productPaymentCost && !canManagePayment ? before?.paymentStatus || "待支付" : requestedPaymentStatus;
  const paymentDate = productPaymentCost && !canManagePayment ? before?.paymentDate || null : requestedPaymentDate;
  if (!(productPaymentCost && !canManagePayment) && paymentStatus === "已支付" && !paymentDate) throw codedError("已支付成本必须填写付款日期", 400, "PAYMENT_DATE_REQUIRED");
  const paid = productPaymentCost && isPaidCost({ paymentStatus });
  return { orderId: order.id, supplierId: supplier.id, supplierNameSnapshot: supplier.supplierName, costType,
    vendorName: supplier.supplierName, currency: exchange.currency, exchangeRate: exchange.exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate, exchangeRateSource: exchange.exchangeRateSource, exchangeRateType: exchange.exchangeRateType,
    amount, amountCny: amountCny(amount, exchange.exchangeRate), paymentStatus,
    ...(productPaymentCost ? { paid: !canManagePayment ? Boolean(before?.paid) : paid,
      paidAt: !canManagePayment ? before?.paidAt || null : paid ? paymentDate : null } : {}),
    costConfirmed, costConfirmedAt: costConfirmed ? before?.costConfirmedAt || new Date() : null, paymentDate,
    invoiceStatus: "未收到", sourceType, sourceId: sourceId || null, remark: optional(input.remark), updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }) };
}

export async function buildLogisticsCostData(order: CostOrderLike, actor: CostActor, input: CostInput, id: string | null = null, before: CostWithOrder | null = null) {
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  const supplier = supplierId ? await assertSupplierActive(supplierId) : null;
  const supplierName = supplier?.supplierName || requireText(input.supplierName || input.vendorName, "供应商名称");
  const amount = requirePositive(input.amount, "物流费用金额");
  const currency = requireText(input.currency || order.currency || "CNY", "币种");
  if (!CURRENCIES.includes(currency)) throw codedError("请选择有效币种", 400, "CURRENCY_REQUIRED");
  const exchange = await resolveExchangeRateSnapshot(input, actor, { currency, defaultDate: todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入" });
  const rawType = String(input.costType || "").trim();
  const costType = LOGISTICS_COST_TYPES.includes(rawType) ? rawType : "其他物流费用";
  assertOrderCostAllowedByTradeTerm(order.tradeTerm, costType);
  const previousConfirmed = before?.costConfirmed || false;
  const requestedConfirmed = booleanInput(input.costConfirmed, previousConfirmed);
  if (inputHasOwn(input, "costConfirmed") && requestedConfirmed !== previousConfirmed && !canConfirmLogisticsCost(actor)) {
    throw permissionError("没有权限确认物流成本，需由管理员或财务确认");
  }
  const costConfirmed = canConfirmLogisticsCost(actor) ? requestedConfirmed : previousConfirmed;
  return { orderId: order.id, supplierId: supplier?.id || null, supplierNameSnapshot: supplierName, vendorName: supplierName,
    costType, currency: exchange.currency, exchangeRate: exchange.exchangeRate, exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource, exchangeRateType: exchange.exchangeRateType,
    amount, amountCny: amountCny(amount, exchange.exchangeRate),
    paymentStatus: input.isPaid === true || input.isPaid === "true" ? "已支付"
      : COST_PAYMENT_STATUSES.includes(nonEmpty(input.paymentStatus)) ? nonEmpty(input.paymentStatus) : "待支付",
    costConfirmed, costConfirmedAt: costConfirmed ? before?.costConfirmedAt || new Date() : null,
    paymentDate: dateFromInput(input.paymentDate), invoiceStatus: "未收到", remark: optional(input.remark), updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }) };
}
