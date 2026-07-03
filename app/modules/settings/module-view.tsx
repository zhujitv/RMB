import { SideDetailDrawer } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import {
  API_PERFORMANCE_SOURCE_OPTIONS,
  API_PERFORMANCE_WINDOW_OPTIONS,
  SETTINGS_TABS,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  USER_ROLES,
  USER_STATUS_FILTER_OPTIONS,
} from "./constants";
import { CustomerEditPanel, SupplierEditPanel } from "./customer-supplier-panels";
import {
  commissionFormulaFormFromSettings,
  companyProfileFormFromSettings,
  exchangeFormFromSettings,
  filtersForTab,
  notificationTemplateFormFromSettings,
  ocrIntegrationFormFromSettings,
  placeholderFor,
  shipsgoIntegrationFormFromSettings,
  taxRefundFeatureFormFromSettings,
} from "./helpers";
import {
  CommissionFormulaSettingsCard,
  BusinessEntitySettingsCard,
  CompanyProfileSettingsCard,
  ExchangeSettingsCard,
  NotificationTemplateSettingsCard,
  OcrIntegrationSettingsCard,
  ShipsgoIntegrationSettingsCard,
  TaxRefundFeatureSettingsCard,
} from "./settings-cards";
import { SettingsTable } from "./settings-table";
import type { SettingsTabKey, SupplierRow } from "./types";
import { UserEditPanel } from "./user-edit-panel";
import type { useSettingsController } from "./use-settings-controller";

type SettingsController = ReturnType<typeof useSettingsController>;

const SETTINGS_HOME_CARDS: Array<{ tab: SettingsTabKey; title: string; description: string; icon: string }> = [
  { tab: "companyProfile", title: "公司资料", description: "公司信息、Logo、联系信息", icon: "企" },
  { tab: "businessEntities", title: "业务主体", description: "业务主体管理", icon: "主" },
  { tab: "customers", title: "客户资料", description: "客户管理", icon: "客" },
  { tab: "suppliers", title: "供应商资料", description: "供应商管理", icon: "供" },
  { tab: "users", title: "用户与权限", description: "角色权限", icon: "权" },
  { tab: "taxRefundFeatures", title: "企业HS编码", description: "企业HS编码库入口", icon: "HS" },
  { tab: "ocrIntegration", title: "OCR识别", description: "OCR 服务配置", icon: "OCR" },
  { tab: "shipsgoIntegration", title: "物流接口", description: "大掌柜、ShipsGo", icon: "船" },
  { tab: "notificationTemplates", title: "通知模板", description: "邮件模板", icon: "邮" },
  { tab: "exchangeRates", title: "汇率设置", description: "汇率", icon: "汇" },
  { tab: "commissionFormula", title: "提成公式", description: "提成计算", icon: "提" },
  { tab: "auditLogs", title: "系统日志", description: "日志", icon: "志" },
  { tab: "apiPerformance", title: "后台任务", description: "慢任务", icon: "任" },
];

const SETTINGS_PAGE_DESCRIPTIONS: Record<SettingsTabKey, string> = {
  home: "按模块进入配置，减少长表单堆叠，保持系统设置清晰可维护。",
  companyProfile: "维护平台展示所需的公司基础信息。",
  businessEntities: "管理业务主体简称、全称和默认主体。",
  customers: "维护客户资料、自动通知和负责业务员。",
  suppliers: "维护产品供应商、物流供应商和业务权限。",
  users: "维护用户账号、角色权限和供应商绑定。",
  taxRefundFeatures: "维护企业HS编码库入口。",
  ocrIntegration: "维护 OCR 服务配置、密钥和识别能力。",
  shipsgoIntegration: "维护大掌柜海运跟踪接口和同步能力。",
  notificationTemplates: "维护系统邮件模板和发送规则。",
  exchangeRates: "维护汇率来源、手动刷新和基础业务开关。",
  commissionFormula: "维护业务员提成计算规则。",
  auditLogs: "查看关键操作日志。",
  apiPerformance: "查看慢接口和后台任务执行情况。",
};

const TABLE_SETTING_TABS = new Set<SettingsTabKey>(["customers", "suppliers", "users", "auditLogs", "apiPerformance"]);

