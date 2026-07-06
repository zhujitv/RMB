import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { assertCostWritableOrder, canAccessOrder } from "./order-access";
import { assertSupplierActive } from "./supplier-masters";
import {
  COST_PAYMENT_STATUSES,
  COST_TYPES,
  CURRENCIES,
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_COST_TYPES,
  ORDER_COST_STATUS_ACTIVE,
  ORDER_COST_STATUS_VOID,
  amountCny,
  booleanInput,
  canConfirmLogisticsCost,
  codedError,
  confirmedFactorySupplierMismatch,
  costTypeAllowsForeignCurrency,
  dateFromInput,
  effectivePermissions,
  inputHasOwn,
  isLogisticsGeneratedCostSourceType,
  isLogisticsCostType,
  isProductSupplierType,
  nonEmpty,
  normalizedCostType,
  num,
  optional,
  permissionError,
  requirePositive,
  requireText,
  resolveExchangeRateSnapshot,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { includeCostRelations, serializeCostOrderSummary } from "./cost-records-shared";

export type CostWithOrder = Prisma.OrderCostGetPayload<{ include: { order: { include: { customer: true } } } }>;
export type CostActorInput = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type CostActor = {
  id: string;
  role?: string;
  customPermissions?: unknown;
};
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type CostInput = Record<string, unknown>;
export type CostOrderLike = {
  id: string;
  currency?: string | null;
};
export type DeletedCostAction = "deleted" | "voided";
export type CostLifecycleReasonInput = {
  reason?: unknown;
  voidReason?: unknown;
  deleteReason?: unknown;
  restoreReason?: unknown;
  action?: unknown;
};
export type CostWithPaymentRelations = Prisma.OrderCostGetPayload<{ include: ReturnType<typeof includeCostRelations> }> & {
  paid?: boolean | null;
  paidAt?: Date | null;
  paymentVoucherUrl?: string | null;
  paymentVoucherFileName?: string | null;
  paymentVoucherMimeType?: string | null;
  paymentVoucherUploadedAt?: Date | null;
  paymentVoucherStorageKey?: string | null;
  paymentVoucherBucket?: string | null;
};

export function requireCostActor(actor: CostActorInput): CostActor {
  if (!actor?.id) throw permissionError("请先登录", 401);
  return {
    id: actor.id,
    role: actor.role || undefined,
    customPermissions: actor.customPermissions,
  };
}

export function isOwnCostScope(actor: CostActor) {
  return effectivePermissions(actor).dataScope === "OWN_COST";
}

export function isCostEntryActor(actor: CostActor) {
  return isOwnCostScope(actor) || actor.role === "成本录入员";
}

export function isPaidCost(cost: { paymentStatus?: string | null }) {
  return cost.paymentStatus === "已支付" || cost.paymentStatus === "部分支付";
}

export function isVoidedCost(cost: { status?: string | null; paymentStatus?: string | null; deletedAt?: Date | string | null }) {
  return cost.status === ORDER_COST_STATUS_VOID || cost.paymentStatus === "已取消" || Boolean(cost.deletedAt);
}

export function assertCanManageProductSupplierPayment(actor: CostActor) {
  if (actor.role === "管理员" || actor.role === "财务") return;
  throw permissionError("只有管理员或财务可以维护产品供应商货款付款信息", 403);
}

export function isProductSupplierPaymentCost(cost: {
  costType?: string | null;
  sourceType?: string | null;
  supplier?: { supplierType?: string | null } | null;
}) {
	if (isLogisticsGeneratedCostSourceType(cost.sourceType) || isLogisticsCostType(cost.costType || "")) return false;
	return FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType || "") || isProductSupplierType(cost.supplier?.supplierType);
}

export function assertProductSupplierPaymentCost(cost: {
  costType?: string | null;
  sourceType?: string | null;
  supplier?: { supplierType?: string | null } | null;
}) {
  if (!isProductSupplierPaymentCost(cost)) {
    throw codedError("付款信息仅适用于成本管理中的产品供应商货款。", 400, "COST_PAYMENT_SCOPE_INVALID");
  }
}

export function paymentBooleanInput(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = nonEmpty(value).toLowerCase();
  return ["true", "1", "yes", "y", "已付款", "已支付"].includes(text);
}

export function paidAtFromInput(value: unknown, fallback = new Date()) {
  const text = nonEmpty(value);
  if (!text) return fallback;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw codedError("付款时间格式错误", 400, "INVALID_PAID_AT");
  return date;
}

export function paymentVoucherFileName(extension: string) {
  return `汇款水单.${extension === "jpeg" ? "jpg" : extension}`;
}

