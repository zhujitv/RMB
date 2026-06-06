import { apiError, assertRead, getActor, getOverview, getReminders, listCosts, listOrders, listPayments } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvResponse(filename, columns, rows) {
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows
    .map((row) => columns.map((column) => csvCell(typeof column.value === "function" ? column.value(row) : row[column.value])).join(","))
    .join("\n");
  return new Response(`\ufeff${header}\n${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(request) {
  try {
    const actor = await getActor(request);
    assertRead(actor, "reports");
    const query = new URL(request.url).searchParams;
    const type = query.get("type") || "orders";

    if (type === "backup-json") {
      if (actor.role !== "管理员") {
        return Response.json({ error: "只有管理员可以导出完整数据备份" }, { status: 403 });
      }
      const [overview, orders, payments, costs] = await Promise.all([
        getOverview(query, actor),
        listOrders(query, actor),
        listPayments(query, actor),
        listCosts(query, actor),
      ]);
      return Response.json({
        exportedAt: new Date().toISOString(),
        platform: "外贸应收款协同管理平台",
        overview,
        orders,
        payments,
        costs,
      });
    }

    if (type === "payments") {
      const rows = await listPayments(query, actor);
      return csvResponse("payments.csv", [
        { label: "订单号", value: "orderNo" },
        { label: "客户", value: "customerName" },
        { label: "收款日期", value: "paymentDate" },
        { label: "收款类型", value: "paymentType" },
        { label: "币种", value: "currency" },
        { label: "汇率", value: "exchangeRate" },
        { label: "收款金额", value: "amount" },
        { label: "折人民币金额", value: "amountCny" },
        { label: "状态", value: "status" },
        { label: "银行流水号", value: "bankReference" },
        { label: "备注", value: "remark" },
      ], rows);
    }

    if (type === "costs") {
      const rows = await listCosts(query, actor);
      return csvResponse("order-costs.csv", [
        { label: "订单号", value: "orderNo" },
        { label: "客户", value: "customerName" },
        { label: "成本类型", value: "costType" },
        { label: "供应商名称", value: "supplierName" },
        { label: "供应商类型", value: "supplierType" },
        { label: "币种", value: "currency" },
        { label: "汇率", value: "exchangeRate" },
        { label: "成本金额", value: "amount" },
        { label: "折人民币金额", value: "amountCny" },
        { label: "付款状态", value: "paymentStatus" },
        { label: "付款日期", value: "paymentDate" },
        { label: "发票状态", value: "invoiceStatus" },
        { label: "备注", value: "remark" },
      ], rows);
    }

    if (type === "reminders") {
      const rows = await getReminders(query, actor);
      return csvResponse("payment-reminders.csv", [
        { label: "订单号", value: "orderNo" },
        { label: "提单号", value: "blNo" },
        { label: "客户", value: "customerName" },
        { label: "业务员", value: "salespersonName" },
        { label: "付款条款", value: "paymentTermDisplay" },
        { label: "到期日", value: "dueDate" },
        { label: "未收款", value: (row) => row.summary.outstandingCny },
        { label: "提醒状态", value: (row) => row.summary.reminderStatus },
        { label: "逾期天数", value: (row) => row.summary.overdueDays },
      ], rows);
    }

    const rows = await listOrders(query, actor);
    const columns = [
      { label: "订单号", value: "orderNo" },
      { label: "提单号", value: "blNo" },
      { label: "客户", value: "customerName" },
      { label: "业务员", value: "salespersonName" },
      { label: "国家/地区", value: "country" },
      { label: "币种", value: "currency" },
      { label: "汇率", value: "exchangeRate" },
      { label: "预计应收金额", value: "estimatedReceivableAmount" },
      { label: "预计应收人民币", value: "estimatedReceivableAmountCny" },
      { label: "实际发货金额", value: "actualShipmentAmount" },
      { label: "最终应收金额", value: "finalReceivableAmount" },
      { label: "最终应收人民币", value: "finalReceivableAmountCny" },
      { label: "付款条款", value: "paymentTermDisplay" },
      { label: "付款条款类型", value: "paymentTermType" },
      { label: "预计到港日期", value: "expectedArrivalDate" },
      { label: "预计发货日期", value: "expectedShipmentDate" },
      { label: "提单日期", value: "blDate" },
      { label: "到期日", value: "dueDate" },
      { label: "分批付款节点", value: "paymentInstallmentText" },
      { label: "预付款比例", value: "depositRatio" },
      { label: "预付款要求金额", value: (row) => row.summary.requiredDepositAmount },
      { label: "已收到预付款", value: (row) => row.summary.receivedDepositCny },
      { label: "预付款差额", value: (row) => row.summary.depositGapCny },
      { label: "已收款", value: (row) => row.summary.confirmedPaymentsCny },
      { label: "未收款", value: (row) => row.summary.outstandingCny },
      { label: "多收款", value: (row) => row.summary.overpaidCny },
      { label: "总成本", value: (row) => row.summary.totalCostCny },
      { label: "预计毛利", value: (row) => row.summary.expectedGrossProfit },
      { label: "实际毛利", value: (row) => row.summary.actualGrossProfit },
      { label: "毛利率", value: (row) => `${(row.summary.grossMargin * 100).toFixed(2)}%` },
      { label: "订单状态", value: "status" },
      { label: "逾期状态", value: (row) => row.summary.reminderStatus },
      { label: "逾期天数", value: (row) => row.summary.overdueDays },
    ];
    return csvResponse(type === "profit" ? "order-profit-analysis.csv" : "receivable-orders.csv", columns, rows);
  } catch (error) {
    return apiError(error, "导出报表失败");
  }
}
