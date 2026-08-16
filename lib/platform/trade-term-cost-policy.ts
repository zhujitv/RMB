import { codedError } from "./shared-base-utils";
import { isOrderCostExcludedByTradeTerm } from "./shared-cost-constants";

export const FOB_OCEAN_FREIGHT_COST_ERROR =
  "FOB订单海运费由买方承担，不能录入或计入订单成本，请核对贸易条款或费用类型。";

export function assertOrderCostAllowedByTradeTerm(tradeTerm: unknown, costType: unknown) {
  if (isOrderCostExcludedByTradeTerm(tradeTerm, costType)) {
    throw codedError(FOB_OCEAN_FREIGHT_COST_ERROR, 400, "FOB_OCEAN_FREIGHT_COST_NOT_ALLOWED");
  }
}
