import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { assertSupplierActive } from "./supplier-masters";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LOGISTICS_COST_TYPES,
  LOGISTICS_EXPENSE_AUDIT_STATUSES,
  amountCny,
  codedError,
  dateFromInput,
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
  includeLogisticsExpenseRelations,
  logisticsExpenseBillAuditStatusValue,
  logisticsExpenseLegacyBillKey,
  logisticsExpenseBillKey,
  logisticsExpenseBillOfLadingNo,
  logisticsExpenseOrderSummary,
} from "./logistics-expense-access-serialization";
import { logisticsExpenseAccessWhere } from "./logistics-expense-access-permissions";
import {
  DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_EXPENSE_BILLING_METHODS,
  LOGISTICS_OPERATOR_ROLE,
  LogisticsActor,
  LogisticsExpenseForCostSync,
  LogisticsExpenseLike,
  LogisticsExpenseOrderForAccess,
  LogisticsOrderLike,
  LogisticsSupplierForExpense,
  UnknownRecord,
  logisticsExpenseActorId,
  logisticsExpenseActorRole,
  logisticsExpenseActorSupplierId,
  logisticsExpenseExchangeActor,
  normalizeBillingMethodValue,
} from "./logistics-expense-access-model";
import { orderOwnedBySalesperson } from "./order-access";

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
  if (role === "管理员") return order;
  if (role === "业务员" && orderOwnedBySalesperson(order, id)) return order;
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) {
    if (supplierId && (order.logisticsSuppliers || []).some((row) => row.supplierId === supplierId)) return order;
  }
  throw permissionError("无权限访问该发货订单", 403);
}

