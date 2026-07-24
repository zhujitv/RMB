import type { CostActionsContext } from "./cost-actions-context";
import { createCostFileActions } from "./cost-file-actions";
import { createCostLifecycleActions } from "./cost-lifecycle-actions";
import { createCostPaymentActions } from "./cost-payment-actions";

export function useCostDocumentActions(context: CostActionsContext) {
  const fileActions = createCostFileActions(context);
  const paymentActions = createCostPaymentActions(context, fileActions.refreshDocumentCost);
  const lifecycleActions = createCostLifecycleActions(context);
  return { ...fileActions, ...paymentActions, ...lifecycleActions };
}