export async function loadCostForPayment(actor: CostActor, id: string): Promise<CostWithPaymentRelations> {
  const cost = await prisma.orderCost.findFirst({
    where: { id, deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } },
    include: includeCostRelations(),
  });
  if (!cost) throw permissionError("成本记录不存在或已删除", 404);
  if (!canAccessOrder(actor, cost.order)) throw permissionError("无权限读取该成本记录");
  assertProductSupplierPaymentCost(cost);
  return cost as CostWithPaymentRelations;
}

type CostDeletionCandidate = {
  sourceType?: string | null;
  paymentStatus?: string | null;
  costConfirmed?: boolean | null;
  paid?: boolean | null;
  paidAt?: Date | string | null;
  paymentDate?: Date | string | null;
  paymentVoucherUrl?: string | null;
  paymentVoucherFileName?: string | null;
  paymentVoucherStorageKey?: string | null;
  status?: string | null;
  documents?: Array<{ uploadStatus?: string | null; deletedAt?: Date | string | null; factoryDocumentRequestId?: string | null }> | null;
  supplierDocumentRequests?: Array<{ id?: string | null; deletedAt?: Date | string | null }> | null;
  generatedLogisticsExpense?: unknown;
  order?: {
    taxArchived?: boolean | null;
    taxRefundStatus?: string | null;
    taxRefundArchivedAt?: Date | string | null;
    commissionStatus?: string | null;
    commissionSettlementRecords?: Array<{ id?: string | null }> | null;
  } | null;
};

function hasUploadedCostDocument(cost: CostDeletionCandidate) {
  return (cost.documents || []).some((document) => (
    !document.deletedAt
    && (document.uploadStatus === "SUCCESS" || Boolean(document.factoryDocumentRequestId))
  ));
}

function hasPaymentRecord(cost: CostDeletionCandidate) {
  return Boolean(cost.paid)
    || Boolean(cost.paidAt)
    || Boolean(cost.paymentDate)
    || isPaidCost(cost);
}

function hasPaymentVoucherRecord(cost: CostDeletionCandidate) {
  return Boolean(cost.paymentVoucherStorageKey || cost.paymentVoucherUrl || cost.paymentVoucherFileName);
}

function hasTaxRefundLink(cost: CostDeletionCandidate) {
  const order = cost.order;
  if (!order) return false;
  const status = nonEmpty(order.taxRefundStatus);
  return Boolean(order.taxArchived || order.taxRefundArchivedAt || (status && status !== "NOT_READY"));
}

function hasSupplierDocumentRequestLink(cost: CostDeletionCandidate) {
  return (cost.supplierDocumentRequests || []).some((request) => !request.deletedAt);
}

function hasProfitSettlementLink(cost: CostDeletionCandidate) {
  const order = cost.order;
  if (!order) return false;
  return ["已结算", "SETTLED"].includes(nonEmpty(order.commissionStatus))
    || Boolean((order.commissionSettlementRecords || []).length);
}

export function costDeleteBlockReasons(cost: CostDeletionCandidate) {
  const reasons: string[] = [];
  if (isVoidedCost(cost)) reasons.push("成本已作废或已删除");
  if (nonEmpty(cost.paymentStatus) !== "待支付") reasons.push("付款状态不是待支付");
  if (hasPaymentRecord(cost)) reasons.push("已存在付款记录");
  if (hasPaymentVoucherRecord(cost)) reasons.push("已存在付款凭证");
  if (hasUploadedCostDocument(cost)) reasons.push("已存在成本附件或发票资料");
  if (hasTaxRefundLink(cost)) reasons.push("订单已进入退税流程");
  if (hasSupplierDocumentRequestLink(cost)) reasons.push("已关联资料回传任务");
  if (hasProfitSettlementLink(cost)) reasons.push("已关联利润或提成结算");
  if (cost.costConfirmed) reasons.push("成本已确认");
	if (isLogisticsGeneratedCostSourceType(cost.sourceType) || cost.generatedLogisticsExpense) reasons.push("物流费用同步成本不能在成本管理物理删除");
  return [...new Set(reasons)];
}

export function canPhysicallyDeleteCost(cost: CostDeletionCandidate) {
  return costDeleteBlockReasons(cost).length === 0;
}

export function requireCostLifecycleReason(input: CostLifecycleReasonInput | null | undefined, fallbackLabel = "原因") {
  const reason = nonEmpty(input?.reason || input?.voidReason || input?.deleteReason || input?.restoreReason);
  if (!reason) throw codedError(`${fallbackLabel}不能为空`, 400, "COST_LIFECYCLE_REASON_REQUIRED");
  return reason;
}

export function activeOrderCostWhere(): Prisma.OrderCostWhereInput {
  return {
    deletedAt: null,
    status: { not: ORDER_COST_STATUS_VOID },
  };
}

