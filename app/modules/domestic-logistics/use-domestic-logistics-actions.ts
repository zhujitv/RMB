import type { DomesticLogisticsActionsContext } from "./domestic-logistics-actions-context";
import { createDomesticLogisticsDocumentActions } from "./domestic-logistics-document-actions";
import { createShipsgoTrackingActions } from "./shipsgo-tracking-actions";

export function useDomesticLogisticsActions(context: DomesticLogisticsActionsContext) {
  return {
    ...createDomesticLogisticsDocumentActions(context),
    ...createShipsgoTrackingActions(context),
  };
}
