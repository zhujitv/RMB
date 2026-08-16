import type { SettingsTabKey } from "./types";

export const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: "home", label: "设置中心" },
  { key: "companyProfile", label: "公司资料" },
  { key: "businessEntities", label: "业务主体" },
  { key: "customers", label: "客户资料" },
  { key: "customerProducts", label: "产品属性维护" },
  { key: "suppliers", label: "供应商资料" },
  { key: "users", label: "用户与权限" },
  { key: "ocrIntegration", label: "OCR识别" },
  { key: "shipsgoIntegration", label: "物流接口" },
  { key: "smsIntegration", label: "短信通知" },
  { key: "notificationTemplates", label: "通知模板" },
  { key: "exchangeRates", label: "汇率设置" },
  { key: "commissionFormula", label: "提成公式" },
  { key: "auditLogs", label: "系统日志" },
];