export function SettingsModuleView(settings: SettingsController) {
  const {
    activeTab,
    filters,
    businessEntities,
    companyProfileSettings,
    companyProfileForm,
    exchangeSettings,
    exchangeForm,
    commissionFormulaSettings,
    commissionFormulaForm,
    notificationTemplateSettings,
    notificationTemplateForm,
    selectedNotificationTemplateType,
    taxRefundFeatureSettings,
    taxRefundFeatureForm,
    ocrIntegrationSettings,
    ocrIntegrationForm,
    shipsgoIntegrationSettings,
    shipsgoIntegrationForm,
    permissionConfig,
    salespeople,
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
    taxRefundFeatureSaving,
    taxRefundFeatureMessage,
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
    saveTaxRefundFeatureSettings,
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
    setTaxRefundFeatureForm,
    setTaxRefundFeatureMessage,
    setShipsgoIntegrationForm,
    setShipsgoIntegrationMessage,
  } = settings;
  const activeTabLabel = SETTINGS_TABS.find((tab) => tab.key === activeTab)?.label || "系统设置";
  const isTableTab = TABLE_SETTING_TABS.has(activeTab);
  const showTopHeader = activeTab !== "ocrIntegration" && activeTab !== "shipsgoIntegration" && activeTab !== "taxRefundFeatures";
  const headerActions = (
    <>
      {activeTab === "customers" ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={startCreateCustomer}>新建客户</button>
      ) : null}
      {activeTab === "suppliers" ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={startCreateSupplier}>新建供应商</button>
      ) : null}
      {activeTab === "users" ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={startCreateUser}>新建用户</button>
      ) : null}
      {activeTab !== "home" ? (
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={refreshCurrent}>
          {loading ? "刷新中..." : "刷新当前页"}
        </button>
      ) : null}
    </>
  );

  return (
    <section className={`${styles.moduleCard} ${styles.settingsCenterShell}`}>
      <aside className={styles.settingsCenterNav}>
        <div className={styles.settingsCenterNavHeader}>
          <strong>系统设置菜单</strong>
          <span>Settings</span>
        </div>
        <nav>
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`${styles.settingsCenterNavButton} ${tab.key === activeTab ? styles.settingsCenterNavButtonActive : ""}`}
              type="button"
              onClick={() => selectTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className={styles.settingsCenterMain}>
        {showTopHeader ? (
          <div className={styles.settingsPageHeader}>
            <div>
              <h2>{activeTab === "home" ? "系统设置中心" : activeTabLabel}</h2>
              <p>{SETTINGS_PAGE_DESCRIPTIONS[activeTab]}</p>
              <div className={styles.settingsPageMeta}>
                <span>最后修改：-</span>
                <span>保存状态：待操作</span>
              </div>
            </div>
            <div className={styles.settingsHeaderActions}>{headerActions}</div>
          </div>
        ) : null}

        {activeTab === "home" ? (
          <div className={styles.settingsHomeGrid}>
            {SETTINGS_HOME_CARDS.map((card) => (
              <button
                key={card.title}
                type="button"
                className={styles.settingsHomeCard}
                onClick={() => selectTab(card.tab)}
              >
                <span className={styles.settingsHomeIcon}>{card.icon}</span>
                <span>
                  <strong>{card.title}</strong>
                  <small>{card.description}</small>
                </span>
                <span className={styles.settingsHomeArrow}>进入</span>
              </button>
            ))}
          </div>
        ) : null}

        {isTableTab ? (
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
                <option value="">全部</option>
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
          {activeTab === "apiPerformance" ? (
            <>
              <select
                value={filters.apiPerformance.source}
                onChange={(event) => updateFilter("apiPerformance", "source", event.target.value)}
              >
                {API_PERFORMANCE_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={filters.apiPerformance.windowHours}
                onChange={(event) => updateFilter("apiPerformance", "windowHours", event.target.value)}
              >
                {API_PERFORMANCE_WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                value={filters.apiPerformance.minDurationMs}
                onChange={(event) => updateFilter("apiPerformance", "minDurationMs", event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitSearch();
                }}
                placeholder="最小耗时 ms"
              />
            </>
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
      {activeTab === "home" ? null : activeTab === "companyProfile" ? (
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
      ) : activeTab === "businessEntities" ? (
        <BusinessEntitySettingsCard
          entities={businessEntities}
          form={businessEntityForm}
          loading={loading && !loadedTabs.has("businessEntities")}
          saving={businessEntitySaving}
          message={businessEntityMessage}
          onChange={setBusinessEntityForm}
          onCreate={startCreateBusinessEntity}
          onEdit={startEditBusinessEntity}
          onCancel={cancelBusinessEntityEdit}
          onSubmit={saveBusinessEntityForm}
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
          selectedType={selectedNotificationTemplateType}
          loading={loading && !notificationTemplateSettings}
          saving={notificationTemplateSaving}
          message={notificationTemplateMessage}
          onChange={setNotificationTemplateForm}
          onSelectType={selectNotificationTemplate}
          onReset={() => {
            setNotificationTemplateForm(notificationTemplateFormFromSettings(notificationTemplateSettings, selectedNotificationTemplateType));
            setNotificationTemplateMessage("");
          }}
          onTestSend={() => void testNotificationTemplate()}
          onSubmit={saveNotificationTemplateSettings}
        />
      ) : activeTab === "taxRefundFeatures" ? (
        <TaxRefundFeatureSettingsCard
          settings={taxRefundFeatureSettings}
          form={taxRefundFeatureForm}
          loading={loading && !taxRefundFeatureSettings}
          saving={taxRefundFeatureSaving}
          message={taxRefundFeatureMessage}
          onChange={setTaxRefundFeatureForm}
          onReset={() => {
            setTaxRefundFeatureForm(taxRefundFeatureFormFromSettings(taxRefundFeatureSettings));
            setTaxRefundFeatureMessage("");
          }}
          onSubmit={saveTaxRefundFeatureSettings}
        />
      ) : activeTab === "ocrIntegration" ? (
        <OcrIntegrationSettingsCard
          settings={ocrIntegrationSettings}
          form={ocrIntegrationForm}
          loading={loading && !ocrIntegrationSettings}
          saving={ocrIntegrationSaving}
          message={ocrIntegrationMessage}
          onChange={setOcrIntegrationForm}
          onReset={() => {
            setOcrIntegrationForm(ocrIntegrationFormFromSettings(ocrIntegrationSettings));
            setOcrIntegrationMessage("");
          }}
          onSubmit={saveOcrIntegrationSettings}
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
      </div>
    </section>
  );
}
