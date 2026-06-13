"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { formatDateTime, yesNo } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import styles from "../WorkspaceShell.module.css";

type SettingsTabKey = "customers" | "suppliers" | "users" | "exchangeRates" | "auditLogs";

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

type ExchangeRateForm = {
  source: string;
  rateType: string;
  autoUpdate: boolean;
  allowManualEdit: boolean;
  allowMultipleOrderLogisticsSuppliers: boolean;
  allowAdminIncompleteTaxSubmit: boolean;
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
  { value: "commercialInvoice", label: "商业发票" },
  { value: "packingList", label: "装箱单" },
  { value: "customsDeclaration", label: "报关单" },
];
const CUSTOMER_COMMISSION_STATUSES = ["启用", "停用"];
const SUPPLIER_TYPES = ["工厂供应商", "物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", "其他供应商"];
const SUPPLIER_STATUSES = ["启用", "停用"];
const LOGISTICS_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"];
const LOGISTICS_COST_TYPES = ["拖车费", "报关费", "港杂费", "海运费", "保险费", "查验费", "超重费", "提箱费", "进港费", "其他物流费用"];
const EXCHANGE_RATE_SOURCES = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
const EXCHANGE_RATE_TYPES = ["现汇买入价", "现汇卖出价", "中间价"];
const USER_ROLES = ["管理员", "业务员", "财务", "成本录入员", "物流供应商", "物流资料录入员", "查看者"];
const USER_APPROVAL_STATUS_OPTIONS = [
  { label: "待审核", value: "PENDING" },
  { label: "已启用", value: "APPROVED" },
  { label: "已拒绝", value: "REJECTED" },
  { label: "已停用", value: "DISABLED" },
];
const BOOLEAN_OPTIONS = [
  { label: "关闭", value: false },
  { label: "开启", value: true },
];

const SETTINGS_TABS: { key: SettingsTabKey; label: string; description: string }[] = [
  { key: "customers", label: "客户资料", description: "客户简称、国家、币种和负责业务员。" },
  { key: "suppliers", label: "供应商资料", description: "供应商类型、状态和物流相关开关。" },
  { key: "users", label: "用户与权限", description: "用户角色、账号状态和权限模式。" },
  { key: "exchangeRates", label: "汇率设置", description: "汇率来源、自动更新和管理员开关。" },
  { key: "auditLogs", label: "操作日志", description: "关键操作追溯记录。" },
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
  { key: "isDefaultLogisticsSupplier", label: "默认物流", render: (row) => yesNo(row.isDefaultLogisticsSupplier) },
];

