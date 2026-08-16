import { summarizeCurrencyTotals } from "../../../lib/platform/currency-totals";
import { isFactoryCost, isLogisticsInvoiceCost } from "./helpers";
import { FACTORY_DOCUMENT_TYPES, type CostOrderSummary, type CostRow } from "./model";

export function recalculateOrderSummary(order: CostOrderSummary, costs: CostRow[]): CostOrderSummary {
  const activeCosts = costs.filter((cost) => Boolean(cost.id));
  const participatingCosts = activeCosts.filter((cost) => !cost.excludedFromOrderCost);
  const excludedFobSeaFreightCostCny = activeCosts
    .filter((cost) => cost.excludedFromOrderCost)
    .reduce((sum, cost) => sum + Number(cost.amountCny || 0), 0);
  const currencyTotals = summarizeCurrencyTotals(participatingCosts);
  const confirmed = participatingCosts.filter((cost) => cost.costConfirmed).length;
  const documentProgress = activeCosts.reduce((acc, cost) => {
    const successDocs = (cost.documents || []).filter((document) => document.uploadStatus === "SUCCESS");
    if (isFactoryCost(cost)) {
      FACTORY_DOCUMENT_TYPES.forEach((type) => {
        acc.total += 1;
        if (successDocs.some((document) => document.documentType === type.value)) acc.completed += 1;
      });
    } else if (isLogisticsInvoiceCost(cost)) {
      acc.total += 1;
      if (successDocs.some((document) => document.documentType === "SUPPLIER_INVOICE")) acc.completed += 1;
    }
    return acc;
  }, { completed: 0, total: 0 });
  return {
    ...order,
    costs: activeCosts,
    costCount: activeCosts.length,
    totalCostCny: currencyTotals.totalCny,
    excludedFobSeaFreightCostCny,
    currencyTotals,
    costConfirmProgress: {
      completed: confirmed,
      total: participatingCosts.length,
      text: participatingCosts.length ? `${confirmed}/${participatingCosts.length}` : "无成本",
    },
    documentProgress: {
      ...documentProgress,
      text: documentProgress.total ? `${documentProgress.completed}/${documentProgress.total}` : "无需资料",
    },
  };
}
