import { CONTAINER_TYPE_OPTIONS, emptyTransportItem, type DomesticLogisticsDocument, type DomesticLogisticsForm, type DomesticLogisticsInfo, type DomesticLogisticsRow, type StructuredTransportRemark, type TransportItem } from "./model";

export function firstItemValue(info: DomesticLogisticsInfo | null | undefined, key: keyof TransportItem) {
  return info?.transportItems?.find((item) => item[key])?.[key] || "";
}

export function latestUploadedDocument(documents: DomesticLogisticsDocument[]) {
  return documents.slice().sort((left, right) => (
    new Date(right.uploadedAt || 0).getTime() - new Date(left.uploadedAt || 0).getTime()
  ))[0] || null;
}

export function formFromRow(row: DomesticLogisticsRow): DomesticLogisticsForm {
  const info = row.domesticLogisticsInfo;
  const transportType = info?.transportType || "TRUCK";
  const transportItems = info?.transportItems?.length
    ? info.transportItems.map((item) => ({ ...emptyTransportItem(), ...item }))
    : [{
      ...emptyTransportItem(),
      truckPlateNo: info?.truckPlateNo || "",
      trailerPlateNo: info?.trailerPlateNo || "",
      departurePlace: info?.departurePlace || "",
      arrivalPlace: info?.destinationPlace || "",
      departureDate: info?.departureDate || "",
      cargoName: info?.cargoDescription || "",
    }];
  const form = {
    orderId: row.id,
    transportType,
    expressTrackingNo: info?.expressTrackingNo || "",
    destinationPlace: info?.destinationPlace || "",
    cargoDescription: info?.cargoDescription || "",
    remarkText: "",
    remarkTextManualEdited: false,
    transportItems,
  };
  return { ...form, remarkText: form.remarkText || generateRemark(form) };
}

export function transportItemsTitle(transportType: string) {
  if (transportType === "BULK_WAREHOUSE") return "散货进舱明细";
  if (transportType === "MULTIMODAL") return "多式联运明细";
  return "集装箱管理";
}

export function addTransportItemText(transportType: string) {
  if (transportType === "BULK_WAREHOUSE") return "新增进舱明细";
  return "新增集装箱";
}

export function showContainerManagementFields(transportType: string) {
  return transportType !== "BULK_WAREHOUSE";
}

export function transportFieldLabels(transportType: string) {
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
  return {
    containerNo: "集装箱号",
    truckPlateNo: "车牌号",
    departureDate: "起运日期",
    departurePlace: "起运地",
    arrivalPlace: "到达地",
    cargoName: "运输货物名称",
  };
}

export function generateRemark(form: DomesticLogisticsForm) {
  if (form.transportType === "EXPRESS") {
    return [
      form.expressTrackingNo ? `快递单号：${form.expressTrackingNo}` : "",
      form.destinationPlace ? `到达地：${form.destinationPlace}` : "",
      form.cargoDescription ? `运输货物名称：${form.cargoDescription}` : "",
    ].filter(Boolean).join("\n");
  }
  return formatStructuredTransportRemarkText(buildStructuredTransportRemarkFromForm(form));
}

export function buildStructuredTransportRemarkFromForm(form: Pick<DomesticLogisticsForm, "transportType" | "transportItems">): StructuredTransportRemark {
  if (form.transportType === "EXPRESS") return { containers: [] };
  return {
    containers: normalizeFormTransportItems(form.transportItems).map((item) => ({
      containerNo: item.containerNo,
      type: showContainerManagementFields(form.transportType) ? item.containerType : "",
      truckNo: item.truckPlateNo,
      trailerNo: item.trailerPlateNo,
      shipDate: item.departureDate,
      origin: item.departurePlace,
      destination: item.arrivalPlace,
      goods: item.cargoName,
    })),
  };
}

export function formatStructuredTransportRemarkText(remark: StructuredTransportRemark) {
  return (remark.containers || []).map((item) => [
    `Container: ${item.containerNo || "-"}`,
    `柜型：${item.type || "-"}`,
    `车牌：${item.truckNo || "-"}`,
    `挂车：${item.trailerNo || "-"}`,
    `起运：${item.shipDate || "-"}`,
    `路线：${item.origin || "-"} → ${item.destination || "-"}`,
    `货物：${item.goods || "-"}`,
  ].join("\n")).join("\n\n");
}

export function normalizeFormTransportItems(items: TransportItem[]) {
  return items.map((item) => ({
    containerNo: (item.containerNo || "").trim(),
    containerType: (item.containerType || "").trim().toUpperCase(),
    sealNo: (item.sealNo || "").trim(),
    truckPlateNo: (item.truckPlateNo || "").trim(),
    trailerPlateNo: (item.trailerPlateNo || "").trim(),
    departureDate: (item.departureDate || "").trim(),
    departurePlace: (item.departurePlace || "").trim(),
    arrivalPlace: (item.arrivalPlace || "").trim(),
    cargoName: (item.cargoName || "").trim(),
    remark: (item.remark || "").trim(),
  })).filter((item) => Object.values(item).some(Boolean));
}

export function validateDomesticLogisticsForm(form: DomesticLogisticsForm) {
  if (form.transportType === "EXPRESS") {
    if (!form.expressTrackingNo.trim()) return "请填写快递单号。";
    if (!form.destinationPlace.trim()) return "请填写到达地。";
    if (!form.cargoDescription.trim()) return "请填写运输货物名称。";
    return "";
  }

  const items = normalizeFormTransportItems(form.transportItems);
  const labels = transportFieldLabels(form.transportType);
  if (!items.length) return `请至少录入一条${transportItemsTitle(form.transportType)}。`;
  for (const [index, item] of items.entries()) {
    const rowNo = `第 ${index + 1} 行`;
    if (showContainerManagementFields(form.transportType) && !item.containerNo) return `请填写${rowNo}${labels.containerNo}。`;
    if (showContainerManagementFields(form.transportType) && !CONTAINER_TYPE_OPTIONS.includes(item.containerType || "")) return `请选择${rowNo}柜型。`;
    if (!item.truckPlateNo) return `请填写${rowNo}${labels.truckPlateNo}。`;
    if (!item.departureDate) return `请填写${rowNo}${labels.departureDate}。`;
    if (!item.departurePlace) return `请填写${rowNo}${labels.departurePlace}。`;
    if (!item.arrivalPlace) return `请填写${rowNo}${labels.arrivalPlace}。`;
    if (!item.cargoName) return `请填写${rowNo}${labels.cargoName}。`;
  }
  return "";
}
