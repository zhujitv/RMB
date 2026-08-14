import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  buildOverviewMonthlyTrend,
  overviewMonthKey,
  overviewOrderMetrics,
  previousOverviewMonth,
} = jiti("../lib/platform/business-overview-metrics.ts") as typeof import("../lib/platform/business-overview-metrics.ts");
const { buildReportSummary } = jiti("../lib/report-service-summary.ts") as typeof import("../lib/report-service-summary.ts");
const { filterRows } = jiti("../lib/report-service-shared.ts") as typeof import("../lib/report-service-shared.ts");
const { aggregateProfitReportRows, reportQueryForBaseRows } = jiti("../lib/report-service-mappers.ts") as typeof import("../lib/report-service-mappers.ts");
const { columnsFor } = jiti("../lib/report-service-shared.ts") as typeof import("../lib/report-service-shared.ts");

test("overview trend assigns orders, receipts, and payments to their real business months", () => {
  const currentMonth = overviewMonthKey(new Date());
  const previousMonth = previousOverviewMonth(currentMonth);
  const order = overviewOrderMetrics({
    id: "order-1",
    orderNo: "ORDER-1",
    createdAt: `${previousMonth}-05T00:00:00.000Z`,
    summary: {
      receivableCny: 1000,
      arrivedPaymentsCny: 500,
      outstandingCny: 500,
      confirmedTotalCostCny: 300,
      totalCostCny: 300,
      expectedGrossProfit: 700,
    },
  } as never);

  const trend = buildOverviewMonthlyTrend(
    [order],
    [{ status: "已到账", amountCny: 500, paymentDate: `${currentMonth}-08` }],
    [{ paymentStatus: "已支付", amountCny: 120, paymentDate: `${currentMonth}-09` }],
  );
  const previous = trend.find((row) => row.label === previousMonth);
  const current = trend.find((row) => row.label === currentMonth);

  assert.equal(previous?.receivable, 1000);
  assert.equal(previous?.paid, 0);
  assert.equal(current?.receivable, 0);
  assert.equal(current?.paid, 500);
  assert.equal(current?.cost, 120);
  assert.equal(current?.netCashFlow, 380);
});

test("receivable report summary totals every overdue row rather than a Top10 subset", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `order-${index}`,
    customerName: index < 6 ? "CUSTOMER A" : "CUSTOMER B",
    finalReceivableAmountCny: 100,
    receivedAmountCny: 0,
    outstandingCny: 100,
    dueDate: "2020-01-01",
  }));
  const summary = buildReportSummary("receivables", rows);
  const overdue = summary.metrics.find((metric) => metric.key === "overdue");

  assert.equal(overdue?.value, 1200);
  assert.equal(overdue?.note, "12 个逾期订单");
  assert.equal(summary.breakdowns[0]?.items.length, 2);
});

test("cost report summary separates confirmation, payment, and invoice risks", () => {
  const summary = buildReportSummary("costs", [
    { id: "1", costType: "工厂货款", amountCny: 600, costConfirmed: true, paymentStatus: "已支付", invoiceStatus: "已收到" },
    { id: "2", costType: "海运费", amountCny: 400, costConfirmed: false, paymentStatus: "待支付", invoiceStatus: "未收到" },
  ]);
  const metric = (key: string) => summary.metrics.find((item) => item.key === key)?.value;

  assert.equal(metric("total"), 1000);
  assert.equal(metric("confirmed"), 600);
  assert.equal(metric("paid"), 600);
  assert.equal(metric("unpaid"), 400);
  assert.equal(metric("missingInvoice"), 400);
  assert.equal(metric("confirmationRate"), 0.6);
});

test("report date filters use the report business date instead of any updated timestamp", () => {
  const rows = [{
    id: "payment-1",
    paymentDate: "2026-06-15",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }];
  const filters = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };

  assert.equal(filterRows(rows, filters, "payments").length, 0);
});

test("cost report base scan is not accidentally limited to the UI page size", () => {
  const sourceQuery = new URLSearchParams({ page: "1", pageSize: "20", keyword: "FREIGHT" });
  const query = reportQueryForBaseRows("costs", sourceQuery, {});

  assert.equal(query.get("page"), null);
  assert.equal(query.get("pageSize"), "5000");
  assert.equal(query.get("keyword"), "FREIGHT");
});

test("customer and salesperson analysis aggregate financial contribution with overdue risk", () => {
  const sourceRows = [
    { customerName: "CLIENT A", salespersonName: "Alice", createdAt: "2026-07-01", dueDate: "2020-01-01", receivableCny: 1000, receivedAmountCny: 600, outstandingCny: 400, totalCostCny: 700, expectedGrossProfit: 300, netCashFlowCny: -100 },
    { customerName: "CLIENT A", salespersonName: "Alice", createdAt: "2026-08-01", dueDate: "2099-01-01", receivableCny: 500, receivedAmountCny: 500, outstandingCny: 0, totalCostCny: 350, expectedGrossProfit: 150, netCashFlowCny: 150 },
  ];
  const customerRows = aggregateProfitReportRows(sourceRows, "customer");
  const salespersonRows = aggregateProfitReportRows(sourceRows, "salesperson");

  assert.equal(customerRows.length, 1);
  assert.equal(customerRows[0]?.orderCount, 2);
  assert.equal(customerRows[0]?.receivableCny, 1500);
  assert.equal(customerRows[0]?.expectedGrossProfit, 450);
  assert.equal(customerRows[0]?.overdueAmountCny, 400);
  assert.equal(customerRows[0]?.expectedGrossMargin, "30.00%");
  assert.equal(salespersonRows[0]?.customerCount, 1);
  assert.ok(columnsFor("customer-analysis").some((column) => column.key === "averageOrderValueCny"));
  assert.ok(columnsFor("salesperson-performance").some((column) => column.key === "collectionRate"));
});
