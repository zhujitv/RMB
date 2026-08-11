export const DEFAULT_CHINA_DEPARTURE_PORT_CODE = "CNSHA";
export const CUSTOM_CHINA_DEPARTURE_PORT_VALUE = "CUSTOM";

export const CHINA_DEPARTURE_PORT_OPTIONS = [
  { value: "CNSHA", label: "上海港（CNSHA）" },
  { value: "CNNGB", label: "宁波港（CNNGB）" },
  { value: "CNTAO", label: "青岛港（CNTAO）" },
] as const;

export function isCommonChinaDeparturePort(portCode: string) {
  return CHINA_DEPARTURE_PORT_OPTIONS.some((option) => option.value === portCode);
}
