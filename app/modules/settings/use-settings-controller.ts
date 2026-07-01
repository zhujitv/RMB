import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../../api";
import type { CompanyProfileSettings } from "../../types";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../../lib/password-policy";
import {
  API_PERFORMANCE_PAGE_SIZE,
  AUDIT_PAGE_SIZE,
  DEFAULT_OCR_INTEGRATION_FORM,
  DEFAULT_SHIPSGO_INTEGRATION_FORM,
  FACTORY_SUPPLIER_ACCOUNT_ROLES,
  PAGE_SIZE,
} from "./constants";
import {
  appendFilterParams,
  businessEntityFormFromRow,
  columnsFor,
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  customerFormFromRow,
  emptyBusinessEntityForm,
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
  notificationTemplateRows,
  ocrIntegrationFormFromSettings,
  resetFilters,
  rowsFor,
  shipsgoIntegrationFormFromSettings,
  supplierFormFromRow,
  supplierMatchesUserRole,
  userFormFromRow,
} from "./helpers";
import type {
  ApiPerformanceRow,
  AuditLogRow,
  BusinessEntityForm,
  BusinessEntityRow,
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
  OcrIntegrationForm,
  OcrIntegrationSettings,
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
} from "./types";

export function useSettingsController({ onCompanyProfileSaved }: SettingsModuleProps = {}) {

  const [activeTab, setActiveTab] = useState<SettingsTabKey>("home");
  const [filters, setFilters] = useState<SettingsFilters>({
    customers: { keyword: "" },
    suppliers: { keyword: "", type: "", status: "" },
    users: { keyword: "", role: "", status: "" },
    auditLogs: { keyword: "", action: "" },
    apiPerformance: { keyword: "", source: "", minDurationMs: "", windowHours: "24" },
  });

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [apiPerformance, setApiPerformance] = useState<ApiPerformanceRow[]>([]);
  const [companyProfileSettings, setCompanyProfileSettings] = useState<CompanyProfileSettings | null>(null);
  const [companyProfileForm, setCompanyProfileForm] = useState<CompanyProfileForm | null>(null);
  const [exchangeSettings, setExchangeSettings] = useState<ExchangeRateSettings | null>(null);
  const [exchangeForm, setExchangeForm] = useState<ExchangeRateForm | null>(null);
  const [commissionFormulaSettings, setCommissionFormulaSettings] = useState<CommissionFormulaSettings | null>(null);
  const [commissionFormulaForm, setCommissionFormulaForm] = useState<CommissionFormulaForm | null>(null);
  const [notificationTemplateSettings, setNotificationTemplateSettings] = useState<NotificationTemplateSettings | null>(null);
  const [notificationTemplateForm, setNotificationTemplateForm] = useState<NotificationTemplateForm | null>(null);
  const [selectedNotificationTemplateType, setSelectedNotificationTemplateType] = useState("");
  const [ocrIntegrationSettings, setOcrIntegrationSettings] = useState<OcrIntegrationSettings | null>(null);
  const [ocrIntegrationForm, setOcrIntegrationForm] = useState<OcrIntegrationForm | null>(null);
  const [shipsgoIntegrationSettings, setShipsgoIntegrationSettings] = useState<ShipsgoIntegrationSettings | null>(null);
  const [shipsgoIntegrationForm, setShipsgoIntegrationForm] = useState<ShipsgoIntegrationForm | null>(null);
  const [permissionConfig, setPermissionConfig] = useState<PermissionConfig | null>(null);
  const [salespeople, setSalespeople] = useState<SalespersonOption[]>([]);

  const [pagination, setPagination] = useState<Record<SettingsTabKey, Pagination>>({
    home: emptyPagination(PAGE_SIZE),
    companyProfile: emptyPagination(PAGE_SIZE),
    businessEntities: emptyPagination(PAGE_SIZE),
    customers: emptyPagination(PAGE_SIZE),
    suppliers: emptyPagination(PAGE_SIZE),
    users: emptyPagination(PAGE_SIZE),
    ocrIntegration: emptyPagination(PAGE_SIZE),
    exchangeRates: emptyPagination(PAGE_SIZE),
    commissionFormula: emptyPagination(PAGE_SIZE),
    notificationTemplates: emptyPagination(PAGE_SIZE),
    shipsgoIntegration: emptyPagination(PAGE_SIZE),
    auditLogs: emptyPagination(AUDIT_PAGE_SIZE),
    apiPerformance: emptyPagination(API_PERFORMANCE_PAGE_SIZE),
  });
  const [loadedTabs, setLoadedTabs] = useState<Set<SettingsTabKey>>(new Set());
  const [detailRow, setDetailRow] = useState<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerForm | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");
  const [businessEntityForm, setBusinessEntityForm] = useState<BusinessEntityForm | null>(null);
  const [businessEntitySaving, setBusinessEntitySaving] = useState(false);
  const [businessEntityMessage, setBusinessEntityMessage] = useState("");
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
  const [ocrIntegrationSaving, setOcrIntegrationSaving] = useState(false);
  const [ocrIntegrationMessage, setOcrIntegrationMessage] = useState("");
  const [shipsgoIntegrationSaving, setShipsgoIntegrationSaving] = useState(false);
  const [shipsgoIntegrationMessage, setShipsgoIntegrationMessage] = useState("");
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activePagination = pagination[activeTab] || emptyPagination(PAGE_SIZE);
  const listColumns = useMemo(() => columnsFor(activeTab), [activeTab]);
  const currentRows = useMemo(() => rowsFor(activeTab, { customers, suppliers, users, logs, apiPerformance }), [activeTab, customers, suppliers, users, logs, apiPerformance]);
  const activeFilter = activeTab === "customers"
    ? filters.customers
    : activeTab === "suppliers"
      ? filters.suppliers
      : activeTab === "users"
        ? filters.users
        : activeTab === "apiPerformance"
          ? filters.apiPerformance
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
      if (tab === "home") {
        markLoaded(tab);
        return;
      }
      if (tab === "companyProfile") {
        const result = await apiJson<{ settings: CompanyProfileSettings }>("/api/settings/company-profile");
        const settings = result.settings || {};
        setCompanyProfileSettings(settings);
        setCompanyProfileForm(companyProfileFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "businessEntities") {
        const result = await apiJson<{ entities?: BusinessEntityRow[] }>("/api/settings/business-entities");
        setBusinessEntities(result.entities || []);
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
        const templates = notificationTemplateRows(settings);
        const nextType = selectedNotificationTemplateType && templates.some((template) => template.type === selectedNotificationTemplateType)
          ? selectedNotificationTemplateType
          : templates[0]?.type || "";
        setNotificationTemplateSettings(settings);
        setSelectedNotificationTemplateType(nextType);
        setNotificationTemplateForm(notificationTemplateFormFromSettings(settings, nextType));
        markLoaded(tab);
        return;
      }
      if (tab === "ocrIntegration") {
        const ocrResult = await apiJson<{ settings: OcrIntegrationSettings }>("/api/settings/ocr");
        const ocrSettings = ocrResult.settings || {};
        setOcrIntegrationSettings(ocrSettings);
        setOcrIntegrationForm(ocrIntegrationFormFromSettings(ocrSettings));
        markLoaded(tab);
        return;
      }
      if (tab === "shipsgoIntegration") {
        const shipsgoResult = await apiJson<{ settings: ShipsgoIntegrationSettings }>("/api/settings/shipsgo");
        const settings = shipsgoResult.settings || {};
        setShipsgoIntegrationSettings(settings);
        setShipsgoIntegrationForm(shipsgoIntegrationFormFromSettings(settings));
        markLoaded(tab);
        return;
      }
      if (tab === "users") {
        await ensurePermissionConfig();
      }
      const pageSize = tab === "auditLogs"
        ? AUDIT_PAGE_SIZE
        : tab === "apiPerformance"
          ? API_PERFORMANCE_PAGE_SIZE
          : PAGE_SIZE;
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      appendFilterParams(params, tab, nextFilters);
      const result = await apiJson<{
        customers?: CustomerRow[];
        suppliers?: SupplierRow[];
        users?: UserRow[];
        logs?: AuditLogRow[];
        metrics?: ApiPerformanceRow[];
        pagination?: Pagination;
      }>(`/api/settings/${kebabTab(tab)}?${params}`);
      if (tab === "customers") {
        setCustomers(result.customers || []);
        setSalespeople((result as { salespeople?: SalespersonOption[] }).salespeople || []);
      }
      if (tab === "suppliers") setSuppliers(result.suppliers || []);
      if (tab === "users") setUsers(result.users || []);
      if (tab === "auditLogs") setLogs(result.logs || []);
      if (tab === "apiPerformance") setApiPerformance(result.metrics || []);
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
    setBusinessEntityForm(null);
    setBusinessEntityMessage("");
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
    setOcrIntegrationMessage("");
    setShipsgoIntegrationMessage("");
  }

  function submitSearch() {
    if (activeTab === "home") return;
    void loadTab(activeTab, 1, filtersForTab(filters, activeTab));
  }

  function resetSearch() {
    if (activeTab === "home") return;
    setFilters((current) => resetFilters(current, activeTab));
    void loadTab(activeTab, 1, emptyFiltersForTab(activeTab));
  }

  function refreshCurrent() {
    if (activeTab === "home") return;
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

  function startCreateBusinessEntity() {
    setActiveTab("businessEntities");
    setDetailRow(null);
    setBusinessEntityMessage("");
    setBusinessEntityForm(emptyBusinessEntityForm());
  }

  function startEditBusinessEntity(entity: BusinessEntityRow) {
    setActiveTab("businessEntities");
    setDetailRow(null);
    setBusinessEntityMessage("");
    setBusinessEntityForm(businessEntityFormFromRow(entity));
  }

  function cancelBusinessEntityEdit() {
    setBusinessEntityForm(null);
    setBusinessEntityMessage("");
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

  async function saveBusinessEntityForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessEntityForm) return;
    if (!businessEntityForm.name.trim()) {
      setBusinessEntityMessage("请填写公司全称");
      return;
    }
    setBusinessEntitySaving(true);
    setBusinessEntityMessage("");
    try {
      const isEdit = Boolean(businessEntityForm.id);
      const result = await apiJson<{ success?: boolean; message?: string; entity?: BusinessEntityRow }>(
        "/api/settings/business-entities",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            id: businessEntityForm.id || undefined,
            name: businessEntityForm.name,
            shortName: businessEntityForm.shortName,
            isDefault: businessEntityForm.isDefault,
            status: businessEntityForm.status,
            sortOrder: Number(businessEntityForm.sortOrder || 0),
            remark: businessEntityForm.remark,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "业务主体保存失败");
      const savedEntity = result.entity;
      if (savedEntity?.id) {
        setBusinessEntities((current) => {
          const withoutSaved = current.filter((entity) => entity.id !== savedEntity.id);
          const normalized = savedEntity.isDefault
            ? withoutSaved.map((entity) => ({ ...entity, isDefault: false }))
            : withoutSaved;
          return [savedEntity, ...normalized].sort((a, b) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
          });
        });
        setBusinessEntityForm(businessEntityFormFromRow(savedEntity));
      }
      setBusinessEntityMessage(result.message || "业务主体已保存");
      markLoaded("businessEntities");
    } catch (saveError) {
      setBusinessEntityMessage(saveError instanceof Error ? saveError.message : "业务主体保存失败");
    } finally {
      setBusinessEntitySaving(false);
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
      const nextType = notificationTemplateForm.type || selectedNotificationTemplateType;
      setNotificationTemplateSettings(nextSettings);
      setSelectedNotificationTemplateType(nextType);
      setNotificationTemplateForm(notificationTemplateFormFromSettings(nextSettings, nextType));
      markLoaded("notificationTemplates");
      setNotificationTemplateMessage(result.message || "通知模板已保存");
    } catch (saveError) {
      setNotificationTemplateMessage(saveError instanceof Error ? saveError.message : "通知模板保存失败");
    } finally {
      setNotificationTemplateSaving(false);
    }
  }

  function selectNotificationTemplate(type: string) {
    setSelectedNotificationTemplateType(type);
    setNotificationTemplateForm(notificationTemplateFormFromSettings(notificationTemplateSettings, type));
    setNotificationTemplateMessage("");
  }

  async function testNotificationTemplate() {
    if (!notificationTemplateForm) return;
    setNotificationTemplateSaving(true);
    setNotificationTemplateMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        "/api/settings/notification-templates/test",
        {
          method: "POST",
          body: JSON.stringify(notificationTemplateForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "测试邮件发送失败");
      const nextSettings = await fetchNotificationTemplateSettings();
      setNotificationTemplateSettings(nextSettings);
      setNotificationTemplateForm(notificationTemplateFormFromSettings(nextSettings, notificationTemplateForm.type));
      setNotificationTemplateMessage(result.message || "测试邮件已发送");
    } catch (sendError) {
      setNotificationTemplateMessage(sendError instanceof Error ? sendError.message : "测试邮件发送失败");
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

  async function saveOcrIntegrationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ocrIntegrationForm) return;
    setOcrIntegrationSaving(true);
    setOcrIntegrationMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: OcrIntegrationSettings; message?: string }>(
        "/api/settings/ocr",
        {
          method: "PATCH",
          body: JSON.stringify({
            ...ocrIntegrationForm,
            timeoutMs: Number(ocrIntegrationForm.timeoutMs || DEFAULT_OCR_INTEGRATION_FORM.timeoutMs),
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "OCR设置保存失败");
      const nextSettings = result.settings || ocrIntegrationForm;
      setOcrIntegrationSettings(nextSettings);
      setOcrIntegrationForm(ocrIntegrationFormFromSettings(nextSettings));
      markLoaded("ocrIntegration");
      setOcrIntegrationMessage(result.message || "OCR设置已保存");
    } catch (saveError) {
      setOcrIntegrationMessage(saveError instanceof Error ? saveError.message : "OCR设置保存失败");
    } finally {
      setOcrIntegrationSaving(false);
    }
  }


  function updateFilter(tab: SettingsTabKey, key: string, value: string) {
    setFilters((current) => {
      if (tab === "customers") return { ...current, customers: { ...current.customers, [key]: value } };
      if (tab === "suppliers") return { ...current, suppliers: { ...current.suppliers, [key]: value } };
      if (tab === "users") return { ...current, users: { ...current.users, [key]: value } };
      if (tab === "apiPerformance") return { ...current, apiPerformance: { ...current.apiPerformance, [key]: value } };
      return { ...current, auditLogs: { ...current.auditLogs, [key]: value } };
    });
  }

  return {
    activeTab,
    filters,
    customers,
    businessEntities,
    suppliers,
    users,
    logs,
    apiPerformance,
    companyProfileSettings,
    companyProfileForm,
    exchangeSettings,
    exchangeForm,
    commissionFormulaSettings,
    commissionFormulaForm,
    notificationTemplateSettings,
    notificationTemplateForm,
    selectedNotificationTemplateType,
    ocrIntegrationSettings,
    ocrIntegrationForm,
    shipsgoIntegrationSettings,
    shipsgoIntegrationForm,
    permissionConfig,
    salespeople,
    pagination,
    loadedTabs,
    detailRow,
    customerForm,
    customerSaving,
    customerMessage,
    businessEntityForm,
    businessEntitySaving,
    businessEntityMessage,
    supplierForm,
    supplierPanelMode,
    supplierSaving,
    supplierMessage,
    userForm,
    selectedUserId,
    userSaving,
    userMessage,
    companyProfileSaving,
    companyProfileMessage,
    exchangeSaving,
    exchangeRefreshing,
    exchangeMessage,
    commissionFormulaSaving,
    commissionFormulaMessage,
    notificationTemplateSaving,
    notificationTemplateMessage,
    ocrIntegrationSaving,
    ocrIntegrationMessage,
    shipsgoIntegrationSaving,
    shipsgoIntegrationMessage,
    activeSuppliers,
    loading,
    error,
    activePagination,
    listColumns,
    currentRows,
    activeFilter,
    userEditPanelRef,
    loadTab,
    selectTab,
    submitSearch,
    resetSearch,
    refreshCurrent,
    refreshExchangeRatesManually,
    deleteRecord,
    startCreateCustomer,
    startCreateBusinessEntity,
    startEditBusinessEntity,
    cancelBusinessEntityEdit,
    startCreateSupplier,
    startCreateUser,
    startEditCustomer,
    startViewSupplier,
    closeSupplierPanel,
    cancelSupplierEdit,
    startEditUser,
    saveCustomerForm,
    saveBusinessEntityForm,
    saveSupplierForm,
    saveUserForm,
    saveCompanyProfileSettings,
    saveExchangeSettings,
    saveCommissionFormulaSettings,
    saveNotificationTemplateSettings,
    selectNotificationTemplate,
    testNotificationTemplate,
    saveOcrIntegrationSettings,
    saveShipsgoIntegrationSettings,
    updateFilter,
    setDetailRow,
    setCustomerForm,
    setCustomerMessage,
    setBusinessEntityForm,
    setBusinessEntityMessage,
    setSupplierForm,
    setSupplierPanelMode,
    setSupplierMessage,
    setUserForm,
    setSelectedUserId,
    setUserMessage,
    setCompanyProfileForm,
    setCompanyProfileMessage,
    setExchangeForm,
    setExchangeMessage,
    setCommissionFormulaForm,
    setCommissionFormulaMessage,
    setNotificationTemplateForm,
    setNotificationTemplateMessage,
    setOcrIntegrationForm,
    setOcrIntegrationMessage,
    setShipsgoIntegrationForm,
    setShipsgoIntegrationMessage,
  };
}
