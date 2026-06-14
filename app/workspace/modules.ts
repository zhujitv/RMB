import type { MenuItem } from "./types";

export type MigrationStage = "ready" | "partial" | "planned" | "legacy";

export type ModuleDescriptor = MenuItem & {
  stage: MigrationStage;
  migrationNotes: string[];
  legacyAnchor?: string;
};

export const MODULE_DESCRIPTORS: Record<string, ModuleDescriptor> = {
  dashboard: {
    key: "dashboard",
    label: "经营总览",
    description: "经营分析工具，按需进入后加载统计。",
    stage: "partial",
    migrationNotes: ["支持筛选区、核心指标卡、月份趋势和风险预警", "进入模块后才加载统计", "后续补充更丰富的图表交互"],
  },
  orders: {
    key: "orders",
    label: "应收订单",
    description: "创建、编辑和跟进订单应收信息。",
    stage: "partial",
    migrationNotes: ["支持列表、基础新建、基础编辑和软删除", "收款、成本、国内物流和退税资料在对应业务模块维护", "复杂历史字段继续按模块逐步补齐"],
  },
  payments: {
    key: "payments",
    label: "收款管理",
    description: "登记客户回款并确认到账状态。",
    stage: "partial",
    migrationNotes: ["支持列表、登记、编辑和删除", "收款状态保存继续由后端权限校验", "收款凭证等待新的 R2 文件表/接口接入，旧附件接口不恢复"],
  },
  costs: {
    key: "costs",
    label: "成本管理",
    description: "维护工厂、物流、港杂等成本资料。",
    stage: "partial",
    migrationNotes: ["支持分页列表、普通成本登记、编辑和删除", "物流信息内保留按票录入物流费用入口", "资料维护组件复用退税文件组件"],
  },
  profit: {
    key: "profit",
    label: "利润分析",
    description: "查看预计毛利、已实现毛利和提成状态。",
    stage: "partial",
    migrationNotes: ["支持分页列表和可结算提成按钮", "新增轻量分页 API", "提成结算继续由后端二次校验"],
  },
  domesticLogistics: {
    key: "domesticLogistics",
    label: "物流信息",
    description: "录入国内运输信息和报关资料。",
    stage: "partial",
    migrationNotes: ["支持列表和多集装箱运输明细编辑", "出口发票备注可自动生成或手工调整", "支持报关资料上传、预览、下载和删除"],
  },
  taxRefund: {
    key: "taxRefund",
    label: "退税资料",
    description: "汇总资料完整度、打包下载和提交归档。",
    stage: "partial",
    migrationNotes: ["支持当前资料和退税档案列表", "支持按需资料详情、报关单信息手工维护、文件上传删除、资料包下载、提交归档和取消归档", "提交归档继续由后端强制校验完整度"],
  },
  reports: {
    key: "reports",
    label: "报表中心",
    description: "在线查询后按需导出报表。",
    stage: "partial",
    migrationNotes: ["支持在线查询筛选、分页、勾选和详情展开", "支持按业务员、供应商、状态、成本类型、归档范围等条件查询", "Excel/CSV 导出继续复用后端 CSV 注入防护"],
  },
  manual: {
    key: "manual",
    label: "操作说明书",
    description: "查看平台业务流程和操作规范。",
    stage: "ready",
    migrationNotes: ["静态说明页面", "支持搜索、目录跳转和展开收起", "不请求业务数据"],
  },
  settings: {
    key: "settings",
    label: "系统设置",
    description: "维护用户、客户、供应商、汇率和日志。",
    stage: "partial",
    migrationNotes: ["支持客户、供应商、用户、权限矩阵和汇率基础设置", "操作日志按需分页查看", "布尔字段统一显示开启/关闭"],
  },
};

export function moduleDescriptor(key: string) {
  return MODULE_DESCRIPTORS[key];
}
