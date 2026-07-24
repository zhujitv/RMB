import type { FormEvent } from "react";
import { useState } from "react";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../../lib/password-policy";
import { PermissionSelectItem } from "../../components";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import styles from "../../WorkspaceShell.module.css";
import { FACTORY_SUPPLIER_ACCOUNT_ROLES, USER_APPROVAL_STATUS_OPTIONS, USER_ROLES } from "./constants";
import { dataScopeLabel, fuzzyIncludes, isSupplierAccountRole, permissionDefaultsForRole, supplierMatchesUserRole, supplierOptionLabel } from "./helpers";
import { PermissionChoiceGroup } from "./permission-choice-group";
import type { PermissionConfig, SupplierRow, UserForm } from "./types";

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

export function UserEditPanel({
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

  const bindableSuppliers = suppliers.filter((supplier) => supplierMatchesUserRole(supplier, form.role));
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
                    ? "请先在供应商资料中建立产品供应商"
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