export async function assertLogisticsExpenseSupplier(actor: LogisticsActor, order: LogisticsExpenseOrderForAccess, input: UnknownRecord = {}): Promise<LogisticsSupplierForExpense> {
  const role = logisticsExpenseActorRole(actor);
  const actorSupplier = logisticsExpenseActorSupplierId(actor);
  const requestedSupplierId = nonEmpty(input.supplierId || input.supplier_id);
  const supplierId = [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role) && actorSupplier
    ? actorSupplier
    : requestedSupplierId;
  if (!supplierId) throw codedError("请选择物流供应商。", 400, "LOGISTICS_SUPPLIER_REQUIRED");
  const supplier = await assertSupplierActive(supplierId);
  if (!DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
    throw codedError("只有物流、报关、海运或港杂费用供应商可以提交物流费用。", 400, "LOGISTICS_SUPPLIER_TYPE_INVALID");
  }
  if (role !== "管理员") {
    if (!supplier.allowLogisticsExpenseEntry) throw codedError("该供应商尚未开启物流费用录入权限。", 403, "LOGISTICS_EXPENSE_ENTRY_DISABLED");
    if (!(order.logisticsSuppliers || []).some((row) => row.supplierId === supplier.id)) {
      throw codedError("该订单未分配给当前物流供应商，不能录入费用。", 403, "LOGISTICS_SUPPLIER_NOT_ASSIGNED");
    }
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
  return LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "待审核";
}

export async function ensureLogisticsExpenseBill(
  order: LogisticsExpenseOrderForAccess,
  supplier: LogisticsSupplierForExpense | null,
  actor: LogisticsActor,
  input: UnknownRecord = {}
) {
  const billOfLadingNo = logisticsExpenseBillOfLadingNo(order);
  const supplierId = nonEmpty(supplier?.id || input.supplierId || input.supplier_id);
  const billKey = logisticsExpenseBillKey(order.id, billOfLadingNo, supplierId);
  const legacyBillKey = logisticsExpenseLegacyBillKey(order.id, billOfLadingNo);
  if (!billKey) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_KEY_INVALID");
  const requestedStatus = nonEmpty(input.auditStatus || input.status || "草稿");
  const auditStatus = LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "草稿";
  const now = new Date();
  const existing = await prisma.logisticsBill.findUnique({ where: { billKey } });
  if (!existing) {
    const legacyBill = legacyBillKey
      ? await prisma.logisticsBill.findFirst({
        where: { billKey: legacyBillKey, deletedAt: null },
        select: { id: true, supplierId: true },
      })
      : null;
    const legacySuppliers = legacyBill
      ? await prisma.logisticsExpense.findMany({
        where: {
          billId: legacyBill.id,
          deletedAt: null,
        },
        distinct: ["supplierId"],
        select: { supplierId: true },
        take: 2,
      })
      : [];
    const legacySupplierIds = legacySuppliers.map((row) => nonEmpty(row.supplierId)).filter(Boolean);
    const legacyHasOnlyThisSupplier = legacyBill
      && supplierId
      && (!legacyBill.supplierId || legacyBill.supplierId === supplierId)
      && (!legacySupplierIds.length || (legacySupplierIds.length === 1 && legacySupplierIds[0] === supplierId));
    if (legacyHasOnlyThisSupplier) {
      return prisma.logisticsBill.update({
        where: { id: legacyBill.id },
        data: {
          billKey,
          supplierId,
          billOfLadingNo,
          deletedAt: null,
          updatedById: logisticsExpenseActorId(actor) || null,
          ...(auditStatus === "待审核" ? {
            auditStatus,
            submittedAt: dateFromInput(input.submittedAt) || now,
            submittedById: logisticsExpenseActorId(actor) || null,
            rejectReason: null,
            invoiceNotificationError: null,
          } : {}),
        },
      });
    }
  }
  return prisma.logisticsBill.upsert({
    where: { billKey },
    update: {
      ...(supplierId ? { supplierId } : {}),
      deletedAt: null,
      updatedById: logisticsExpenseActorId(actor) || null,
      ...(auditStatus === "待审核" ? {
        auditStatus,
        submittedAt: dateFromInput(input.submittedAt) || now,
        submittedById: logisticsExpenseActorId(actor) || null,
        rejectReason: null,
        invoiceNotificationError: null,
      } : {}),
    },
    create: {
      billKey,
      orderId: order.id,
      supplierId: supplierId || null,
      billOfLadingNo,
      auditStatus,
      invoiceStatus: "未通知",
      paymentStatus: "待开票",
      submittedAt: auditStatus === "待审核" ? (dateFromInput(input.submittedAt) || now) : null,
      submittedById: auditStatus === "待审核" ? (logisticsExpenseActorId(actor) || null) : null,
      createdById: logisticsExpenseActorId(actor) || null,
      updatedById: logisticsExpenseActorId(actor) || null,
    },
  });
}

function integerBillingMethod(method: unknown) {
  return ["按柜", "按票", "按次"].includes(normalizeBillingMethodValue(method));
}

function normalizeLogisticsExpenseBillingMethod(input: UnknownRecord = {}, before: LogisticsExpenseLike | null = null): string {
  const hasBillingMethodInput = Object.prototype.hasOwnProperty.call(input, "billingMethod")
    || Object.prototype.hasOwnProperty.call(input, "billing_method");
  if (!hasBillingMethodInput && before) return normalizeBillingMethodValue(before.billingMethod);
  const requested = nonEmpty(input.billingMethod ?? input.billing_method ?? DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  if (!LOGISTICS_EXPENSE_BILLING_METHODS.includes(requested)) {
    throw codedError("请选择有效计费方式。", 400, "LOGISTICS_BILLING_METHOD_INVALID");
  }
  return requested;
}

function normalizeLogisticsExpenseBillingQuantity(input: UnknownRecord = {}, billingMethod = DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD, before: LogisticsExpenseLike | null = null): number {
  const hasQuantityInput = Object.prototype.hasOwnProperty.call(input, "billingQuantity")
    || Object.prototype.hasOwnProperty.call(input, "billing_quantity")
    || Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
    || Object.prototype.hasOwnProperty.call(input, "containerCount")
    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasQuantityInput && before) return Number(before.billingQuantity ?? before.appliedContainerCount ?? 1);
  const raw = input.billingQuantity ?? input.billing_quantity ?? input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return 1;
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw codedError("适用数量/范围必须大于 0。", 400, "LOGISTICS_BILLING_QUANTITY_INVALID");
  }
  if (integerBillingMethod(billingMethod) && !Number.isInteger(quantity)) {
    throw codedError("按柜、按票、按次的适用数量/范围必须为正整数。", 400, "LOGISTICS_BILLING_QUANTITY_INTEGER_REQUIRED");
  }
  return quantity;
}

