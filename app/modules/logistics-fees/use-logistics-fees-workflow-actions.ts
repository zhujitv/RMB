import type { WorkflowActionsContext } from "./workflow-actions-context";
import { createLogisticsFeesWorkflowPaymentActions } from "./workflow-payment-actions";
import { createLogisticsFeesWorkflowReviewActions } from "./workflow-review-actions";

export function createLogisticsFeesWorkflowActions(context: WorkflowActionsContext) {
  return {
    ...createLogisticsFeesWorkflowReviewActions(context),
    ...createLogisticsFeesWorkflowPaymentActions(context),
  };
}
