import { DismissibleLayer, SideDetailDrawer } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { CustomerEditPanel, SupplierEditPanel } from "./customer-supplier-panels";
import { emptySupplierForm, filtersForTab, supplierFormFromRow } from "./helpers";
import { SettingsTable } from "./settings-table";
import type { SupplierForm, SupplierRow, UserRow } from "./types";
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
    setSupplierMessage,
    setUserForm,
    setSelectedUserId,
    setUserMessage,
    saveCustomerForm,
    saveSupplierForm,
    saveUserForm,
    closeSupplierPanel,
    deleteRecord,
    userEditPanelRef,
  } = settings;
  const supplierModalTitle = supplierForm?.id ? "编辑供应商" : "新建供应商";
  const savedSupplierForm = supplierForm?.id
    ? settings.suppliers.find((supplier) => supplier.id === supplierForm.id)
    : null;
  const supplierFormBaseline = savedSupplierForm ? supplierFormFromRow(savedSupplierForm) : emptySupplierForm();
  const supplierFormDirty = supplierForm ? !isSameSupplierForm(supplierForm, supplierFormBaseline) : false;

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
        <DismissibleLayer
          ariaLabel={supplierModalTitle}
          overlayClassName={styles.modalOverlay}
          surfaceClassName={styles.supplierSettingsModalCard}
          onClose={closeSupplierPanel}
          dismissible={!supplierSaving}
          dismissConfirmMessage={supplierFormDirty ? "表单已有修改，确认放弃修改吗？" : ""}
        >
          {({ requestClose }) => (
            <>
              <div className={styles.supplierSettingsModalHeader}>
                <div>
                  <strong id="supplier-settings-modal-title">{supplierModalTitle}</strong>
                  <span>供应商资料保存后会同步到系统设置列表。</span>
                </div>
                <button
                  className={styles.supplierSettingsModalClose}
                  type="button"
                  onClick={requestClose}
                  disabled={supplierSaving}
                  aria-label="关闭供应商弹窗"
                >
                  ×
                </button>
              </div>
              <SupplierEditPanel
                form={supplierForm}
                readOnly={false}
                saving={supplierSaving}
                message={supplierMessage}
                modal
                onChange={setSupplierForm}
                onSubmit={saveSupplierForm}
                onEdit={() => undefined}
                onDelete={() => supplierForm.id ? void deleteRecord("supplier", supplierForm.id) : undefined}
                onClose={requestClose}
                onCancel={requestClose}
              />
            </>
          )}
        </DismissibleLayer>
      ) : null}
      {activeTab === "suppliers" && !supplierForm && supplierMessage ? (
        <div className={styles.inlineSuccess}>{supplierMessage}</div>
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

function normalizeSupplierForm(form: SupplierForm) {
  return {
    ...form,
    allowedLogisticsCostTypes: [...form.allowedLogisticsCostTypes].sort(),
  };
}

function isSameSupplierForm(left: SupplierForm, right: SupplierForm) {
  return JSON.stringify(normalizeSupplierForm(left)) === JSON.stringify(normalizeSupplierForm(right));
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
    canForceDeleteRejectedUsers,
    setDetailRow,
    startViewSupplier,
    startEditCustomer,
    startEditUser,
    deleteRecord,
    forceDeleteRejectedUser,
    loadTab,
    forceDeletingRejectedUserId,
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
        onForceDeleteRejectedUser={(user: UserRow) => void forceDeleteRejectedUser(user)}
        forceDeletingRejectedUserId={forceDeletingRejectedUserId}
        canForceDeleteRejectedUsers={canForceDeleteRejectedUsers}
        onPage={(nextPage) => loadTab(activeTab, nextPage, filtersForTab(filters, activeTab))}
      />
      <SettingsEntityEditors settings={settings} />
    </>
  );
}
