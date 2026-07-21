import { summarizeOrder } from "./shared-order-calculations";

type CommissionSettlementSnapshotLike = {
  status?: string | null;
  reversedAt?: Date | string | null;
  commissionRate?: unknown;
  paidAmountCny?: unknown;
  logisticsCostCny?: unknown;
  commissionBaseCny?: unknown;
  commissionAmountCny?: unknown;
  commissionFormulaMode?: string | null;
  commissionFormulaLabel?: string | null;
  commissionFormulaDescription?: string | null;
  commissionFormulaSource?: string | null;
  commissionFormulaDeductions?: unknown;
  commissionFormulaFloorAtZero?: boolean | null;
  commissionFormulaVersion?: string | null;
};

type OrderWithCommissionSnapshot = Parameters<typeof summarizeOrder>[0] & {
  commissionSettledAt?: Date | string | null;
  commissionSettlementRecords?: CommissionSettlementSnapshotLike[] | null;
};

function activeCommissionSettlement(order: OrderWithCommissionSnapshot) {
  return (order.commissionSettlementRecords || []).find((record) => (
    String(record.status || "ACTIVE").trim() === "ACTIVE" && !record.reversedAt
  )) || null;
}

export function summarizeOrderWithCommissionSnapshot(
  order: OrderWithCommissionSnapshot,
  commissionFormulaSettings?: Record<string, unknown> | null,
) {
  const calculated = summarizeOrder(order, commissionFormulaSettings);
  const settlement = activeCommissionSettlement(order);
  if (!settlement) {
    const hasLegacySettlementMarker = ["已结算", "SETTLED"].includes(String(order.commissionStatus || "").trim())
      || Boolean(order.commissionSettledAt);
    if (hasLegacySettlementMarker) {
      return {
        ...calculated,
        commissionStatus: "已结算（缺少历史快照）",
        commissionCanSettle: false,
        commissionRate: undefined,
        commissionBaseCny: undefined,
        estimatedCommissionBaseCny: undefined,
        estimatedCommissionCny: undefined,
        settleableCommissionBaseCny: undefined,
        settleableCommissionCny: undefined,
        commissionAmountCny: undefined,
        commissionFormulaMode: "LEGACY_UNSNAPSHOTTED",
        commissionFormulaLabel: "历史结算（缺少金额快照）",
        commissionFormulaDescription: "该记录来自旧版结算，结算时金额与公式未留存；当前估算不会作为历史结算金额展示。",
        commissionFormulaSource: "LEGACY_UNSNAPSHOTTED",
        commissionFormulaDeductions: [],
        commissionFormulaVersion: "legacy-unsnapshotted",
        commissionSnapshotMissing: true,
        currentCommissionEstimate: {
          commissionRate: calculated.commissionRate,
          commissionBaseCny: calculated.estimatedCommissionBaseCny,
          commissionAmountCny: calculated.estimatedCommissionCny,
          formulaMode: calculated.commissionFormulaMode,
          formulaLabel: calculated.commissionFormulaLabel,
        },
      };
    }
    return { ...calculated, commissionFormulaVersion: "", commissionSnapshotMissing: false };
  }
  const paidAmountCny = Number(settlement.paidAmountCny || 0);
  const logisticsCostCny = Number(settlement.logisticsCostCny || 0);
  const commissionBaseCny = Number(settlement.commissionBaseCny || 0);
  const commissionAmountCny = Number(settlement.commissionAmountCny || 0);
  const commissionFormulaVersion = settlement.commissionFormulaVersion || "legacy";
  const legacyFormulaSnapshot = commissionFormulaVersion === "legacy";
  return {
    ...calculated,
    arrivedPaymentsCny: paidAmountCny,
    confirmedPaymentsCny: paidAmountCny,
    logisticsCostCny,
    confirmedLogisticsCostCny: logisticsCostCny,
    commissionRate: Number(settlement.commissionRate || 0),
    commissionBaseCny,
    estimatedCommissionBaseCny: commissionBaseCny,
    settleableCommissionBaseCny: commissionBaseCny,
    commissionAmountCny,
    estimatedCommissionCny: commissionAmountCny,
    settleableCommissionCny: commissionAmountCny,
    commissionFormulaMode: settlement.commissionFormulaMode || "SETTLEMENT_SNAPSHOT",
    commissionFormulaLabel: settlement.commissionFormulaLabel
      || (legacyFormulaSnapshot ? "历史结算快照（公式配置未留存）" : "历史结算快照"),
    commissionFormulaDescription: settlement.commissionFormulaDescription
      || (legacyFormulaSnapshot ? "金额取自历史结算记录；当时的公式配置未留存" : "按结算时保存的金额快照展示"),
    commissionFormulaSource: settlement.commissionFormulaSource || "SETTLEMENT_SNAPSHOT",
    commissionFormulaDeductions: settlement.commissionFormulaDeductions ?? [],
    commissionFormulaFloorAtZero: settlement.commissionFormulaFloorAtZero ?? true,
    commissionFormulaVersion,
    commissionSnapshotMissing: false,
    commissionStatus: "已结算",
    commissionCanSettle: false,
  };
}
