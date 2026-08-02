import styles from "../../WorkspaceShell.module.css";
import { SETTINGS_TABS } from "./constants";
import { SettingsModuleTabContent } from "./module-tab-content";
import { SettingsModuleToolbar } from "./module-toolbar";
import type { useSettingsController } from "./use-settings-controller";
import { SETTINGS_PAGE_DESCRIPTIONS, TABLE_SETTING_TABS } from "./settings-view-constants";
import type { OcrValidationRulesDraft } from "./ocr-integration-settings-card";

type SettingsController = ReturnType<typeof useSettingsController> & {
  ocrValidationRulesDraft: OcrValidationRulesDraft;
  confirmDiscardCurrentSettings: () => boolean;
  setWechatSettingsDirty: (dirty: boolean) => void;
  setWechatSettingsBusy: (busy: boolean) => void;
};

export function SettingsModuleView(settings: SettingsController) {
  const {
    activeTab,
    loading,
    error,
    selectTab,
    refreshCurrent,
    startCreateCustomer,
    startCreateSupplier,
    startCreateUser,
    confirmDiscardCurrentSettings,
  } = settings;
  const activeTabLabel = SETTINGS_TABS.find((tab) => tab.key === activeTab)?.label || "系统设置";
  const isTableTab = TABLE_SETTING_TABS.has(activeTab);
  const showTopHeader = activeTab !== "ocrIntegration" && activeTab !== "shipsgoIntegration";

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
            <div className={styles.settingsHeaderActions}>
              <SettingsHeaderActions
                activeTab={activeTab}
                loading={loading}
                onCreateCustomer={() => {
                  if (confirmDiscardCurrentSettings()) startCreateCustomer();
                }}
                onCreateSupplier={() => {
                  if (confirmDiscardCurrentSettings()) startCreateSupplier();
                }}
                onCreateUser={() => {
                  if (confirmDiscardCurrentSettings()) startCreateUser();
                }}
                onRefresh={() => {
                  if (confirmDiscardCurrentSettings()) refreshCurrent();
                }}
              />
            </div>
          </div>
        ) : null}

        {isTableTab ? <SettingsModuleToolbar settings={settings} activeTab={activeTab} /> : null}
        {error ? <div className={styles.inlineError}>{error}</div> : null}
        <SettingsModuleTabContent settings={settings} />
      </div>
    </section>
  );
}

function SettingsHeaderActions({
  activeTab,
  loading,
  onCreateCustomer,
  onCreateSupplier,
  onCreateUser,
  onRefresh,
}: {
  activeTab: string;
  loading: boolean;
  onCreateCustomer: () => void;
  onCreateSupplier: () => void;
  onCreateUser: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      {activeTab === "customers" ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={onCreateCustomer}>新建客户</button>
      ) : null}
      {activeTab === "suppliers" ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={onCreateSupplier}>新建供应商</button>
      ) : null}
      {activeTab === "users" ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={onCreateUser}>新建用户</button>
      ) : null}
      {activeTab !== "home" ? (
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={onRefresh}>
          {loading ? "刷新中..." : "刷新当前页"}
        </button>
      ) : null}
    </>
  );
}
