import {
  dateOnly,
  displayCustomerName,
  moneyNumber,
  nonEmptyText,
  type ReportRow,
} from "./report-service-shared";

type ProfitAggregate = {
  id: string;
  customerName?: string;
  salespersonName?: string;
  customers: Set<string>;
  orderCount: number;
  receivableCny: number;
  receivedAmountCny: number;
  outstandingCny: number;
  totalCostCny: number;
  expectedGrossProfit: number;
  profitMarginEligibleOrderCount: number;
  profitMarginReceivableCny: number;
  profitMarginProfitCny: number;
  realizedGrossProfit: number;
  netCashFlowCny: number;
  overdueOrders: number;
  overdueAmountCny: number;
  lastOrderDate: string;
};

function createProfitAggregate(dimension: "customer" | "salesperson", key: string, label: string): ProfitAggregate {
  return {
    id: `${dimension}:${key}`,
    ...(dimension === "customer" ? { customerName: label } : { salespersonName: label }),
    customers: new Set<string>(),
    orderCount: 0,
    receivableCny: 0,
    receivedAmountCny: 0,
    outstandingCny: 0,
    totalCostCny: 0,
    expectedGrossProfit: 0,
    profitMarginEligibleOrderCount: 0,
    profitMarginReceivableCny: 0,
    profitMarginProfitCny: 0,
    realizedGrossProfit: 0,
    netCashFlowCny: 0,
    overdueOrders: 0,
    overdueAmountCny: 0,
    lastOrderDate: "",
  };
}

export function aggregateProfitReportRows(rows: ReportRow[], dimension: "customer" | "salesperson") {
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const groups = rows.reduce<Record<string, ProfitAggregate>>((acc, row) => {
    const customerName = displayCustomerName(row.customerName || row.customerFullName || "未填写客户");
    const salespersonName = nonEmptyText(row.salespersonName) || "未分配";
    const label = dimension === "customer" ? customerName : salespersonName;
    const key = label.toLocaleLowerCase("zh-CN");
    acc[key] ||= createProfitAggregate(dimension, key, label);

    const group = acc[key];
    const outstanding = moneyNumber(row.outstandingCny);
    const dueDate = dateOnly(row.dueDate);
    group.customers.add(customerName);
    group.orderCount += 1;
    group.receivableCny += moneyNumber(row.receivableCny);
    group.receivedAmountCny += moneyNumber(row.receivedAmountCny);
    group.outstandingCny += outstanding;
    group.totalCostCny += moneyNumber(row.totalCostCny);
    group.expectedGrossProfit += moneyNumber(row.expectedGrossProfit);
    if (row.profitMarginEligible === true) {
      group.profitMarginEligibleOrderCount += 1;
      group.profitMarginReceivableCny += moneyNumber(row.receivableCny);
      group.profitMarginProfitCny += moneyNumber(row.expectedGrossProfit);
    }
    group.realizedGrossProfit += moneyNumber(row.realizedGrossProfit);
    group.netCashFlowCny += moneyNumber(row.netCashFlowCny);
    if (dueDate && dueDate < today && outstanding > 0) {
      group.overdueOrders += 1;
      group.overdueAmountCny += outstanding;
    }
    const orderDate = dateOnly(row.createdAt || row.date);
    if (orderDate > group.lastOrderDate) group.lastOrderDate = orderDate;
    return acc;
  }, {});

  return Object.values(groups).map((group) => ({
    ...group,
    customers: undefined,
    customerCount: group.customers.size,
    averageOrderValueCny: group.orderCount > 0 ? moneyNumber(group.receivableCny / group.orderCount) : 0,
    collectionRate: group.receivableCny > 0 ? `${((group.receivedAmountCny / group.receivableCny) * 100).toFixed(2)}%` : "--",
    profitMarginEligible: group.profitMarginEligibleOrderCount > 0,
    expectedGrossMargin: group.profitMarginReceivableCny > 0
      ? `${((group.profitMarginProfitCny / group.profitMarginReceivableCny) * 100).toFixed(2)}%`
      : "--",
  })).sort((a, b) => b.receivableCny - a.receivableCny);
}
