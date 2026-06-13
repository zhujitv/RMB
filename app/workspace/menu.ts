import type { MenuItem, PermissionSnapshot, User } from "./types";

export const MENU_ITEMS: MenuItem[] = [
  { key: "dashboard", label: "经营总览", description: "经营分析工具，按需进入后加载统计。" },
  { key: "orders", label: "应收订单", description: "创建、编辑和跟进订单应收信息。" },
  { key: "payments", label: "收款管理", description: "登记客户回款并确认到账状态。" },
  { key: "costs", label: "成本管理", description: "维护工厂、物流、港杂等成本资料。" },
  { key: "logisticsFees", label: "物流费用登记", description: "物流供应商费用录入、审核和付款跟进。" },
  { key: "profit", label: "利润分析", description: "查看预计毛利、已实现毛利和提成状态。" },
  { key: "domesticLogistics", label: "国内物流信息", description: "录入国内运输信息和报关资料。" },
  { key: "taxRefund", label: "退税资料", description: "汇总资料完整度、打包下载和提交归档。" },
  { key: "reports", label: "报表中心", description: "在线查询后按需导出报表。" },
  { key: "manual", label: "操作说明书", description: "查看平台业务流程和操作规范。" },
  { key: "settings", label: "系统设置", description: "维护用户、客户、供应商、汇率和日志。" },
];

export const ROLE_MENU_FALLBACK: Record<string, string[]> = {
  管理员: ["dashboard", "orders", "payments", "costs", "logisticsFees", "profit", "domesticLogistics", "taxRefund", "reports", "manual", "settings"],
  业务员: ["orders", "payments", "costs", "profit", "domesticLogistics", "taxRefund", "reports", "manual"],
  财务: ["payments", "costs", "logisticsFees", "profit", "taxRefund", "reports", "manual"],
  成本录入员: ["costs", "manual"],
  物流供应商: ["domesticLogistics", "logisticsFees", "manual"],
  物流资料录入员: ["domesticLogistics", "logisticsFees", "manual"],
  查看者: ["manual"],
};

export function availableMenus(user: User, permissions?: PermissionSnapshot) {
  const allowed = permissions?.menus?.length ? permissions.menus : ROLE_MENU_FALLBACK[user.role] || ["manual"];
  return MENU_ITEMS.filter((item) => allowed.includes(item.key));
}
