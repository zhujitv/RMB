import type { MenuItem, PermissionSnapshot, User } from "./types";

export const MENU_ITEMS: MenuItem[] = [
  { key: "dashboard", label: "经营总览", description: "经营分析工具，按需进入后加载统计。" },
  { key: "quotations", label: "报价管理", description: "创建、编辑和跟进客户报价。" },
  { key: "salesExecution", label: "销售执行", description: "从报价转入或直接创建销售执行单，并分配工厂采购草稿。" },
  { key: "orders", label: "应收订单", description: "创建、编辑和跟进订单应收信息。" },
  { key: "payments", label: "收款管理", description: "登记客户回款并确认到账状态。" },
  { key: "costs", label: "成本管理", description: "维护工厂、物流、港杂等成本资料。" },
  { key: "profit", label: "利润分析", description: "查看预计毛利、已实现毛利和提成状态。" },
  { key: "domesticLogistics", label: "物流信息", description: "录入国内运输信息和报关资料。" },
  { key: "customerCommunication", label: "客户沟通", description: "按订单发送和追踪客户清关资料邮件。" },
  { key: "oceanControlTower", label: "运输监控", description: "集中查看在途海运跟踪和 ETA 预警。", parentKey: "domesticLogistics" },
  { key: "logisticsFees", label: "物流费用", description: "录入、审核、月结和维护物流费用。" },
  { key: "supplierPurchaseOrders", label: "工厂采购单", description: "确认交期、填报生产进度并申请交付数量差异。" },
  { key: "supplierDocuments", label: "资料回传", description: "下载合同样本后回传工厂采购合同和增值税发票 PDF。" },
  { key: "taxRefund", label: "退税资料", description: "汇总资料完整度、打包下载和提交归档。" },
  { key: "reports", label: "报表中心", description: "在线查询后按需导出报表。" },
  { key: "manual", label: "操作手册", description: "查看平台业务流程、操作规范和资料要求。" },
  { key: "settings", label: "系统设置", description: "维护用户、客户、供应商、汇率和日志。" },
];

export const ROLE_MENU_FALLBACK: Record<string, string[]> = {
  管理员: ["dashboard", "quotations", "salesExecution", "orders", "payments", "costs", "profit", "domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "supplierDocuments", "taxRefund", "reports", "manual", "settings"],
  业务员: ["quotations", "salesExecution", "orders", "payments", "costs", "domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "taxRefund", "reports", "manual"],
  财务: ["salesExecution", "payments", "costs", "profit", "domesticLogistics", "logisticsFees", "taxRefund", "reports", "manual"],
  物流供应商: ["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"],
  产品供应商: ["supplierPurchaseOrders", "supplierDocuments", "manual"],
  工厂供应商账号: ["supplierPurchaseOrders", "supplierDocuments", "manual"],
  物流资料录入员: ["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"],
};

const OCEAN_CONTROL_TOWER_ROLES = ["管理员", "业务员", "物流供应商", "物流资料录入员"];
const LOGISTICS_FEES_ROLES = ["管理员", "业务员", "财务", "物流供应商", "物流资料录入员"];
const PRODUCT_SUPPLIER_ROLE = "产品供应商";
const LEGACY_PRODUCT_SUPPLIER_ROLE = `${PRODUCT_SUPPLIER_ROLE}账号`;
const LEGACY_FACTORY_SUPPLIER_ROLE = "工厂供应商账号";

function normalizeMenuRole(role: string) {
  return role === LEGACY_PRODUCT_SUPPLIER_ROLE || role === LEGACY_FACTORY_SUPPLIER_ROLE ? PRODUCT_SUPPLIER_ROLE : role;
}

function menusWithDerivedAccess(role: string, menus: string[]) {
  const nextMenus = [...menus];
  if (OCEAN_CONTROL_TOWER_ROLES.includes(role) && nextMenus.includes("domesticLogistics") && !nextMenus.includes("oceanControlTower")) {
    nextMenus.splice(nextMenus.indexOf("domesticLogistics") + 1, 0, "oceanControlTower");
  }
  if (LOGISTICS_FEES_ROLES.includes(role) && !nextMenus.includes("logisticsFees") && (nextMenus.includes("domesticLogistics") || nextMenus.includes("costs"))) {
    const insertAfter = nextMenus.includes("oceanControlTower")
      ? nextMenus.indexOf("oceanControlTower")
      : nextMenus.includes("domesticLogistics")
        ? nextMenus.indexOf("domesticLogistics")
        : nextMenus.indexOf("costs");
    nextMenus.splice(insertAfter + 1, 0, "logisticsFees");
  }
  return nextMenus;
}

export function availableMenus(user: User, permissions?: PermissionSnapshot) {
  const role = normalizeMenuRole(user.role);
  if (role === "管理员") {
    return MENU_ITEMS.filter((item) => ROLE_MENU_FALLBACK["管理员"].includes(item.key));
  }
  const allowed = menusWithDerivedAccess(role, permissions?.menus?.length ? permissions.menus : ROLE_MENU_FALLBACK[role] || ["manual"]);
  return MENU_ITEMS.filter((item) => allowed.includes(item.key));
}
