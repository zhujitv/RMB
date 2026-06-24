import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import {
  COST_PAYMENT_STATUSES,
  COST_BATCH_INPUT_SCHEMA,
  COST_INPUT_SCHEMA,
  COST_TYPES,
  CURRENCIES,
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_COST_TYPES,
  amountCny,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  booleanInput,
  canConfirmLogisticsCost,
  codedError,
  confirmedFactorySupplierMismatch,
  costTypeAllowsForeignCurrency,
  dateFromInput,
  effectivePermissions,
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

type CostWithOrder = Prisma.OrderCostGetPayload<{ include: { order: { include: { customer: true } } } }>;
type CostActorInput = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type CostActor = {
  id: string;
  role?: string;
  customPermissions?: unknown;
};
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type CostInput = Record<string, unknown>;
type CostOrderLike = {
  id: string;
  currency?: string | null;
};

function requireCostActor(actor: CostActorInput): CostActor {
  if (!actor?.id) throw permissionError("请先登录", 401);
  return {
    id: actor.id,
    role: actor.role || undefined,
    customPermissions: actor.customPermissions,
  };
}

function isOwnCostScope(actor: CostActor) {
  return effectivePermissions(actor).dataScope === "OWN_COST";
}

async function buildCostData(order: CostOrderLike, actor: CostActor, input: CostInput, id: string | null = null, before: CostWithOrder | null = null) {
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  if (!supplierId) throw codedError("请选择供应商", 400, "SUPPLIER_REQUIRED");
  const supplier = await assertSupplierActive(supplierId);
  if (!nonEmpty(input.amount)) throw codedError("请填写供应商成本金额", 400, "COST_AMOUNT_REQUIRED");
  const amount = num(input.amount);
  if (!(amount > 0)) throw codedError("供应商成本金额必须大于 0", 400, "COST_AMOUNT_REQUIRED");
  const inputCostType = normalizedCostType(nonEmpty(input.costType));
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
    throw codedError("请选择有效成本币种", 400, "CURRENCY_REQUIRED");
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
    throw codedError("当前成本类型为工厂货款，但供应商类型不是工厂供应商，请确认是否修改供应商资料。", 409, "FACTORY_SUPPLIER_MISMATCH");
  }
  const requestedCostConfirmed = booleanInput(input.costConfirmed, before?.costConfirmed || false);
  const canConfirmOrdinaryCost = ["管理员", "业务员"].includes(actor.role || "");
  if (isOwnCostScope(actor) && before?.costConfirmed) {
    throw codedError("已确认成本不能继续修改，请联系管理员处理。", 403, "CONFIRMED_COST_LOCKED");
  }
  if (requestedCostConfirmed && !canConfirmOrdinaryCost) {
    throw codedError("当前角色无权限确认成本。", 403, "COST_CONFIRMATION_REQUIRES_REVIEWER");
  }
  const costConfirmed = canConfirmOrdinaryCost ? requestedCostConfirmed : Boolean(before?.costConfirmed);
  const paymentStatusInput = nonEmpty(input.paymentStatus);
  const paymentStatus = COST_PAYMENT_STATUSES.includes(paymentStatusInput) ? paymentStatusInput : "待支付";
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

async function buildLogisticsCostData(order: CostOrderLike, actor: CostActor, input: CostInput, id: string | null = null, before: CostWithOrder | null = null) {
  const supplierId = nonEmpty(input.supplierId || input.supplier_id);
  const supplier = supplierId ? await assertSupplierActive(supplierId) : null;
  const supplierName = supplier?.supplierName || requireText(input.supplierName || input.vendorName, "供应商名称");
  const amount = requirePositive(input.amount, "物流费用金额");
  const currency = requireText(input.currency || order.currency || "CNY", "币种");
  if (!CURRENCIES.includes(currency)) {
    throw codedError("请选择有效币种", 400, "CURRENCY_REQUIRED");
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
      : (COST_PAYMENT_STATUSES.includes(nonEmpty(input.paymentStatus)) ? nonEmpty(input.paymentStatus) : "待支付"),
    costConfirmed,
    costConfirmedAt: costConfirmed ? (before?.costConfirmedAt || new Date()) : null,
    paymentDate: dateFromInput(input.paymentDate),
    invoiceStatus: "未收到",
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
}

export async function saveCost(request: AuditRequestLike, actor: CostActorInput, input: unknown, id: string | null = null) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const body = assertInputSchema(assertJsonObject(input), COST_INPUT_SCHEMA);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt)) throw permissionError("成本记录不存在或已删除", 404);
  const ownCostScope = isOwnCostScope(currentActor);
  if (before && ownCostScope && before.createdById !== currentActor.id) throw permissionError("只能维护自己录入的成本记录");
  if (before && !ownCostScope && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限修改该成本记录");
  const order = await assertCostWritableOrder(requireText(body.orderId || body.receivableOrderId || body.order_id, "关联订单"), currentActor, before);
  const data = await buildCostData(order, currentActor, body, id, before);
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
    await runNonCriticalTask("成本操作日志写入", () => writeAudit(request, currentActor, action, "order_costs", cost.id, before, cost));
  }
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(cost.orderId));
  return safeSerializeCost(cost);
}

