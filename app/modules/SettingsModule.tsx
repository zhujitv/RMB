"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar, PermissionSelectItem, SideDetailDrawer, UiCheckbox, UiSwitch } from "../components";
import { formatDateTime, yesNo } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import styles from "../WorkspaceShell.module.css";
import type { CompanyProfileSettings } from "../types";
import {
  LOGISTICS_COST_TYPE_OPTIONS,
} from "../../lib/platform/logistics-cost-types";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../lib/password-policy";

type SettingsTabKey = "companyProfile" | "customers" | "suppliers" | "users" | "exchangeRates" | "commissionFormula" | "notificationTemplates" | "shipsgoIntegration" | "auditLogs";

type SettingsFilters = {
  customers: {
    keyword: string;
  };
  suppliers: {
    keyword: string;
    type: string;
    status: string;
  };
  users: {
    keyword: string;
    role: string;
    status: string;
  };
  auditLogs: {
    keyword: string;
    action: string;
  };
};

type FiltersFor<T extends SettingsTabKey> =
  T extends "customers" ? SettingsFilters["customers"]
    : T extends "suppliers" ? SettingsFilters["suppliers"]
      : T extends "users" ? SettingsFilters["users"]
        : T extends "auditLogs" ? SettingsFilters["auditLogs"]
          : never;

type TableColumn<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => string;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type UserLite = {
  name?: string;
  role?: string;
};

type CustomerRow = {
  id: string;
  shortName?: string;
  name?: string;
  fullName?: string;
  country?: string;
  defaultCurrency?: string;
  salespersonUserId?: string;
  salespersonName?: string;
  commissionRate?: number;
  commissionStatus?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  enableAutoShippingDocsNotification?: boolean;
  shippingDocsEmails?: string[];
  shippingDocsCcEmails?: string[];
  autoSendDocumentTypes?: string[];
  clearanceEmailLanguage?: string;
  clearanceEmailLanguageLabel?: string;
  remark?: string;
};

type SalespersonOption = {
  id: string;
  name?: string;
  role?: string;
};

type SupplierRow = {
  id: string;
  supplierName?: string;
  supplierType?: string;
  status?: string;
  country?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  invoiceTitle?: string;
  taxNumber?: string;
  bankName?: string;
  bankAccount?: string;
  allowDomesticLogisticsEntry?: boolean;
  allowLogisticsExpenseEntry?: boolean;
  allowLogisticsInvoiceUpload?: boolean;
  allowFactoryDocumentUpload?: boolean;
  isDefaultLogisticsSupplier?: boolean;
  allowedLogisticsCostTypes?: string[];
  remark?: string;
};

type UserRow = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  supplierId?: string;
  supplierName?: string;
  supplierType?: string;
  phone?: string;
  approvalStatus?: string;
  isActive?: boolean;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  passwordPolicyPassed?: boolean;
  createdAt?: string;
  permissionMode?: string;
  customPermissions?: UserCustomPermissions | null;
  mustChangePassword?: boolean;
};

type AuditLogRow = {
  id: string;
  user?: UserLite | null;
  action?: string;
  entityType?: string;
  entityLabel?: string;
  ipAddress?: string;
  createdAt?: string;
};

type ExchangeRateSettings = Record<string, unknown>;
type CommissionFormulaSettings = Record<string, unknown>;
type NotificationTemplateSettings = Record<string, unknown>;
type ShipsgoIntegrationSettings = Record<string, unknown>;

type ExchangeRateForm = {
  source: string;
  rateType: string;
  autoUpdate: boolean;
  allowManualEdit: boolean;
  allowMultipleOrderLogisticsSuppliers: boolean;
  allowAdminIncompleteTaxSubmit: boolean;
};

type CommissionFormulaForm = {
  mode: string;
  label: string;
  source: string;
  deductions: string[];
  floorAtZero: boolean;
};

type NotificationTemplateForm = {
  autoSendOnApproval: boolean;
  recipientEmailFields: string[];
  ccAdminEmails: boolean;
  ccEmails: string;
  singleSubjectTemplate: string;
  batchSubjectTemplate: string;
  bodyTemplate: string;
  invoiceRequirements: string;
  uploadUrl: string;
  signature: string;
};

type ShipsgoIntegrationForm = {
  enabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  oceanTrackingEnabled: boolean;
  airTrackingEnabled: boolean;
  manualSyncEnabled: boolean;
  autoSyncEnabled: boolean;
  dailySyncTime: string;
  webhookEnabled: boolean;
  webhookSecret: string;
  webhookSecretConfigured: boolean;
  liveMapEnabled: boolean;
  customerPushEnabled: boolean;
  creditWarningThreshold: string;
};

type CompanyProfileForm = {
  brandName: string;
  systemName: string;
  companyNameZh: string;
  companyNameEn: string;
  shortName: string;
  website: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  logoUrl: string;
  footerText: string;
};

type PermissionOption = {
  value: string;
  label: string;
};

type PermissionConfig = {
  permissionModes?: PermissionOption[];
  dataScopeOptions?: PermissionOption[];
  menuPermissionOptions?: PermissionOption[];
  readPermissionOptions?: PermissionOption[];
  writePermissionOptions?: PermissionOption[];
  roleMenus?: Record<string, string[]>;
  roleReads?: Record<string, string[]>;
  roleWrites?: Record<string, string[]>;
};

type UserCustomPermissions = {
  mode?: string;
  menus?: string[];
  reads?: string[];
  writes?: string[];
  dataScope?: string;
};

type CustomerForm = {
  id: string;
  name: string;
  shortName: string;
  country: string;
  defaultCurrency: string;
  salespersonUserId: string;
  commissionRate: string;
  commissionStatus: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  enableAutoShippingDocsNotification: boolean;
  shippingDocsEmails: string;
  shippingDocsCcEmails: string;
  autoSendDocumentTypes: string[];
  clearanceEmailLanguage: string;
  remark: string;
};

type SupplierForm = {
  id: string;
  supplierName: string;
  supplierType: string;
  status: string;
  country: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  invoiceTitle: string;
  taxNumber: string;
  bankName: string;
  bankAccount: string;
  allowDomesticLogisticsEntry: boolean;
  allowLogisticsExpenseEntry: boolean;
  allowLogisticsInvoiceUpload: boolean;
  allowFactoryDocumentUpload: boolean;
  isDefaultLogisticsSupplier: boolean;
  allowedLogisticsCostTypes: string[];
  remark: string;
};

type UserForm = {
  id: string;
  name: string;
  email: string;
  role: string;
  approvalStatus: string;
  supplierId: string;
  password: string;
  permissionMode: string;
  dataScope: string;
  menus: string[];
  reads: string[];
  writes: string[];
};

const PAGE_SIZE = 20;
const AUDIT_PAGE_SIZE = 50;
const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
const SHIPPING_DOCUMENT_TYPE_OPTIONS = [
  { key: "invoice", value: "commercialInvoice", label: "商业发票" },
  { key: "packingList", value: "packingList", label: "装箱单" },
  { key: "customsDeclaration", value: "customsDeclaration", label: "报关单" },
] as const;
type ShippingDocumentConfigKey = typeof SHIPPING_DOCUMENT_TYPE_OPTIONS[number]["key"];
type ShippingDocumentConfig = Record<ShippingDocumentConfigKey, boolean>;
const CUSTOMER_COMMISSION_STATUSES = ["启用", "停用"];
const PRODUCT_SUPPLIER_TYPE = "产品供应商";
const LEGACY_FACTORY_SUPPLIER_TYPE = "工厂供应商";
const PRODUCT_SUPPLIER_TYPES = [PRODUCT_SUPPLIER_TYPE, LEGACY_FACTORY_SUPPLIER_TYPE];
const SUPPLIER_TYPES = [PRODUCT_SUPPLIER_TYPE, "物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", "其他供应商"];
const SUPPLIER_STATUSES = ["启用", "停用"];
const LOGISTICS_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"];
const FACTORY_SUPPLIER_ACCOUNT_ROLE = "产品供应商";
const LEGACY_PRODUCT_SUPPLIER_ACCOUNT_ROLE = `${FACTORY_SUPPLIER_ACCOUNT_ROLE}账号`;
const LEGACY_FACTORY_SUPPLIER_ACCOUNT_ROLE = "工厂供应商账号";
const FACTORY_SUPPLIER_ACCOUNT_ROLES = [FACTORY_SUPPLIER_ACCOUNT_ROLE, LEGACY_PRODUCT_SUPPLIER_ACCOUNT_ROLE, LEGACY_FACTORY_SUPPLIER_ACCOUNT_ROLE];
const SUPPLIER_ACCOUNT_ROLES = ["物流供应商", ...FACTORY_SUPPLIER_ACCOUNT_ROLES];
const SUPPLIER_LOGISTICS_COST_TYPE_UI_META: Record<string, { label?: string; description: string }> = {
  拖车费: { description: "国内拖车、短驳、提送柜等运输费用。" },
  报关费: { description: "出口报关代理、申报服务相关费用。" },
  港杂费: { description: "码头、港区、港口服务等本地杂费。" },
  海运费: { description: "海运主运费及承运人相关费用。" },
  保险费: { description: "货运保险及运输保障费用。" },
  ENS: { label: "ENS", description: "ENS 申报及相关承运人费用。" },
  打单费: { description: "单证制作、文件处理、打单服务费用。" },
  查验费: { description: "海关查验、协查、查验服务费用。" },
  超重费: { description: "超重箱、超限或额外重量附加费。" },
  提箱费: { description: "提空箱、提重箱或场站提箱费用。" },
  进港费: { description: "集装箱进港、入场及相关操作费用。" },
  落箱费: { description: "落箱、堆存或场站临时操作费用。" },
  预提费: { description: "预提箱、提前操作及相关服务费用。" },
  其他物流费用: { description: "不属于上述类型的零散物流费用。" },
};
const EXCHANGE_RATE_SOURCES = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
const EXCHANGE_RATE_TYPES = ["现汇买入价", "现汇卖出价", "中间价"];
const COMMISSION_FORMULA_PRESETS = [
  { value: "ACTUAL_RECEIVED_MINUS_LOGISTICS", label: "实际到账 - 物流成本", source: "ARRIVED_PAYMENTS_CNY", deductions: ["LOGISTICS_COST_CNY"] },
  { value: "ACTUAL_PROFIT", label: "实际利润", source: "REALIZED_GROSS_PROFIT_CNY", deductions: [] },
  { value: "FOB_TOTAL", label: "FOB总额", source: "FOB_CNY", deductions: [] },
  { value: "FOB_MINUS_LOGISTICS", label: "FOB - 物流成本", source: "FOB_CNY", deductions: ["LOGISTICS_COST_CNY"] },
  { value: "CUSTOM", label: "自定义公式", source: "ARRIVED_PAYMENTS_CNY", deductions: ["LOGISTICS_COST_CNY"] },
];
const COMMISSION_FORMULA_SOURCES = [
  { value: "ARRIVED_PAYMENTS_CNY", label: "实际到账货款" },
  { value: "FOB_CNY", label: "FOB总额" },
  { value: "EXPECTED_GROSS_PROFIT_CNY", label: "预计利润" },
  { value: "REALIZED_GROSS_PROFIT_CNY", label: "实际利润" },
];
const COMMISSION_FORMULA_DEDUCTIONS = [
  { value: "LOGISTICS_COST_CNY", label: "物流成本总和", description: "从FOB中扣减物流费用" },
  { value: "TOTAL_COST_CNY", label: "总成本", description: "扣减所有成本" },
  { value: "CONFIRMED_TOTAL_COST_CNY", label: "已确认总成本", description: "只扣减已确认的成本" },
  { value: "PAID_CONFIRMED_COST_CNY", label: "已支付确认成本", description: "只扣减已支付且已确认的成本" },
];
const NOTIFICATION_TEMPLATE_VARIABLES = [
  ["{supplierName}", "供应商名称"],
  ["{billCount}", "本次邮件包含票数"],
  ["{orderNo}", "订单号"],
  ["{blNo}", "提单号"],
  ["{customerShortName}", "客户简称"],
  ["{containerSummary}", "柜型 / 柜量"],
  ["{amountCny}", "账单合计"],
  ["{expenseDetails}", "费用明细"],
  ["{invoiceGroups}", "应上传发票分组"],
  ["{remark}", "备注"],
  ["{billRows}", "待开票费用清单"],
  ["{invoiceRequirements}", "开票要求"],
  ["{uploadUrl}", "发票上传入口"],
  ["{signature}", "邮件落款"],
] as const;
const NOTIFICATION_RECIPIENT_EMAIL_OPTIONS = [
  {
    value: "operatorUsers.email",
    label: "绑定登录账号邮箱",
    description: "读取物流供应商绑定的系统登录账号邮箱。",
  },
  {
    value: "contactEmail",
    label: "供应商联系邮箱",
    description: "读取供应商资料中的联系邮箱。",
  },
  {
    value: "email",
    label: "供应商主邮箱",
    description: "读取供应商资料中的主邮箱。",
  },
  {
    value: "financeEmail",
    label: "供应商财务邮箱",
    description: "读取供应商资料中的财务邮箱。",
  },
] as const;
const DEFAULT_NOTIFICATION_TEMPLATE_FORM: NotificationTemplateForm = {
  autoSendOnApproval: true,
  recipientEmailFields: NOTIFICATION_RECIPIENT_EMAIL_OPTIONS.map((item) => item.value),
  ccAdminEmails: true,
  ccEmails: "",
  singleSubjectTemplate: "物流费用已审核通过，请开票并上传发票 - {orderNo}/{blNo}",
  batchSubjectTemplate: "待开票物流费用清单（{billCount} 票）",
  bodyTemplate: [
    "{supplierName}，您好：",
    "",
    "以下物流费用已审核通过，请按开票要求开具发票，并登录系统在对应账单中上传发票。",
    "",
    "待开票费用清单：",
    "{billRows}",
    "",
    "开票要求：",
    "{invoiceRequirements}",
    "",
    "发票上传入口：{uploadUrl}",
    "",
    "{signature}",
  ].join("\n"),
  invoiceRequirements: [
    "1. 发票金额需与系统审核通过的费用合计一致。",
    "2. 发票抬头、税号、供应商信息需与系统资料一致。",
    "3. 报关费、港杂费必须分别开票上传。",
    "4. 海运费、ENS费、保险费及所有 USD 费用统一归入“海运费发票”上传。",
    "5. 拖车费、打单费、进港费、提箱费、落箱费、预提费、查验费、超重费和其他 CNY 物流费用可合并为“拖车及其他费用合并发票”上传。",
    "6. 发票上传后必须在对应物流费用账单中提交，系统会绑定到该账单记录。",
  ].join("\n"),
  uploadUrl: "",
  signature: "NEXTWOOD 供应链协同平台",
};
const DEFAULT_SHIPSGO_INTEGRATION_FORM: ShipsgoIntegrationForm = {
  enabled: false,
  apiBaseUrl: "https://api.shipsgo.com",
  apiKey: "",
  apiKeyConfigured: false,
  oceanTrackingEnabled: true,
  airTrackingEnabled: false,
  manualSyncEnabled: true,
  autoSyncEnabled: false,
  dailySyncTime: "02:00",
  webhookEnabled: false,
  webhookSecret: "",
  webhookSecretConfigured: false,
  liveMapEnabled: false,
  customerPushEnabled: false,
  creditWarningThreshold: "20",
};
const SHIPSGO_FEATURE_OPTIONS = [
  {
    key: "oceanTrackingEnabled",
    label: "海运集装箱跟踪",
    description: "按提单号、柜号创建大掌櫃海运跟踪任务。",
  },
  {
    key: "airTrackingEnabled",
    label: "空运货物跟踪",
    description: "预留空运 AWB 跟踪能力，开启后前台显示空运入口。",
  },
  {
    key: "manualSyncEnabled",
    label: "手动同步",
    description: "允许在物流页面手动刷新大掌櫃跟踪状态。",
  },
  {
    key: "autoSyncEnabled",
    label: "每日自动同步",
    description: "按配置时间每日拉取状态更新。",
  },
  {
    key: "webhookEnabled",
    label: "Webhook 推送",
    description: "允许接收大掌櫃状态变更推送。",
  },
  {
    key: "liveMapEnabled",
    label: "Live Map",
    description: "开启后前台显示船舶/集装箱可视化入口。",
  },
  {
    key: "customerPushEnabled",
    label: "客户自动推送",
    description: "状态更新后可扩展为邮件推送客户。",
  },
] satisfies Array<{
  key: keyof Pick<
    ShipsgoIntegrationForm,
    "oceanTrackingEnabled" | "airTrackingEnabled" | "manualSyncEnabled" | "autoSyncEnabled" | "webhookEnabled" | "liveMapEnabled" | "customerPushEnabled"
  >;
  label: string;
  description: string;
}>;
const USER_ROLES = ["管理员", "业务员", "财务", "物流供应商", FACTORY_SUPPLIER_ACCOUNT_ROLE, "物流资料录入员"];
const USER_APPROVAL_STATUS_OPTIONS = [
  { label: "待审核", value: "PENDING" },
  { label: "已启用", value: "APPROVED" },
  { label: "已拒绝", value: "REJECTED" },
  { label: "已停用", value: "DISABLED" },
];
const USER_STATUS_FILTER_OPTIONS = [
  { label: "邮箱未验证", value: "email_unverified" },
  ...USER_APPROVAL_STATUS_OPTIONS,
];
const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: "companyProfile", label: "公司资料" },
  { key: "customers", label: "客户资料" },
  { key: "suppliers", label: "供应商资料" },
  { key: "users", label: "用户与权限" },
  { key: "exchangeRates", label: "汇率设置" },
  { key: "commissionFormula", label: "提成公式" },
  { key: "notificationTemplates", label: "通知模板" },
  { key: "shipsgoIntegration", label: "第三方接口" },
  { key: "auditLogs", label: "操作日志" },
];

