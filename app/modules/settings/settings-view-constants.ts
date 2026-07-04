import type { SettingsTabKey } from "./types";

export const SETTINGS_HOME_CARDS: Array<{ tab: SettingsTabKey; title: string; description: string; icon: string }> = [
  { tab: "companyProfile", title: "公司资料", description: "公司信息、Logo、联系信息", icon: "企" },
  { tab: "businessEntities", title: "业务主体", description: "业务主体管理", icon: "主" },
  { tab: "customers", title: "客户资料", description: "客户管理", icon: "客" },
  { tab: "suppliers", title: "供应商资料", description: "供应商管理", icon: "供" },
  { tab: "users", title: "用户与权限", description: "角色权限", icon: "权" },
  { tab: "ocrIntegration", title: "OCR识别", description: "OCR 服务配置", icon: "OCR" },
  { tab: "shipsgoIntegration", title: "物流接口", description: "大掌柜、ShipsGo", icon: "船" },
  { tab: "notificationTemplates", title: "通知模板", description: "邮件模板", icon: "邮" },
  { tab: "exchangeRates", title: "汇率设置", description: "汇率", icon: "汇" },
  { tab: "commissionFormula", title: "提成公式", description: "提成计算", icon: "提" },
  { tab: "auditLogs", title: "系统日志", description: "日志", icon: "志" },
  { tab: "apiPerformance", title: "后台任务", description: "慢任务", icon: "任" },
];

export const SETTINGS_PAGE_DESCRIPTIONS: Record<SettingsTabKey, string> = {
  home: "按模块进入配置，减少长表单堆叠，保持系统设置清晰可维护。",
  companyProfile: "维护平台展示所需的公司基础信息。",
  businessEntities: "管理业务主体简称、全称和默认主体。",
  customers: "维护客户资料、自动通知和负责业务员。",
  suppliers: "维护产品供应商、物流供应商和业务权限。",
  users: "维护用户账号、角色权限和供应商绑定。",
  ocrIntegration: "维护 OCR 服务配置、密钥和识别能力。",
  shipsgoIntegration: "维护大掌柜海运跟踪接口和同步能力。",
  notificationTemplates: "维护系统邮件模板和发送规则。",
  exchangeRates: "维护汇率来源、手动刷新和基础业务开关。",
  commissionFormula: "维护业务员提成计算规则。",
  auditLogs: "查看关键操作日志。",
  apiPerformance: "查看慢接口和后台任务执行情况。",
};

export const TABLE_SETTING_TABS = new Set<SettingsTabKey>(["customers", "suppliers", "users", "auditLogs", "apiPerformance"]);
