import type { MenuItem, PermissionSnapshot, User } from "./types";

export const MENU_ITEMS: MenuItem[] = [
  { key: "dashboard", label: "经营总览", description: "经营分析工具，按需进入后加载统计。" },
  { key: "orders", label: "应收订单", description: "创建、编辑和跟进订单应收信息。" },
  { key: "payments", label: "收款管理", description: "登记客户回款并确认到账状态。" },
  { key: "costs", label: "成本管理", description: "维护工厂、物流、港杂等成本资料。" },
  { key: "profit", label: "利润分析", description: "查看预计毛利、已实现毛利和提成状态。" },
  { key: "domesticLogistics", label: "物流信息", description: "录入国内运输信息和报关资料。" },
  { key: "logisticsReview", label: "物流费用审核", description: "审核供应商提交的物流费用、月结和开票通知。" },
  { key: "supplierDocuments", label: "资料回传", description: "下载合同样本后回传工厂采购合同和增值税发票 PDF。" },
  { key: "taxRefund", label: "退税资料", description: "汇总资料完整度、打包下载和提交归档。" },
  { key: "reports", label: "报表中心", description: "在线查询后按需导出报表。" },
  { key: "manual", label: "操作说明书", description: "查看平台业务流程和操作规范。" },
  { key: "settings", label: "系统设置", description: "维护用户、客户、供应商、汇率和日志。" },
];

export const ROLE_MENU_FALLBACK: Record<string, string[]> = {
  管理员: ["dashboard", "orders", "payments", "costs", "profit", "domesticLogistics", "logisticsReview", "taxRefund", "reports", "manual", "settings"],
  业务员: ["orders", "payments", "costs", "domesticLogistics", "taxRefund", "reports", "manual"],
  财务: ["payments", "costs", "profit", "domesticLogistics", "taxRefund", "reports", "manual"],
  物流供应商: ["domesticLogistics", "manual"],
  产品供应商账号: ["supplierDocuments", "manual"],
  工厂供应商账号: ["supplierDocuments", "manual"],
  物流资料录入员: ["domesticLogistics", "manual"],
};

export function availableMenus(user: User, permissions?: PermissionSnapshot) {
  if (user.role === "管理员") {
    return MENU_ITEMS.filter((item) => ROLE_MENU_FALLBACK["管理员"].includes(item.key));
  }
  const allowed = permissions?.menus?.length ? permissions.menus : ROLE_MENU_FALLBACK[user.role] || ["manual"];
  return MENU_ITEMS.filter((item) => allowed.includes(item.key));
}