export function restoreOrderCostData(actor: CostActor, reason: string): Prisma.OrderCostUncheckedUpdateInput {
  return {
    status: ORDER_COST_STATUS_ACTIVE,
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    restoredAt: new Date(),
    restoredById: actor.id,
    restoreReason: reason,
    updatedById: actor.id,
  };
}

export function assertCanDeleteCost(actor: CostActor, cost: { createdById?: string | null; paymentStatus?: string | null; costConfirmed?: boolean | null }) {
  if (actor.role === "管理员") return;
  const ownCost = cost.createdById === actor.id;
  if (isCostEntryActor(actor)) {
    if (!ownCost) throw permissionError("只能删除自己录入的成本记录");
    if (cost.costConfirmed || isPaidCost(cost)) {
      throw permissionError("已确认或已付款的成本不能删除，请联系管理员处理。");
    }
    return;
  }
  if (actor.role === "业务员") {
    if (!ownCost) throw permissionError("只能删除自己录入的成本记录");
    if (cost.costConfirmed) throw permissionError("普通业务员不可删除已确认成本");
    if (isPaidCost(cost)) throw permissionError("已付款成本不能删除，请联系管理员处理。");
    return;
  }
  throw permissionError("当前角色无权限删除成本明细");
}

export async function costOrderSummaryForMutation(orderId: string, actor: CostActor) {
  const ownCostScope = isOwnCostScope(actor);
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      customer: true,
      costs: {
        where: {
          deletedAt: null,
          status: { not: ORDER_COST_STATUS_VOID },
          ...(ownCostScope ? { createdById: actor.id } : {}),
        },
        include: {
          supplier: true,
          generatedLogisticsExpense: { select: { id: true } },
          supplierDocumentRequests: {
            where: { deletedAt: null },
            select: { id: true, deletedAt: true },
            take: 1,
          },
          documents: {
            where: { deletedAt: null },
            include: { uploadedBy: true, supplier: true },
            orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
          },
        },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });
  return order ? serializeCostOrderSummary(order) : null;
}

export function deletionAuditPayload(
  action: DeletedCostAction,
  actor: CostActor,
  cost: CostWithOrder & { supplier?: { supplierName?: string | null } | null },
  deletedAt: Date,
) {
  return {
    action,
    deletedById: actor.id,
    deletedAt,
    orderNo: cost.order.orderNo,
    costType: cost.costType,
    supplier: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName,
    amount: Number(cost.amount),
    currency: cost.currency,
    amountCny: Number(cost.amountCny),
  };
}

export async function buildCostData(order: CostOrderLike, actor: CostActor, input: CostInput, id: string | null = null, before: CostWithOrder | null = null) {
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
	if (!id && !isLogisticsGeneratedCostSourceType(sourceType) && isLogisticsCostType(costType)) {
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
  if (FACTORY_SUPPLIER_COST_TYPES.includes(costType) && !isProductSupplierType(supplier.supplierType) && !confirmedFactorySupplierMismatch(input)) {
    throw codedError("当前成本类型为工厂货款，但供应商类型不是产品供应商，请确认是否修改供应商资料。", 409, "FACTORY_SUPPLIER_MISMATCH");
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
  const requestedPaymentStatus = COST_PAYMENT_STATUSES.includes(paymentStatusInput) ? paymentStatusInput : "待支付";
  const requestedPaymentDate = dateFromInput(input.paymentDate);
  const productPaymentCost = isProductSupplierPaymentCost({ costType, sourceType, supplier });
  const canManageProductPayment = actor.role === "管理员" || actor.role === "财务";
  const paymentStatus = productPaymentCost && !canManageProductPayment
    ? (before?.paymentStatus || "待支付")
    : requestedPaymentStatus;
  const paymentDate = productPaymentCost && !canManageProductPayment
    ? (before?.paymentDate || null)
    : requestedPaymentDate;
  if (!(productPaymentCost && !canManageProductPayment) && paymentStatus === "已支付" && !paymentDate) {
    throw codedError("已支付成本必须填写付款日期", 400, "PAYMENT_DATE_REQUIRED");
  }
  const paid = productPaymentCost && isPaidCost({ paymentStatus });
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
    ...(productPaymentCost ? {
      paid: productPaymentCost && !canManageProductPayment ? Boolean(before?.paid) : paid,
      paidAt: productPaymentCost && !canManageProductPayment ? (before?.paidAt || null) : (paid ? paymentDate : null),
    } : {}),
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

export async function buildLogisticsCostData(order: CostOrderLike, actor: CostActor, input: CostInput, id: string | null = null, before: CostWithOrder | null = null) {
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
