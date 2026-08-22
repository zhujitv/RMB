const REPORT_TYPES = [
  ["receivables", "应收订单明细"], ["payments", "收款明细"], ["costs", "成本明细"],
  ["profits", "利润分析"], ["commissions", "业务员提成"], ["overdue", "逾期催款"],
  ["tax-refunds", "退税资料"], ["customer-analysis", "客户经营分析"], ["salesperson-performance", "业务员绩效"],
];

const CONFIGS = {
  dashboard: { title: "经营总览", endpoint: "/api/overview", root: "overview", analytics: true },
  costs: { title: "成本管理", endpoint: "/api/costs?view=details", createKind: "cost", actionable: true, fields: [["orderNo", "订单号"], ["customerName", "客户"], ["supplierName", "供应商"], ["costType", "成本类型"], ["amountCny", "折人民币"], ["paymentStatus", "付款状态"], ["invoiceStatus", "发票状态"]] },
  profit: { title: "利润分析", endpoint: "/api/profit", fields: [["orderNo", "订单号"], ["customerName", "客户"], ["receivableCny", "应收"], ["totalCostCny", "总成本"], ["expectedGrossProfit", "预计毛利"], ["expectedGrossMargin", "毛利率"], ["commissionStatus", "提成状态"]] },
  domesticLogistics: { title: "物流信息", endpoint: "/api/domestic-logistics", createKind: "domestic", fields: [["orderNo", "订单号"], ["customerName", "客户"], ["blNo", "提单号"], ["tradeTerm", "贸易条款"], ["logisticsStatus", "物流状态"], ["auditStatus", "审核状态"], ["invoiceStatus", "发票状态"]] },
  customerCommunication: { title: "客户沟通", endpoint: "/api/customer-communications", actionable: true, fields: [["orderNo", "订单号"], ["customerName", "客户"], ["status", "发送状态"], ["communicationStatus", "沟通状态"], ["lastSentAt", "最近发送"], ["recipientEmails", "收件邮箱"]] },
  oceanControlTower: { title: "运输监控", endpoint: "/api/freightower/ocean-trackings/control-tower", actionable: true, fields: [["orderNo", "订单号"], ["masterBlNo", "主提单号"], ["carrierName", "船公司"], ["statusLabel", "运输状态"], ["originName", "起运港"], ["destinationName", "目的港"], ["eta", "预计到港"], ["alertCount", "预警数"]] },
  logisticsFees: { title: "物流费用", endpoint: "/api/logistics-costs", createKind: "logisticsFee", actionable: true, fields: [["orderNo", "订单号"], ["customerName", "客户"], ["supplierName", "供应商"], ["costType", "费用类型"], ["amountCny", "折人民币"], ["auditStatus", "审核状态"], ["invoiceStatus", "发票状态"], ["paymentStatus", "付款状态"]] },
  taxRefund: { title: "退税资料", endpoint: "/api/tax-refund/list", actionable: true, fields: [["orderNo", "订单号"], ["customerName", "客户"], ["customsDeclarationNo", "报关单号"], ["customsDeclarationDate", "申报日期"], ["overallCompleteness", "完整度"], ["taxRefundStatusLabel", "退税状态"], ["missingDocumentCount", "缺少资料"]] },
  reports: { title: "报表中心", endpoint: "/api/reports", reports: REPORT_TYPES },
};

module.exports = { CONFIGS, REPORT_TYPES };
