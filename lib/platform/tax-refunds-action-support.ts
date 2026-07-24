import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  DEFAULT_EXCHANGE_RATE_SETTINGS,
  EXCHANGE_RATE_SETTING_KEY,
  codedError,
  normalizeExchangeRateSettings,
  roundMoney,
  summarizeOrder,
  taxDocumentCompleteness,
} from "./shared";
import { isCommissionSettled } from "./commission-settlement-lock";
import { taxRefundCompletenessSummaryText } from "./tax-refunds-shared";

export const EDITABLE_TAX_REFUND_STATUSES = ["NOT_READY", "READY", "PROBLEM", "SUBMITTED"];
export const COMMISSION_SETTLEMENT_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 15000,
  maxWait: 10000,
};

const TAX_REFUND_STATUS_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 15000,
  maxWait: 10000,
};
const TAX_REFUND_STATUS_TRANSACTION_MAX_ATTEMPTS = 3;

type TaxRefundCompleteness = ReturnType<typeof taxDocumentCompleteness>;

export function taxRefundStatusSerializationConflict() {
  return codedError(
    "退税状态刚刚被其他操作更新，请刷新后重试。",
    409,
    "TAX_REFUND_STATUS_CONFLICT",
  );
}

export async function runTaxRefundStatusTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 1; attempt <= TAX_REFUND_STATUS_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, TAX_REFUND_STATUS_TRANSACTION_OPTIONS);
    } catch (error: unknown) {
      if (String((error as { code?: string })?.code || "") !== "P2034") throw error;
      if (attempt === TAX_REFUND_STATUS_TRANSACTION_MAX_ATTEMPTS) {
        throw taxRefundStatusSerializationConflict();
      }
    }
  }
  throw taxRefundStatusSerializationConflict();
}

export async function exchangeRateSettingsInTransaction(tx: Prisma.TransactionClient) {
  const setting = await tx.systemSetting.findUnique({ where: { key: EXCHANGE_RATE_SETTING_KEY } });
  return normalizeExchangeRateSettings(setting?.value ?? DEFAULT_EXCHANGE_RATE_SETTINGS);
}

export function nextTaxRefundMutationVersion(...values: Array<Date | null | undefined>) {
  const latest = values.reduce(
    (time, value) => Math.max(time, value?.getTime() || 0),
    Date.now(),
  );
  return new Date(latest + 1);
}

export function taxRefundCompletenessData(
  completeness: TaxRefundCompleteness,
  version: Date,
) {
  const total = Number(completeness.total || 0);
  const completed = Number(completeness.completed || 0);
  const overall = Number.isFinite(total) && total > 0
    ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
    : 0;
  return {
    taxRefundCompleteness: JSON.parse(JSON.stringify(completeness)) as Prisma.InputJsonValue,
    taxRefundCompletenessUpdatedAt: version,
    taxRefundOverallCompleteness: overall,
    taxRefundCompletenessIssuesSummary: taxRefundCompletenessSummaryText(completeness).slice(0, 500),
  };
}

export function taxRefundCompletenessError(completeness: TaxRefundCompleteness) {
  const total = Number(completeness.total || 0);
  const completed = Number(completeness.completed || 0);
  const error = codedError(
    "资料尚未完整，无法提交退税。",
    400,
    "TAX_REFUND_COMPLETENESS_REQUIRED",
  );
  error.details = {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    missingLabels: completeness.missingLabels || [],
    text: completeness.text || "",
  };
  return error;
}

export function assertCommissionCanSettle(
  order: Parameters<typeof summarizeOrder>[0],
  commissionFormulaSettings: Parameters<typeof summarizeOrder>[1],
) {
  if (isCommissionSettled(order)) {
    throw codedError("该订单业务员提成已结算，不能重复结算。", 400, "COMMISSION_ALREADY_SETTLED");
  }
  const summary = summarizeOrder(order, commissionFormulaSettings);
  if (summary.commissionRate <= 0) {
    throw codedError("提成比例未设置，不能结算业务员提成。", 400, "COMMISSION_RATE_NOT_SET");
  }
  if (!summary.realSalespersonSet) {
    throw codedError("未分配真实业务员，不能结算业务员提成。", 400, "SALESPERSON_NOT_SET");
  }
  if (summary.hasArrivedPaymentCurrencyMismatch) {
    throw codedError(
      "订单存在币种不一致的历史收款，请先人工复核，不能结算业务员提成。",
      400,
      "PAYMENT_CURRENCY_MISMATCH",
    );
  }
  if (["草稿", "已关闭", "已取消"].includes(order.status || "") || summary.arrivedOutstandingAmount > 0) {
    throw codedError("当前订单货款尚未全部到账，不能结算业务员提成。", 400, "ORDER_NOT_FULLY_PAID");
  }
  if (!summary.taxLogisticsCostsComplete) {
    const missingText = (
      Array.isArray(summary.taxLogisticsMissingLabels) ? summary.taxLogisticsMissingLabels : []
    ).join("、") || "物流费用";
    throw codedError(
      `退税资料中的物流费用未完整，缺少：${missingText}。不能结算业务员提成。`,
      400,
      "TAX_LOGISTICS_COSTS_INCOMPLETE",
    );
  }
  if (!summary.allCostsConfirmed) {
    throw codedError("当前订单成本尚未全部确认完成，不能结算业务员提成。", 400, "COST_NOT_CONFIRMED");
  }
  if (!summary.logisticsCostConfirmed) {
    throw codedError(
      "当前订单物流成本尚未确认完成，不能结算业务员提成。",
      400,
      "LOGISTICS_COST_NOT_CONFIRMED",
    );
  }
  const commissionAmountCny = roundMoney(
    (summary.settleableCommissionBaseCny * summary.commissionRate) / 100,
  );
  if (commissionAmountCny <= 0) {
    throw codedError(
      "提成金额为 0，不能结算，请检查提成比例和成本数据。",
      400,
      "COMMISSION_AMOUNT_ZERO",
    );
  }
  return { summary, commissionAmountCny };
}
