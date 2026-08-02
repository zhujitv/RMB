import { useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { PermissionSelectItem } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { SHIPSGO_FEATURE_OPTIONS } from "./constants";
import { FreightowerSettingsCard } from "./freightower-settings-card";
import { shipsgoIntegrationFormFromSettings } from "./helpers";
import {
  SettingsCard,
  SettingsPage,
  SettingsSection,
  SettingsStatusTag,
  SettingsSwitch,
} from "./settings-layout";
import type { ShipsgoIntegrationForm, ShipsgoIntegrationSettings } from "./types";

export function FreightowerIntegrationSettingsCard({
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
  const [testing, setTesting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载物流接口设置</div>;
  const currentForm = form || shipsgoIntegrationFormFromSettings(settings);
  const hasFreightowerCredentials = Boolean(
    currentForm.freightowerApiKeyConfigured || currentForm.freightowerApiKey
  );
  const activeReady = hasFreightowerCredentials;
  const statusTone = currentForm.enabled ? (activeReady ? "success" : "warning") : "muted";
  const statusLabel = currentForm.enabled
    ? (activeReady ? "已启用飞驼可视" : "待完善飞驼可视凭据")
    : "已关闭";

  function setField<K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) {
    setConnectionMessage("");
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof SHIPSGO_FEATURE_OPTIONS[number]["key"]) {
    setField(key, !currentForm[key]);
  }

  async function testConnection() {
    setTesting(true);
    setConnectionMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>("/api/settings/freightower/test", {
        method: "POST",
        body: JSON.stringify(currentForm),
        timeoutMs: 20000,
      });
      if (result.success !== true) throw new Error(result.message || "连接测试失败");
      setConnectionMessage(result.message || "连接成功，飞驼 API Key 直连认证正常。");
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsPage
      title="物流接口"
      description="使用飞驼 API Key 直连查询接口，提供网页端海运跟踪、甩柜预警、手动同步和地图功能。"
      status={<SettingsStatusTag tone={statusTone}>{statusLabel}</SettingsStatusTag>}
      onSubmit={onSubmit}
      actions={(
        <>
          <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          <button className={styles.secondaryButton} type="button" onClick={() => void testConnection()} disabled={saving || testing || !hasFreightowerCredentials}>
            {testing ? "测试中..." : "测试 API 连接"}
          </button>
          <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复</button>
        </>
      )}
    >
      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}
      {connectionMessage ? (
        <div aria-live="polite" className={connectionMessage.includes("成功") ? styles.emptyState : styles.inlineError}>
          {connectionMessage}
        </div>
      ) : null}

      <SettingsCard title="基础配置" icon="船">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用飞驼可视物流跟踪"
            tooltip="关闭后物流信息页面不显示飞驼可视海运跟踪入口。"
            checked={currentForm.enabled}
            onChange={(value) => setField("enabled", value)}
          />
        </div>
      </SettingsCard>

      <FreightowerSettingsCard form={currentForm} onChange={setField} />

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
