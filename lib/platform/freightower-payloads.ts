import { codedError } from "./shared-base-utils";
import {
  cleanBookingNumber,
  cleanInputText,
  safeContainerNumber,
  uniqueStrings,
  type ShipsgoSettings,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";
import type { ShipsgoTrackingOrder } from "./shipsgo-tracking-service-shared";

function cleanFreightowerCode(value: unknown, limit = 32) {
  return cleanInputText(value, limit).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function cleanFreightowerBusinessNo(value: unknown) {
  return cleanInputText(value, 128).replace(/[#&?/]/g, "-");
}

export function createFreightowerPayloadFromInput(input: ShipsgoTrackingInput, order: ShipsgoTrackingOrder, settings: ShipsgoSettings) {
  const billNo = cleanBookingNumber(order.blNo);
  const localContainerNo = uniqueStrings((order.domesticLogisticsInfos || []).flatMap((info) => (
    info.transportItems || []
  ).map((item) => safeContainerNumber(item.containerNo))))[0] || "";
  const carrierCode = cleanFreightowerCode(input.carrierScac, 32) || settings.freightowerDefaultCarrierCode || "AUTO";
  const portCode = cleanFreightowerCode(input.portCode, 16) || settings.freightowerDefaultPortCode || "";
  const isExport = cleanFreightowerCode(input.isExport, 1) || settings.freightowerDefaultIsExport || "";
  if (!billNo && !localContainerNo) {
    throw codedError("请先录入提单号或柜号后再使用飞驼可视追踪。", 400, "FREIGHTOWER_TARGET_REQUIRED");
  }
  if (!carrierCode && !portCode) {
    throw codedError("飞驼可视需要船公司代码或港区代码，请在后台设置默认值。", 400, "FREIGHTOWER_PROVIDER_CODE_REQUIRED");
  }
  return {
    billNo,
    containerNo: safeContainerNumber(input.containerNo) || localContainerNo,
    carrierCode,
    portCode,
    isExport,
    businessNo: cleanFreightowerBusinessNo(input.reference || `${order.orderNo || order.id}-${billNo || localContainerNo}`),
    billCategory: cleanFreightowerCode(input.billCategory, 2),
    polCode: cleanFreightowerCode(input.polCode, 16),
    podCode: cleanFreightowerCode(input.podCode, 16),
  };
}

export function createFreightowerPayloadFromTracking(row: {
  masterBlNo?: string | null;
  bookingNumber?: string | null;
  containerNumber?: string | null;
  reference?: string | null;
  carrierScac?: string | null;
}, settings: ShipsgoSettings) {
  const billNo = cleanBookingNumber(row.masterBlNo || row.bookingNumber);
  const containerNo = safeContainerNumber(row.containerNumber);
  if (!billNo && !containerNo) {
    throw codedError("本地缺少飞驼可视同步所需的提单号或柜号。", 400, "FREIGHTOWER_SYNC_TARGET_REQUIRED");
  }
  return {
    billNo,
    containerNo,
    carrierCode: cleanFreightowerCode(row.carrierScac, 32) || settings.freightowerDefaultCarrierCode || "AUTO",
    portCode: settings.freightowerDefaultPortCode || "",
    isExport: settings.freightowerDefaultIsExport || "",
    businessNo: cleanFreightowerBusinessNo(row.reference || billNo || containerNo),
    billCategory: "",
    polCode: "",
    podCode: "",
  };
}