export async function saveCosts(request: AuditRequestLike, actor: CostActorInput, input: unknown) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const body = assertInputSchema(assertJsonObject(input), COST_BATCH_INPUT_SCHEMA);
  const order = await assertCostWritableOrder(requireText(body.orderId || body.receivableOrderId || body.order_id, "关联订单"), currentActor);
  const items = Array.isArray(body.items)
    ? body.items.map((item, index) => assertInputSchema({ ...body, ...assertJsonObject(item, `第 ${index + 1} 行成本明细`) }, COST_INPUT_SCHEMA))
    : [];
  if (!items.length) {
    throw codedError("请至少录入一条供应商成本", 400, "COST_ITEMS_REQUIRED");
  }
  const rows = await Promise.all(items.map((item) => buildCostData(order, currentActor, {
    ...body,
    ...item,
    costType: item.costType || body.costType,
    paymentStatus: item.paymentStatus || body.paymentStatus,
    paymentDate: item.paymentDate ?? body.paymentDate,
    invoiceStatus: item.invoiceStatus || body.invoiceStatus,
    remark: item.remark ?? body.remark,
  })));
  const uniqueRows: Awaited<ReturnType<typeof buildCostData>>[] = [];
  const seen = new Set<string>();
  rows.forEach((data) => {
    const key = duplicateCostFingerprint(data);
    if (seen.has(key)) return;
    seen.add(key);
    uniqueRows.push(data);
  });
  const results: Awaited<ReturnType<typeof createCostIdempotently>>[] = [];
  for (const data of uniqueRows) {
    results.push(await createCostIdempotently(data));
  }
  const costs = results.map((result) => result.cost);
  const createdCosts = results.filter((result) => !result.reused).map((result) => result.cost);
  await Promise.all(createdCosts.map((cost) => runNonCriticalTask("成本操作日志写入", () => writeAudit(request, currentActor, "新增成本", "order_costs", cost.id, null, cost))));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(order.id));
  return costs.map(safeSerializeCost);
}

export async function deleteCost(request: AuditRequestLike, actor: CostActorInput, id: string) {
  assertWrite(actor, "costs");
  const currentActor = requireCostActor(actor);
  const before = await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt) throw permissionError("成本记录不存在或已删除", 404);
  const ownCostScope = isOwnCostScope(currentActor);
  if (ownCostScope && before.createdById !== currentActor.id) throw permissionError("只能删除自己录入的成本记录");
  if (!ownCostScope && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限删除该成本记录");
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: currentActor.id },
  });
  await runNonCriticalTask("成本删除操作日志写入", () => writeAudit(request, currentActor, "删除成本", "order_costs", id, before, cost));
  await runNonCriticalTask("退税资料完整度刷新", () => refreshTaxRefundCompleteness(before.orderId));
}

export async function saveLogisticsCost(request: AuditRequestLike, actor: CostActorInput, input: CostInput, id: string | null = null) {
  assertWrite(actor, "logistics");
  const currentActor = requireCostActor(actor);
  const order = await assertOrderOpen(requireText(input.orderId || input.order_id, "关联订单"), currentActor);
  const before = id ? await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } }) : null;
  if (id && (!before || before.deletedAt || !validCost(before) || !isLogisticsCostType(before.costType))) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (before && !canAccessOrder(currentActor, before.order)) throw permissionError("无权限修改该物流费用");
  const data = await buildLogisticsCostData(order, currentActor, input, id, before);
  const cost = id
    ? await prisma.orderCost.update({ where: { id }, data, include: includeCostRelations() })
    : await prisma.orderCost.create({ data, include: includeCostRelations() });
  await runNonCriticalTask("物流费用发票状态同步", () => syncCostInvoiceStatus(cost.id));
  await runNonCriticalTask("物流费用操作日志写入", () => writeAudit(request, currentActor, id ? "修改物流费用" : "新增物流费用", "order_costs", cost.id, before, cost));
  return safeSerializeCost(cost);
}

export async function deleteLogisticsCost(request: AuditRequestLike, actor: CostActorInput, id: string) {
  assertWrite(actor, "logistics");
  const currentActor = requireCostActor(actor);
  const before = await prisma.orderCost.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt || !isLogisticsCostType(before.costType)) {
    throw permissionError("物流费用记录不存在或已删除", 404);
  }
  if (!canAccessOrder(currentActor, before.order)) throw permissionError("无权限删除该物流费用");
  const cost = await prisma.orderCost.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: currentActor.id },
  });
  await runNonCriticalTask("物流费用删除操作日志写入", () => writeAudit(request, currentActor, "删除物流费用", "order_costs", id, before, cost));
}
