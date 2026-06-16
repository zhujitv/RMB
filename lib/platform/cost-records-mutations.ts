// @ts-nocheck
import { prisma } from "../prisma";
import {
  COST_PAYMENT_STATUSES,
  COST_TYPES,
  CURRENCIES,
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_COST_TYPES,
  amountCny,
  assertWrite,
  booleanInput,
  canConfirmLogisticsCost,
  codedError,
  confirmedFactorySupplierMismatch,
  costTypeAllowsForeignCurrency,
  dateFromInput,
  inputHasOwn,
  isLogisticsCostType,
  nonEmpty,
  normalizedCostType,
  num,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  requirePositive,
  requireText,
  resolveExchangeRateSnapshot,
  runNonCriticalTask,
  safeSerializeCost,
  syncCostInvoiceStatus,
  todayInputInChina,
  validCost,
  writeAudit,
} from "./shared";
import { assertOrderOpen, assertCostWritableOrder, canAccessOrder } from "./order-access";
import { assertSupplierActive } from "./supplier-masters";
import {
  createCostIdempotently,
  duplicateCostFingerprint,
  includeCostRelations,
} from "./cost-records-shared";

async function buildCostData(order, actor, input, id = null, before = null) {
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  if (!supplierId) throw codedError("请选择供应商", 400, "SUPPLIER_REQUIRED");
  const supplier = await assertSupplierActive(supplierId);
  if (!nonEmpty(input.amount)) throw codedError("请填写供应商成本金额", 400, "COST_AMOUNT_REQUIRED");
  const amount = num(input.amount);
  if (!(amount > 0)) throw codedError("供应商成本金额必须大于 0", 400, "COST_AMOUNT_REQUIRED");
  const inputCostType = normalizedCostType(input.costType);
  const costType = COST_TYPES.includes(inputCostType) ? inputCostType : "其他费用";
  const sourceType = nonEmpty(input.sourceType || before?.sourceType || "MANUAL");
  const sourceId = nonEmpty(input.sourceId || before?.sourceId || "");
  if (!id && sourceType !== "LOGISTICS_EXPENSE" && isLogisticsCostType(costType)) {
    throw codedError("该类费用请从物流费用录入模块提交，审核通过后自动进入成本。", 400, "LOGISTICS_COST_REQUIRES_EXPENSE_WORKFLOW");
  }
  const requestedCurrency = nonEmpty(input.currency || "CNY").toUpperCase();
  const allowsForeignCurrency = costTypeAllowsForeignCurrency(costType);
  if (allowsForeignCurrency && !requestedCurrency) throw codedError("请选择成本币种", 400, "CURRENCY_REQUIRED");
  if (allowsForeignCurrency && !CURRENCIES.includes(requestedCurrency)) {
    const error = new Error("请选择有效成本币种");
    error.status = 400;
    throw error;
  }
  const currency = allowsForeignCurrency ? requestedCurrency : "CNY";
  const exchangeRateInput = currency === "CNY" ? 1 : input.exchangeRate;
  if (!nonEmpty(exchangeRateInput)) throw codedError("请填写汇率；CNY 成本汇率应自动为 1", 400, "EXCHANGE_RATE_REQUIRED");
  if (!(num(exchangeRateInput) > 0)) throw codedError("成本汇率必须大于 0", 400, "EXCHANGE_RATE_REQUIRED");
  const exchangeInput = currency === "CNY"
    ? {
      ...input,
      currency: "CNY",
      exchangeRate: 1,
      exchangeRateSource: "系统",
      exchangeRateDate: input.exchangeRateDate || input.rateDate || input.paymentDate || todayInputInChina(),
      exchangeRateType: input.exchangeRateType || input.rateType,
    }
    : { ...input, exchangeRate: exchangeRateInput };
  const exchange = await resolveExchangeRateSnapshot(exchangeInput, actor, {
    currency,
    defaultDate: input.paymentDate || todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  if (FACTORY_SUPPLIER_COST_TYPES.includes(costType) && supplier.supplierType !== "工厂供应商" && !confirmedFactorySupplierMismatch(input)) {
    const error = new Error("当前成本类型为工厂货款，但供应商类型不是工厂供应商，请确认是否修改供应商资料。");
    error.status = 409;
    throw error;
  }
  const requestedCostConfirmed = booleanInput(input.costConfirmed, before?.costConfirmed || false);
  const canConfirmOrdinaryCost = ["管理员", "业务员"].includes(actor?.role);
  if (actor?.role === "成本录入员" && before?.costConfirmed) {
    throw codedError("已确认成本不能由成本录入员继续修改，请联系管理员处理。", 403, "CONFIRMED_COST_LOCKED");
  }
  if (requestedCostConfirmed && !canConfirmOrdinaryCost) {
    throw codedError("当前角色无权限确认成本。", 403, "COST_CONFIRMATION_REQUIRES_REVIEWER");
  }
  const costConfirmed = canConfirmOrdinaryCost ? requestedCostConfirmed : Boolean(before?.costConfirmed);
  const paymentStatus = COST_PAYMENT_STATUSES.includes(input.paymentStatus) ? input.paymentStatus : "待支付";
  const paymentDate = dateFromInput(input.paymentDate);
  if (paymentStatus === "已支付" && !paymentDate) {
    throw codedError("已支付成本必须填写付款日期", 400, "PAYMENT_DATE_REQUIRED");
  }
  return {
    orderId: order.id,
    supplierId: supplier.id,
    supplierNameSnapshot: supplier.supplierName,
    costType,
    vendorName: supplier.supplierName,
    currency: exchange.currency,
    exchangeRate: exchange.exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchange.exchangeRate),
    paymentStatus,
    costConfirmed,
    costConfirmedAt: costConfirmed ? (before?.costConfirmedAt || new Date()) : null,
    paymentDate,
    invoiceStatus: "未收到",
    sourceType,
    sourceId: sourceId || null,
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
}

async function buildLogisticsCostData(order, actor, input, id = null, before = null) {
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  const supplier = supplierId ? await assertSupplierActive(supplierId) : null;
  const supplierName = supplier?.supplierName || requireText(input.supplierName || input.vendorName, "供应商名称");
  const amount = requirePositive(input.amount, "物流费用金额");
  const currency = requireText(input.currency || order.currency || "CNY", "币种");
  if (!CURRENCIES.includes(currency)) {
    const error = new Error("请选择有效币种");
    error.status = 400;
    throw error;
  }
  const exchange = await resolveExchangeRateSnapshot(input, actor, {
    currency,
    defaultDate: todayInputInChina(),
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const inputCostType = String(input.costType || "").trim();
  const costType = LOGISTICS_COST_TYPES.includes(inputCostType) ? inputCostType : "其他物流费用";
  const previousCostConfirmed = before?.costConfirmed || false;
  const requestedCostConfirmed = booleanInput(input.costConfirmed, previousCostConfirmed);
  if (inputHasOwn(input, "costConfirmed") && requestedCostConfirmed !== previousCostConfirmed && !canConfirmLogisticsCost(actor)) {
    throw permissionError("没有权限确认物流成本，需由管理员或财务确认");
  }
  const costConfirmed = canConfirmLogisticsCost(actor) ? requestedCostConfirmed : previousCostConfirmed;
  return {
    orderId: order.id,
    supplierId: supplier?.id || null,
    supplierNameSnapshot: supplierName,
    vendorName: supplierName,
    costType,
    currency: exchange.currency,
    exchangeRate: exchange.exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchange.exchangeRate),
    paymentStatus: input.isPaid === true || input.isPaid === "true"
      ? "已支付"
      : (COST_PAYMENT_STATUSES.includes(input.paymentStatus) ? input.paymentStatus : "待支付"),
    costConfirmed,
    costConfirmedAt: costConfirmed ? (before?.costConfirmedAt || new Date()) : null,
    paymentDate: dateFromInput(input.paymentDate),
    invoiceStatus: "未收到",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
}

export async function saveCost(request, actor, input, id = null) {
  assertWrite(actor, "costs");
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt)) throw permissionError("成本记录不存在或已删除", 404);
  if (before && actor.role === "成本录入员" && before.createdById !== actor.id) throw permissionError("只能维护自己录入的成本记录");
  if (before && actor.role !== "成本录入员" && !canAccessOrder(actor, before.order)) throw permissionError("无权限修改该成本记录");
  const order = await assertCostWritableOrder(requireText(input.orderId || input.receivableOrderId || input.order_id, "关联订单"), actor, before);
  const data = await buildCostData(order, actor, input, id, before);
  const result = id
    ? { cost: await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() }), reused: false }
    : await createCostIdempotently(data);
  const { cost, reused } = result;
  if (!reused) {
    await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(cost.id));
    const isConfirmed = Boolean(data?.costConfirmed);
    const wasConfirmed = Boolean(before?.costConfirmed);
    const action = id
      ? (isConfirmed !== wasConfirmed && isConfirmed ? "确认成本" : "更新成本")
      : "新增成本";
    await runNonCriticalTask("成本操作日志写入", () => writeAudit(request, actor, action, "order_costs", cost.id, before, cost));
  }
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(cost.orderId));
  return safeSerializeCost(cost);
}