const CUSTOMER_COLUMNS: TableColumn<CustomerRow>[] = [
  { key: "shortName", label: "客户简称", render: (row) => row.shortName || "-" },
  { key: "country", label: "国家" },
  { key: "defaultCurrency", label: "默认币种" },
  { key: "salespersonName", label: "负责业务员" },
  { key: "commissionStatus", label: "提成状态" },
];

const SUPPLIER_COLUMNS: TableColumn<SupplierRow>[] = [
  { key: "supplierName", label: "供应商" },
  { key: "supplierType", label: "类型" },
  { key: "status", label: "状态" },
  { key: "contactPerson", label: "联系人" },
  { key: "isDefaultLogisticsSupplier", label: "默认物流", render: (row) => LOGISTICS_SUPPLIER_TYPES.includes(row.supplierType || "") ? yesNo(row.isDefaultLogisticsSupplier) : "-" },
];

const USER_COLUMNS: TableColumn<UserRow>[] = [
  { key: "name", label: "姓名" },
  { key: "email", label: "邮箱" },
  { key: "role", label: "角色" },
  { key: "supplierName", label: "所属供应商", render: (row) => isSupplierAccountRole(row.role) ? (supplierDisplayName(row) || "-") : "-" },
  { key: "emailVerified", label: "邮箱验证状态", render: (row) => row.emailVerified === false ? "邮箱未验证" : "已验证" },
  { key: "createdAt", label: "注册时间", render: (row) => formatDateTime(row.createdAt) },
  { key: "approvalStatus", label: "审核状态", render: (row) => approvalStatusText(row.approvalStatus) },
  { key: "accountStatus", label: "账号状态", render: (row) => userStatus(row) },
  { key: "permissionMode", label: "权限模式", render: (row) => row.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
];

const AUDIT_COLUMNS: TableColumn<AuditLogRow>[] = [
  { key: "createdAt", label: "时间", render: (row) => formatDateTime(row.createdAt) },
  { key: "user", label: "操作人", render: (row) => row.user?.name || "-" },
  { key: "action", label: "动作" },
  { key: "entityLabel", label: "对象" },
  { key: "ipAddress", label: "IP" },
];

type SettingsModuleProps = {
  onCompanyProfileSaved?: (settings: CompanyProfileSettings) => void;
};

export function SettingsModule({ onCompanyProfileSaved }: SettingsModuleProps = {}) {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("companyProfile");
  const [filters, setFilters] = useState<SettingsFilters>({
    customers: { keyword: "" },
    suppliers: { keyword: "", type: "", status: "" },
    users: { keyword: "", role: "", status: "" },
    auditLogs: { keyword: "", action: "" },
  });

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [companyProfileSettings, setCompanyProfileSettings] = useState<CompanyProfileSettings | null>(null);
  const [companyProfileForm, setCompanyProfileForm] = useState<CompanyProfileForm | null>(null);
  const [exchangeSettings, setExchangeSettings] = useState<ExchangeRateSettings | null>(null);
  const [exchangeForm, setExchangeForm] = useState<ExchangeRateForm | null>(null);
  const [commissionFormulaSettings, setCommissionFormulaSettings] = useState<CommissionFormulaSettings | null>(null);
  const [commissionFormulaForm, setCommissionFormulaForm] = useState<CommissionFormulaForm | null>(null);
  const [notificationTemplateSettings, setNotificationTemplateSettings] = useState<NotificationTemplateSettings | null>(null);
  const [notificationTemplateForm, setNotificationTemplateForm] = useState<NotificationTemplateForm | null>(null);
  const [shipsgoIntegrationSettings, setShipsgoIntegrationSettings] = useState<ShipsgoIntegrationSettings | null>(null);
  const [shipsgoIntegrationForm, setShipsgoIntegrationForm] = useState<ShipsgoIntegrationForm | null>(null);
  const [permissionConfig, setPermissionConfig] = useState<PermissionConfig | null>(null);
  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);

  const [pagination, setPagination] = useState<Record<SettingsTabKey, Pagination>>({
    companyProfile: emptyPagination(PAGE_SIZE),
    customers: emptyPagination(PAGE_SIZE),
    suppliers: emptyPagination(PAGE_SIZE),
    users: emptyPagination(PAGE_SIZE),
    exchangeRates: emptyPagination(PAGE_SIZE),
    commissionFormula: emptyPagination(PAGE_SIZE),
    notificationTemplates: emptyPagination(PAGE_SIZE),
    shipsgoIntegration: emptyPagination(PAGE_SIZE),
    auditLogs: emptyPagination(AUDIT_PAGE_SIZE),
  });
  const [loadedTabs, setLoadedTabs] = useState<Set<SettingsTabKey>>(new Set());
  const [detailRow, setDetailRow] = useState<CustomerRow | SupplierRow | UserRow | AuditLogRow | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerForm | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");
  const [supplierForm, setSupplierForm] = useState<SupplierForm | null>(null);
  const [supplierPanelMode, setSupplierPanelMode] = useState<"view" | "edit">("view");
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierMessage, setSupplierMessage] = useState("");
  const [userForm, setUserForm] = useState<UserForm | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userSaving, setUserSaving] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [companyProfileSaving, setCompanyProfileSaving] = useState(false);
  const [companyProfileMessage, setCompanyProfileMessage] = useState("");
  const [exchangeSaving, setExchangeSaving] = useState(false);
  const [exchangeRefreshing, setExchangeRefreshing] = useState(false);
  const [exchangeMessage, setExchangeMessage] = useState("");
  const [commissionFormulaSaving, setCommissionFormulaSaving] = useState(false);
  const [commissionFormulaMessage, setCommissionFormulaMessage] = useState("");
  const [notificationTemplateSaving, setNotificationTemplateSaving] = useState(false);
  const [notificationTemplateMessage, setNotificationTemplateMessage] = useState("");
  const [shipsgoIntegrationSaving, setShipsgoIntegrationSaving] = useState(false);
  const [shipsgoIntegrationMessage, setShipsgoIntegrationMessage] = useState("");
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activePagination = pagination[activeTab] || emptyPagination(PAGE_SIZE);
  const listColumns = useMemo(() => columnsFor(activeTab), [activeTab]);
  const currentRows = useMemo(() => rowsFor(activeTab, { customers, suppliers, users, logs }), [activeTab, customers, suppliers, users, logs]);
  const activeFilter = activeTab === "customers"
    ? filters.customers
    : activeTab === "suppliers"
      ? filters.suppliers
      : activeTab === "users"
        ? filters.users
        : filters.auditLogs;
  const userEditPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loadedTabs.has(activeTab)) {
      void loadTab(activeTab, 1, filtersForTab(filters, activeTab));
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "users" || !selectedUserId || !userForm) return;
    userEditPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeTab, selectedUserId, userForm?.id]);

  async function loadTab(tab = activeTab, page = activePagination.page || 1, nextFilters = filtersForTab(filters, tab)) {
    setLoading(true);
    setError("");
    try {
      if (tab === "companyProfile") {
        const result = await apiJson<{ settings: CompanyProfileSettings }>("/api/settings/company-profile");
        const settings = result.settings || {};
        setCompanyProfileSettings(settings);
        setCompanyProfileForm(companyProfileFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "exchangeRates") {
        const result = await apiJson<{ settings: ExchangeRateSettings }>("/api/settings/exchange-rates");
        const settings = result.settings || {};
        setExchangeSettings(settings);
        setExchangeForm(exchangeFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "commissionFormula") {
        const result = await apiJson<{ settings: CommissionFormulaSettings }>("/api/settings/commission-formula");
        const settings = result.settings || {};
        setCommissionFormulaSettings(settings);
        setCommissionFormulaForm(commissionFormulaFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "notificationTemplates") {
        const settings = await fetchNotificationTemplateSettings();
        setNotificationTemplateSettings(settings);
        setNotificationTemplateForm(notificationTemplateFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "shipsgoIntegration") {
        const result = await apiJson<{ settings: ShipsgoIntegrationSettings }>("/api/settings/shipsgo");
        const settings = result.settings || {};
        setShipsgoIntegrationSettings(settings);
        setShipsgoIntegrationForm(shipsgoIntegrationFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "users") {
        await ensurePermissionConfig();
      }
      const pageSize = tab === "auditLogs" ? AUDIT_PAGE_SIZE : PAGE_SIZE;
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      appendFilterParams(params, tab, nextFilters);
      const result = await apiJson<{
        customers?: CustomerRow[];
        suppliers?: SupplierRow[];
        users?: UserRow[];
        logs?: AuditLogRow[];
        pagination?: Pagination;
      }>(`/api/settings/${kebabTab(tab)}?${params}`);
      if (tab === "customers") {
        setCustomers(result.customers || []);
        setSalespeople((result as { salespeople?: SalespersonOption[] }).salespeople || []);
      }
      if (tab === "suppliers") setSuppliers(result.suppliers || []);
      if (tab === "users") setUsers(result.users || []);
      if (tab === "auditLogs") setLogs(result.logs || []);
      setPagination((current) => ({
        ...current,
        [tab]: result.pagination || emptyPagination(pageSize),
      }));
      markLoaded(tab);
      setDetailRow(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取系统设置失败");
    } finally {
      setLoading(false);
    }
  }

  async function fetchNotificationTemplateSettings() {
    const result = await apiJson<{ settings: NotificationTemplateSettings }>("/api/settings/notification-templates");
    return result.settings || {};
  }

  function markLoaded(tab: SettingsTabKey) {
    setLoadedTabs((current) => new Set(current).add(tab));
  }

  function selectTab(tab: SettingsTabKey) {
    setActiveTab(tab);
    setDetailRow(null);
    setCustomerForm(null);
    setCustomerMessage("");
    setSupplierForm(null);
    setSupplierPanelMode("view");
    setSupplierMessage("");
    setUserForm(null);
    setSelectedUserId("");
    setUserMessage("");
    setCompanyProfileMessage("");
    setExchangeMessage("");
    setCommissionFormulaMessage("");
    setNotificationTemplateMessage("");
    setShipsgoIntegrationMessage("");
  }

  function submitSearch() {
    void loadTab(activeTab, 1, filtersForTab(filters, activeTab));
  }

  function resetSearch() {
    setFilters((current) => resetFilters(current, activeTab));
    void loadTab(activeTab, 1, emptyFiltersForTab(activeTab));
  }

  function refreshCurrent() {
    void loadTab(activeTab, activePagination.page || 1, filtersForTab(filters, activeTab));
  }

  async function refreshExchangeRatesManually() {
    setExchangeRefreshing(true);
    setExchangeMessage("");
    try {
      const payload = exchangeForm || exchangeFormFromSettings(exchangeSettings);
      const result = await apiJson<{ ok?: boolean; message?: string; settings?: ExchangeRateSettings }>(
        "/api/exchange-rates/refresh",
        {
          method: "POST",
          body: JSON.stringify({
            date: new Date().toISOString().slice(0, 10),
            source: payload.source,
            rateType: payload.rateType,
          }),
        },
      );
      setExchangeMessage(result.ok ? "今日汇率已刷新" : (result.message || "今日汇率获取失败，已使用最近可用汇率。"));
    } catch (refreshError) {
      setExchangeMessage(refreshError instanceof Error ? refreshError.message : "刷新汇率失败");
    } finally {
      setExchangeRefreshing(false);
    }
  }

  async function deleteRecord(kind: "customer" | "supplier" | "user", id: string) {
    const labels = { customer: "客户", supplier: "供应商", user: "用户" };
    const message = kind === "user"
      ? "确认停用该用户吗？该操作会写入操作日志。"
      : `确认删除该${labels[kind]}吗？该操作会写入操作日志。`;
    if (!window.confirm(message)) return;
    setError("");
    try {
      const result = await apiJson<{ success?: boolean; ok?: boolean; message?: string }>(
        kind === "customer"
          ? `/api/customers/${encodeURIComponent(id)}`
          : kind === "supplier"
            ? `/api/suppliers/${encodeURIComponent(id)}`
            : `/api/users/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      await loadTab(activeTab, activePagination.page || 1, filtersForTab(filters, activeTab));
      if (kind === "supplier") {
        closeSupplierPanel();
      }
      if (kind === "user") {
        setExchangeMessage("");
        setError(result.message || "用户已停用");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `${labels[kind]}操作失败`);
    }
  }

  function startCreateCustomer() {
    setActiveTab("customers");
    setDetailRow(null);
    setCustomerMessage("");
    setCustomerForm(emptyCustomerForm());
  }

  function startCreateSupplier() {
    setActiveTab("suppliers");
    setDetailRow(null);
    setSupplierMessage("");
    setSupplierPanelMode("edit");
    setSupplierForm(emptySupplierForm());
  }

  async function ensureActiveSuppliers() {
    if (activeSuppliers.length) return;
    try {
      const result = await apiJson<{ suppliers?: SupplierRow[] }>("/api/suppliers/available");
      setActiveSuppliers(result.suppliers || []);
    } catch {
      setActiveSuppliers([]);
    }
  }

  async function ensurePermissionConfig() {
    if (permissionConfig) return permissionConfig;
    const result = await apiJson<{ permissions?: PermissionConfig }>("/api/settings/permissions");
    const nextConfig = result.permissions || {};
    setPermissionConfig(nextConfig);
    return nextConfig;
  }

  function startCreateUser() {
    setActiveTab("users");
    setDetailRow(null);
    setUserMessage("");
    setSelectedUserId("new");
    setUserForm(emptyUserForm());
    void ensureActiveSuppliers();
    void ensurePermissionConfig();
  }

  function startEditCustomer(customer: CustomerRow) {
    setActiveTab("customers");
    setDetailRow(customer);
    setCustomerMessage("");
    setCustomerForm(customerFormFromRow(customer));
  }

  function startViewSupplier(supplier: SupplierRow) {
    setActiveTab("suppliers");
    setDetailRow(null);
    setSupplierMessage("");
    setSupplierPanelMode("view");
    setSupplierForm(supplierFormFromRow(supplier));
  }

  function closeSupplierPanel() {
    setSupplierForm(null);
    setSupplierPanelMode("view");
    setSupplierMessage("");
  }

  function cancelSupplierEdit() {
    if (!supplierForm?.id) {
      closeSupplierPanel();
      return;
    }
    const currentSupplier = suppliers.find((supplier) => supplier.id === supplierForm.id);
    if (currentSupplier) setSupplierForm(supplierFormFromRow(currentSupplier));
    setSupplierPanelMode("view");
    setSupplierMessage("");
  }

  function startEditUser(user: UserRow) {
    setActiveTab("users");
    setDetailRow(null);
    setUserMessage("");
    setSelectedUserId(user.id);
    setUserForm(userFormFromRow(user));
    void ensureActiveSuppliers();
    void ensurePermissionConfig();
  }

  async function saveCustomerForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerForm) return;
    if (!customerForm.name.trim()) {
      setCustomerMessage("请填写客户全称");
      return;
    }
    setCustomerSaving(true);
    setCustomerMessage("");
    try {
      const isEdit = Boolean(customerForm.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/customers/${encodeURIComponent(customerForm.id)}` : "/api/customers",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            name: customerForm.name,
            shortName: customerForm.shortName,
            country: customerForm.country,
            defaultCurrency: customerForm.defaultCurrency || undefined,
            salespersonUserId: customerForm.salespersonUserId || undefined,
            commissionRate: Number(customerForm.commissionRate || 0),
            commissionStatus: customerForm.commissionStatus,
            contactPerson: customerForm.contactPerson,
            contactEmail: customerForm.contactEmail,
            contactPhone: customerForm.contactPhone,
            enableAutoShippingDocsNotification: customerForm.enableAutoShippingDocsNotification,
            shippingDocsEmails: customerForm.shippingDocsEmails,
            shippingDocsCcEmails: customerForm.shippingDocsCcEmails,
            autoSendDocumentTypes: customerForm.autoSendDocumentTypes,
            clearanceEmailLanguage: customerForm.clearanceEmailLanguage,
            remark: customerForm.remark,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "客户资料保存失败");
      setCustomerForm(null);
      await loadTab("customers", activePagination.page || 1, filters.customers);
    } catch (saveError) {
      setCustomerMessage(saveError instanceof Error ? saveError.message : "客户资料保存失败");
    } finally {
      setCustomerSaving(false);
    }
  }

  async function saveSupplierForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierForm) return;
    if (!supplierForm.supplierName.trim()) {
      setSupplierMessage("请填写供应商名称");
      return;
    }
    setSupplierSaving(true);
    setSupplierMessage("");
    try {
      const isEdit = Boolean(supplierForm.id);
      const result = await apiJson<{ success?: boolean; message?: string; supplier?: SupplierRow }>(
        isEdit ? `/api/suppliers/${encodeURIComponent(supplierForm.id)}` : "/api/suppliers",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            supplierName: supplierForm.supplierName,
            supplierType: supplierForm.supplierType,
            status: supplierForm.status,
            country: supplierForm.country,
            contactPerson: supplierForm.contactPerson,
            phone: supplierForm.phone,
            email: supplierForm.email,
            address: supplierForm.address,
            invoiceTitle: supplierForm.invoiceTitle,
            taxNumber: supplierForm.taxNumber,
            bankName: supplierForm.bankName,
            bankAccount: supplierForm.bankAccount,
            allowDomesticLogisticsEntry: supplierForm.allowDomesticLogisticsEntry,
            allowLogisticsExpenseEntry: supplierForm.allowLogisticsExpenseEntry,
            allowLogisticsInvoiceUpload: supplierForm.allowLogisticsInvoiceUpload,
            allowFactoryDocumentUpload: supplierForm.allowFactoryDocumentUpload,
            isDefaultLogisticsSupplier: supplierForm.isDefaultLogisticsSupplier,
            allowedLogisticsCostTypes: supplierForm.allowedLogisticsCostTypes,
            remark: supplierForm.remark,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "供应商资料保存失败");
      const savedSupplier = result.supplier;
      if (savedSupplier?.id) {
        setSuppliers((current) => {
          const exists = current.some((supplier) => supplier.id === savedSupplier.id);
          return exists
            ? current.map((supplier) => (supplier.id === savedSupplier.id ? savedSupplier : supplier))
            : [savedSupplier, ...current];
        });
        setSupplierForm(supplierFormFromRow(savedSupplier));
      }
      setSupplierPanelMode("view");
      setSupplierMessage(result.message || "供应商已保存");
    } catch (saveError) {
      setSupplierMessage(saveError instanceof Error ? saveError.message : "供应商资料保存失败");
    } finally {
      setSupplierSaving(false);
    }
  }

  async function saveUserForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userForm) return;
    if (!userForm.name.trim()) {
      setUserMessage("请填写姓名");
      return;
    }
    if (!userForm.email.trim()) {
      setUserMessage("请填写邮箱");
      return;
    }
    if (!userForm.id && !userForm.password.trim()) {
      setUserMessage("新建用户必须设置初始密码");
      return;
    }
    if (isSupplierAccountRole(userForm.role) && !userForm.supplierId) {
      setUserMessage(`${userForm.role}必须绑定供应商`);
      return;
    }
    if (isSupplierAccountRole(userForm.role)) {
      const supplier = suppliers.find((item) => item.id === userForm.supplierId);
      if (!supplierMatchesUserRole(supplier, userForm.role)) {
        setUserMessage(FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(userForm.role)
          ? "产品供应商只能绑定已开启资料回传权限的产品供应商"
          : "物流供应商账号只能绑定物流、报关、海运或港杂费用供应商");
        return;
      }
    }
    if (userForm.password.trim() && !passwordMeetsPolicy(userForm.password.trim())) {
      setUserMessage(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setUserSaving(true);
    setUserMessage("");
    try {
      const isEdit = Boolean(userForm.id);
      const payload: Record<string, unknown> = {
        name: userForm.name,
        email: userForm.email,
        role: userForm.role,
        approvalStatus: userForm.approvalStatus,
        supplierId: isSupplierAccountRole(userForm.role) ? userForm.supplierId : undefined,
        customPermissions: userForm.permissionMode === "CUSTOM"
          ? {
            mode: "CUSTOM",
            menus: userForm.menus,
            reads: userForm.reads,
            writes: userForm.writes,
            dataScope: userForm.dataScope,
          }
          : { mode: "ROLE" },
      };
      if (userForm.password.trim()) payload.password = userForm.password.trim();
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/users/${encodeURIComponent(userForm.id)}` : "/api/users",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      if (result.success !== true) throw new Error(result.message || "用户保存失败");
      setUserForm(null);
      setSelectedUserId("");
      await loadTab("users", activePagination.page || 1, filters.users);
    } catch (saveError) {
      setUserMessage(saveError instanceof Error ? saveError.message : "用户保存失败");
    } finally {
      setUserSaving(false);
    }
  }

  async function saveCompanyProfileSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyProfileForm) return;
    if (!companyProfileForm.brandName.trim()) {
      setCompanyProfileMessage("请填写品牌名称");
      return;
    }
    if (!companyProfileForm.systemName.trim()) {
      setCompanyProfileMessage("请填写系统名称");
      return;
    }
    if (!companyProfileForm.companyNameZh.trim()) {
      setCompanyProfileMessage("请填写公司中文名称");
      return;
    }
    setCompanyProfileSaving(true);
    setCompanyProfileMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: CompanyProfileSettings; message?: string }>(
        "/api/settings/company-profile",
        {
          method: "PATCH",
          body: JSON.stringify(companyProfileForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "公司资料保存失败");
      const nextSettings = result.settings || companyProfileForm;
      setCompanyProfileSettings(nextSettings);
      setCompanyProfileForm(companyProfileFormFromSettings(nextSettings));
      onCompanyProfileSaved?.(nextSettings);
      markLoaded("companyProfile");
      setCompanyProfileMessage(result.message || "公司资料已保存");
    } catch (saveError) {
      setCompanyProfileMessage(saveError instanceof Error ? saveError.message : "公司资料保存失败");
    } finally {
      setCompanyProfileSaving(false);
    }
  }

  async function saveExchangeSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!exchangeForm) return;
    setExchangeSaving(true);
    setExchangeMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: ExchangeRateSettings; message?: string }>(
        "/api/exchange-rates/settings",
        {
          method: "PATCH",
          body: JSON.stringify(exchangeForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "汇率设置保存失败");
      const nextSettings = result.settings || exchangeForm;
      setExchangeSettings(nextSettings);
      setExchangeForm(exchangeFormFromSettings(nextSettings));
      markLoaded("exchangeRates");
      setExchangeMessage(result.message || "汇率设置已保存");
    } catch (saveError) {
      setExchangeMessage(saveError instanceof Error ? saveError.message : "汇率设置保存失败");
    } finally {
      setExchangeSaving(false);
    }
  }

  async function saveCommissionFormulaSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commissionFormulaForm) return;
    setCommissionFormulaSaving(true);
    setCommissionFormulaMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: CommissionFormulaSettings; message?: string }>(
        "/api/commission-formula/settings",
        {
          method: "PATCH",
          body: JSON.stringify(commissionFormulaForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "提成公式设置保存失败");
      const nextSettings = result.settings || commissionFormulaForm;
      setCommissionFormulaSettings(nextSettings);
      setCommissionFormulaForm(commissionFormulaFormFromSettings(nextSettings));
      markLoaded("commissionFormula");
      setCommissionFormulaMessage(result.message || "提成公式设置已保存");
    } catch (saveError) {
      setCommissionFormulaMessage(saveError instanceof Error ? saveError.message : "提成公式设置保存失败");
    } finally {
      setCommissionFormulaSaving(false);
    }
  }

  async function saveNotificationTemplateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!notificationTemplateForm) return;
    setNotificationTemplateSaving(true);
    setNotificationTemplateMessage("");
    try {
      const payload = { ...notificationTemplateForm };
      const result = await apiJson<{ success?: boolean; settings?: NotificationTemplateSettings; message?: string }>(
        "/api/settings/notification-templates",
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      if (result.success !== true) throw new Error(result.message || "通知模板保存失败");
      const nextSettings = await fetchNotificationTemplateSettings();
      setNotificationTemplateSettings(nextSettings);
      setNotificationTemplateForm(notificationTemplateFormFromSettings(nextSettings));
      markLoaded("notificationTemplates");
      setNotificationTemplateMessage(result.message || "通知模板已保存");
    } catch (saveError) {
      setNotificationTemplateMessage(saveError instanceof Error ? saveError.message : "通知模板保存失败");
    } finally {
      setNotificationTemplateSaving(false);
    }
  }

  async function saveShipsgoIntegrationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shipsgoIntegrationForm) return;
    setShipsgoIntegrationSaving(true);
    setShipsgoIntegrationMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: ShipsgoIntegrationSettings; message?: string }>(
        "/api/settings/shipsgo",
        {
          method: "PATCH",
          body: JSON.stringify({
            ...shipsgoIntegrationForm,
            creditWarningThreshold: Number(shipsgoIntegrationForm.creditWarningThreshold || 0),
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "大掌櫃设置保存失败");
      const nextSettings = result.settings || shipsgoIntegrationForm;
      setShipsgoIntegrationSettings(nextSettings);
      setShipsgoIntegrationForm(shipsgoIntegrationFormFromSettings(nextSettings));
      markLoaded("shipsgoIntegration");
      setShipsgoIntegrationMessage(result.message || "大掌櫃设置已保存");
    } catch (saveError) {
      setShipsgoIntegrationMessage(saveError instanceof Error ? saveError.message : "大掌櫃设置保存失败");
    } finally {
      setShipsgoIntegrationSaving(false);
    }
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>系统设置</h2>
        </div>
        <div className={styles.headerActions}>
          {activeTab === "customers" ? (
            <button className={styles.primaryButtonCompact} type="button" onClick={startCreateCustomer}>新建客户</button>
          ) : null}
          {activeTab === "suppliers" ? (
            <button className={styles.primaryButtonCompact} type="button" onClick={startCreateSupplier}>新建供应商</button>
          ) : null}
          {activeTab === "users" ? (
            <button className={styles.primaryButtonCompact} type="button" onClick={startCreateUser}>新建用户</button>
          ) : null}
          <button className={styles.secondaryButton} type="button" disabled={loading} onClick={refreshCurrent}>
            {loading ? "刷新中..." : "刷新当前页"}
          </button>
        </div>
      </div>

      <div className={styles.reportTabs}>
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.key}
            className={tab.key === activeTab ? styles.reportTabActive : ""}
            type="button"
            onClick={() => selectTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab !== "companyProfile" && activeTab !== "exchangeRates" && activeTab !== "commissionFormula" && activeTab !== "notificationTemplates" && activeTab !== "shipsgoIntegration" ? (
        <div className={styles.listToolbar}>
          <input
            value={activeFilter.keyword || ""}
            onChange={(event) => updateFilter(activeTab, "keyword", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitSearch();
            }}
            placeholder={placeholderFor(activeTab)}
          />
          {activeTab === "suppliers" ? (
            <>
              <select
                value={filters.suppliers.type}
                onChange={(event) => updateFilter("suppliers", "type", event.target.value)}
              >
                <option value="">全部类型</option>
                {SUPPLIER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select
                value={filters.suppliers.status}
                onChange={(event) => updateFilter("suppliers", "status", event.target.value)}
              >
                <option value="">全部状态</option>
                {SUPPLIER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </>
          ) : null}
          {activeTab === "users" ? (
            <>
              <select
                value={filters.users.status}
                onChange={(event) => updateFilter("users", "status", event.target.value)}
              >
                <option value="">全部状态</option>
                {USER_STATUS_FILTER_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
              <select
                value={filters.users.role}
                onChange={(event) => updateFilter("users", "role", event.target.value)}
              >
                <option value="">全部角色</option>
                {USER_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </>
          ) : null}
          {activeTab === "auditLogs" ? (
            <input
              value={filters.auditLogs.action}
              onChange={(event) => updateFilter("auditLogs", "action", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSearch();
              }}
              placeholder="动作"
            />
          ) : null}
          <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
          <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
        </div>
      ) : null}

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {customerForm && activeTab === "customers" ? (
        <SideDetailDrawer
          ariaLabel={customerForm.id ? "编辑客户资料" : "新建客户资料"}
          kicker="客户资料"
          title={customerForm.id ? "编辑客户资料" : "新建客户资料"}
          subtitle="客户资料会通过 Portal 挂载到页面顶层，避免被列表或表格遮挡。"
          surfaceClassName={styles.settingsCustomerDrawer}
          onClose={() => {
            setCustomerForm(null);
            setCustomerMessage("");
          }}
        >
          <CustomerEditPanel
            form={customerForm}
            salespeople={salespeople}
            saving={customerSaving}
            message={customerMessage}
            onChange={setCustomerForm}
            onSubmit={saveCustomerForm}
            onCancel={() => {
              setCustomerForm(null);
              setCustomerMessage("");
            }}
          />
        </SideDetailDrawer>
      ) : null}
      {supplierForm && activeTab === "suppliers" ? (
        <SupplierEditPanel
          form={supplierForm}
          readOnly={Boolean(supplierForm.id) && supplierPanelMode === "view"}
          saving={supplierSaving}
          message={supplierMessage}
          onChange={setSupplierForm}
          onSubmit={saveSupplierForm}
          onEdit={() => setSupplierPanelMode("edit")}
          onDelete={() => supplierForm.id ? void deleteRecord("supplier", supplierForm.id) : undefined}
          onClose={closeSupplierPanel}
          onCancel={cancelSupplierEdit}
        />
      ) : null}
      {activeTab === "companyProfile" ? (
        <CompanyProfileSettingsCard
          settings={companyProfileSettings}
          form={companyProfileForm}
          loading={loading && !companyProfileSettings}
          saving={companyProfileSaving}
          message={companyProfileMessage}
          onChange={setCompanyProfileForm}
          onReset={() => {
            setCompanyProfileForm(companyProfileFormFromSettings(companyProfileSettings));
            setCompanyProfileMessage("");
          }}
          onSubmit={saveCompanyProfileSettings}
        />
      ) : activeTab === "exchangeRates" ? (
        <ExchangeSettingsCard
          settings={exchangeSettings}
          form={exchangeForm}
          loading={loading && !exchangeSettings}
          saving={exchangeSaving}
          message={exchangeMessage}
          refreshing={exchangeRefreshing}
          onChange={setExchangeForm}
          onReset={() => {
            setExchangeForm(exchangeFormFromSettings(exchangeSettings));
            setExchangeMessage("");
          }}
          onRefresh={refreshExchangeRatesManually}
          onSubmit={saveExchangeSettings}
        />
      ) : activeTab === "commissionFormula" ? (
        <CommissionFormulaSettingsCard
          settings={commissionFormulaSettings}
          form={commissionFormulaForm}
          loading={loading && !commissionFormulaSettings}
          saving={commissionFormulaSaving}
          message={commissionFormulaMessage}
          onChange={setCommissionFormulaForm}
          onReset={() => {
            setCommissionFormulaForm(commissionFormulaFormFromSettings(commissionFormulaSettings));
            setCommissionFormulaMessage("");
          }}
          onSubmit={saveCommissionFormulaSettings}
        />
      ) : activeTab === "notificationTemplates" ? (
        <NotificationTemplateSettingsCard
          settings={notificationTemplateSettings}
          form={notificationTemplateForm}
          loading={loading && !notificationTemplateSettings}
          saving={notificationTemplateSaving}
          message={notificationTemplateMessage}
          onChange={setNotificationTemplateForm}
          onReset={() => {
            setNotificationTemplateForm(notificationTemplateFormFromSettings(notificationTemplateSettings));
            setNotificationTemplateMessage("");
          }}
          onRestoreDefault={() => {
            setNotificationTemplateForm({ ...DEFAULT_NOTIFICATION_TEMPLATE_FORM });
            setNotificationTemplateMessage("已恢复默认模板，请保存后生效");
          }}
          onSubmit={saveNotificationTemplateSettings}
        />
      ) : activeTab === "shipsgoIntegration" ? (
        <ShipsgoIntegrationSettingsCard
          settings={shipsgoIntegrationSettings}
          form={shipsgoIntegrationForm}
          loading={loading && !shipsgoIntegrationSettings}
          saving={shipsgoIntegrationSaving}
          message={shipsgoIntegrationMessage}
          onChange={setShipsgoIntegrationForm}
          onReset={() => {
            setShipsgoIntegrationForm(shipsgoIntegrationFormFromSettings(shipsgoIntegrationSettings));
            setShipsgoIntegrationMessage("");
          }}
          onSubmit={saveShipsgoIntegrationSettings}
        />
      ) : (
        <>
          <SettingsTable
            tab={activeTab}
            rows={currentRows}
            columns={listColumns}
            loading={loading && !loadedTabs.has(activeTab)}
            pagination={activePagination}
            detailRow={detailRow}
            onViewDetail={(row) => {
              if (activeTab === "suppliers") {
                startViewSupplier(row as SupplierRow);
                return;
              }
              setDetailRow(row);
            }}
            onCloseDetail={() => setDetailRow(null)}
            onEditCustomer={startEditCustomer}
            onEditUser={startEditUser}
            onDeleteCustomer={(customer) => void deleteRecord("customer", customer.id)}
            onDeleteUser={(user) => void deleteRecord("user", user.id)}
            onPage={(nextPage) => loadTab(activeTab, nextPage, filtersForTab(filters, activeTab))}
          />
          {userForm && activeTab === "users" ? (
            <div ref={userEditPanelRef}>
              <UserEditPanel
                form={userForm}
                suppliers={activeSuppliers}
                permissionConfig={permissionConfig}
                saving={userSaving}
                message={userMessage}
                onChange={setUserForm}
                onSubmit={saveUserForm}
                onCancel={() => {
                  setUserForm(null);
                  setSelectedUserId("");
                  setUserMessage("");
                }}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );

  function updateFilter(tab: SettingsTabKey, key: string, value: string) {
    setFilters((current) => {
      if (tab === "customers") return { ...current, customers: { ...current.customers, [key]: value } };
      if (tab === "suppliers") return { ...current, suppliers: { ...current.suppliers, [key]: value } };
      if (tab === "users") return { ...current, users: { ...current.users, [key]: value } };
      return { ...current, auditLogs: { ...current.auditLogs, [key]: value } };
    });
  }
}

function SettingsTable({
  tab,
  rows,
  columns,
  loading,
  pagination,
  detailRow,
  onViewDetail,
  onCloseDetail,
  onEditCustomer,
  onEditUser,
  onDeleteCustomer,
  onDeleteUser,
  onPage,
}: {
  tab: SettingsTabKey;
  rows: Array<CustomerRow | SupplierRow | UserRow | AuditLogRow>;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  loading: boolean;
  pagination: Pagination;
  detailRow: CustomerRow | SupplierRow | UserRow | AuditLogRow | null;
  onViewDetail: (row: CustomerRow | SupplierRow | UserRow | AuditLogRow) => void;
  onCloseDetail: () => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onEditUser: (user: UserRow) => void;
  onDeleteCustomer: (customer: CustomerRow) => void;
  onDeleteUser: (user: UserRow) => void;
  onPage: (page: number) => void;
}) {
  const colSpan = columns.length + 1;
  return (
    <>
      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              {columns.map((column) => <th key={String(column.key)}>{column.label}</th>)}
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : rows.length ? rows.map((row) => (
              <SettingsRows
                key={row.id}
                tab={tab}
                row={row}
                columns={columns}
                onViewDetail={() => onViewDetail(row)}
                onEditUser={onEditUser}
              />
            )) : (
              <tr>
                <td colSpan={colSpan}><div className={styles.emptyState}>未找到匹配的数据</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar
        total={pagination.total}
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPage={onPage}
      />
      {detailRow && tab !== "users" && tab !== "suppliers" ? (
        <SettingsDetailDrawer
          tab={tab}
          row={detailRow}
          onClose={onCloseDetail}
          onEditCustomer={onEditCustomer}
          onDeleteCustomer={onDeleteCustomer}
        />
      ) : null}
    </>
  );
}

function SettingsRows({
  tab,
  row,
  columns,
  onViewDetail,
  onEditUser,
}: {
  tab: SettingsTabKey;
  row: CustomerRow | SupplierRow | UserRow | AuditLogRow;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  onViewDetail: () => void;
  onEditUser: (user: UserRow) => void;
}) {
  const handlePrimaryAction = () => {
    if (tab === "users") {
      onEditUser(row as UserRow);
      return;
    }
    onViewDetail();
  };

  return (
    <>
      <tr className={styles.clickableRow} onClick={handlePrimaryAction}>
        {columns.map((column) => <td key={String(column.key)}>{valueFor(row, column)}</td>)}
        <td>
          <button
            className={styles.rowDetailButton}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handlePrimaryAction();
            }}
          >
            {tab === "users" ? "编辑" : "详情"}
          </button>
        </td>
      </tr>
    </>
  );
}

function SettingsDetailDrawer({
  tab,
  row,
  onClose,
  onEditCustomer,
  onDeleteCustomer,
}: {
  tab: SettingsTabKey;
  row: CustomerRow | SupplierRow | UserRow | AuditLogRow;
  onClose: () => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onDeleteCustomer: (customer: CustomerRow) => void;
}) {
  const detailFields = detailFieldsFor(tab, row);
  const actions = tab === "customers"
    ? (
      <>
        <button className={styles.primaryButtonCompact} type="button" onClick={() => onEditCustomer(row as CustomerRow)}>编辑客户</button>
        <button className={styles.dangerButton} type="button" onClick={() => onDeleteCustomer(row as CustomerRow)}>删除客户</button>
      </>
    )
    : undefined;

  return (
    <SideDetailDrawer
      ariaLabel="系统设置详情"
      kicker="系统设置"
      title={drawerTitleFor(tab, row)}
      subtitle={drawerSubtitleFor(tab, row)}
      actions={actions}
      onClose={onClose}
    >
      <div className={styles.detailGrid}>
        {detailFields.map((field) => (
          <DetailField key={field.label} label={field.label} value={field.value} wide={field.wide} />
        ))}
      </div>
    </SideDetailDrawer>
  );
}

function CompanyProfileSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: CompanyProfileSettings | null;
  form: CompanyProfileForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: CompanyProfileForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载公司资料</div>;
  const currentForm = form || companyProfileFormFromSettings(settings);

  function setField<K extends keyof CompanyProfileForm>(key: K, value: CompanyProfileForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>公司资料 / 系统品牌配置</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          品牌名称
          <input value={currentForm.brandName} onChange={(event) => setField("brandName", event.target.value)} required />
        </label>
        <label>
          系统名称
          <input value={currentForm.systemName} onChange={(event) => setField("systemName", event.target.value)} required />
        </label>
        <label>
          公司中文名称
          <input value={currentForm.companyNameZh} onChange={(event) => setField("companyNameZh", event.target.value)} required />
        </label>
        <label>
          公司英文名称
          <input value={currentForm.companyNameEn} onChange={(event) => setField("companyNameEn", event.target.value)} />
        </label>
        <label>
          公司简称
          <input value={currentForm.shortName} onChange={(event) => setField("shortName", event.target.value)} />
        </label>
        <label>
          官网地址
          <input value={currentForm.website} onChange={(event) => setField("website", event.target.value)} placeholder="https://www.example.com" />
        </label>
        <label>
          联系邮箱
          <input value={currentForm.contactEmail} onChange={(event) => setField("contactEmail", event.target.value)} type="email" />
        </label>
        <label>
          联系电话
          <input value={currentForm.contactPhone} onChange={(event) => setField("contactPhone", event.target.value)} />
        </label>
        <label>
          Logo 地址
          <input value={currentForm.logoUrl} onChange={(event) => setField("logoUrl", event.target.value)} placeholder="可为空，支持 http/https 图片地址" />
        </label>
        <label>
          页脚版权文案
          <input value={currentForm.footerText} onChange={(event) => setField("footerText", event.target.value)} />
        </label>
        <label>
          公司地址
          <textarea value={currentForm.address} onChange={(event) => setField("address", event.target.value)} rows={3} />
        </label>
      </div>

      <div className={styles.emptyState}>
        当前品牌预览：{currentForm.brandName || "-"} · {currentForm.systemName || "-"} · {currentForm.companyNameZh || "-"}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存公司资料"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}

function ExchangeSettingsCard({
  settings,
  form,
  loading,
  saving,
  refreshing,
  message,
  onChange,
  onReset,
  onRefresh,
  onSubmit,
}: {
  settings: ExchangeRateSettings | null;
  form: ExchangeRateForm | null;
  loading: boolean;
  saving: boolean;
  refreshing: boolean;
  message: string;
  onChange: (form: ExchangeRateForm) => void;
  onReset: () => void;
  onRefresh: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载汇率设置</div>;
  const currentForm = form || exchangeFormFromSettings(settings);
  function setField<K extends keyof ExchangeRateForm>(key: K, value: ExchangeRateForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>汇率设置</strong>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={onRefresh} disabled={refreshing || saving}>
          {refreshing ? "刷新中..." : "手动刷新今日汇率"}
        </button>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          汇率来源
          <select value={currentForm.source} onChange={(event) => setField("source", event.target.value)}>
            {EXCHANGE_RATE_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <label>
          汇率类型
          <select value={currentForm.rateType} onChange={(event) => setField("rateType", event.target.value)}>
            {EXCHANGE_RATE_TYPES.map((rateType) => <option key={rateType} value={rateType}>{rateType}</option>)}
          </select>
        </label>
        <BooleanSelect
          label="自动更新汇率"
          value={currentForm.autoUpdate}
          onChange={(value) => setField("autoUpdate", value)}
        />
        <BooleanSelect
          label="允许手动汇率"
          value={currentForm.allowManualEdit}
          onChange={(value) => setField("allowManualEdit", value)}
        />
        <BooleanSelect
          label="允许订单选择多个物流供应商"
          value={currentForm.allowMultipleOrderLogisticsSuppliers}
          onChange={(value) => setField("allowMultipleOrderLogisticsSuppliers", value)}
        />
        <BooleanSelect
          label="管理员可忽略退税完整度"
          value={currentForm.allowAdminIncompleteTaxSubmit}
          onChange={(value) => setField("allowAdminIncompleteTaxSubmit", value)}
        />
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存汇率设置"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}

function CommissionFormulaSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: CommissionFormulaSettings | null;
  form: CommissionFormulaForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: CommissionFormulaForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载提成公式设置</div>;
  const currentForm = form || commissionFormulaFormFromSettings(settings);
  const formulaText = commissionFormulaPreview(currentForm);

  function setField<K extends keyof CommissionFormulaForm>(key: K, value: CommissionFormulaForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function applyPreset(mode: string) {
    const preset = COMMISSION_FORMULA_PRESETS.find((item) => item.value === mode) || COMMISSION_FORMULA_PRESETS[0];
    onChange({
      ...currentForm,
      mode: preset.value,
      label: preset.label,
      source: preset.source,
      deductions: [...preset.deductions],
    });
  }

  function toggleDeduction(value: string) {
    const exists = currentForm.deductions.includes(value);
    const deductions = exists
      ? currentForm.deductions.filter((item) => item !== value)
      : [...currentForm.deductions, value];
    onChange({ ...currentForm, mode: "CUSTOM", label: currentForm.label || "自定义公式", deductions });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>提成公式</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          公式模板
          <select value={currentForm.mode} onChange={(event) => applyPreset(event.target.value)}>
            {COMMISSION_FORMULA_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </select>
        </label>
        <label>
          公式名称
          <input value={currentForm.label} onChange={(event) => setField("label", event.target.value)} />
        </label>
        <label>
          收入来源
          <select
            value={currentForm.source}
            onChange={(event) => onChange({ ...currentForm, mode: "CUSTOM", source: event.target.value })}
          >
            {COMMISSION_FORMULA_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
          </select>
        </label>
        <UiSwitch
          label="提成基数负数归零"
          description="开启后，扣减后的负数基数按 0 处理。"
          checked={currentForm.floorAtZero}
          onChange={(value) => setField("floorAtZero", value)}
        />
      </div>

      <div className={styles.documentGroupCard}>
        <strong>扣减项</strong>
        <div className={styles.commissionDeductionGrid}>
          {COMMISSION_FORMULA_DEDUCTIONS.map((item) => (
            <PermissionSelectItem
              key={item.value}
              label={item.label}
              description={item.description}
              checked={currentForm.deductions.includes(item.value)}
              onChange={() => toggleDeduction(item.value)}
            />
          ))}
        </div>
      </div>

      <div className={styles.emptyState}>当前公式：提成基数 = {formulaText}</div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存提成公式"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}

function NotificationTemplateSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onRestoreDefault,
  onSubmit,
}: {
  settings: NotificationTemplateSettings | null;
  form: NotificationTemplateForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: NotificationTemplateForm) => void;
  onReset: () => void;
  onRestoreDefault: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载通知模板</div>;
  const currentForm = form || notificationTemplateFormFromSettings(settings);
  const preview = notificationTemplatePreview(currentForm);

  function setField<K extends keyof NotificationTemplateForm>(key: K, value: NotificationTemplateForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleRecipientEmailField(value: string) {
    const current = currentForm.recipientEmailFields || [];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    if (!next.length) return;
    setField("recipientEmailFields", next);
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>物流费用开票通知模板</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <UiSwitch
          label="审核通过后自动发送"
          description="关闭后，审核仍会通过，但不会自动发开票通知，可在账单中手工重发。"
          checked={currentForm.autoSendOnApproval}
          onChange={(value) => setField("autoSendOnApproval", value)}
        />
      </div>

      <section className={styles.documentGroupCard}>
        <strong>物流公司收件邮箱来源</strong>
        <div className={styles.quickCreateMeta}>
          <span>邮件收件人直接读取系统里的物流供应商资料，不在发送时手工输入。</span>
        </div>
        <div className={styles.commissionDeductionGrid}>
          {NOTIFICATION_RECIPIENT_EMAIL_OPTIONS.map((item) => (
            <PermissionSelectItem
              key={item.value}
              label={item.label}
              description={item.description}
              checked={(currentForm.recipientEmailFields || []).includes(item.value)}
              onChange={() => toggleRecipientEmailField(item.value)}
            />
          ))}
        </div>
      </section>

      <section className={styles.documentGroupCard}>
        <strong>抄送设置</strong>
        <UiSwitch
          label="默认抄送管理员"
          description="发送物流费用开票通知时，自动抄送系统中已启用的管理员邮箱。"
          checked={currentForm.ccAdminEmails}
          onChange={(value) => setField("ccAdminEmails", value)}
        />
        <label className={styles.notificationTemplateField}>
          额外抄送邮箱
          <textarea
            value={currentForm.ccEmails}
            onChange={(event) => setField("ccEmails", event.target.value)}
            placeholder="多个邮箱可用逗号、分号或换行分隔"
            rows={3}
          />
        </label>
      </section>

      <div className={styles.reportFilterGrid}>
        <label>
          发票上传入口
          <input
            value={currentForm.uploadUrl}
            onChange={(event) => setField("uploadUrl", event.target.value)}
            placeholder="为空时使用系统访问地址"
          />
        </label>
        <label>
          单票邮件标题
          <input
            value={currentForm.singleSubjectTemplate}
            onChange={(event) => setField("singleSubjectTemplate", event.target.value)}
          />
        </label>
        <label>
          批量邮件标题
          <input
            value={currentForm.batchSubjectTemplate}
            onChange={(event) => setField("batchSubjectTemplate", event.target.value)}
          />
        </label>
        <label>
          邮件落款
          <input value={currentForm.signature} onChange={(event) => setField("signature", event.target.value)} />
        </label>
        <label>
          开票要求
          <textarea
            value={currentForm.invoiceRequirements}
            onChange={(event) => setField("invoiceRequirements", event.target.value)}
            rows={6}
          />
        </label>
        <label>
          邮件正文模板
          <textarea
            value={currentForm.bodyTemplate}
            onChange={(event) => setField("bodyTemplate", event.target.value)}
            rows={11}
          />
        </label>
      </div>

      <section className={styles.documentGroupCard}>
        <strong>可用变量</strong>
        <div className={styles.quickCreateMeta}>
          {NOTIFICATION_TEMPLATE_VARIABLES.map(([token, label]) => (
            <span key={token}>{token}：{label}</span>
          ))}
        </div>
      </section>

      <section className={styles.documentGroupCard}>
        <strong>模板预览</strong>
        <textarea readOnly value={preview} rows={12} />
      </section>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存通知模板"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
        <button className={styles.secondaryButton} type="button" onClick={onRestoreDefault} disabled={saving}>恢复默认模板</button>
      </div>
    </form>
  );
}

function ShipsgoIntegrationSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: ShipsgoIntegrationSettings | null;
  form: ShipsgoIntegrationForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: ShipsgoIntegrationForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载第三方接口设置</div>;
  const currentForm = form || shipsgoIntegrationFormFromSettings(settings);

  function setField<K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof SHIPSGO_FEATURE_OPTIONS[number]["key"]) {
    setField(key, !currentForm[key]);
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>大掌櫃接口配置</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <UiSwitch
          label="启用大掌櫃"
          description="关闭后，物流信息页面不显示大掌櫃相关入口。"
          checked={currentForm.enabled}
          onChange={(value) => setField("enabled", value)}
        />
        <label>
          API Base URL
          <input
            value={currentForm.apiBaseUrl}
            onChange={(event) => setField("apiBaseUrl", event.target.value)}
            placeholder="https://api.shipsgo.com"
          />
        </label>
        <label>
          API Key
          <input
            value={currentForm.apiKey}
            onChange={(event) => setField("apiKey", event.target.value)}
            placeholder={currentForm.apiKeyConfigured ? "已配置，留空则保持不变" : "请输入大掌櫃 API Key"}
            autoComplete="off"
          />
        </label>
        <label>
          剩余 Credit 预警阈值
          <input
            value={currentForm.creditWarningThreshold}
            onChange={(event) => setField("creditWarningThreshold", event.target.value)}
            inputMode="numeric"
            min={0}
            type="number"
          />
        </label>
        <label>
          每日同步时间
          <input
            value={currentForm.dailySyncTime}
            onChange={(event) => setField("dailySyncTime", event.target.value)}
            type="time"
          />
        </label>
        <label>
          Webhook Secret
          <input
            value={currentForm.webhookSecret}
            onChange={(event) => setField("webhookSecret", event.target.value)}
            placeholder={currentForm.webhookSecretConfigured ? "已配置，留空则保持不变" : "用于校验大掌櫃 Webhook"}
            autoComplete="off"
          />
        </label>
      </div>

      <section className={styles.documentGroupCard}>
        <strong>前台功能显示</strong>
        <div className={styles.commissionDeductionGrid}>
          {SHIPSGO_FEATURE_OPTIONS.map((item) => (
            <PermissionSelectItem
              key={item.key}
              label={item.label}
              description={item.description}
              checked={Boolean(currentForm[item.key])}
              onChange={() => toggleFeature(item.key)}
            />
          ))}
        </div>
      </section>

      <div className={styles.emptyState}>
        当前状态：{currentForm.enabled ? (currentForm.apiKeyConfigured || currentForm.apiKey ? "已启用" : "待填写 API Key") : "已关闭"}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存大掌櫃设置"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}

function CustomerEditPanel({
  form,
  salespeople,
  saving,
  message,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: CustomerForm;
  salespeople: SalespersonOption[];
  saving: boolean;
  message: string;
  onChange: (form: CustomerForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  function setField<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    onChange({ ...form, [key]: value });
  }

  const selectedSalesperson = salespeople.find((user) => user.id === form.salespersonUserId) || null;

  async function searchSalespeople(keyword: string) {
    return salespeople.filter((user) => fuzzyIncludes([
      user.name,
      user.role,
    ], keyword)).slice(0, 10);
  }

  const docConfig: ShippingDocumentConfig = SHIPPING_DOCUMENT_TYPE_OPTIONS.reduce((config, option) => {
    config[option.key] = form.autoSendDocumentTypes.includes(option.value);
    return config;
  }, {} as ShippingDocumentConfig);

  function toggleShippingDocumentType(key: ShippingDocumentConfigKey) {
    const nextConfig: ShippingDocumentConfig = {
      ...docConfig,
      [key]: !docConfig[key],
    };
    setField(
      "autoSendDocumentTypes",
      SHIPPING_DOCUMENT_TYPE_OPTIONS
        .filter((option) => nextConfig[option.key])
        .map((option) => option.value),
    );
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{form.id ? "编辑客户资料" : "新建客户资料"}</strong>
          <span>客户名称保存时会统一转为大写；业务列表优先显示客户简称，正式单证继续使用客户全称。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          客户全称
          <input value={form.name} onChange={(event) => setField("name", event.target.value)} required />
        </label>
        <label>
          客户简称
          <input value={form.shortName} onChange={(event) => setField("shortName", event.target.value)} placeholder="允许为空" />
        </label>
        <label>
          国家 / 地区
          <input value={form.country} onChange={(event) => setField("country", event.target.value)} />
        </label>
        <label>
          默认币种
          <select value={form.defaultCurrency} onChange={(event) => setField("defaultCurrency", event.target.value)}>
            {CURRENCIES.map((currency) => <option key={currency || "empty"} value={currency}>{currency || "请选择币种"}</option>)}
          </select>
        </label>
        <label>
          负责业务员
          <SearchAutocomplete
            value={selectedSalesperson}
            cacheKey="settings-customer-salespeople"
            emptyLabel="未找到匹配业务员"
            placeholder="搜索业务员姓名 / 角色"
            getLabel={salespersonOptionLabel}
            getDescription={(user) => user.role || ""}
            search={searchSalespeople}
            onSelect={(user) => setField("salespersonUserId", user.id)}
          />
          {selectedSalesperson ? (
            <button className={styles.secondaryButton} type="button" onClick={() => setField("salespersonUserId", "")}>
              清除负责业务员
            </button>
          ) : (
            <span className={styles.mutedText}>未选择时表示不指定负责业务员。</span>
          )}
        </label>
        <label>
          提成比例 %
          <input value={form.commissionRate} onChange={(event) => setField("commissionRate", event.target.value)} inputMode="decimal" />
        </label>
        <label>
          提成状态
          <select value={form.commissionStatus} onChange={(event) => setField("commissionStatus", event.target.value)}>
            {CUSTOMER_COMMISSION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          联系人
          <input value={form.contactPerson} onChange={(event) => setField("contactPerson", event.target.value)} />
        </label>
        <label>
          联系邮箱
          <input value={form.contactEmail} onChange={(event) => setField("contactEmail", event.target.value)} type="email" />
        </label>
        <label>
          联系电话
          <input value={form.contactPhone} onChange={(event) => setField("contactPhone", event.target.value)} />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setField("remark", event.target.value)} />
        </label>
      </div>

      <section className={styles.customerShippingPanel}>
        <div className={styles.customerShippingHeader}>
          <strong>清关资料自动通知</strong>
        </div>
        <UiCheckbox
          variant="inline"
          label="启用报关单确认后的自动发送"
          checked={form.enableAutoShippingDocsNotification}
          onChange={(event) => setField("enableAutoShippingDocsNotification", event.currentTarget.checked)}
        />
        <div className={styles.reportFilterGrid}>
          <label>
            清关资料接收邮箱
            <textarea
              value={form.shippingDocsEmails}
              onChange={(event) => setField("shippingDocsEmails", event.target.value)}
              rows={3}
              placeholder="多个邮箱可用逗号、分号或换行分隔；为空则使用客户主邮箱"
            />
          </label>
          <label>
            抄送邮箱
            <textarea
              value={form.shippingDocsCcEmails}
              onChange={(event) => setField("shippingDocsCcEmails", event.target.value)}
              rows={3}
              placeholder="可为空，多个邮箱可用逗号、分号或换行分隔"
            />
          </label>
          <label>
            清关邮件语言
            <select value={form.clearanceEmailLanguage} onChange={(event) => setField("clearanceEmailLanguage", event.target.value)}>
              <option value="EN">English</option>
              <option value="RU">Русский</option>
            </select>
          </label>
        </div>
        <div className={styles.documentGroupCard}>
          <strong>自动发送资料</strong>
          <div className={styles.commissionDeductionGrid}>
            {SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => (
              <PermissionSelectItem
                key={option.value}
                label={option.label}
                checked={docConfig[option.key]}
                onChange={() => toggleShippingDocumentType(option.key)}
              />
            ))}
          </div>
        </div>
      </section>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存客户"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function SupplierEditPanel({
  form,
  readOnly,
  saving,
  message,
  onChange,
  onSubmit,
  onEdit,
  onDelete,
  onClose,
  onCancel,
}: {
  form: SupplierForm;
  readOnly: boolean;
  saving: boolean;
  message: string;
  onChange: (form: SupplierForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: () => void;
  onDelete: () => void | undefined;
  onClose: () => void;
  onCancel: () => void;
}) {
  function setField<K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) {
    onChange({ ...form, [key]: value });
  }

  function toggleCostType(costType: string) {
    const exists = form.allowedLogisticsCostTypes.includes(costType);
    setField(
      "allowedLogisticsCostTypes",
      exists
        ? form.allowedLogisticsCostTypes.filter((item) => item !== costType)
        : [...form.allowedLogisticsCostTypes, costType],
    );
  }

  const logisticsCapable = LOGISTICS_SUPPLIER_TYPES.includes(form.supplierType);
  const factoryDocumentCapable = PRODUCT_SUPPLIER_TYPES.includes(form.supplierType);
  const isCreate = !form.id;
  const controlsDisabled = readOnly || saving;

  return (
    <form className={`${styles.quickCreatePanel} ${styles.userEditPanel}`} onSubmit={(event) => {
      if (readOnly) {
        event.preventDefault();
        return;
      }
      onSubmit(event);
    }}>
      <section className={styles.userEditTitle}>
        <div>
          <strong>{isCreate ? "新建供应商资料" : readOnly ? "供应商资料" : "编辑供应商资料"}</strong>
        </div>
      </section>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <section className={styles.userEditSection}>
        <div className={styles.userEditSectionHeader}>
          <div>
            <strong>基础信息</strong>
          </div>
        </div>
        <div className={styles.reportFilterGrid}>
        <label>
          供应商名称
          <input value={form.supplierName} onChange={(event) => setField("supplierName", event.target.value)} required disabled={controlsDisabled} />
        </label>
        <label>
          供应商类型
          <select value={form.supplierType} onChange={(event) => {
            const supplierType = event.target.value;
            onChange({
              ...form,
              supplierType,
            });
          }} disabled={controlsDisabled}>
            {SUPPLIER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          状态
          <select value={form.status} onChange={(event) => setField("status", event.target.value)} disabled={controlsDisabled}>
            {SUPPLIER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          国家 / 地区
          <input value={form.country} onChange={(event) => setField("country", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          联系人
          <input value={form.contactPerson} onChange={(event) => setField("contactPerson", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          电话
          <input value={form.phone} onChange={(event) => setField("phone", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          邮箱
          <input value={form.email} onChange={(event) => setField("email", event.target.value)} type="email" disabled={controlsDisabled} />
        </label>
        <label>
          地址
          <input value={form.address} onChange={(event) => setField("address", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          开票名称
          <input value={form.invoiceTitle} onChange={(event) => setField("invoiceTitle", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          税号
          <input value={form.taxNumber} onChange={(event) => setField("taxNumber", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          银行名称
          <input value={form.bankName} onChange={(event) => setField("bankName", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          银行账号
          <input value={form.bankAccount} onChange={(event) => setField("bankAccount", event.target.value)} disabled={controlsDisabled} />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setField("remark", event.target.value)} disabled={controlsDisabled} />
        </label>
        </div>
      </section>

      {factoryDocumentCapable ? (
        <section className={styles.userEditSection}>
          <div className={styles.userEditSectionHeader}>
            <div>
              <strong>产品供应商权限</strong>
            </div>
          </div>
          <div className={styles.reportFilterGrid}>
            <BooleanSelect
              label="允许供应商资料回传"
              value={form.allowFactoryDocumentUpload}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowFactoryDocumentUpload", value)}
            />
          </div>
        </section>
      ) : null}

      {logisticsCapable ? (
        <section className={styles.userEditSection}>
          <div className={styles.userEditSectionHeader}>
            <div>
              <strong>物流供应商权限</strong>
            </div>
          </div>
          <div className={styles.reportFilterGrid}>
            <BooleanSelect
              label="允许录入物流信息"
              value={form.allowDomesticLogisticsEntry}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowDomesticLogisticsEntry", value)}
            />
            <BooleanSelect
              label="允许物流费用录入"
              value={form.allowLogisticsExpenseEntry}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowLogisticsExpenseEntry", value)}
            />
            <BooleanSelect
              label="允许物流发票上传"
              value={form.allowLogisticsInvoiceUpload}
              disabled={controlsDisabled}
              onChange={(value) => setField("allowLogisticsInvoiceUpload", value)}
            />
            <BooleanSelect
              label="默认物流供应商"
              value={form.isDefaultLogisticsSupplier}
              disabled={controlsDisabled}
              onChange={(value) => setField("isDefaultLogisticsSupplier", value)}
            />
          </div>
          <div className={styles.documentGroupCard}>
            <strong>允许录入的物流费用类型</strong>
            <div className={styles.supplierLogisticsCostGrid}>
              {LOGISTICS_COST_TYPE_OPTIONS.map(({ value: costType, label }) => {
                const meta = SUPPLIER_LOGISTICS_COST_TYPE_UI_META[costType];
                return (
                  <PermissionSelectItem
                    key={costType}
                    label={meta?.label || label}
                    description={meta?.description || "允许供应商在物流费用模块录入该费用。"}
                    checked={form.allowedLogisticsCostTypes.includes(costType)}
                    disabled={controlsDisabled || !form.allowLogisticsExpenseEntry}
                    onChange={() => toggleCostType(costType)}
                  />
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <div className={styles.detailActions}>
        {readOnly ? (
          <>
            <button className={styles.primaryButtonCompact} type="button" onClick={onEdit} disabled={saving}>编辑供应商</button>
            <button className={styles.dangerButton} type="button" onClick={onDelete} disabled={saving}>删除供应商</button>
            <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={saving}>关闭</button>
          </>
        ) : (
          <>
            <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存供应商"}</button>
            <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
          </>
        )}
      </div>
    </form>
  );
}

function BooleanSelect({ label, value, disabled, onChange }: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <UiSwitch
      label={label}
      checked={Boolean(value)}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function PermissionChoiceGroup({
  title,
  options,
  values,
  onToggle,
}: {
  title: string;
  options: PermissionOption[];
  values: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <section className={styles.permissionGroup}>
      <div className={styles.permissionGroupHeader}>
        <strong>{title}</strong>
        <span>
          已选择 {values.length} / {options.length} 项
        </span>
      </div>
      <div className={styles.permissionOptionGrid}>
        {options.map((option) => (
          <PermissionSelectItem
            key={option.value}
            className={styles.permissionOptionCard}
            label={option.label}
            checked={values.includes(option.value)}
            onChange={() => onToggle(option.value)}
          />
        ))}
      </div>
    </section>
  );
}

type PermissionTabKey = "menus" | "reads" | "writes";

const PERMISSION_MODE_DESCRIPTIONS: Record<string, string> = {
  ROLE: "适合大多数账号，系统按角色自动分配权限。",
  CUSTOM: "仅用于特殊账号，可单独控制菜单、数据范围和操作权限。",
};

const DATA_SCOPE_DESCRIPTIONS: Record<string, string> = {
  ALL: "可查看系统内全部业务数据。",
  OWN: "仅查看本人客户、订单及相关业务数据。",
  OWN_COST: "仅查看与本人相关的成本业务数据。",
  NONE: "不授予业务数据查看范围。",
};

const PERMISSION_TAB_LABELS: Record<PermissionTabKey, string> = {
  menus: "菜单权限",
  reads: "查看权限",
  writes: "操作权限",
};

function UserEditPanel({
  form,
  suppliers,
  permissionConfig,
  saving,
  message,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: UserForm;
  suppliers: SupplierRow[];
  permissionConfig: PermissionConfig | null;
  saving: boolean;
  message: string;
  onChange: (form: UserForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  function setField<K extends keyof UserForm>(key: K, value: UserForm[K]) {
    onChange({ ...form, [key]: value });
  }

  const bindableSuppliers = suppliers.filter((supplier) => {
    if (form.role === "物流供应商") return LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || "");
    if (FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(form.role)) return PRODUCT_SUPPLIER_TYPES.includes(supplier.supplierType || "") && supplier.allowFactoryDocumentUpload;
    return false;
  });
  const selectedSupplier = bindableSuppliers.find((supplier) => supplier.id === form.supplierId) || null;
  const passwordError = form.password && !passwordMeetsPolicy(form.password) ? PASSWORD_POLICY_MESSAGE : "";
  const defaults = permissionDefaultsForRole(permissionConfig, form.role);
  const [advancedPermissionsOpen, setAdvancedPermissionsOpen] = useState(false);
  const [activePermissionTab, setActivePermissionTab] = useState<PermissionTabKey>("menus");
  const permissionModeOptions = permissionConfig?.permissionModes || [
    { value: "ROLE", label: "固定角色权限" },
    { value: "CUSTOM", label: "自定义组合权限" },
  ];
  const dataScopeOptions = permissionConfig?.dataScopeOptions || [
    { value: "ALL", label: "全部数据" },
    { value: "OWN", label: "本人客户和订单" },
    { value: "OWN_COST", label: "本人成本相关" },
    { value: "NONE", label: "无数据范围" },
  ];
  const activePermissionGroup = {
    menus: {
      title: "菜单权限",
      options: permissionConfig?.menuPermissionOptions || [],
      values: form.menus,
      onToggle: (value: string) => togglePermission("menus", value),
    },
    reads: {
      title: "查看权限",
      options: permissionConfig?.readPermissionOptions || [],
      values: form.reads,
      onToggle: (value: string) => togglePermission("reads", value),
    },
    writes: {
      title: "操作权限",
      options: permissionConfig?.writePermissionOptions || [],
      values: form.writes,
      onToggle: (value: string) => togglePermission("writes", value),
    },
  }[activePermissionTab];

  async function searchBindableSuppliers(keyword: string) {
    const filtered = bindableSuppliers.filter((supplier) => fuzzyIncludes([
      supplier.supplierName,
      supplier.supplierType,
      supplier.contactPerson,
      supplier.invoiceTitle,
      supplier.taxNumber,
    ], keyword));
    return filtered.slice(0, 10);
  }

  function setRole(role: string) {
    const nextDefaults = permissionDefaultsForRole(permissionConfig, role);
    onChange({
      ...form,
      role,
      supplierId: role === form.role && isSupplierAccountRole(role) ? form.supplierId : "",
      ...(form.permissionMode === "CUSTOM" ? nextDefaults : {}),
    });
  }

  function setPermissionMode(mode: string) {
    if (mode === "CUSTOM") {
      setAdvancedPermissionsOpen(false);
      setActivePermissionTab("menus");
      onChange({
        ...form,
        permissionMode: "CUSTOM",
        menus: form.menus.length ? form.menus : defaults.menus,
        reads: form.reads.length ? form.reads : defaults.reads,
        writes: form.writes.length ? form.writes : defaults.writes,
        dataScope: form.dataScope || defaults.dataScope,
      });
      return;
    }
    setAdvancedPermissionsOpen(false);
    onChange({ ...form, permissionMode: "ROLE" });
  }

  function togglePermission(key: "menus" | "reads" | "writes", value: string) {
    const values = form[key];
    const nextValues = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    onChange({ ...form, [key]: nextValues });
  }

  return (
    <form className={`${styles.quickCreatePanel} ${styles.userEditPanel}`} onSubmit={onSubmit}>
      <div className={styles.userEditTitle}>
        <div>
          <strong>{form.id ? "编辑用户资料" : "新建用户"}</strong>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <section className={styles.userEditSection}>
        <div className={styles.userEditSectionHeader}>
          <strong>基本账号信息</strong>
        </div>
        <div className={styles.userEditBasicGrid}>
          <label>
            姓名
            <input value={form.name} onChange={(event) => setField("name", event.target.value)} required />
          </label>
          <label>
            邮箱
            <input value={form.email} onChange={(event) => setField("email", event.target.value.trim().toLowerCase())} type="email" required />
          </label>
          <label>
            角色
            <select value={form.role} onChange={(event) => setRole(event.target.value)}>
              {USER_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label>
            账号状态
            <select value={form.approvalStatus} onChange={(event) => setField("approvalStatus", event.target.value)}>
              {USER_APPROVAL_STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </label>
          {isSupplierAccountRole(form.role) ? (
            <label>
              绑定供应商
              <SearchAutocomplete
                value={selectedSupplier}
                cacheKey={FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(form.role) ? "settings-user-product-suppliers" : "settings-user-logistics-suppliers"}
                emptyLabel="未找到匹配供应商"
                placeholder="搜索供应商 / 类型 / 联系人 / 税号"
                getLabel={supplierOptionLabel}
                getDescription={(supplier) => [supplier.contactPerson, supplier.invoiceTitle, supplier.taxNumber].filter(Boolean).join(" / ")}
                search={searchBindableSuppliers}
                onSelect={(supplier) => setField("supplierId", supplier.id)}
              />
              {!bindableSuppliers.length ? (
                <small className={styles.mutedText}>
                  {FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(form.role)
                    ? "请先在供应商资料中建立产品供应商并开启资料回传权限"
                    : "请先在供应商资料中启用物流相关供应商"}
                </small>
              ) : null}
            </label>
          ) : null}
          <label>
            {form.id ? "重置密码" : "初始密码"}
            <input
              value={form.password}
              onChange={(event) => setField("password", event.target.value)}
              type="password"
              placeholder={form.id ? "留空则不修改密码" : "新建用户必填"}
              required={!form.id}
            />
            {passwordError ? <small className={styles.inlineError}>{passwordError}</small> : null}
          </label>
        </div>
      </section>

      <section className={styles.userEditSection}>
        <div className={styles.userEditSectionHeader}>
          <strong>权限方案</strong>
          <span>普通账号建议使用固定角色权限，特殊账号再启用自定义组合权限。</span>
        </div>
        <div className={styles.permissionModeCards}>
          {permissionModeOptions.map((option) => (
            <PermissionSelectItem
              key={option.value}
              className={styles.permissionSchemeCard}
              label={option.label}
              description={PERMISSION_MODE_DESCRIPTIONS[option.value] || ""}
              checked={form.permissionMode === option.value}
              onChange={() => setPermissionMode(option.value)}
            />
          ))}
        </div>

        {form.permissionMode === "CUSTOM" ? (
          <>
            <div className={styles.dataScopeCardGrid}>
              {dataScopeOptions.map((option) => (
                <PermissionSelectItem
                  key={option.value}
                  className={styles.permissionSchemeCard}
                  label={option.label}
                  description={DATA_SCOPE_DESCRIPTIONS[option.value] || "按当前权限模板控制数据访问范围。"}
                  checked={form.dataScope === option.value}
                  onChange={() => setField("dataScope", option.value)}
                />
              ))}
            </div>
            <div className={styles.permissionTemplateNote}>
              权限模板说明：当前账号使用自定义组合权限，保存后将按所选数据范围、菜单权限、查看权限和操作权限执行。
            </div>
          </>
        ) : (
          <div className={styles.permissionTemplateNote}>
            当前账号将使用【{form.role}】角色默认权限。默认数据范围：{dataScopeLabel(permissionConfig, defaults.dataScope)}；菜单 {defaults.menus.length} 项，查看权限 {defaults.reads.length} 项，操作权限 {defaults.writes.length} 项。
          </div>
        )}
      </section>

      {form.permissionMode === "CUSTOM" ? (
        <section className={styles.userEditSection}>
          <div className={styles.advancedPermissionHeader}>
            <div>
              <strong>高级自定义权限</strong>
            </div>
            <button className={styles.secondaryButton} type="button" onClick={() => setAdvancedPermissionsOpen((open) => !open)}>
              {advancedPermissionsOpen ? "收起高级权限" : "展开高级权限"}
            </button>
          </div>
          {advancedPermissionsOpen ? (
            <>
              <div className={styles.permissionTabs}>
                {(Object.keys(PERMISSION_TAB_LABELS) as PermissionTabKey[]).map((tab) => (
                  <button
                    key={tab}
                    className={tab === activePermissionTab ? styles.permissionTabActive : ""}
                    type="button"
                    onClick={() => setActivePermissionTab(tab)}
                  >
                    {PERMISSION_TAB_LABELS[tab]}
                  </button>
                ))}
              </div>
              <PermissionChoiceGroup
                title={activePermissionGroup.title}
                options={activePermissionGroup.options}
                values={activePermissionGroup.values}
                onToggle={activePermissionGroup.onToggle}
              />
            </>
          ) : (
            <div className={styles.permissionTemplateNote}>
              高级权限当前已折叠。保存时仍会保留当前自定义权限配置。
            </div>
          )}
        </section>
      ) : null}

      <div className={styles.userEditActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving || Boolean(passwordError)}>{saving ? "保存中..." : "保存用户"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function columnsFor(tab: SettingsTabKey) {
  if (tab === "customers") return CUSTOMER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  if (tab === "suppliers") return SUPPLIER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  if (tab === "users") return USER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  return AUDIT_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
}

function rowsFor(tab: SettingsTabKey, rows: {
  customers: CustomerRow[];
  suppliers: SupplierRow[];
  users: UserRow[];
  logs: AuditLogRow[];
}) {
  if (tab === "customers") return rows.customers;
  if (tab === "suppliers") return rows.suppliers;
  if (tab === "users") return rows.users;
  if (tab === "auditLogs") return rows.logs;
  return [];
}

function detailFieldsFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return [
      { label: "客户全称", value: customer.fullName || customer.name || "-", wide: true },
      { label: "客户简称", value: customer.shortName || "-" },
      { label: "国家", value: customer.country || "-" },
      { label: "默认币种", value: customer.defaultCurrency || "-" },
      { label: "负责业务员", value: customer.salespersonName || "-" },
      { label: "提成比例", value: `${Number(customer.commissionRate || 0).toFixed(2)}%` },
      { label: "联系人", value: customer.contactPerson || "-" },
      { label: "清关资料自动通知", value: yesNo(customer.enableAutoShippingDocsNotification) },
      { label: "清关资料接收邮箱", value: emailListText(customer.shippingDocsEmails) || "默认使用客户主邮箱", wide: true },
      { label: "抄送邮箱", value: emailListText(customer.shippingDocsCcEmails), wide: true },
      { label: "清关邮件语言", value: customer.clearanceEmailLanguageLabel || (customer.clearanceEmailLanguage === "RU" ? "Русский" : "English") },
      { label: "自动发送资料", value: shippingDocumentTypeLabels(customer.autoSendDocumentTypes), wide: true },
      { label: "备注", value: customer.remark || "-", wide: true },
    ];
  }
  if (tab === "users") {
    const user = row as UserRow;
    return [
      { label: "姓名", value: user.name || "-" },
      { label: "邮箱", value: user.email || "-", wide: true },
      { label: "角色", value: user.role || "-" },
      { label: "邮箱验证状态", value: user.emailVerified === false ? "邮箱未验证" : "已验证" },
      { label: "注册时间", value: formatDateTime(user.createdAt) },
      { label: "审核状态", value: approvalStatusText(user.approvalStatus) },
      { label: "账号状态", value: userStatus(user) },
      { label: "权限模式", value: user.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
      { label: "数据范围", value: user.customPermissions?.dataScope || "-" },
      { label: "菜单权限", value: user.customPermissions?.menus?.length ? `${user.customPermissions.menus.length} 项自定义` : "-" },
      { label: "查看权限", value: user.customPermissions?.reads?.length ? `${user.customPermissions.reads.length} 项自定义` : "-" },
      { label: "操作权限", value: user.customPermissions?.writes?.length ? `${user.customPermissions.writes.length} 项自定义` : "-" },
      { label: "绑定供应商", value: isSupplierAccountRole(user.role) ? (supplierDisplayName(user) || "-") : "-", wide: isSupplierAccountRole(user.role) },
      { label: "首次改密", value: yesNo(user.mustChangePassword) },
    ];
  }
  const log = row as AuditLogRow;
  return [
    { label: "时间", value: formatDateTime(log.createdAt) },
    { label: "操作人", value: log.user?.name || "-" },
    { label: "动作", value: log.action || "-" },
    { label: "对象", value: log.entityLabel || "-", wide: true },
    { label: "IP", value: log.ipAddress || "-" },
  ];
}

function drawerTitleFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return customer.shortName || customer.name || "客户详情";
  }
  if (tab === "users") {
    const user = row as UserRow;
    return user.name || user.email || "用户详情";
  }
  const log = row as AuditLogRow;
  return log.entityLabel || log.action || "操作日志";
}

function drawerSubtitleFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return `国家：${customer.country || "-"} · 默认币种：${customer.defaultCurrency || "-"}`;
  }
  if (tab === "users") {
    const user = row as UserRow;
    return `角色：${user.role || "-"} · 状态：${userStatus(user)}`;
  }
  const log = row as AuditLogRow;
  return `时间：${formatDateTime(log.createdAt)} · 操作人：${log.user?.name || "-"}`;
}

function valueFor(row: CustomerRow | SupplierRow | UserRow | AuditLogRow, column: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>) {
  if (column.render) return column.render(row);
  const key = String(column.key) as keyof typeof row;
  return String(row[key] ?? "-");
}

function placeholderFor(tab: SettingsTabKey) {
  if (tab === "customers") return "搜索客户简称 / 全称 / 国家";
  if (tab === "suppliers") return "搜索供应商 / 类型 / 联系人 / 税号";
  if (tab === "users") return "搜索姓名 / 邮箱";
  return "搜索操作人 / 动作 / 对象";
}

function kebabTab(tab: SettingsTabKey) {
  if (tab === "exchangeRates") return "exchange-rates";
  if (tab === "commissionFormula") return "commission-formula";
  if (tab === "auditLogs") return "audit-logs";
  return tab;
}

function emptyPagination(pageSize: number): Pagination {
  return { page: 1, pageSize, total: 0, totalPages: 1 };
}

function filtersForTab(filters: SettingsFilters, tab: SettingsTabKey) {
  if (tab === "customers") return filters.customers;
  if (tab === "suppliers") return filters.suppliers;
  if (tab === "users") return filters.users;
  return filters.auditLogs;
}

function appendFilterParams(params: URLSearchParams, tab: SettingsTabKey, filters: SettingsFilters[keyof SettingsFilters]) {
  if ("keyword" in filters && filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (tab === "suppliers") {
    const supplierFilters = filters as SettingsFilters["suppliers"];
    if (supplierFilters.type) params.set("type", supplierFilters.type);
    if (supplierFilters.status) params.set("status", supplierFilters.status);
  }
  if (tab === "users") {
    const userFilters = filters as SettingsFilters["users"];
    if (userFilters.role) params.set("role", userFilters.role);
    if (userFilters.status) params.set("status", userFilters.status);
  }
  if (tab === "auditLogs") {
    const logFilters = filters as SettingsFilters["auditLogs"];
    if (logFilters.action.trim()) params.set("action", logFilters.action.trim());
  }
}

function emptyFiltersForTab(tab: SettingsTabKey) {
  if (tab === "customers") return { keyword: "" };
  if (tab === "suppliers") return { keyword: "", type: "", status: "" };
  if (tab === "users") return { keyword: "", role: "", status: "" };
  return { keyword: "", action: "" };
}

function resetFilters(filters: SettingsFilters, tab: SettingsTabKey): SettingsFilters {
  return {
    ...filters,
    [tab]: emptyFiltersForTab(tab),
  } as SettingsFilters;
}

function companyProfileFormFromSettings(settings: CompanyProfileSettings | null): CompanyProfileForm {
  return {
    brandName: stringSetting(settings, "brandName", "NEXTWOOD"),
    systemName: stringSetting(settings, "systemName", "NEXTWOOD 供应链协同平台"),
    companyNameZh: stringSetting(settings, "companyNameZh", "浙江莱诺建材有限公司"),
    companyNameEn: optionalStringSetting(settings, "companyNameEn"),
    shortName: stringSetting(settings, "shortName", "NEXTWOOD"),
    website: stringSetting(settings, "website", "https://www.nextwood.net"),
    contactEmail: stringSetting(settings, "contactEmail", ""),
    contactPhone: stringSetting(settings, "contactPhone", ""),
    address: stringSetting(settings, "address", ""),
    logoUrl: stringSetting(settings, "logoUrl", ""),
    footerText: optionalStringSetting(settings, "footerText"),
  };
}

function exchangeFormFromSettings(settings: ExchangeRateSettings | null): ExchangeRateForm {
  return {
    source: stringSetting(settings, "source", "中国银行"),
    rateType: stringSetting(settings, "rateType", "现汇买入价"),
    autoUpdate: Boolean(settings?.autoUpdate),
    allowManualEdit: Boolean(settings?.allowManualEdit),
    allowMultipleOrderLogisticsSuppliers: Boolean(settings?.allowMultipleOrderLogisticsSuppliers),
    allowAdminIncompleteTaxSubmit: Boolean(settings?.allowAdminIncompleteTaxSubmit),
  };
}

function commissionFormulaFormFromSettings(settings: CommissionFormulaSettings | null): CommissionFormulaForm {
  const fallback = COMMISSION_FORMULA_PRESETS[0];
  const deductions = Array.isArray(settings?.deductions)
    ? settings.deductions.filter((item): item is string => typeof item === "string")
    : fallback.deductions;
  return {
    mode: stringSetting(settings, "mode", fallback.value),
    label: stringSetting(settings, "label", fallback.label),
    source: stringSetting(settings, "source", fallback.source),
    deductions,
    floorAtZero: settings?.floorAtZero !== false,
  };
}

function notificationTemplateFormFromSettings(settings: NotificationTemplateSettings | null): NotificationTemplateForm {
  return {
    autoSendOnApproval: settings?.autoSendOnApproval !== false,
    recipientEmailFields: stringArraySetting(
      settings,
      "recipientEmailFields",
      DEFAULT_NOTIFICATION_TEMPLATE_FORM.recipientEmailFields,
    ),
    ccAdminEmails: settings?.ccAdminEmails !== false,
    ccEmails: emailListSettingText(settings, "ccEmails"),
    singleSubjectTemplate: templateStringSetting(settings, "singleSubjectTemplate", DEFAULT_NOTIFICATION_TEMPLATE_FORM.singleSubjectTemplate),
    batchSubjectTemplate: templateStringSetting(settings, "batchSubjectTemplate", DEFAULT_NOTIFICATION_TEMPLATE_FORM.batchSubjectTemplate),
    bodyTemplate: templateStringSetting(settings, "bodyTemplate", DEFAULT_NOTIFICATION_TEMPLATE_FORM.bodyTemplate),
    invoiceRequirements: templateStringSetting(settings, "invoiceRequirements", DEFAULT_NOTIFICATION_TEMPLATE_FORM.invoiceRequirements),
    uploadUrl: optionalStringSetting(settings, "uploadUrl"),
    signature: templateStringSetting(settings, "signature", DEFAULT_NOTIFICATION_TEMPLATE_FORM.signature),
  };
}

function shipsgoIntegrationFormFromSettings(settings: ShipsgoIntegrationSettings | null): ShipsgoIntegrationForm {
  return {
    enabled: settings?.enabled === true,
    apiBaseUrl: stringSetting(settings, "apiBaseUrl", DEFAULT_SHIPSGO_INTEGRATION_FORM.apiBaseUrl),
    apiKey: "",
    apiKeyConfigured: settings?.apiKeyConfigured === true,
    oceanTrackingEnabled: settings?.oceanTrackingEnabled !== false,
    airTrackingEnabled: settings?.airTrackingEnabled === true,
    manualSyncEnabled: settings?.manualSyncEnabled !== false,
    autoSyncEnabled: settings?.autoSyncEnabled === true,
    dailySyncTime: stringSetting(settings, "dailySyncTime", DEFAULT_SHIPSGO_INTEGRATION_FORM.dailySyncTime),
    webhookEnabled: settings?.webhookEnabled === true,
    webhookSecret: "",
    webhookSecretConfigured: settings?.webhookSecretConfigured === true,
    liveMapEnabled: settings?.liveMapEnabled === true,
    customerPushEnabled: settings?.customerPushEnabled === true,
    creditWarningThreshold: String(settings?.creditWarningThreshold ?? DEFAULT_SHIPSGO_INTEGRATION_FORM.creditWarningThreshold),
  };
}

function commissionFormulaPreview(form: CommissionFormulaForm) {
  const sourceLabel = COMMISSION_FORMULA_SOURCES.find((item) => item.value === form.source)?.label || form.source;
  const deductionLabels = form.deductions
    .map((deduction) => COMMISSION_FORMULA_DEDUCTIONS.find((item) => item.value === deduction)?.label || deduction)
    .filter(Boolean);
  return [sourceLabel, ...deductionLabels.map((label) => `- ${label}`)].join(" ");
}

function notificationTemplatePreview(form: NotificationTemplateForm) {
  const uploadUrl = form.uploadUrl || "https://www.nextwood.net";
  const recipientLabels = form.recipientEmailFields
    .map((value) => NOTIFICATION_RECIPIENT_EMAIL_OPTIONS.find((item) => item.value === value)?.label || "")
    .filter(Boolean)
    .join("、") || "未选择";
  const extraCcText = form.ccEmails
    .split(/[\n,;；]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("、");
  const ccText = [
    form.ccAdminEmails ? "管理员邮箱" : "未默认抄送管理员",
    extraCcText ? `额外抄送：${extraCcText}` : "",
  ].filter(Boolean).join("；");
  const sampleBillRows = [
    "1. 订单号：PV252",
    "   提单号：STSHVS76979",
    "   柜型/柜量：40HQ×1",
    "   客户简称：TERRAVUD",
    "   费用合计：",
    "   - 人民币实际费用合计：CNY ¥3,450.00",
    "   - USD 外币费用合计：USD $1,825.00",
    "   - 折人民币总合计：CNY ¥15,643.75",
    "   费用明细：",
    "   - 1. 拖车费，数量 1，CNY 2650.00，折人民币 ¥2650.00，备注：2650*1",
    "   - 2. 港杂费，数量 1，CNY 800.00，折人民币 ¥800.00",
    "   - 3. 海运费，数量 1，USD 1790.00，折人民币 ¥11959.30",
    "   - 4. ENS费，数量 1，USD 35.00，折人民币 ¥234.45",
    "   请分别上传：",
    "   - 港杂费发票：CNY ¥800.00",
    "   - 海运费发票：USD $1,825.00 / 折人民币 CNY ¥12,193.75",
    "   - 拖车及其他费用合并发票：CNY ¥2,650.00",
  ].join("\n");
  const variables: Record<string, string> = {
    supplierName: "浙江迈奇克国际货运代理有限公司",
    billCount: "1",
    orderNo: "PV252",
    blNo: "STSHVS76979",
    customerShortName: "TERRAVUD",
    containerSummary: "40HQ×1",
    amountCny: "CNY ¥15,643.75",
    expenseDetails: "1. 拖车费，数量 1，CNY 2650.00，折人民币 ¥2650.00\n2. 海运费，数量 1，USD 1790.00，折人民币 ¥11959.30",
    invoiceGroups: "港杂费发票：CNY ¥800.00\n海运费发票：USD $1,825.00 / 折人民币 CNY ¥12,193.75\n拖车及其他费用合并发票：CNY ¥2,650.00",
    remark: "2650*1",
    billRows: sampleBillRows,
    invoiceRequirements: form.invoiceRequirements,
    uploadUrl,
    signature: form.signature,
  };
  const subject = applyNotificationTemplate(form.singleSubjectTemplate, variables);
  const body = applyNotificationTemplate(form.bodyTemplate, variables);
  return [`收件来源：${recipientLabels}`, `抄送：${ccText}`, "", `标题：${subject}`, "", body].join("\n");
}

function applyNotificationTemplate(template: string, variables: Record<string, string>) {
  return String(template || "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
  ));
}

function stringSetting(settings: Record<string, unknown> | null | undefined, key: string, fallback: string) {
  const value = settings?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalStringSetting(settings: Record<string, unknown> | null | undefined, key: string) {
  const value = settings?.[key];
  return typeof value === "string" ? value : "";
}

function templateStringSetting(settings: Record<string, unknown> | null | undefined, key: string, fallback: string) {
  const value = settings?.[key];
  return typeof value === "string" ? value : fallback;
}

function stringArraySetting(settings: Record<string, unknown> | null | undefined, key: string, fallback: string[]) {
  const value = settings?.[key];
  if (!Array.isArray(value)) return fallback;
  const result = value
    .map((item) => String(item || "").trim())
    .filter((item, index, arr) => item && arr.indexOf(item) === index);
  return result.length ? result : fallback;
}

function emailListSettingText(settings: Record<string, unknown> | null | undefined, key: string) {
  const value = settings?.[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).join("\n");
  }
  return typeof value === "string" ? value : "";
}

function approvalStatusText(status: unknown) {
  if (status === "APPROVED") return "已启用";
  if (status === "PENDING") return "待审核";
  if (status === "REJECTED") return "已拒绝";
  if (status === "DISABLED") return "已停用";
  return String(status || "-");
}

function userStatus(user: UserRow) {
  if (user.emailVerified === false) return "邮箱未验证";
  if (user.approvalStatus === "APPROVED" && user.isActive !== false) return "已启用";
  if (user.approvalStatus === "PENDING") return "待审核";
  if (user.approvalStatus === "REJECTED") return "已拒绝";
  if (user.approvalStatus === "DISABLED" || user.isActive === false) return "已停用";
  return user.approvalStatus || "-";
}

function supplierDisplayName(user: UserRow) {
  const name = user.supplierName || "";
  const type = user.supplierType || "";
  if (name && type) return `${name} / ${type}`;
  return name || type || "";
}

function isSupplierAccountRole(role: unknown) {
  return SUPPLIER_ACCOUNT_ROLES.includes(String(role || ""));
}

function supplierMatchesUserRole(supplier: SupplierRow | undefined, role: string) {
  if (!supplier) return false;
  if (role === "物流供应商") return LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || "");
  if (FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(role)) return PRODUCT_SUPPLIER_TYPES.includes(supplier.supplierType || "") && Boolean(supplier.allowFactoryDocumentUpload);
  return false;
}

function supplierOptionLabel(supplier: SupplierRow) {
  const name = supplier.supplierName || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}

function salespersonOptionLabel(user: SalespersonOption) {
  return user.role ? `${user.name || "未命名用户"} / ${user.role}` : (user.name || "未命名用户");
}

function fuzzyIncludes(values: unknown[], keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(normalized));
}

function emptyCustomerForm(): CustomerForm {
  return {
    id: "",
    name: "",
    shortName: "",
    country: "",
    defaultCurrency: "",
    salespersonUserId: "",
    commissionRate: "0",
    commissionStatus: "启用",
    contactPerson: "",
    contactEmail: "",
    contactPhone: "",
    enableAutoShippingDocsNotification: false,
    shippingDocsEmails: "",
    shippingDocsCcEmails: "",
    autoSendDocumentTypes: SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => option.value),
    clearanceEmailLanguage: "EN",
    remark: "",
  };
}

function customerFormFromRow(customer: CustomerRow): CustomerForm {
  return {
    id: customer.id,
    name: customer.fullName || customer.name || "",
    shortName: customer.shortName || "",
    country: customer.country || "",
    defaultCurrency: customer.defaultCurrency || "",
    salespersonUserId: (customer as CustomerRow & { salespersonUserId?: string }).salespersonUserId || "",
    commissionRate: String(Number(customer.commissionRate || 0)),
    commissionStatus: customer.commissionStatus || "启用",
    contactPerson: customer.contactPerson || "",
    contactEmail: customer.contactEmail || "",
    contactPhone: customer.contactPhone || "",
    enableAutoShippingDocsNotification: Boolean(customer.enableAutoShippingDocsNotification),
    shippingDocsEmails: emailListText(customer.shippingDocsEmails),
    shippingDocsCcEmails: emailListText(customer.shippingDocsCcEmails),
    autoSendDocumentTypes: customer.autoSendDocumentTypes?.length
      ? customer.autoSendDocumentTypes
      : SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => option.value),
    clearanceEmailLanguage: customer.clearanceEmailLanguage || "EN",
    remark: customer.remark || "",
  };
}

function emailListText(value?: string[] | string) {
  if (Array.isArray(value)) return value.join("\n");
  return value || "";
}

function shippingDocumentTypeLabels(value?: string[]) {
  const selected = value?.length ? value : SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => option.value);
  return selected
    .map((item) => SHIPPING_DOCUMENT_TYPE_OPTIONS.find((option) => option.value === item)?.label || item)
    .join("、");
}

function emptySupplierForm(): SupplierForm {
  return {
    id: "",
    supplierName: "",
    supplierType: PRODUCT_SUPPLIER_TYPE,
    status: "启用",
    country: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    invoiceTitle: "",
    taxNumber: "",
    bankName: "",
    bankAccount: "",
    allowDomesticLogisticsEntry: false,
    allowLogisticsExpenseEntry: false,
    allowLogisticsInvoiceUpload: false,
    allowFactoryDocumentUpload: false,
    isDefaultLogisticsSupplier: false,
    allowedLogisticsCostTypes: [],
    remark: "",
  };
}

function supplierFormFromRow(supplier: SupplierRow): SupplierForm {
  return {
    id: supplier.id,
    supplierName: supplier.supplierName || "",
    supplierType: supplier.supplierType || "其他供应商",
    status: supplier.status || "启用",
    country: supplier.country || "",
    contactPerson: supplier.contactPerson || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    invoiceTitle: supplier.invoiceTitle || "",
    taxNumber: supplier.taxNumber || "",
    bankName: supplier.bankName || "",
    bankAccount: supplier.bankAccount || "",
    allowDomesticLogisticsEntry: Boolean(supplier.allowDomesticLogisticsEntry),
    allowLogisticsExpenseEntry: Boolean(supplier.allowLogisticsExpenseEntry),
    allowLogisticsInvoiceUpload: Boolean(supplier.allowLogisticsInvoiceUpload),
    allowFactoryDocumentUpload: Boolean(supplier.allowFactoryDocumentUpload),
    isDefaultLogisticsSupplier: Boolean(supplier.isDefaultLogisticsSupplier),
    allowedLogisticsCostTypes: Array.isArray(supplier.allowedLogisticsCostTypes) ? supplier.allowedLogisticsCostTypes : [],
    remark: supplier.remark || "",
  };
}

function emptyUserForm(): UserForm {
  return {
    id: "",
    name: "",
    email: "",
    role: "业务员",
    approvalStatus: "APPROVED",
    supplierId: "",
    password: "",
    permissionMode: "ROLE",
    dataScope: "OWN",
    menus: [],
    reads: [],
    writes: [],
  };
}

function userFormFromRow(user: UserRow): UserForm {
  const custom = user.customPermissions || null;
  const role = USER_ROLES.includes(user.role || "") ? String(user.role) : "业务员";
  return {
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    role,
    approvalStatus: user.approvalStatus || (user.isActive === false ? "DISABLED" : "APPROVED"),
    supplierId: user.supplierId || "",
    password: "",
    permissionMode: custom?.mode === "CUSTOM" || user.permissionMode === "CUSTOM" ? "CUSTOM" : "ROLE",
    dataScope: custom?.dataScope || "NONE",
    menus: Array.isArray(custom?.menus) ? custom.menus : [],
    reads: Array.isArray(custom?.reads) ? custom.reads : [],
    writes: Array.isArray(custom?.writes) ? custom.writes : [],
  };
}

function permissionDefaultsForRole(config: PermissionConfig | null, role: string) {
  return {
    menus: config?.roleMenus?.[role] || [],
    reads: config?.roleReads?.[role] || [],
    writes: config?.roleWrites?.[role] || [],
    dataScope: defaultDataScopeForRole(role),
  };
}

function defaultDataScopeForRole(role: string) {
  if (role === "管理员" || role === "财务") return "ALL";
  if (role === "业务员" || role === "物流供应商" || FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(role) || role === "物流资料录入员") return "OWN";
  return "NONE";
}

function dataScopeLabel(config: PermissionConfig | null, value: string) {
  return config?.dataScopeOptions?.find((option) => option.value === value)?.label || value || "-";
}