function normalizeLogisticsExpenseContainerType(input: UnknownRecord = {}, order: LogisticsOrderLike = {}, before: LogisticsExpenseLike | null = null): string | null {
  const hasContainerTypeInput = Object.prototype.hasOwnProperty.call(input, "containerType")
    || Object.prototype.hasOwnProperty.call(input, "container_type");
  if (!hasContainerTypeInput && before) return before.containerType || null;
  const requested = optional(input.containerType ?? input.container_type);
  if (!requested) return null;
  const summary = logisticsExpenseOrderSummary(order);
  const allowedTypes = summary.containerTypes || [];
  if (allowedTypes.length && !allowedTypes.includes(requested)) {
    throw codedError("请选择有效集装箱柜型。", 400, "LOGISTICS_CONTAINER_TYPE_INVALID");
  }
  return requested;
}

function normalizeAppliedContainerCount(input: UnknownRecord = {}, order: LogisticsOrderLike = {}, before: LogisticsExpenseLike | null = null, billingQuantity = 1): number {
  const hasContainerCountInput = Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
	    || Object.prototype.hasOwnProperty.call(input, "containerCount")
	    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasContainerCountInput && before) return Number(before.appliedContainerCount ?? 1);
  const raw = input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return Math.max(1, Math.ceil(Number(billingQuantity || 1)));
  const count = Number(text);
  if (!Number.isFinite(count) || count <= 0) {
	    throw codedError("适用数量必须为正整数。", 400, "LOGISTICS_CONTAINER_COUNT_INVALID");
  }
  return Math.max(1, Math.ceil(count));
}

export async function loadLogisticsExpenseForAction(id: string, actor: LogisticsActor) {
  const expense = await prisma.logisticsExpense.findFirst({
    where: {
      id,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
  });
  if (!expense) throw permissionError("物流费用不存在或无权访问", 404);
  return expense;
}

export async function createOrUpdateCostFromLogisticsExpense(tx: Prisma.TransactionClient | typeof prisma, expense: LogisticsExpenseForCostSync, actor: LogisticsActor) {
  const costType = String(normalizedCostType(nonEmpty(expense.costType)));
  const currentActorId = logisticsExpenseActorId(actor);
  const costData = {
    orderId: expense.orderId,
    supplierId: expense.supplierId,
    supplierNameSnapshot: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    vendorName: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    costType,
    currency: nonEmpty(expense.currency || "CNY"),
    exchangeRate: expense.exchangeRate ?? 1,
    exchangeRateDate: dateFromInput(expense.exchangeRateDate),
    exchangeRateSource: expense.exchangeRateSource,
    exchangeRateType: expense.exchangeRateType,
    amount: expense.amount ?? 0,
    amountCny: expense.amountCny ?? 0,
    paymentStatus: "待支付",
    costConfirmed: true,
    costConfirmedAt: new Date(),
    paymentDate: null,
    invoiceStatus: "未通知",
    sourceType: "LOGISTICS_EXPENSE",
    sourceId: expense.id,
    remark: expense.remark || "",
    updatedById: currentActorId || null,
  };
  const existing = expense.costId
    ? await tx.orderCost.findFirst({ where: { id: expense.costId, deletedAt: null } })
    : await tx.orderCost.findFirst({ where: { sourceType: "LOGISTICS_EXPENSE", sourceId: expense.id, deletedAt: null } });
  if (existing) return tx.orderCost.update({ where: { id: existing.id }, data: costData });
  return tx.orderCost.create({ data: { ...costData, createdById: currentActorId || null } });
}