const USER_COLUMNS: TableColumn<UserRow>[] = [
  { key: "name", label: "姓名" },
  { key: "email", label: "邮箱" },
  { key: "role", label: "角色" },
  { key: "supplierName", label: "所属供应商", render: (row) => row.role === "物流供应商" ? (supplierDisplayName(row) || "-") : "-" },
  { key: "approvalStatus", label: "账号状态", render: (row) => userStatus(row) },
  { key: "permissionMode", label: "权限模式", render: (row) => row.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
];

const AUDIT_COLUMNS: TableColumn<AuditLogRow>[] = [
  { key: "createdAt", label: "时间", render: (row) => formatDateTime(row.createdAt) },
  { key: "user", label: "操作人", render: (row) => row.user?.name || "-" },
  { key: "action", label: "动作" },
  { key: "entityLabel", label: "对象" },
  { key: "ipAddress", label: "IP" },
];

export function SettingsModule() {
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("customers");
  const [keyword, setKeyword] = useState("");

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [exchangeSettings, setExchangeSettings] = useState<ExchangeRateSettings | null>(null);
  const [exchangeForm, setExchangeForm] = useState<ExchangeRateForm | null>(null);
  const [permissionConfig, setPermissionConfig] = useState<PermissionConfig | null>(null);
  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);

  const [pagination, setPagination] = useState<Record<SettingsTabKey, Pagination>>({
    customers: emptyPagination(PAGE_SIZE),
    suppliers: emptyPagination(PAGE_SIZE),
    users: emptyPagination(PAGE_SIZE),
    exchangeRates: emptyPagination(PAGE_SIZE),
    auditLogs: emptyPagination(AUDIT_PAGE_SIZE),
  });
  const [loadedTabs, setLoadedTabs] = useState<Set<SettingsTabKey>>(new Set());
  const [expandedId, setExpandedId] = useState("");
  const [customerForm, setCustomerForm] = useState<CustomerForm | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");
  const [supplierForm, setSupplierForm] = useState<SupplierForm | null>(null);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierMessage, setSupplierMessage] = useState("");
  const [userForm, setUserForm] = useState<UserForm | null>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [exchangeSaving, setExchangeSaving] = useState(false);
  const [exchangeMessage, setExchangeMessage] = useState("");
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeMeta = SETTINGS_TABS.find((tab) => tab.key === activeTab) || SETTINGS_TABS[0];
  const activePagination = pagination[activeTab] || emptyPagination(PAGE_SIZE);
  const listColumns = useMemo(() => columnsFor(activeTab), [activeTab]);
  const currentRows = useMemo(() => rowsFor(activeTab, { customers, suppliers, users, logs }), [activeTab, customers, suppliers, users, logs]);

  useEffect(() => {
    if (!loadedTabs.has(activeTab)) {
      void loadTab(activeTab, 1, "");
    }
  }, [activeTab]);

  async function loadTab(tab = activeTab, page = activePagination.page || 1, nextKeyword = keyword) {
    setLoading(true);
    setError("");
    try {
      if (tab === "exchangeRates") {
        const result = await apiJson<{ settings: ExchangeRateSettings }>("/api/settings/exchange-rates");
        const settings = result.settings || {};
        setExchangeSettings(settings);
        setExchangeForm(exchangeFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "users") {
        await ensurePermissionConfig();
      }
      const pageSize = tab === "auditLogs" ? AUDIT_PAGE_SIZE : PAGE_SIZE;
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
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
      setExpandedId("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取系统设置失败");
    } finally {
      setLoading(false);
    }
  }

  function markLoaded(tab: SettingsTabKey) {
    setLoadedTabs((current) => new Set(current).add(tab));
  }

  function selectTab(tab: SettingsTabKey) {
    setActiveTab(tab);
    setKeyword("");
    setExpandedId("");
    setCustomerForm(null);
    setCustomerMessage("");
    setSupplierForm(null);
    setSupplierMessage("");
    setUserForm(null);
    setUserMessage("");
    setExchangeMessage("");
  }

  function submitSearch() {
    void loadTab(activeTab, 1, keyword);
  }

  function resetSearch() {
    setKeyword("");
    void loadTab(activeTab, 1, "");
  }

  function refreshCurrent() {
    void loadTab(activeTab, activePagination.page || 1, keyword);
  }

  function startCreateCustomer() {
    setActiveTab("customers");
    setExpandedId("");
    setCustomerMessage("");
    setCustomerForm(emptyCustomerForm());
  }

  function startCreateSupplier() {
    setActiveTab("suppliers");
    setExpandedId("");
    setSupplierMessage("");
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
    setExpandedId("");
    setUserMessage("");
    setUserForm(emptyUserForm());
    void ensureActiveSuppliers();
    void ensurePermissionConfig();
  }

  function startEditCustomer(customer: CustomerRow) {
    setActiveTab("customers");
    setExpandedId(customer.id);
    setCustomerMessage("");
    setCustomerForm(customerFormFromRow(customer));
  }

  function startEditSupplier(supplier: SupplierRow) {
    setActiveTab("suppliers");
    setExpandedId(supplier.id);
    setSupplierMessage("");
    setSupplierForm(supplierFormFromRow(supplier));
  }

  function startEditUser(user: UserRow) {
    setActiveTab("users");
    setExpandedId(user.id);
    setUserMessage("");
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
      await loadTab("customers", activePagination.page || 1, keyword);
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
      const result = await apiJson<{ success?: boolean; message?: string }>(
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
            isDefaultLogisticsSupplier: supplierForm.isDefaultLogisticsSupplier,
            allowedLogisticsCostTypes: supplierForm.allowedLogisticsCostTypes,
            remark: supplierForm.remark,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "供应商资料保存失败");
      setSupplierForm(null);
      await loadTab("suppliers", activePagination.page || 1, keyword);
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
    if (userForm.role === "物流供应商" && !userForm.supplierId) {
      setUserMessage("物流供应商账号必须绑定供应商");
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
        supplierId: userForm.role === "物流供应商" ? userForm.supplierId : undefined,
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
      await loadTab("users", activePagination.page || 1, keyword);
    } catch (saveError) {
      setUserMessage(saveError instanceof Error ? saveError.message : "用户保存失败");
    } finally {
      setUserSaving(false);
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

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>React 迁移模块</span>
          <h2>系统设置</h2>
          <p>{activeMeta.description}</p>
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

      {activeTab !== "exchangeRates" ? (
        <div className={styles.listToolbar}>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitSearch();
            }}
            placeholder={placeholderFor(activeTab)}
          />
          <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
          <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
        </div>
      ) : null}

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {customerForm && activeTab === "customers" ? (
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
      ) : null}
      {supplierForm && activeTab === "suppliers" ? (
        <SupplierEditPanel
          form={supplierForm}
          saving={supplierSaving}
          message={supplierMessage}
          onChange={setSupplierForm}
          onSubmit={saveSupplierForm}
          onCancel={() => {
            setSupplierForm(null);
            setSupplierMessage("");
          }}
        />
      ) : null}
      {userForm && activeTab === "users" ? (
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
            setUserMessage("");
          }}
        />
      ) : null}

      {activeTab === "exchangeRates" ? (
        <ExchangeSettingsCard
          settings={exchangeSettings}
          form={exchangeForm}
          loading={loading && !exchangeSettings}
          saving={exchangeSaving}
          message={exchangeMessage}
          onChange={setExchangeForm}
          onReset={() => {
            setExchangeForm(exchangeFormFromSettings(exchangeSettings));
            setExchangeMessage("");
          }}
          onSubmit={saveExchangeSettings}
        />
      ) : (
        <SettingsTable
          tab={activeTab}
          rows={currentRows}
          columns={listColumns}
          loading={loading && !loadedTabs.has(activeTab)}
          pagination={activePagination}
          expandedId={expandedId}
          onToggle={setExpandedId}
          onEditCustomer={startEditCustomer}
          onEditSupplier={startEditSupplier}
          onEditUser={startEditUser}
          onPage={(nextPage) => loadTab(activeTab, nextPage, keyword)}
        />
      )}
    </section>
  );
}

