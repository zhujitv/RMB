import { SideDetailDrawer } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { CustomerEditPanel, SupplierEditPanel } from "./customer-supplier-panels";
import { filtersForTab } from "./helpers";
import { SettingsTable } from "./settings-table";
import type { SupplierRow, UserRow } from "./types";
import { UserEditPanel } from "./user-edit-panel";
import type { useSettingsController } from "./use-settings-controller";

type SettingsController = ReturnType<typeof useSettingsController>;

export function SettingsEntityEditors({ settings }: { settings: SettingsController }) {
  const {
    activeTab,
    customerForm,
    customerSaving,
    customerMessage,
    supplierForm,
    supplierPanelMode,
    supplierSaving,
    supplierMessage,
    userForm,
    userSaving,
    userMessage,
    activeSuppliers,
    permissionConfig,
    setCustomerForm,
    setCustomerMessage,
    setSupplierForm,
    setSupplierPanelMode,
    setSupplierMessage,
    setUserForm,
    setSelectedUserId,
    setUserMessage,
    saveCustomerForm,
    saveSupplierForm,
    saveUserForm,
    closeSupplierPanel,
    cancelSupplierEdit,
    deleteRecord,
    userEditPanelRef,
  } = settings;

  return (
    <>
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
            salespeople={settings.salespeople}
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
  );
}

export function SettingsTableContent({ settings }: { settings: SettingsController }) {
  const {
    activeTab,
    currentRows,
    listColumns,
    loading,
    loadedTabs,
    activePagination,
    detailRow,
    filters,
    setDetailRow,
    startViewSupplier,
    startEditCustomer,
    startEditUser,
    deleteRecord,
    loadTab,
  } = settings;

  return (
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
        onDeleteUser={(user: UserRow) => void deleteRecord("user", user.id)}
        onPage={(nextPage) => loadTab(activeTab, nextPage, filtersForTab(filters, activeTab))}
      />
      <SettingsEntityEditors settings={settings} />
    </>
  );
}
