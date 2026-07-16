import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { assertSupplierActive } from "./supplier-masters";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LOGISTICS_COST_TYPES,
  LOGISTICS_EXPENSE_AUDIT_STATUSES,
  LOGISTICS_FEE_COST_SOURCE_TYPE,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
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
import { logisticsCostPaymentDataFromExpense } from "./logistics-expense-cost-payment";
import { logisticsCostHasSettlementEvidence } from "./logistics-expense-cost-safety";
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
import { assertBusinessNotArchived } from "./business-archive";

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

const LOGISTICS_BILL_APPENDABLE_INVOICE_STATUSES = [
  "待开票",
  "未通知",
  "已通知开票",
  "通知失败",
  "待开票 / 通知失败",
];

const LOGISTICS_BILL_APPENDABLE_PAYMENT_STATUSES = ["待开票", "未付款"];

type LogisticsExpenseBillWriteDb = Prisma.TransactionClient | typeof prisma;

async function updateAppendableLogisticsExpenseBill(
  db: LogisticsExpenseBillWriteDb,
  billId: string,
  actor: LogisticsActor,
  auditStatus: string,
  submittedAt: unknown,
  now: Date,
  extraData: Prisma.LogisticsBillUncheckedUpdateManyInput = {},
) {
  await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "logistics_bills"
    WHERE "id" = ${billId}
    FOR UPDATE
  `);
  const current = await db.logisticsBill.findUnique({ where: { id: billId } });
  if (!current) {
    throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_APPEND_STATE_CHANGED");
  }
  if (current.status === "voided") {
    throw codedError("该订单/供应商对应物流费用账单已作废，不能继续追加费用，请重新核对订单后创建新账单。", 400, "LOGISTICS_BILL_VOIDED_CREATE_BLOCKED");
  }
  if (
    !["草稿", "已驳回"].includes(current.auditStatus)
    || !LOGISTICS_BILL_APPENDABLE_INVOICE_STATUSES.includes(current.invoiceStatus)
    || !LOGISTICS_BILL_APPENDABLE_PAYMENT_STATUSES.includes(current.paymentStatus)
  ) {
    throw codedError("该订单/供应商已有进入审核、发票或付款流程的物流费用账单，不能继续追加明细。", 409, "LOGISTICS_BILL_APPEND_STATE_BLOCKED");
  }
  const updated = await db.logisticsBill.updateMany({
    where: {
      id: billId,
      status: { not: "voided" },
      auditStatus: { in: ["草稿", "已驳回"] },
      invoiceStatus: { in: LOGISTICS_BILL_APPENDABLE_INVOICE_STATUSES },
      paymentStatus: { in: LOGISTICS_BILL_APPENDABLE_PAYMENT_STATUSES },
    },
    data: {
      ...extraData,
      deletedAt: null,
      updatedById: logisticsExpenseActorId(actor) || null,
      ...(auditStatus === "待审核" ? {
        auditStatus,
        submittedAt: dateFromInput(submittedAt) || now,
        submittedById: logisticsExpenseActorId(actor) || null,
        rejectReason: null,
        invoiceNotificationError: null,
      } : {}),
    },
  });
  if (updated.count !== 1) {
    throw codedError("物流费用账单状态已变化，新增明细已取消，请刷新后重试。", 409, "LOGISTICS_BILL_APPEND_STATE_CHANGED");
  }
  return db.logisticsBill.findUniqueOrThrow({ where: { id: billId } });
}

export async function ensureLogisticsExpenseBill(
  order: LogisticsExpenseOrderForAccess,
  supplier: LogisticsSupplierForExpense | null,
  actor: LogisticsActor,
  input: UnknownRecord = {},
  db: LogisticsExpenseBillWriteDb = prisma,
) {
  const billOfLadingNo = logisticsExpenseBillOfLadingNo(order);
  const supplierId = nonEmpty(supplier?.id || input.supplierId || input.supplier_id);
  const billKey = logisticsExpenseBillKey(order.id, billOfLadingNo, supplierId);
  const legacyBillKey = logisticsExpenseLegacyBillKey(order.id, billOfLadingNo);
  if (!billKey) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_KEY_INVALID");
  const requestedStatus = nonEmpty(input.auditStatus || input.status || "草稿");
  const auditStatus = LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "草稿";
  const now = new Date();
  const existing = await db.logisticsBill.findUnique({ where: { billKey } });
  if (existing) {
    return updateAppendableLogisticsExpenseBill(
      db,
      existing.id,
      actor,
      auditStatus,
      input.submittedAt,
      now,
      supplierId ? { supplierId } : {},
    );
  }
  const legacyBill = legacyBillKey
      ? await db.logisticsBill.findFirst({
        where: { billKey: legacyBillKey, deletedAt: null },
        select: { id: true, supplierId: true },
      })
      : null;
    const legacySuppliers = legacyBill
      ? await db.logisticsExpense.findMany({
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
      return updateAppendableLogisticsExpenseBill(
        db,
        legacyBill.id,
        actor,
        auditStatus,
        input.submittedAt,
        now,
        {
          billKey,
          supplierId,
          billOfLadingNo,
        },
      );
    }
  try {
    return await db.logisticsBill.create({
      data: {
      billKey,
      orderId: order.id,
      supplierId: supplierId || null,
      billOfLadingNo,
      auditStatus,
      invoiceStatus: "待开票",
      paymentStatus: "待开票",
      submittedAt: auditStatus === "待审核" ? (dateFromInput(input.submittedAt) || now) : null,
      submittedById: auditStatus === "待审核" ? (logisticsExpenseActorId(actor) || null) : null,
      createdById: logisticsExpenseActorId(actor) || null,
      updatedById: logisticsExpenseActorId(actor) || null,
    },
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "P2002") {
      throw codedError("同一订单/供应商的物流费用账单正在创建，请刷新后重试。", 409, "LOGISTICS_BILL_CREATE_CONFLICT");
    }
    throw error;
  }
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
  assertBusinessNotArchived(expense.order, "该订单已提交退税并归档，物流费用只允许查看和下载。");
  return expense;
}

export async function createOrUpdateCostFromLogisticsExpense(
	tx: Prisma.TransactionClient | typeof prisma,
	expense: LogisticsExpenseForCostSync,
	actor: LogisticsActor,
	options: { settledCostMode?: "reject" | "preserve-required" } = {},
) {
	const costType = String(normalizedCostType(nonEmpty(expense.costType)));
	const currentActorId = logisticsExpenseActorId(actor);
	const invoiceUploaded = Boolean(expense.invoiceDocumentId)
		|| ["已上传", "已确认", "已上传发票", "已确认发票"].includes(nonEmpty(expense.invoiceStatus || expense.detailInvoiceStatus));
	const paymentData = logisticsCostPaymentDataFromExpense(expense);
	const confirmedAt = new Date();
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
    paymentStatus: paymentData.paymentStatus,
    paid: paymentData.paid,
	    paidAt: paymentData.paidAt,
	    costConfirmed: true,
	    paymentDate: paymentData.paymentDate,
		invoiceStatus: invoiceUploaded ? "已收到" : "未收到",
		sourceType: LOGISTICS_FEE_COST_SOURCE_TYPE,
		sourceId: expense.id,
    remark: expense.remark || "",
    updatedById: currentActorId || null,
	};
	let existing = expense.costId
		? await tx.orderCost.findFirst({ where: { id: expense.costId, deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } } })
		: null;
	if (existing) {
		const sourceMatches = LOGISTICS_GENERATED_COST_SOURCE_TYPES.includes(existing.sourceType)
			&& existing.sourceId === expense.id;
		const scopeMatches = existing.orderId === expense.orderId
			&& (!existing.supplierId || existing.supplierId === expense.supplierId);
		if (!sourceMatches || !scopeMatches) {
			throw codedError(
				"物流费用关联的成本来源、订单或供应商不一致，已阻止覆盖正式成本，请先修复历史关联。",
				409,
				"LOGISTICS_COST_LINK_SCOPE_MISMATCH",
			);
		}
	}
	const sourceCosts = await tx.orderCost.findMany({
		where: {
			sourceType: { in: LOGISTICS_GENERATED_COST_SOURCE_TYPES },
			sourceId: expense.id,
			deletedAt: null,
			status: { not: ORDER_COST_STATUS_VOID },
		},
		orderBy: [{ createdAt: "asc" }],
		take: 2,
	});
	if (
		sourceCosts.length > 1
		|| existing && sourceCosts.some((cost) => cost.id !== existing?.id)
	) {
		throw codedError(
			"同一物流费用关联了多条有效成本，已阻止自动覆盖，请先清理重复成本。",
			409,
			"LOGISTICS_COST_SOURCE_DUPLICATE",
		);
	}
	if (!existing) existing = sourceCosts[0] || null;
	const settledCostMode = options.settledCostMode || "reject";
	const existingIsSettled = logisticsCostHasSettlementEvidence(existing);
	if (settledCostMode === "reject" && existingIsSettled) {
		throw codedError(
			"关联正式成本已存在付款记录，已阻止自动覆盖，请先核对账单状态；如需更正请使用付款冲销。",
			409,
			"LOGISTICS_COST_PAYMENT_STATE_CONFLICT",
		);
	}
	if (settledCostMode === "preserve-required" && (!existing || !existingIsSettled)) {
		throw codedError(
			"账单显示已付款，但关联正式成本缺少完整付款记录，冲销已取消，请先修复历史状态。",
			409,
			"LOGISTICS_PAYMENT_REVERSAL_COST_STATE_CONFLICT",
		);
	}
	if (settledCostMode === "preserve-required" && existing) {
		return existing;
	}
	const physicalTargetConflict = await tx.orderCost.findFirst({
		where: {
			...(existing ? { id: { not: existing.id } } : {}),
			sourceType: LOGISTICS_FEE_COST_SOURCE_TYPE,
			sourceId: expense.id,
		},
		select: { id: true },
	});
	if (physicalTargetConflict) {
		throw codedError(
			"物流费用成本来源键已被历史记录占用，已阻止覆盖，请先修复重复成本。",
			409,
			"LOGISTICS_COST_SOURCE_KEY_CONFLICT",
		);
	}
	  if (existing) {
	    const updated = await tx.orderCost.updateMany({
	      where: {
	        id: existing.id,
	        paid: false,
	        paymentStatus: { notIn: ["已支付", "部分支付", "已付款", "部分付款"] },
	        paidAt: null,
	        paymentDate: null,
	      },
	      data: { ...costData, costConfirmedAt: existing.costConfirmedAt || confirmedAt },
	    });
	    if (updated.count !== 1) {
	      throw codedError(
	        "关联正式成本付款状态已变化，已阻止自动覆盖，请刷新后核对。",
	        409,
	        "LOGISTICS_COST_PAYMENT_STATE_CONFLICT",
	      );
	    }
	    const saved = await tx.orderCost.findUnique({ where: { id: existing.id } });
	    if (!saved) throw codedError("物流费用成本状态已变化，请刷新后重试。", 409, "LOGISTICS_COST_SYNC_CHANGED");
	    return saved;
	  }
	  return tx.orderCost.create({ data: { ...costData, costConfirmedAt: confirmedAt, createdById: currentActorId || null } });
}
