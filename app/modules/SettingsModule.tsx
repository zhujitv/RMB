"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../api";
import { SideDetailDrawer } from "../components";
import styles from "../WorkspaceShell.module.css";
import type { CompanyProfileSettings } from "../types";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../lib/password-policy";
import {
  AUDIT_PAGE_SIZE,
  DEFAULT_NOTIFICATION_TEMPLATE_FORM,
  DEFAULT_SHIPSGO_INTEGRATION_FORM,
  FACTORY_SUPPLIER_ACCOUNT_ROLES,
  PAGE_SIZE,
  SETTINGS_TABS,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  USER_APPROVAL_STATUS_OPTIONS,
  USER_ROLES,
  USER_STATUS_FILTER_OPTIONS,
} from "./settings/constants";
import { CustomerEditPanel, SupplierEditPanel } from "./settings/customer-supplier-panels";
import {
  appendFilterParams,
  columnsFor,
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  customerFormFromRow,
  emptyCustomerForm,
  emptyFiltersForTab,
  emptyPagination,
  emptySupplierForm,
  emptyUserForm,
  exchangeFormFromSettings,
  filtersForTab,
  isSupplierAccountRole,
  kebabTab,
  notificationTemplateFormFromSettings,
  placeholderFor,
  resetFilters,
  rowsFor,
  shipsgoIntegrationFormFromSettings,
  supplierFormFromRow,
  supplierMatchesUserRole,
  userFormFromRow,
} from "./settings/helpers";
import {
  CommissionFormulaSettingsCard,
  CompanyProfileSettingsCard,
  ExchangeSettingsCard,
  NotificationTemplateSettingsCard,
  ShipsgoIntegrationSettingsCard,
} from "./settings/settings-cards";
import { SettingsTable } from "./settings/settings-table";
import type {
  AuditLogRow,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
  CustomerForm,
  CustomerRow,
  ExchangeRateForm,
  ExchangeRateSettings,
  FiltersFor,
  NotificationTemplateForm,
  NotificationTemplateSettings,
  Pagination,
  PermissionConfig,
  SalespersonOption,
  SettingsFilters,
  SettingsModuleProps,
  SettingsTabKey,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
  SupplierForm,
  SupplierRow,
  UserForm,
  UserRow,
} from "./settings/types";
import { UserEditPanel } from "./settings/user-edit-panel";

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
    setSupplierPanelMode("edit");
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
      const supplier = activeSuppliers.find((item) => item.id === userForm.supplierId)
        || suppliers.find((item) => item.id === userForm.supplierId);
      if (!supplierMatchesUserRole(supplier, userForm.role)) {
        setUserMessage(FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(userForm.role)
          ? "当前角色只能绑定产品供应商"
          : "当前角色只能绑定物流供应商");
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
        supplierId: isSupplierAccountRole(userForm.role) ? userForm.supplierId : "",
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
