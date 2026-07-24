import { Prisma } from "../generated/prisma/client.js";
import {
  LOGISTICS_FEE_COST_SOURCE_TYPE,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
  codedError,
  dateFromInput,
  nonEmpty,
  normalizedCostType,
} from "./shared";
import { logisticsCostPaymentDataFromExpense } from "./logistics-expense-cost-payment";
import { logisticsCostHasSettlementEvidence } from "./logistics-expense-cost-safety";
import {
  type LogisticsActor,
  type LogisticsExpenseForCostSync,
  logisticsExpenseActorId,
} from "./logistics-expense-access-model";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { assertCommissionOrderWritableInTransaction } from "./commission-settlement-lock";

type LogisticsCostFingerprintLike = {
	id?: string | null;
	orderId?: string | null;
	supplierId?: string | null;
	sourceType?: string | null;
	sourceId?: string | null;
	costType?: string | null;
	currency?: string | null;
	amount?: unknown;
	amountCny?: unknown;
};

function decimalFingerprint(value: unknown) {
	try {
		return new Prisma.Decimal(String(value ?? "")).toFixed(2);
	} catch {
		return "";
	}
}

export function logisticsExpenseCostFingerprintMismatches(
	cost: LogisticsCostFingerprintLike,
	expense: LogisticsExpenseForCostSync,
) {
	const mismatches: string[] = [];
	if (!LOGISTICS_GENERATED_COST_SOURCE_TYPES.includes(nonEmpty(cost.sourceType)) || nonEmpty(cost.sourceId) !== nonEmpty(expense.id)) {
		mismatches.push("来源");
	}
	if (nonEmpty(cost.orderId) !== nonEmpty(expense.orderId)) mismatches.push("订单");
	if (nonEmpty(cost.supplierId) !== nonEmpty(expense.supplierId)) mismatches.push("供应商");
	if (normalizedCostType(nonEmpty(cost.costType)) !== normalizedCostType(nonEmpty(expense.costType))) mismatches.push("费用类型");
	if (nonEmpty(cost.currency).toUpperCase() !== nonEmpty(expense.currency || "CNY").toUpperCase()) mismatches.push("币种");
	if (decimalFingerprint(cost.amount) !== decimalFingerprint(expense.amount)) mismatches.push("原币金额");
	if (decimalFingerprint(cost.amountCny) !== decimalFingerprint(expense.amountCny)) mismatches.push("人民币金额");
	return mismatches;
}

function assertLogisticsPaymentCostFingerprint(
	cost: LogisticsCostFingerprintLike,
	expense: LogisticsExpenseForCostSync,
) {
	const mismatches = logisticsExpenseCostFingerprintMismatches(cost, expense);
	if (!mismatches.length) return;
	throw codedError(
		`物流费用关联正式成本的${mismatches.join("、")}与费用明细不一致，请先修复历史关联，不能继续付款或冲销。`,
		409,
		"LOGISTICS_PAYMENT_COST_FINGERPRINT_MISMATCH",
	);
}

export async function createOrUpdateCostFromLogisticsExpense(
	tx: Prisma.TransactionClient,
	expense: LogisticsExpenseForCostSync,
	actor: LogisticsActor,
	options: {
		settledCostMode?: "reject" | "preserve-required" | "preserve-existing";
		commissionLockAlreadyHeld?: boolean;
	} = {},
	) {
	if (!options.commissionLockAlreadyHeld) {
		await assertBusinessOrderWritableInTransaction(
			tx,
			expense.orderId,
			"该订单已提交退税并归档，不能同步物流费用成本。",
		);
		await assertCommissionOrderWritableInTransaction(tx, expense.orderId);
	}
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
	if ((settledCostMode === "preserve-existing" || settledCostMode === "preserve-required") && existing) {
		assertLogisticsPaymentCostFingerprint(existing, expense);
	}
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
	if (settledCostMode === "preserve-existing") {
		if (!existing) {
			throw codedError(
				"物流费用尚未生成对应正式成本，付款状态更新已取消，请先修复成本关联。",
				409,
				"LOGISTICS_PAYMENT_COST_LINK_MISSING",
			);
		}
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
