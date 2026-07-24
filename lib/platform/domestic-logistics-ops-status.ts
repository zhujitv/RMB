import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  customerFullName,
  customerShortName,
  serializeDomesticLogisticsInfo,
  serializeOrderDocument,
  serializeSupplier,
} from "./shared";
import { businessEntityFieldsFromOrder } from "./business-entities";
import { serializeShipsgoTrackingSummary } from "./shipsgo-tracking";
import {
  type ActorLike,
  type DomesticLogisticsInfoLike,
  type DomesticOrderLike,
  type LogisticsBillLike,
  type LogisticsExpenseLike,
} from "./domestic-logistics-ops-shared";

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
  if (["已上传", "已上传发票", "已确认", "已确认发票"].includes(text)) return "已上传发票";
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

function domesticLogisticsBillInvoiceStatus(bill: LogisticsBillLike = {}) {
  return normalizedDomesticExpenseStatus(bill.invoiceStatus || "未通知") || "未通知";
}

function domesticLogisticsExpenseDisplayStatus(expense: LogisticsExpenseLike = {}) {
  return normalizedDomesticExpenseStatus(expense.auditStatus || "草稿") || "草稿";
}

function logisticsStatusUpdatedAtValue(row: LogisticsBillLike | LogisticsExpenseLike = {}) {
  const time = new Date(row.updatedAt || row.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function domesticLogisticsBillRowsForActor(order: DomesticOrderLike = {}, actor: ActorLike = null) {
  return (order.logisticsBills || []).filter((bill) => {
    if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(String(actor?.role || "")) && actor?.supplierId) {
      return bill.supplierId === actor.supplierId;
    }
    return true;
  });
}

function domesticLogisticsExpenseRowsForActor(order: DomesticOrderLike = {}, actor: ActorLike = null) {
  return (order.logisticsExpenses || []).filter((expense) => {
    if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(String(actor?.role || "")) && actor?.supplierId) {
      return expense.supplierId === actor.supplierId;
    }
    return true;
  });
}

export function domesticLogisticsCanArchiveOrder(order: DomesticOrderLike = {}, actor: ActorLike = null) {
  if (order.isArchived === true) return false;
  const bills = domesticLogisticsBillRowsForActor(order, actor);
  if (bills.length) {
    return bills.every((bill) => (
      domesticLogisticsBillDisplayStatus(bill) === "审核通过"
      && domesticLogisticsBillInvoiceStatus(bill) === "已上传发票"
    ));
  }
  const expenses = domesticLogisticsExpenseRowsForActor(order, actor);
  return expenses.length > 0 && expenses.every((expense) => (
    domesticLogisticsExpenseDisplayStatus(expense) === "审核通过"
    && (normalizedDomesticExpenseStatus(expense.invoiceStatus || "未通知") || "未通知") === "已上传发票"
  ));
}

export function domesticLogisticsExpenseStatusSummary(order: DomesticOrderLike = {}, actor: ActorLike = null) {
  const bills = domesticLogisticsBillRowsForActor(order, actor);
  if (bills.length) {
    const rankedBills = bills.map((bill) => {
      const status = domesticLogisticsBillDisplayStatus(bill);
      return {
        status,
        invoiceStatus: domesticLogisticsBillInvoiceStatus(bill),
        billId: bill.id || "",
        updatedAt: bill.updatedAt || bill.createdAt || null,
        count: bills.length,
        rank: LOGISTICS_EXPENSE_STATUS_PRIORITY[status] || 999,
        updatedAtValue: logisticsStatusUpdatedAtValue(bill),
      };
    }).sort((left, right) => left.rank - right.rank || right.updatedAtValue - left.updatedAtValue);
    return rankedBills[0] || {
      status: "未录入",
      invoiceStatus: "待开票",
      billId: "",
      updatedAt: null,
      count: 0,
    };
  }

  const expenses = domesticLogisticsExpenseRowsForActor(order, actor);
  if (!expenses.length) {
    return {
      status: "未录入",
      invoiceStatus: "待开票",
      billId: "",
      updatedAt: null,
      count: 0,
    };
  }
  const ranked = expenses.map((expense) => {
    const status = domesticLogisticsExpenseDisplayStatus(expense);
    return {
      status,
      invoiceStatus: normalizedDomesticExpenseStatus(expense.invoiceStatus || "待开票") || "待开票",
      billId: domesticLogisticsExpenseBillId(order, expense),
      updatedAt: expense.updatedAt || expense.createdAt || null,
      count: expenses.length,
      rank: LOGISTICS_EXPENSE_STATUS_PRIORITY[status] || 999,
      updatedAtValue: logisticsStatusUpdatedAtValue(expense),
    };
  }).sort((left, right) => left.rank - right.rank || right.updatedAtValue - left.updatedAtValue);
  return ranked[0] || {
    status: "未录入",
    invoiceStatus: "待开票",
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
    tradeTerm: order.tradeTerm || "",
    customerShortName: shortCustomerName || fullCustomerName,
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    ...businessEntityFieldsFromOrder(order),
    destinationCountry: order.customer?.country || order.country || "",
    destinationPort: "",
    logisticsStatus: domesticLogisticsStatusText(info),
    isArchived: Boolean(order.isArchived),
    auditStatus: expenseStatus.status,
    invoiceStatus: expenseStatus.invoiceStatus,
    archiveEligible: domesticLogisticsCanArchiveOrder(order, actor),
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
    shipsgoTrackings: (order.shipsgoTrackings || []).map((row) => serializeShipsgoTrackingSummary(row)),
  };
}

export type DomesticLogisticsOrderDto = ReturnType<typeof serializeDomesticLogisticsOrder>;
