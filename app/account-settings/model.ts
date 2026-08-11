import type { CompanyProfileSettings, User } from "../types";

export type AccountSettingsProps = {
  user: User;
  companyProfile?: CompanyProfileSettings | null;
  onProfileSaved: (user: User) => void;
  onBeforePasswordChange: (hasOtherUnsavedChanges?: boolean) => boolean;
  onPasswordChanged: (message: string) => void;
};

export type AccountTab = "profile" | "security" | "logins" | "preferences";

export type ProfileResponse = {
  success: boolean;
  user: User;
  message?: string;
};

export type PasswordResponse = {
  success: boolean;
  message?: string;
};

export type LoginRecord = {
  id: string;
  loginAt?: string;
  ipAddress?: string;
  region?: string;
  geoCountry?: string;
  geoRegion?: string;
  geoCity?: string;
  geoIsp?: string;
  geoSource?: string;
  geoResolvedAt?: string | null;
  browser?: string;
  result?: string;
  failureReason?: string;
};

export type LoginRecordsResponse = {
  success: boolean;
  loginRecords?: LoginRecord[];
  message?: string;
};

export const ACCOUNT_TABS: Array<{ key: AccountTab; label: string }> = [
  { key: "profile", label: "个人资料" },
  { key: "security", label: "账户安全" },
  { key: "logins", label: "登录记录" },
  { key: "preferences", label: "偏好设置" },
];

export const HOME_OPTIONS = [
  { value: "welcome", label: "工作台首页" },
  { value: "dashboard", label: "经营总览" },
  { value: "orders", label: "应收订单" },
  { value: "payments", label: "收款管理" },
  { value: "costs", label: "成本管理" },
  { value: "domesticLogistics", label: "物流信息" },
  { value: "customerCommunication", label: "客户沟通" },
  { value: "logisticsFees", label: "物流费用" },
  { value: "taxRefund", label: "退税资料" },
  { value: "reports", label: "报表中心" },
];
