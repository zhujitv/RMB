import type { FormEvent } from "react";
import { PermissionSelectItem } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import {
  SHIPSGO_FEATURE_OPTIONS,
  TRACKING_PROVIDER_OPTIONS,
} from "./constants";
import { FreightowerSettingsCard } from "./freightower-settings-card";
import { shipsgoIntegrationFormFromSettings } from "./helpers";
import {
  SecretField,
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsSection,
  SettingsStatusTag,
  SettingsSwitch,
} from "./settings-layout";
import type { ShipsgoIntegrationForm, ShipsgoIntegrationSettings } from "./types";

export function ShipsgoIntegrationSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: ShipsgoIntegrationSettings | null;
  form: ShipsgoIntegrationForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: ShipsgoIntegrationForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载物流接口设置</div>;
  const currentForm = form || shipsgoIntegrationFormFromSettings(settings);
  const activeProvider = currentForm.activeProvider === "FREIGHTOWER" ? "FREIGHTOWER" : "SHIPSGO";
  const hasShipsgoApiKey = Boolean(currentForm.apiKeyConfigured || currentForm.apiKey);
  const hasFreightowerCredentials = Boolean(
    (currentForm.freightowerClientIdConfigured || currentForm.freightowerClientId)
    && (currentForm.freightowerSecretConfigured || currentForm.freightowerSecret),
  );
  const activeReady = activeProvider === "FREIGHTOWER"
    ? currentForm.freightowerEnabled && hasFreightowerCredentials
    : currentForm.shipsgoEnabled && hasShipsgoApiKey;
  const statusTone = currentForm.enabled ? (activeReady ? "success" : "warning") : "muted";
  const statusLabel = currentForm.enabled
    ? (activeReady ? `已启用 ${activeProvider === "FREIGHTOWER" ? "飞驼可视" : "ShipsGo"}` : "待完善当前接口配置")
    : "已关闭";

  function setField<K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof SHIPSGO_FEATURE_OPTIONS[number]["key"]) {
    setField(key, !currentForm[key]);
  }

  return (
    <SettingsPage
      title="物流接口"
      description="管理 ShipsGo 与飞驼可视海运跟踪接口、同步策略和前台功能开关。"
      status={<SettingsStatusTag tone={statusTone}>{statusLabel}</SettingsStatusTag>}
      onSubmit={onSubmit}
      actions={(
        <>
          <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复</button>
        </>
      )}
    >
      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <SettingsCard title="基础配置" icon="船">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用物流跟踪接口"
            tooltip="关闭后物流信息页面不显示第三方海运跟踪入口。"
            checked={currentForm.enabled}
            onChange={(value) => setField("enabled", value)}
          />
          <SettingsField label="当前使用接口">
            <select
              value={activeProvider}
              onChange={(event) => setField("activeProvider", event.target.value)}
            >
              {TRACKING_PROVIDER_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </SettingsField>
          <SettingsField label="剩余 Credit 预警阈值">
            <input
              value={currentForm.creditWarningThreshold}
              onChange={(event) => setField("creditWarningThreshold", event.target.value)}
              inputMode="numeric"
              min={0}
              type="number"
            />
          </SettingsField>
          <SettingsField label="每日同步时间">
            <input
              value={currentForm.dailySyncTime}
              onChange={(event) => setField("dailySyncTime", event.target.value)}
              type="time"
            />
          </SettingsField>
        </div>
        <SettingsSection title="接口选择">
          <div className={styles.commissionDeductionGrid}>
            {TRACKING_PROVIDER_OPTIONS.map((item) => (
              <PermissionSelectItem
                key={item.value}
                label={item.label}
                description={item.description}
                checked={activeProvider === item.value}
                onChange={() => setField("activeProvider", item.value)}
              />
            ))}
          </div>
        </SettingsSection>
      </SettingsCard>

      <SettingsCard title="ShipsGo 接口" icon="Key">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用 ShipsGo"
            tooltip="关闭后不会使用 ShipsGo 创建新跟踪，但历史记录仍保留。"
            checked={currentForm.shipsgoEnabled}
            onChange={(value) => setField("shipsgoEnabled", value)}
          />
          <SettingsField label="API Base URL">
            <input
              value={currentForm.apiBaseUrl}
              onChange={(event) => setField("apiBaseUrl", event.target.value)}
              placeholder="https://api.shipsgo.com"
            />
          </SettingsField>
          <SettingsField label="API Key">
            <SecretField
              value={currentForm.apiKey}
              onChange={(value) => setField("apiKey", value)}
              placeholder={currentForm.apiKeyConfigured ? "已配置，留空则保持不变" : "请输入大掌櫃 API Key"}
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <FreightowerSettingsCard form={currentForm} onChange={setField} />

      <SettingsCard title="推送密钥" icon="Key">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="Webhook Secret">
            <SecretField
              value={currentForm.webhookSecret}
              onChange={(value) => setField("webhookSecret", value)}
              placeholder={currentForm.webhookSecretConfigured ? "已配置，留空则保持不变" : "用于校验大掌櫃 Webhook"}
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard title="前台功能显示" icon="显">
        <SettingsSection title="启用范围">
          <div className={styles.commissionDeductionGrid}>
            {SHIPSGO_FEATURE_OPTIONS.map((item) => (
              <PermissionSelectItem
                key={item.key}
                label={item.label}
                description={item.description}
                checked={Boolean(currentForm[item.key])}
                onChange={() => toggleFeature(item.key)}
              />
            ))}
          </div>
        </SettingsSection>
      </SettingsCard>

    </SettingsPage>
  );
}
