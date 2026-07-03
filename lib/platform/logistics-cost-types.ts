export const LOGISTICS_COST_TYPE_OPTIONS = [
  { value: "拖车费", label: "拖车费" },
  { value: "报关费", label: "报关费" },
  { value: "港杂费", label: "港杂费" },
  { value: "打单费", label: "打单费" },
  { value: "ENS", label: "ENS费" },
  { value: "进港费", label: "进港费" },
  { value: "提箱费", label: "提箱费" },
  { value: "落箱费", label: "落箱费" },
  { value: "预提费", label: "预提费" },
  { value: "查验费", label: "查验费" },
  { value: "超重费", label: "超重费" },
  { value: "海运费", label: "海运费" },
  { value: "保险费", label: "保险费" },
  { value: "其他本地费用", label: "其他本地费用" },
  { value: "其他国际费用", label: "其他国际费用" },
  { value: "其他物流费用", label: "其他物流费用" },
];

export const LOGISTICS_COST_TYPES = LOGISTICS_COST_TYPE_OPTIONS.map((item) => item.value);

export const LOGISTICS_COST_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  LOGISTICS_COST_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);

export const LOGISTICS_CNY_COST_TYPES = [
  "拖车费",
  "报关费",
  "港杂费",
  "打单费",
  "进港费",
  "提箱费",
  "落箱费",
  "预提费",
  "查验费",
  "超重费",
  "其他本地费用",
];

export const LOGISTICS_USD_COST_TYPES = ["海运费", "ENS", "保险费", "其他国际费用"];

export const LOGISTICS_EXPENSE_CURRENCIES = ["CNY", "USD"];

export function logisticsCostTypeLabel(costType = "") {
  return LOGISTICS_COST_TYPE_LABELS[costType] || costType || "";
}

export function logisticsCostTypeDefaultCurrency(costType = "") {
  return LOGISTICS_USD_COST_TYPES.includes(costType) ? "USD" : "CNY";
}

export function logisticsCostTypeLocksCurrency(_costType = "") {
  return false;
}

export const LOGISTICS_COST_TYPE_ENGLISH_LABELS: Record<string, string> = {
  拖车费: "Trucking Fee",
  报关费: "Customs Clearance Fee",
  港杂费: "Port Charges",
  打单费: "Document Processing Fee",
  ENS: "ENS Fee",
  进港费: "Gate-in Fee",
  提箱费: "Container Pick-up Fee",
  落箱费: "Container Drop-off Fee",
  预提费: "Advance Charge",
  查验费: "Inspection Fee",
  超重费: "Overweight Fee",
  海运费: "Ocean Freight",
  保险费: "Insurance Fee",
  其他本地费用: "Other Local Fee",
  其他国际费用: "Other International Fee",
  其他物流费用: "Other Logistics Fee",
};

export const LOGISTICS_INVOICE_ENGLISH_LABELS: Record<string, string> = {
  报关费: "Customs-Service-Invoice",
  拖车费: "Trucking-Invoice",
  港杂费: "Port-Charges-Invoice",
  打单费: "Document-Processing-Fee-Invoice",
  ENS: "ENS-Fee-Invoice",
  进港费: "Gate-in-Invoice",
  提箱费: "Container-Pick-up-Invoice",
  落箱费: "Container-Drop-off-Fee-Invoice",
  预提费: "Advance-Charge-Invoice",
  查验费: "Inspection-Invoice",
  超重费: "Overweight-Invoice",
  海运费: "Ocean-Freight-Invoice",
  保险费: "Insurance-Invoice",
  其他本地费用: "Other-Local-Fee-Invoice",
  其他国际费用: "Other-International-Fee-Invoice",
  其他物流费用: "Other-Logistics-Invoice",
};
