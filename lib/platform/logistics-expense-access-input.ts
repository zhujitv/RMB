import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { assertSupplierActive } from "./supplier-masters";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LOGISTICS_COST_TYPES,
  amountCny,
  codedError,
  expandLegacyFullLogisticsCostTypeList,
  nonEmpty,
  normalizedCostType,
  optional,
  permissionError,
  requirePositive,
  resolveExchangeRateSnapshot,
  todayInputInChina,
} from "./shared";
import {
  LOGISTICS_EXPENSE_CURRENCIES,
  logisticsCostTypeDefaultCurrency,
} from "./logistics-cost-types";
import {
  logisticsExpenseBillAuditStatusValue,
} from "./logistics-expense-access-serialization";
import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  type LogisticsActor,
  type LogisticsExpenseLike,
  type LogisticsExpenseOrderForAccess,
  type LogisticsSupplierForExpense,
  type UnknownRecord,
  logisticsExpenseActorId,
  logisticsExpenseActorRole,
  logisticsExpenseActorSupplierId,
  logisticsExpenseExchangeActor,
} from "./logistics-expense-access-model";
import { orderOwnedBySalesperson } from "./order-access";
import { assertBusinessNotArchived } from "./business-archive";
import {
  normalizeAppliedContainerCount,
  normalizeLogisticsExpenseBillingMethod,
  normalizeLogisticsExpenseBillingQuantity,
  normalizeLogisticsExpenseContainerType,
} from "./logistics-expense-billing-normalization";

