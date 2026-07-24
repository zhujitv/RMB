import { codedError, isLogisticsGeneratedCostSourceType } from "./shared";

export function assertCostCanBeManagedInCostModule(
  cost: { sourceType?: string | null; generatedLogisticsExpense?: unknown },
  action: string,
) {
  if (!isLogisticsGeneratedCostSourceType(cost.sourceType) && !cost.generatedLogisticsExpense) return;
  throw codedError(
    `物流费用同步成本不能在成本管理${action}，请到物流费用模块操作。`,
    400,
    "LOGISTICS_COST_MANAGED_BY_LOGISTICS",
  );
}