export async function saveCosts(request, actor, input) {
  assertWrite(actor, "costs");
  const order = await assertCostWritableOrder(requireText(input.orderId || input.receivableOrderId || input.order_id, "关联订单"), actor);
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) {
    const error = new Error("请至少录入一条供应商成本");
    error.status = 400;
    throw error;
  }
  const rows = await Promise.all(items.map((item) => buildCostData(order, actor, {
    ...input,
    ...item,
    costType: item.costType || input.costType,
    paymentStatus: item.paymentStatus || input.paymentStatus,
    paymentDate: item.paymentDate ?? input.paymentDate,
    invoiceStatus: item.invoiceStatus || input.invoiceStatus,
    remark: item.remark ?? input.remark,
  })));
  const uniqueRows = [];
  const seen = new Set();
  rows.forEach((data) => {
    const key = duplicateCostFingerprint(data);
    if (seen.has(key)) return;
    seen.add(key);
    uniqueRows.push(data);
  });
  const results = [];
  for (const data of uniqueRows) {
    results.push(await createCostIdempotently(data));
  }
  const costs = results.map((result) => result.cost);
  const createdCosts = results.filter((result) => !result.reused).map((result) => result.cost);
  await Promise.all(createdCosts.map((cost) => runNonCriticalTask("成本操作日志写入", () => writeAudit(request, actor, "新增成本", "order_costs", cost.id, null, cost))));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(order.id));
  return costs.map(safeSerializeCost);
}