export async function assertLogisticsExpenseOrder(input: UnknownRecord = {}, actor: LogisticsActor): Promise<LogisticsExpenseOrderForAccess> {
  const role = logisticsExpenseActorRole(actor);
  const id = logisticsExpenseActorId(actor);
  const supplierId = logisticsExpenseActorSupplierId(actor);
  const orderId = nonEmpty(input.orderId || input.order_id);
  const orderNo = nonEmpty(input.orderNo || input.order_no);
  const blNo = nonEmpty(input.blNo || input.billOfLadingNo || input.bill_of_lading_no);
  if (!orderId && !orderNo && !blNo) {
    throw codedError("未找到对应发货订单，请先建立或完善发货订单后再录入费用。", 400, "LOGISTICS_EXPENSE_ORDER_REQUIRED");
  }
  const orderFilters: Prisma.ReceivableOrderWhereInput[] = [];
  if (orderId) orderFilters.push({ id: orderId });
  if (orderNo) orderFilters.push({ orderNo: { equals: orderNo, mode: "insensitive" } });
  if (blNo) orderFilters.push({ blNo: { equals: blNo, mode: "insensitive" } });
  const order = await prisma.receivableOrder.findFirst({
    where: {
      deletedAt: null,
      OR: orderFilters,
    },
    include: {
      customer: true,
      salesperson: true,
      logisticsSuppliers: { include: { supplier: true } },
      domesticLogisticsInfos: {
        include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!order) throw codedError("未找到对应发货订单，请先建立或完善发货订单后再录入费用。", 404, "LOGISTICS_EXPENSE_ORDER_NOT_FOUND");
  let canAccess = role === "管理员" || (role === "业务员" && orderOwnedBySalesperson(order, id));
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) {
    canAccess = Boolean(supplierId && (order.logisticsSuppliers || []).some((row) => row.supplierId === supplierId));
  }
  if (!canAccess) throw permissionError("无权限访问该发货订单", 403);
  assertBusinessNotArchived(order, "该订单已提交退税并归档，不能再新增或修改物流费用。");
  return order;
}

export async function assertLogisticsExpenseSupplier(actor: LogisticsActor, order: LogisticsExpenseOrderForAccess, input: UnknownRecord = {}): Promise<LogisticsSupplierForExpense> {
  const role = logisticsExpenseActorRole(actor);
  const actorSupplier = logisticsExpenseActorSupplierId(actor);
  const isExternalLogisticsSupplier = [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role);
  const canSelectTemporarySupplier = role === "管理员" || role === "业务员";
  const requestedSupplierId = nonEmpty(input.supplierId || input.supplier_id);
  const supplierId = isExternalLogisticsSupplier && actorSupplier
    ? actorSupplier
    : requestedSupplierId;
  if (!supplierId) throw codedError("请选择物流供应商。", 400, "LOGISTICS_SUPPLIER_REQUIRED");
  const supplier = await assertSupplierActive(supplierId);
  if (!DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
    throw codedError("只有物流、报关、海运或港杂费用供应商可以提交物流费用。", 400, "LOGISTICS_SUPPLIER_TYPE_INVALID");
  }
  if (!canSelectTemporarySupplier) {
    if (!supplier.allowLogisticsExpenseEntry) throw codedError("该供应商尚未开启物流费用录入权限。", 403, "LOGISTICS_EXPENSE_ENTRY_DISABLED");
    if (!(order.logisticsSuppliers || []).some((row) => row.supplierId === supplier.id)) {
      throw codedError("该订单未分配给当前物流供应商，不能录入费用。", 403, "LOGISTICS_SUPPLIER_NOT_ASSIGNED");
    }
  } else if (role === "业务员" && !supplier.allowLogisticsExpenseEntry) {
    throw codedError("该供应商尚未开启物流费用录入权限。", 403, "LOGISTICS_EXPENSE_ENTRY_DISABLED");
  }
  return supplier;
}

function assertSupplierCostTypeAllowed(actor: LogisticsActor, supplier: LogisticsSupplierForExpense, costType: string) {
  if (logisticsExpenseActorRole(actor) === "管理员") return;
  const allowed = expandLegacyFullLogisticsCostTypeList(supplier.allowedLogisticsCostTypes || []);
  if (!allowed.includes(costType)) {
    throw codedError(`当前供应商不能录入${costType}。`, 403, "LOGISTICS_COST_TYPE_NOT_ALLOWED");
  }
}

async function resolveLogisticsExpenseExchange(costType: string, input: UnknownRecord, actor: LogisticsActor, before: LogisticsExpenseLike | null = null) {
  const currency = nonEmpty(
    input.currency || before?.currency || logisticsCostTypeDefaultCurrency(costType),
  ).toUpperCase();
  if (!LOGISTICS_EXPENSE_CURRENCIES.includes(currency)) {
    throw codedError("请选择有效币种。", 400, "CURRENCY_REQUIRED");
  }
  return resolveExchangeRateSnapshot(currency === "CNY"
    ? { ...input, currency: "CNY", exchangeRate: 1, exchangeRateSource: "系统", exchangeRateDate: input.exchangeRateDate || todayInputInChina() }
    : input, logisticsExpenseExchangeActor(actor), {
      currency,
      defaultDate: todayInputInChina(),
      allowHistoricalSource: before?.exchangeRateSource === "历史录入",
    });
}

export async function buildLogisticsExpenseData(
  order: LogisticsExpenseOrderForAccess,
  supplier: LogisticsSupplierForExpense,
  actor: LogisticsActor,
  input: UnknownRecord = {},
  before: LogisticsExpenseLike | null = null
) {
  const currentActorId = logisticsExpenseActorId(actor);
  const inputCostType = String(normalizedCostType(nonEmpty(input.costType)));
  const costType = LOGISTICS_COST_TYPES.includes(inputCostType) ? inputCostType : "";
  if (!costType) throw codedError("请选择有效物流费用类型。", 400, "LOGISTICS_EXPENSE_COST_TYPE_REQUIRED");
  assertSupplierCostTypeAllowed(actor, supplier, costType);
  const amount = requirePositive(input.amount, "物流费用金额");
  const exchange = await resolveLogisticsExpenseExchange(costType, input, actor, before);
  const beforeAuditStatus = before ? logisticsExpenseBillAuditStatusValue(before) : "";
  if (beforeAuditStatus === "审核通过" && logisticsExpenseActorRole(actor) !== "管理员") {
    throw codedError("已审核通过的费用金额不能修改。", 403, "LOGISTICS_EXPENSE_APPROVED_LOCKED");
  }
  const billingMethod = normalizeLogisticsExpenseBillingMethod(input, before);
  const billingQuantity = normalizeLogisticsExpenseBillingQuantity(input, billingMethod, before);
  const appliedContainerCount = normalizeAppliedContainerCount(input, order, before, billingQuantity);
  const containerType = normalizeLogisticsExpenseContainerType(input, order, before);
  return {
    orderId: order.id,
    supplierId: supplier.id,
    supplierNameSnapshot: nonEmpty(supplier.supplierName),
    costType,
    currency: exchange.currency,
    exchangeRate: exchange.exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchange.exchangeRate),
    containerType,
    appliedContainerCount,
    billingMethod,
    billingQuantity,
    remark: optional(input.remark),
    updatedById: currentActorId || null,
    ...(before ? {} : { createdById: currentActorId || null }),
  };
}

export function logisticsExpenseRequestedAuditStatus(input: UnknownRecord = {}, before: LogisticsExpenseLike | null = null) {
  const beforeAuditStatus = before ? logisticsExpenseBillAuditStatusValue(before) : "";
  const requestedStatus = nonEmpty(input.auditStatus || input.status || (before ? beforeAuditStatus : (input.submit === false ? "草稿" : "待审核")));
  return ["草稿", "待审核"].includes(requestedStatus) ? requestedStatus : "待审核";
}
