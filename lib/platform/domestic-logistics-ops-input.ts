import { codedError, dateFromInput, nonEmpty, optional, requireText } from "./shared";
import { buildExportInvoiceRemarkFromTransportItems, formatExportInvoiceRemark } from "./export-invoice-remark";
import {
  type DomesticLogisticsInput,
  type DomesticTransportInput,
  type NormalizedDomesticTransportItem,
} from "./domestic-logistics-ops-shared";

export function normalizeDomesticTransportItems(input: DomesticLogisticsInput = {}, transportType = "TRUCK"): NormalizedDomesticTransportItem[] {
  if (transportType === "EXPRESS") return [];
  const labels = domesticTransportFieldLabels(transportType);
  const supportsContainerFields = transportType !== "BULK_WAREHOUSE";
  const rawItems = Array.isArray(input.transportItems) ? input.transportItems : [];
  const fallback: DomesticTransportInput = {
    containerNo: optional(input.containerNo),
    containerType: optional(input.containerType),
    sealNo: optional(input.sealNo),
    truckPlateNo: optional(input.truckPlateNo),
    trailerPlateNo: optional(input.trailerPlateNo),
    departureDate: input.departureDate || "",
    departurePlace: optional(input.departurePlace),
    arrivalPlace: optional(input.destinationPlace || input.arrivalPlace),
    cargoName: optional(input.cargoDescription || input.cargoName),
    remark: optional(input.remark),
  };
	  const meaningfulRawItems = rawItems.filter((item) => [
	    item.containerNo,
	    item.containerType,
	    item.sealNo,
	    item.truckPlateNo,
    item.trailerPlateNo,
    item.departureDate,
    item.departurePlace,
    item.arrivalPlace || item.destinationPlace,
    item.cargoName || item.cargoDescription,
    item.remark,
  ].some((value) => nonEmpty(value)));
  const items: DomesticTransportInput[] = meaningfulRawItems.length ? meaningfulRawItems : [fallback];
	  const normalized = items.map((item, index) => {
	    const containerNo = optional(item.containerNo);
	    const containerType = supportsContainerFields ? normalizeDomesticContainerType(item.containerType, index) : null;
	    if (supportsContainerFields && !containerNo) {
	      throw codedError(`请填写第 ${index + 1} 行${labels.containerNo}`, 400, "DOMESTIC_CONTAINER_NO_REQUIRED");
	    }
	    if (supportsContainerFields && !containerType) {
	      throw codedError(`请选择第 ${index + 1} 行柜型。`, 400, "DOMESTIC_CONTAINER_TYPE_REQUIRED");
	    }
	    const truckPlateNo = requireText(item.truckPlateNo, `第 ${index + 1} 行${labels.truckPlateNo}`);
	    const departureDate = dateFromInput(item.departureDate);
	    if (!departureDate) throw codedError(`请选择第 ${index + 1} 行${labels.departureDate}`, 400, "DEPARTURE_DATE_REQUIRED");
	    return {
	      containerNo,
	      containerType,
	      sealNo: supportsContainerFields ? optional(item.sealNo) : null,
	      truckPlateNo,
      trailerPlateNo: optional(item.trailerPlateNo),
      departureDate,
      departurePlace: requireText(item.departurePlace, `第 ${index + 1} 行${labels.departurePlace}`),
      arrivalPlace: requireText(item.arrivalPlace || item.destinationPlace, `第 ${index + 1} 行${labels.arrivalPlace}`),
      cargoName: requireText(item.cargoName || item.cargoDescription, `第 ${index + 1} 行${labels.cargoName}`),
      remark: optional(item.remark),
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    };
  });
  if (!normalized.length) throw codedError("请至少填写一条集装箱运输明细", 400, "TRANSPORT_ITEMS_REQUIRED");
	  return normalized;
}

function normalizeDomesticContainerType(value: unknown, index: number) {
  const type = nonEmpty(value).toUpperCase();
  if (!type) return null;
  if (!["20GP", "40GP", "40HQ", "45HQ"].includes(type)) {
    throw codedError(`请选择第 ${index + 1} 行有效柜型。`, 400, "DOMESTIC_CONTAINER_TYPE_INVALID");
  }
  return type;
}

function domesticTransportFieldLabels(transportType = "TRUCK") {
  if (transportType === "MULTIMODAL") {
    return {
      containerNo: "集装箱号",
      truckPlateNo: "首程车牌号",
      departureDate: "起运日期",
      departurePlace: "首程起运地",
      arrivalPlace: "到达地",
      cargoName: "运输货物名称",
    };
  }
  if (transportType === "BULK_WAREHOUSE") {
    return {
      containerNo: "进舱编号/唛头",
      truckPlateNo: "送货车牌号",
      departureDate: "进舱日期",
      departurePlace: "提货地",
      arrivalPlace: "进舱仓库",
      cargoName: "货物名称",
    };
  }
  return {
    containerNo: "集装箱号",
    truckPlateNo: "车牌号",
    departureDate: "起运日期",
    departurePlace: "起运地",
    arrivalPlace: "到达地",
    cargoName: "运输货物名称",
  };
}

function domesticLogisticsRemarkFromItems(items: NormalizedDomesticTransportItem[] = [], transportType = "TRUCK") {
  return formatExportInvoiceRemark(buildExportInvoiceRemarkFromTransportItems(items));
}

export function domesticLogisticsRemark(input: DomesticLogisticsInput = {}) {
  const type = input.transportType;
  if (type === "EXPRESS") {
    const trackingNo = requireText(input.expressTrackingNo, "快递单号");
    return [
      `快递单号：${trackingNo}`,
      input.destinationPlace ? `到达地：${input.destinationPlace}` : "",
      input.cargoDescription ? `运输货物名称：${input.cargoDescription}` : "",
    ].filter(Boolean).join("\n");
  }
  return domesticLogisticsRemarkFromItems(normalizeDomesticTransportItems(input, type), type);
}