export async function deleteCost(request, actor, id) {
  assertWrite(actor, "costs");
  const before = await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt) throw permissionError("成本记录不存在或已删除", 404);
  if (actor.role === "成本录入员" && before.createdById !== actor.id) throw permissionError("只能删除自己录入的成本记录");
  if (actor.role !== "成本录入员" && !canAccessOrder(actor, before.order)) throw permissionError("无权限删除该成本记录");
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await runNonCriticalTask("成本删除操作日志写入", () => writeAudit(request, actor, "删除成本", "order_costs", id, before, cost));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(before.orderId));
}

export async function saveLogisticsCost(request, actor, input, id = null) {
  assertWrite(actor, "logistics");
  const order = await assertOrderOpen(requireText(input.orderId || input.order_id, "关联订单"), actor);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt || !validCost(before) || !isLogisticsCostType(before.costType))) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (before && !canAccessOrder(actor, before.order)) throw permissionError("无权限修改该物流费用");
  const data = await buildLogisticsCostData(order, actor, input, id, before);
  const cost = id
    ? await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() })
    : await prisma.orderCost.create({ data, include: includeCostRelations() });
  await runNonCriticalTask("物流费用发票状态同步", () => syncCostInvoiceStatus(cost.id));
  await runNonCriticalTask("物流费用操作日志写入", () => writeAudit(request, actor, id ? "修改物流费用" : "新增物流费用", "order_costs", cost.id, before, cost));
  return safeSerializeCost(cost);
}

export async function deleteLogisticsCost(request, actor, id) {
  assertWrite(actor, "logistics");
  const before = await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt || !isLogisticsCostType(before.costType)) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (!canAccessOrder(actor, before.order)) throw permissionError("无权限删除该物流费用");
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await runNonCriticalTask("物流费用删除操作日志写入", () => writeAudit(request, actor, "删除物流费用", "order_costs", id, before, cost));
}
