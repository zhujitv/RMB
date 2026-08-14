import styles from "../../WorkspaceShell.module.css";
import {
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  USER_ROLES,
  USER_STATUS_FILTER_OPTIONS,
} from "./constants";
import { placeholderFor } from "./helpers";
import type { SettingsTabKey } from "./types";
import type { useSettingsController } from "./use-settings-controller";

type SettingsController = ReturnType<typeof useSettingsController>;

export function SettingsModuleToolbar({
  settings,
  activeTab,
}: {
  settings: SettingsController;
  activeTab: SettingsTabKey;
}) {
  const {
    activeFilter,
    filters,
    loading,
    submitSearch,
    resetSearch,
    updateFilter,
  } = settings;

  return (
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
          <select value={filters.suppliers.type} onChange={(event) => updateFilter("suppliers", "type", event.target.value)}>
            <option value="">全部类型</option>
            {SUPPLIER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select value={filters.suppliers.status} onChange={(event) => updateFilter("suppliers", "status", event.target.value)}>
            <option value="">全部状态</option>
            {SUPPLIER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </>
      ) : null}
      {activeTab === "users" ? (
        <>
          <select value={filters.users.status} onChange={(event) => updateFilter("users", "status", event.target.value)}>
            <option value="">全部</option>
            {USER_STATUS_FILTER_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <select value={filters.users.role} onChange={(event) => updateFilter("users", "role", event.target.value)}>
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
  );
}
