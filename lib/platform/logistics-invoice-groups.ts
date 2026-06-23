import { LOGISTICS_COST_TYPES } from "./logistics-cost-types";

export type LogisticsInvoiceGroupDefinition = {
  key: string;
  label: string;
  costTypes: string[];
};

export const LOGISTICS_INVOICE_GROUPS: LogisticsInvoiceGroupDefinition[] = [
  {
    key: "CUSTOMS",
    label: "报关费发票",
    costTypes: ["报关费"],
  },
  {
    key: "PORT_CHARGES",
    label: "港杂费发票",
    costTypes: ["港杂费"],
  },
  {
    key: "OCEAN_FREIGHT",
    label: "海运费发票",
    costTypes: ["海运费"],
  },
  {
    key: "TRUCKING_OTHER",
    label: "拖车及其他费用合并发票",
    costTypes: [
      "拖车费",
      "打单费",
      "ENS",
      "进港费",
      "提箱费",
      "落箱费",
      "预提费",
      "查验费",
      "超重费",
      "保险费",
      "其他物流费用",
    ],
  },
];

export type LogisticsInvoiceGroupKey = string;

export function logisticsInvoiceGroupForKey(key: unknown) {
  const value = String(key || "").trim();
  return LOGISTICS_INVOICE_GROUPS.find((group) => group.key === value) || null;
}

export function logisticsInvoiceGroupForCostType(costType: unknown) {
  const normalized = String(costType || "").trim();
  return LOGISTICS_INVOICE_GROUPS.find((group) => group.costTypes.includes(normalized)) || null;
}

export function logisticsInvoiceGroupsForCostTypes(costTypes: unknown[] = []) {
  const normalizedTypes = costTypes
    .map((item) => String(item || "").trim())
    .filter((item) => LOGISTICS_COST_TYPES.includes(item));
  return LOGISTICS_INVOICE_GROUPS.filter((group) => group.costTypes.some((costType) => normalizedTypes.includes(costType)));
}
