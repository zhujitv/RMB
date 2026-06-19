// @ts-nocheck
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  canRead,
  codedError,
  customerFullName,
  customerShortName,
  dateFromInput,
  dateToInput,
  nonEmpty,
  optional,
  requireText,
  serializeDomesticLogisticsInfo,
  serializeOrderDocument,
  serializeSupplier,
} from "./shared";
import {
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";

export function archiveScope(query) {
  const scope = nonEmpty(query?.get("archiveScope") || query?.get("businessScope") || query?.get("taxArchiveScope"));
  return ["current", "archive", "all"].includes(scope) ? scope : "current";
}

export function orderArchiveWhereForScope(scope = "current") {
  if (scope === "archive") return { OR: [{ taxArchived: true }, { taxRefundStatus: "SUBMITTED" }] };
  if (scope === "all") return {};
  return { taxArchived: false };
}

export function domesticLogisticsInclude() {
  return {
    order: { include: { customer: true, salesperson: true } },
    submittedBy: true,
    financeConfirmedBy: true,
    transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  };
}

export function domesticLogisticsOrderInclude() {
  return {
    customer: true,
    salesperson: true,
    domesticLogisticsInfos: {
      include: {
        submittedBy: true,
        financeConfirmedBy: true,
        transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 1,
    },
    documents: {
      where: { deletedAt: null, documentType: { in: DOMESTIC_LOGISTICS_DOCUMENT_TYPES } },
      include: { uploadedBy: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
    logisticsSuppliers: {
      include: { supplier: true },
      orderBy: [{ assignedAt: "desc" }],
    },
  };
}

export function domesticLogisticsSubmitterRole(actor) {
  if (actor?.role === "管理员") return "ADMIN";
  if (actor?.role === "业务员") return "SALES";
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actor?.role)) return "LOGISTICS_OPERATOR";
  return "";
}

export function canReadDomesticLogisticsOrder(actor, order = {}) {
  if (!canRead(actor, "domesticLogistics")) return false;
  if (["管理员", "财务"].includes(actor?.role)) return true;
  if (isInternalLogisticsOperator(actor)) return true;
  if (isExternalLogisticsSupplierAccount(actor)) {
    return (order.logisticsSuppliers || []).some((row) => row.supplierId === actor.supplierId);
  }
  if (actor?.role === "业务员") return order?.customer?.salespersonUserId === actor.id;
  return false;
}

export function normalizeDomesticTransportItems(input = {}, transportType = "TRUCK") {
  if (transportType === "EXPRESS") return [];
  const rawItems = Array.isArray(input.transportItems) ? input.transportItems : [];
  const fallback = {
    containerNo: optional(input.containerNo),
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
    item.truckPlateNo,
    item.trailerPlateNo,
    item.departureDate,
    item.departurePlace,
    item.arrivalPlace || item.destinationPlace,
    item.cargoName || item.cargoDescription,
    item.remark,
  ].some((value) => nonEmpty(value)));
  const items = meaningfulRawItems.length ? meaningfulRawItems : [fallback];
  const normalized = items.map((item, index) => {
    const truckPlateNo = requireText(item.truckPlateNo, transportType === "MULTIMODAL" ? `第 ${index + 1} 行首程车牌号` : `第 ${index + 1} 行车牌号`);
    const departureDate = dateFromInput(item.departureDate);
    if (!departureDate) throw codedError(`请选择第 ${index + 1} 行起运日期`, 400, "DEPARTURE_DATE_REQUIRED");
    return {
      containerNo: optional(item.containerNo),
      truckPlateNo,
      trailerPlateNo: optional(item.trailerPlateNo),
      departureDate,
      departurePlace: requireText(item.departurePlace, transportType === "MULTIMODAL" ? `第 ${index + 1} 行首程起运地` : `第 ${index + 1} 行起运地`),
      arrivalPlace: requireText(item.arrivalPlace || item.destinationPlace, `第 ${index + 1} 行到达地`),
      cargoName: requireText(item.cargoName || item.cargoDescription, `第 ${index + 1} 行运输货物名称`),
      remark: optional(item.remark),
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    };
  });
  if (!normalized.length) throw codedError("请至少填写一条集装箱运输明细", 400, "TRANSPORT_ITEMS_REQUIRED");
  return normalized;
}

function domesticLogisticsRemarkFromItems(items = []) {
  return items.map((item) => [
    item.containerNo ? `集装箱号：${item.containerNo}` : "",
    item.truckPlateNo ? `车牌号：${item.truckPlateNo}` : "",
    item.trailerPlateNo ? `挂车车牌：${item.trailerPlateNo}` : "",
    item.departureDate ? `起运日：${dateToInput(item.departureDate)}` : "",
    item.departurePlace ? `起运地：${item.departurePlace}` : "",
    item.arrivalPlace ? `到达地：${item.arrivalPlace}` : "",
    item.cargoName ? `运输货物名称：${item.cargoName}` : "",
  ].filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
}

export function domesticLogisticsRemark(input = {}) {
  const type = input.transportType;
  if (type === "EXPRESS") {
    const trackingNo = requireText(input.expressTrackingNo, "快递单号");
    return [
      `快递单号：${trackingNo}`,
      input.destinationPlace ? `到达地：${input.destinationPlace}` : "",
      input.cargoDescription ? `运输货物名称：${input.cargoDescription}` : "",
    ].filter(Boolean).join("\n");
  }
  return domesticLogisticsRemarkFromItems(normalizeDomesticTransportItems(input, type));
}

function domesticLogisticsStatusText(info = null) {
  if (!info) return "未提交";
  return info.remarkText ? "已提交" : "未完成";
}

function domesticLogisticsSortRank(order = {}) {
  const info = (order.domesticLogisticsInfos || [])[0];
  if (!info) return 1;
  if (!info.remarkText) return 2;
  if (order.taxArchived || order.taxRefundStatus === "SUBMITTED") return 4;
  return 3;
}

function dateSortValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function sortDomesticLogisticsOrders(a = {}, b = {}) {
  const rankDiff = domesticLogisticsSortRank(a) - domesticLogisticsSortRank(b);
  if (rankDiff) return rankDiff;
  const updatedDiff = dateSortValue(b.updatedAt) - dateSortValue(a.updatedAt);
  if (updatedDiff) return updatedDiff;
  return dateSortValue(b.createdAt) - dateSortValue(a.createdAt);
}

export function serializeDomesticLogisticsOrder(order) {
  const info = serializeDomesticLogisticsInfo((order.domesticLogisticsInfos || [])[0]);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  return {
    id: order.id,
    orderId: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerShortName: shortCustomerName || fullCustomerName,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    destinationCountry: order.customer?.country || order.country || "",
    destinationPort: "",
    logisticsStatus: domesticLogisticsStatusText(info),
    submittedAt: info?.submittedAt || null,
    domesticLogisticsInfo: info,
    documents: (order.documents || []).map((document) => serializeOrderDocument(document, order)),
    logisticsSupplierIds: (order.logisticsSuppliers || []).map((row) => row.supplierId),
    logisticsSuppliers: (order.logisticsSuppliers || []).map((row) => serializeSupplier(row.supplier)).filter((item) => item.id),
  };
}
