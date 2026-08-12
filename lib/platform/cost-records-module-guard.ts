import { FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE } from "./factory-purchase-order-settlement-values";
import { isLogisticsGeneratedCostSourceType } from "./logistics-generated-cost-source-types";
import { codedError } from "./shared-base-errors";

type CostModuleManagedSource = {
  sourceType?: string | null;
  generatedLogisticsExpense?: unknown;
};

export function isFactoryPurchaseSettlementCost(cost: Pick<CostModuleManagedSource, "sourceType">) {
  return cost.sourceType === FACTORY_PURCHASE_SETTLEMENT_SOURCE_TYPE;
}

export function assertFactoryPurchaseSettlementCostCanBeManagedInCostModule(
  cost: Pick<CostModuleManagedSource, "sourceType">,
  action: string,
) {
  if (!isFactoryPurchaseSettlementCost(cost)) return;
  throw codedError(
    `采购结算生成的成本不能在成本管理${action}，请到采购执行模块的结算与付款中操作。`,
    400,
    "FACTORY_PURCHASE_SETTLEMENT_COST_MANAGED_BY_PURCHASE",
  );
}

export function assertCostCanBeManagedInCostModule(
  cost: CostModuleManagedSource,
  action: string,
) {
  assertFactoryPurchaseSettlementCostCanBeManagedInCostModule(cost, action);
  if (!isLogisticsGeneratedCostSourceType(cost.sourceType) && !cost.generatedLogisticsExpense) return;
  throw codedError(
    `物流费用同步成本不能在成本管理${action}，请到物流费用模块操作。`,
    400,
    "LOGISTICS_COST_MANAGED_BY_LOGISTICS",
  );
}