function SettingsTable({
  tab,
  rows,
  columns,
  loading,
  pagination,
  expandedId,
  onToggle,
  onEditCustomer,
  onEditSupplier,
  onEditUser,
  onPage,
}: {
  tab: SettingsTabKey;
  rows: Array<CustomerRow | SupplierRow | UserRow | AuditLogRow>;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  loading: boolean;
  pagination: Pagination;
  expandedId: string;
  onToggle: (id: string) => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onEditSupplier: (supplier: SupplierRow) => void;
  onEditUser: (user: UserRow) => void;
  onPage: (page: number) => void;
}) {
  const colSpan = columns.length + 1;
  return (
    <>
      <div className={styles.tableWrap}>
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
                expanded={expandedId === row.id}
                onToggle={() => onToggle(expandedId === row.id ? "" : row.id)}
                onEditCustomer={onEditCustomer}
                onEditSupplier={onEditSupplier}
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
    </>
  );
}

function SettingsRows({
  tab,
  row,
  columns,
  expanded,
  onToggle,
  onEditCustomer,
  onEditSupplier,
  onEditUser,
}: {
  tab: SettingsTabKey;
  row: CustomerRow | SupplierRow | UserRow | AuditLogRow;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  expanded: boolean;
  onToggle: () => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onEditSupplier: (supplier: SupplierRow) => void;
  onEditUser: (user: UserRow) => void;
}) {
  const detailFields = detailFieldsFor(tab, row);
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        {columns.map((column) => <td key={String(column.key)}>{valueFor(row, column)}</td>)}
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={columns.length + 1}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                {tab === "customers" ? (
                  <button className={styles.primaryButtonCompact} type="button" onClick={(event) => { event.stopPropagation(); onEditCustomer(row as CustomerRow); }}>
                    编辑客户
                  </button>
                ) : null}
                {tab === "suppliers" ? (
                  <button className={styles.primaryButtonCompact} type="button" onClick={(event) => { event.stopPropagation(); onEditSupplier(row as SupplierRow); }}>
                    编辑供应商
                  </button>
                ) : null}
                {tab === "users" ? (
                  <button className={styles.primaryButtonCompact} type="button" onClick={(event) => { event.stopPropagation(); onEditUser(row as UserRow); }}>
                    编辑用户
                  </button>
                ) : null}
              </div>
              <div className={styles.detailGrid}>
                {detailFields.map((field) => (
                  <DetailField key={field.label} label={field.label} value={field.value} wide={field.wide} />
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExchangeSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: ExchangeRateSettings | null;
  form: ExchangeRateForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: ExchangeRateForm) => void;
  onReset: () => void;
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
          <span>维护外币折人民币来源、自动更新策略，以及退税和物流供应商相关系统开关。</span>
        </div>
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

  function toggleShippingDocumentType(value: string) {
    const current = new Set(form.autoSendDocumentTypes);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    setField("autoSendDocumentTypes", Array.from(current));
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
          <span>用于自动或手动向客户发送商业发票、装箱单和报关单。</span>
        </div>
        <label className={styles.inlineCheckbox}>
          <input
            type="checkbox"
            checked={form.enableAutoShippingDocsNotification}
            onChange={(event) => setField("enableAutoShippingDocsNotification", event.target.checked)}
          />
          <span>启用报关单确认后的自动发送</span>
        </label>
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
        <div className={styles.checkboxPanel}>
          <strong>自动发送资料</strong>
          <div>
            {SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={form.autoSendDocumentTypes.includes(option.value)}
                  onChange={() => toggleShippingDocumentType(option.value)}
                />
                {option.label}
              </label>
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
  saving,
  message,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: SupplierForm;
  saving: boolean;
  message: string;
  onChange: (form: SupplierForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
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

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{form.id ? "编辑供应商资料" : "新建供应商资料"}</strong>
          <span>物流相关开关只对物流、报关、海运、港杂费用供应商生效；同一时间只能有一家默认物流供应商。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          供应商名称
          <input value={form.supplierName} onChange={(event) => setField("supplierName", event.target.value)} required />
        </label>
        <label>
          供应商类型
          <select value={form.supplierType} onChange={(event) => {
            const supplierType = event.target.value;
            onChange({
              ...form,
              supplierType,
              allowDomesticLogisticsEntry: LOGISTICS_SUPPLIER_TYPES.includes(supplierType) ? form.allowDomesticLogisticsEntry : false,
              allowLogisticsExpenseEntry: LOGISTICS_SUPPLIER_TYPES.includes(supplierType) ? form.allowLogisticsExpenseEntry : false,
              allowLogisticsInvoiceUpload: LOGISTICS_SUPPLIER_TYPES.includes(supplierType) ? form.allowLogisticsInvoiceUpload : false,
              isDefaultLogisticsSupplier: LOGISTICS_SUPPLIER_TYPES.includes(supplierType) ? form.isDefaultLogisticsSupplier : false,
            });
          }}>
            {SUPPLIER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          状态
          <select value={form.status} onChange={(event) => setField("status", event.target.value)}>
            {SUPPLIER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          国家 / 地区
          <input value={form.country} onChange={(event) => setField("country", event.target.value)} />
        </label>
        <label>
          联系人
          <input value={form.contactPerson} onChange={(event) => setField("contactPerson", event.target.value)} />
        </label>
        <label>
          电话
          <input value={form.phone} onChange={(event) => setField("phone", event.target.value)} />
        </label>
        <label>
          邮箱
          <input value={form.email} onChange={(event) => setField("email", event.target.value)} type="email" />
        </label>
        <label>
          地址
          <input value={form.address} onChange={(event) => setField("address", event.target.value)} />
        </label>
        <label>
          开票名称
          <input value={form.invoiceTitle} onChange={(event) => setField("invoiceTitle", event.target.value)} />
        </label>
        <label>
          税号
          <input value={form.taxNumber} onChange={(event) => setField("taxNumber", event.target.value)} />
        </label>
        <label>
          银行名称
          <input value={form.bankName} onChange={(event) => setField("bankName", event.target.value)} />
        </label>
        <label>
          银行账号
          <input value={form.bankAccount} onChange={(event) => setField("bankAccount", event.target.value)} />
        </label>
        <BooleanSelect
          label="允许录入国内物流信息"
          value={logisticsCapable && form.allowDomesticLogisticsEntry}
          disabled={!logisticsCapable}
          onChange={(value) => setField("allowDomesticLogisticsEntry", value)}
        />
        <BooleanSelect
          label="允许物流费用录入"
          value={logisticsCapable && form.allowLogisticsExpenseEntry}
          disabled={!logisticsCapable}
          onChange={(value) => setField("allowLogisticsExpenseEntry", value)}
        />
        <BooleanSelect
          label="允许物流发票上传"
          value={logisticsCapable && form.allowLogisticsInvoiceUpload}
          disabled={!logisticsCapable}
          onChange={(value) => setField("allowLogisticsInvoiceUpload", value)}
        />
        <BooleanSelect
          label="默认物流供应商"
          value={logisticsCapable && form.isDefaultLogisticsSupplier}
          disabled={!logisticsCapable}
          onChange={(value) => setField("isDefaultLogisticsSupplier", value)}
        />
        <label>
          备注
          <input value={form.remark} onChange={(event) => setField("remark", event.target.value)} />
        </label>
      </div>

      <div className={styles.checkboxPanel}>
        <strong>允许录入的物流费用类型</strong>
        <div>
          {LOGISTICS_COST_TYPES.map((costType) => (
            <label key={costType}>
              <input
                type="checkbox"
                checked={form.allowedLogisticsCostTypes.includes(costType)}
                disabled={!logisticsCapable || !form.allowLogisticsExpenseEntry}
                onChange={() => toggleCostType(costType)}
              />
              {costType}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存供应商"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
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
    <label>
      {label}
      <select value={String(Boolean(value))} disabled={disabled} onChange={(event) => onChange(event.target.value === "true")}>
        {BOOLEAN_OPTIONS.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
      </select>
    </label>
  );
}

function PermissionCheckboxGroup({
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
      <strong>{title}</strong>
      <div>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </section>
  );
}

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

  const logisticsSuppliers = suppliers.filter((supplier) => LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || ""));
  const selectedSupplier = logisticsSuppliers.find((supplier) => supplier.id === form.supplierId) || null;
  const defaults = permissionDefaultsForRole(permissionConfig, form.role);

  async function searchLogisticsSuppliers(keyword: string) {
    const filtered = logisticsSuppliers.filter((supplier) => fuzzyIncludes([
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
      supplierId: role === "物流供应商" ? form.supplierId : "",
      ...(form.permissionMode === "CUSTOM" ? nextDefaults : {}),
    });
  }

  function setPermissionMode(mode: string) {
    if (mode === "CUSTOM") {
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
    onChange({ ...form, permissionMode: "ROLE" });
  }

  function togglePermission(key: "menus" | "reads" | "writes", value: string) {
    const values = form[key];
    const nextValues = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    onChange({ ...form, [key]: nextValues });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{form.id ? "编辑用户资料" : "新建用户"}</strong>
          <span>维护基础账号、角色状态和权限组合；自定义权限保存后立即由后端统一校验。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
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
        {form.role === "物流供应商" ? (
          <label>
            绑定供应商
            <SearchAutocomplete
              value={selectedSupplier}
              cacheKey="settings-user-logistics-suppliers"
              emptyLabel="未找到匹配供应商"
              placeholder="搜索供应商 / 类型 / 联系人 / 税号"
              getLabel={supplierOptionLabel}
              getDescription={(supplier) => [supplier.contactPerson, supplier.invoiceTitle, supplier.taxNumber].filter(Boolean).join(" / ")}
              search={searchLogisticsSuppliers}
              onSelect={(supplier) => setField("supplierId", supplier.id)}
            />
            {!logisticsSuppliers.length ? <small className={styles.mutedText}>请先在供应商资料中启用物流相关供应商</small> : null}
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
        </label>
      </div>

      <div className={styles.checkboxPanel}>
        <div className={styles.quickCreateHeader}>
          <div>
            <strong>权限模式</strong>
            <span>固定角色权限适合大多数账号；自定义组合权限可精细控制菜单、数据范围和读写能力。</span>
          </div>
        </div>
        <div className={styles.reportFilterGrid}>
          <label>
            权限模式
            <select value={form.permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
              {(permissionConfig?.permissionModes || [
                { value: "ROLE", label: "固定角色权限" },
                { value: "CUSTOM", label: "自定义组合权限" },
              ]).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {form.permissionMode === "CUSTOM" ? (
            <label>
              数据范围
              <select value={form.dataScope} onChange={(event) => setField("dataScope", event.target.value)}>
                {(permissionConfig?.dataScopeOptions || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : (
            <label>
              当前角色默认范围
              <input value={dataScopeLabel(permissionConfig, defaults.dataScope)} readOnly />
            </label>
          )}
        </div>
        {form.permissionMode === "CUSTOM" ? (
          <div className={styles.permissionMatrix}>
            <PermissionCheckboxGroup
              title="菜单权限"
              options={permissionConfig?.menuPermissionOptions || []}
              values={form.menus}
              onToggle={(value) => togglePermission("menus", value)}
            />
            <PermissionCheckboxGroup
              title="查看权限"
              options={permissionConfig?.readPermissionOptions || []}
              values={form.reads}
              onToggle={(value) => togglePermission("reads", value)}
            />
            <PermissionCheckboxGroup
              title="操作权限"
              options={permissionConfig?.writePermissionOptions || []}
              values={form.writes}
              onToggle={(value) => togglePermission("writes", value)}
            />
          </div>
        ) : (
          <div className={styles.quickCreateMeta}>
            <span>菜单：{defaults.menus.length} 项</span>
            <span>查看权限：{defaults.reads.length} 项</span>
            <span>操作权限：{defaults.writes.length} 项</span>
          </div>
        )}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存用户"}</button>
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
  if (tab === "suppliers") {
    const supplier = row as SupplierRow;
    return [
      { label: "供应商", value: supplier.supplierName || "-", wide: true },
      { label: "类型", value: supplier.supplierType || "-" },
      { label: "状态", value: supplier.status || "-" },
      { label: "联系人", value: supplier.contactPerson || "-" },
      { label: "电话", value: supplier.phone || "-" },
      { label: "邮箱", value: supplier.email || "-" },
      { label: "开票名称", value: supplier.invoiceTitle || "-", wide: true },
      { label: "税号", value: supplier.taxNumber || "-" },
      { label: "允许国内物流录入", value: yesNo(supplier.allowDomesticLogisticsEntry) },
      { label: "默认物流供应商", value: yesNo(supplier.isDefaultLogisticsSupplier) },
      { label: "备注", value: supplier.remark || "-", wide: true },
    ];
  }
  if (tab === "users") {
    const user = row as UserRow;
    return [
      { label: "姓名", value: user.name || "-" },
      { label: "邮箱", value: user.email || "-", wide: true },
      { label: "角色", value: user.role || "-" },
      { label: "账号状态", value: userStatus(user) },
      { label: "权限模式", value: user.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
      { label: "数据范围", value: user.customPermissions?.dataScope || "-" },
      { label: "菜单权限", value: user.customPermissions?.menus?.length ? `${user.customPermissions.menus.length} 项自定义` : "-" },
      { label: "查看权限", value: user.customPermissions?.reads?.length ? `${user.customPermissions.reads.length} 项自定义` : "-" },
      { label: "操作权限", value: user.customPermissions?.writes?.length ? `${user.customPermissions.writes.length} 项自定义` : "-" },
      { label: "绑定供应商", value: user.role === "物流供应商" ? (supplierDisplayName(user) || "-") : "-", wide: user.role === "物流供应商" },
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

function valueFor(row: CustomerRow | SupplierRow | UserRow | AuditLogRow, column: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>) {
  if (column.render) return column.render(row);
  return String((row as Record<string, unknown>)[String(column.key)] ?? "-");
}

function placeholderFor(tab: SettingsTabKey) {
  if (tab === "customers") return "搜索客户简称 / 全称 / 国家";
  if (tab === "suppliers") return "搜索供应商 / 类型 / 联系人 / 税号";
  if (tab === "users") return "搜索姓名 / 邮箱";
  return "搜索操作人 / 动作 / 对象";
}

function kebabTab(tab: SettingsTabKey) {
  if (tab === "exchangeRates") return "exchange-rates";
  if (tab === "auditLogs") return "audit-logs";
  return tab;
}

function emptyPagination(pageSize: number): Pagination {
  return { page: 1, pageSize, total: 0, totalPages: 1 };
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

function stringSetting(settings: ExchangeRateSettings | null, key: string, fallback: string) {
  const value = settings?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function userStatus(user: UserRow) {
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
    supplierType: "工厂供应商",
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
    role: "查看者",
    approvalStatus: "APPROVED",
    supplierId: "",
    password: "",
    permissionMode: "ROLE",
    dataScope: "NONE",
    menus: [],
    reads: [],
    writes: [],
  };
}

function userFormFromRow(user: UserRow): UserForm {
  const custom = user.customPermissions || null;
  return {
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    role: user.role || "查看者",
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
  if (role === "业务员" || role === "物流供应商") return "OWN";
  if (role === "成本录入员") return "OWN_COST";
  return "NONE";
}

function dataScopeLabel(config: PermissionConfig | null, value: string) {
  return config?.dataScopeOptions?.find((option) => option.value === value)?.label || value || "-";
}
