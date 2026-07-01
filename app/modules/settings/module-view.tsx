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
} from "./helpers";
import {
  CommissionFormulaSettingsCard,
  BusinessEntitySettingsCard,
  CompanyProfileSettingsCard,
  ExchangeSettingsCard,
  NotificationTemplateSettingsCard,
  OcrIntegrationSettingsCard,
  ShipsgoIntegrationSettingsCard,
} from "./settings-cards";
import { SettingsTable } from "./settings-table";
import type { SupplierRow } from "./types";
import { UserEditPanel } from "./user-edit-panel";
import type { useSettingsController } from "./use-settings-controller";

type SettingsController = ReturnType<typeof useSettingsController>;

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
  } = settings;

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

      {activeTab !== "companyProfile" && activeTab !== "businessEntities" && activeTab !== "exchangeRates" && activeTab !== "commissionFormula" && activeTab !== "notificationTemplates" && activeTab !== "shipsgoIntegration" ? (
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
      ) : activeTab === "shipsgoIntegration" ? (
        <>
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
        </>
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
}
