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
import { Prisma } from "../generated/prisma/client.js";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
  supplierId?: string | null;
} | null | undefined;
type QueryLike = {
  get(key: string): string | null;
} | null | undefined;
type DomesticTransportInput = Record<string, unknown> & {
  containerNo?: string | null;
  containerType?: string | null;
  sealNo?: string | null;
  truckPlateNo?: string | null;
  trailerPlateNo?: string | null;
  departureDate?: unknown;
  departurePlace?: string | null;
  arrivalPlace?: string | null;
  destinationPlace?: string | null;
  cargoName?: string | null;
  cargoDescription?: string | null;
  remark?: string | null;
  sortOrder?: unknown;
};
type DomesticLogisticsInput = DomesticTransportInput & {
  transportItems?: DomesticTransportInput[];
  transportType?: string;
  expressTrackingNo?: string;
  remarkText?: string;
  remarkTextManualEdited?: boolean | string;
};
type NormalizedDomesticTransportItem = {
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  truckPlateNo: string;
  trailerPlateNo: string | null;
  departureDate: Date;
  departurePlace: string;
  arrivalPlace: string;
  cargoName: string;
  remark: string | null;
  sortOrder: number;
};
type DomesticLogisticsInfoLike = {
  remarkText?: string | null;
  submittedAt?: Date | string | null;
};
type LogisticsSupplierRowLike = {
  supplierId?: string | null;
  supplier?: unknown;
};
type LogisticsExpenseLike = {
  id?: string | null;
  billId?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
type LogisticsBillLike = {
  id?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  auditStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
type DomesticOrderLike = {
  id?: string;
  orderNo?: string | null;
  blNo?: string | null;
  customer?: { salespersonUserId?: string | null; country?: string | null } | null;
  customerNameSnapshot?: string | null;
  country?: string | null;
  logisticsSuppliers?: LogisticsSupplierRowLike[] | null;
  logisticsExpenses?: LogisticsExpenseLike[] | null;
  logisticsBills?: LogisticsBillLike[] | null;
  domesticLogisticsInfos?: DomesticLogisticsInfoLike[] | null;
  documents?: unknown[] | null;
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export function archiveScope(query: QueryLike) {
  const scope = nonEmpty(query?.get("archiveScope") || query?.get("businessScope") || query?.get("taxArchiveScope"));
  return ["current", "archive", "all"].includes(scope) ? scope : "current";
}

export function orderArchiveWhereForScope(scope = "current"): Prisma.ReceivableOrderWhereInput {
  if (scope === "archive") return { OR: [{ taxArchived: true }, { taxRefundStatus: "SUBMITTED" }] };
  if (scope === "all") return {};
  return { taxArchived: false };
}

export function domesticLogisticsInclude() {
  return Prisma.validator<Prisma.DomesticLogisticsInfoInclude>()({
    order: { include: { customer: true, salesperson: true } },
    submittedBy: true,
    financeConfirmedBy: true,
    transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  });
}

export function domesticLogisticsOrderInclude() {
  return Prisma.validator<Prisma.ReceivableOrderInclude>()({
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
    logisticsBills: {
      where: { deletedAt: null },
      select: {
        id: true,
        orderId: true,
        supplierId: true,
        auditStatus: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    },
    logisticsExpenses: {
      where: { deletedAt: null },
      select: {
        id: true,
        billId: true,
        orderId: true,
        supplierId: true,
        auditStatus: true,
        invoiceStatus: true,
        paymentStatus: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    },
  });
}

export function domesticLogisticsSubmitterRole(actor: ActorLike) {
  if (actor?.role === "管理员") return "ADMIN";
  if (actor?.role === "业务员") return "SALES";
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(String(actor?.role || ""))) return "LOGISTICS_OPERATOR";
  return "";
}

export function canReadDomesticLogisticsOrder(actor: ActorLike, order: DomesticOrderLike = {}) {
  if (!canRead(actor, "domesticLogistics")) return false;
  if (["管理员", "财务"].includes(String(actor?.role || ""))) return true;
  if (isInternalLogisticsOperator(actor)) return true;
  if (isExternalLogisticsSupplierAccount(actor)) {
    const supplierId = actor?.supplierId || "";
    return (order.logisticsSuppliers || []).some((row) => row.supplierId === supplierId);
  }
  if (actor?.role === "业务员") return order?.customer?.salespersonUserId === actor.id;
  return false;
}

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
  const labels = domesticTransportFieldLabels(transportType);
	  return items.map((item) => [
	    item.containerNo ? `${labels.containerNo}：${item.containerNo}` : "",
	    item.containerType ? `柜型：${item.containerType}` : "",
	    item.sealNo ? `封号：${item.sealNo}` : "",
	    item.truckPlateNo ? `${labels.truckPlateNo}：${item.truckPlateNo}` : "",
    item.trailerPlateNo ? `挂车车牌：${item.trailerPlateNo}` : "",
    item.departureDate ? `${labels.departureDate}：${dateToInput(item.departureDate)}` : "",
    item.departurePlace ? `${labels.departurePlace}：${item.departurePlace}` : "",
    item.arrivalPlace ? `${labels.arrivalPlace}：${item.arrivalPlace}` : "",
    item.cargoName ? `${labels.cargoName}：${item.cargoName}` : "",
  ].filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
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

function domesticLogisticsStatusText(info: DomesticLogisticsInfoLike | null = null) {
  if (!info) return "未提交";
  return info.remarkText ? "已提交" : "未完成";
}

const LOGISTICS_EXPENSE_STATUS_PRIORITY: Record<string, number> = {
  已驳回: 10,
  草稿: 20,
  待审核: 30,
  待开票: 40,
  已上传发票: 50,
  待付款: 60,
  部分付款: 70,
  已付款: 80,
  审核通过: 90,
  未录入: 100,
};

const DOMESTIC_LOGISTICS_PROGRESS_WEIGHT: Record<string, number> = {
  已驳回: 1,
  草稿: 1,
  未提交: 1,
  未完成: 1,
  未录入: 2,
  待审核: 3,
  已提交: 4,
  审核通过: 5,
  待开票: 5,
  已上传发票: 5,
  待付款: 5,
  部分付款: 5,
  已付款: 5,
};

function normalizedDomesticExpenseStatus(value = "") {
  const text = String(value || "").trim();
  if (["未通知", "已通知开票", "通知失败", "待开票 / 通知失败", "部分未通知", "部分已通知", "部分上传发票", "部分上传", "部分已上传", "部分已确认"].includes(text)) {
    return "待开票";
  }
  if (["已上传", "已上传发票"].includes(text)) return "已上传发票";
  if (["部分已付款"].includes(text)) return "部分付款";
  if (["部分待付款"].includes(text)) return "待付款";
  return text;
}

function domesticLogisticsExpenseBillId(order: DomesticOrderLike = {}, expense: LogisticsExpenseLike = {}) {
  if (expense.billId) return expense.billId;
  return `bill:${expense.orderId || order.id || "order"}:${order.blNo || order.orderNo || "no-bl"}`;
}

function domesticLogisticsBillDisplayStatus(bill: LogisticsBillLike = {}) {
  return normalizedDomesticExpenseStatus(bill.auditStatus || "草稿") || "草稿";
}

function domesticLogisticsExpenseDisplayStatus(expense: LogisticsExpenseLike = {}) {
  return normalizedDomesticExpenseStatus(expense.auditStatus || "草稿") || "草稿";
}

function logisticsStatusUpdatedAtValue(row: LogisticsBillLike | LogisticsExpenseLike = {}) {
  const time = new Date(row.updatedAt || row.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function domesticLogisticsExpenseStatusSummary(order: DomesticOrderLike = {}, actor: ActorLike = null) {
  const bills = (order.logisticsBills || []).filter((bill) => {
    if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(String(actor?.role || "")) && actor?.supplierId) {
      return bill.supplierId === actor.supplierId;
    }
    return true;
  });
  if (bills.length) {
    const rankedBills = bills.map((bill) => {
      const status = domesticLogisticsBillDisplayStatus(bill);
      return {
        status,
        billId: bill.id || "",
        updatedAt: bill.updatedAt || bill.createdAt || null,
        count: bills.length,
        rank: LOGISTICS_EXPENSE_STATUS_PRIORITY[status] || 999,
        updatedAtValue: logisticsStatusUpdatedAtValue(bill),
      };
    }).sort((left, right) => left.rank - right.rank || right.updatedAtValue - left.updatedAtValue);
    return rankedBills[0] || {
      status: "未录入",
      billId: "",
      updatedAt: null,
      count: 0,
    };
  }

  const expenses = (order.logisticsExpenses || []).filter((expense) => {
    if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(String(actor?.role || "")) && actor?.supplierId) {
      return expense.supplierId === actor.supplierId;
    }
    return true;
  });
  if (!expenses.length) {
    return {
      status: "未录入",
      billId: "",
      updatedAt: null,
      count: 0,
    };
  }
  const ranked = expenses.map((expense) => {
    const status = domesticLogisticsExpenseDisplayStatus(expense);
    return {
      status,
      billId: domesticLogisticsExpenseBillId(order, expense),
      updatedAt: expense.updatedAt || expense.createdAt || null,
      count: expenses.length,
      rank: LOGISTICS_EXPENSE_STATUS_PRIORITY[status] || 999,
      updatedAtValue: logisticsStatusUpdatedAtValue(expense),
    };
  }).sort((left, right) => left.rank - right.rank || right.updatedAtValue - left.updatedAtValue);
  return ranked[0] || {
    status: "未录入",
    billId: "",
    updatedAt: null,
    count: 0,
  };
}

function domesticLogisticsSortRank(order: DomesticOrderLike = {}) {
  const info = (order.domesticLogisticsInfos || [])[0];
  const logisticsStatus = domesticLogisticsStatusText(info);
  const feeStatus = domesticLogisticsExpenseStatusSummary(order).status;
  return Math.max(
    DOMESTIC_LOGISTICS_PROGRESS_WEIGHT[logisticsStatus] ?? 0,
    DOMESTIC_LOGISTICS_PROGRESS_WEIGHT[feeStatus] ?? 0,
  );
}

function dateSortValue(value: Date | string | null | undefined) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function sortDomesticLogisticsOrders(a: DomesticOrderLike = {}, b: DomesticOrderLike = {}) {
  const rankDiff = domesticLogisticsSortRank(a) - domesticLogisticsSortRank(b);
  if (rankDiff) return rankDiff;
  const updatedDiff = dateSortValue(b.updatedAt) - dateSortValue(a.updatedAt);
  if (updatedDiff) return updatedDiff;
  return dateSortValue(b.createdAt) - dateSortValue(a.createdAt);
}

export function serializeDomesticLogisticsOrder(order: DomesticOrderLike = {}, actor: ActorLike = null) {
  const info = serializeDomesticLogisticsInfo((order.domesticLogisticsInfos || [])[0]);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot || "");
  const shortCustomerName = customerShortName(order.customer);
  const expenseStatus = domesticLogisticsExpenseStatusSummary(order, actor);
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
    logisticsExpenseStatus: expenseStatus.status,
    logisticsExpenseStatusLabel: expenseStatus.status,
    logisticsExpenseBillId: expenseStatus.billId,
    logisticsExpenseCount: expenseStatus.count,
    logisticsExpenseUpdatedAt: expenseStatus.updatedAt,
    submittedAt: info?.submittedAt || null,
    domesticLogisticsInfo: info,
    documents: (order.documents || []).map((document) => serializeOrderDocument(document, order as Parameters<typeof serializeOrderDocument>[1])),
    logisticsSupplierIds: (order.logisticsSuppliers || []).map((row) => row.supplierId),
    logisticsSuppliers: (order.logisticsSuppliers || []).map((row) => serializeSupplier(row.supplier)).filter((item) => item.id),
  };
}

export type DomesticLogisticsOrderDto = ReturnType<typeof serializeDomesticLogisticsOrder>;
