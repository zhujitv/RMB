import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import styles from "../../WorkspaceShell.module.css";
import { SecretField, SettingsCard, SettingsField, SettingsSection, SettingsSwitch } from "./settings-layout";

type WechatOfficialSettings = {
  enabled: boolean;
  accountCertified: boolean;
  appId: string;
  appSecret: string;
  appSecretConfigured: boolean;
  templateId: string;
  credentialsReady: boolean;
  ready: boolean;
  callbackUrl: string;
  accountRequirement: string;
};

const EMPTY_SETTINGS: WechatOfficialSettings = {
  enabled: false,
  accountCertified: false,
  appId: "",
  appSecret: "",
  appSecretConfigured: false,
  templateId: "",
  credentialsReady: false,
  ready: false,
  callbackUrl: "https://www.nextwood.net/api/wechat-official/subscription/callback",
  accountRequirement: "仅企业主体已认证公众号可调用一次性订阅消息接口",
};

function settingsFingerprint(settings: WechatOfficialSettings) {
  return JSON.stringify(settings);
}

export function WechatOfficialSettingsCard({
  onDirtyChange,
  onBusyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [settings, setSettings] = useState<WechatOfficialSettings>(EMPTY_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<WechatOfficialSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = settingsFingerprint(settings) !== settingsFingerprint(savedSettings);
  const busy = saving || testing;

  useEffect(() => {
    onDirtyChange?.(!loading && dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, loading, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    let active = true;
    void apiJson<{ settings?: WechatOfficialSettings }>("/api/settings/wechat-official")
      .then((result) => {
        if (!active) return;
        const nextSettings = { ...EMPTY_SETTINGS, ...(result.settings || {}) };
        setSettings(nextSettings);
        setSavedSettings(nextSettings);
      })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "读取微信公众号设置失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function setField<K extends keyof WechatOfficialSettings>(key: K, value: WechatOfficialSettings[K]) {
    setMessage("");
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: WechatOfficialSettings; message?: string }>(
        "/api/settings/wechat-official",
        { method: "PATCH", body: JSON.stringify(settings) },
      );
      if (result.success !== true) throw new Error(result.message || "保存失败");
      const nextSettings = { ...EMPTY_SETTINGS, ...(result.settings || {}) };
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      setMessage(result.message || "微信公众号通知设置已保存");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "保存微信公众号设置失败");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>("/api/settings/wechat-official/test", { method: "POST" });
      if (result.success !== true) throw new Error(result.message || "连接测试失败");
      setMessage(result.message || "微信公众号连接成功");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "微信公众号连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsCard title="微信公众号物流通知（预开发）" icon="微">
      {loading ? <div className={styles.emptyState}>正在读取微信公众号设置...</div> : (
        <>
          <SettingsSection title="账号与接口">
            <div className={styles.settingsFieldGrid}>
              <SettingsSwitch
                label="启用微信公众号通知"
                tooltip="启用后，物流变化会向已授权的管理员和订单业务员发送一次性订阅消息；邮件通知保持不变。"
                checked={settings.enabled}
                onChange={(value) => setField("enabled", value)}
              />
              <SettingsSwitch
                label="企业主体已认证"
                tooltip="微信官方规定一次性订阅消息仅允许企业主体已认证账号调用。请在认证完成后再勾选。"
                checked={settings.accountCertified}
                onChange={(value) => setField("accountCertified", value)}
              />
              <SettingsField label="公众号 AppID">
                <input value={settings.appId} onChange={(event) => setField("appId", event.target.value)} placeholder="wx 开头的 AppID" />
              </SettingsField>
              <SettingsField label="公众号 AppSecret" tooltip="只在服务端加密保存，不会返回到浏览器。">
                <SecretField
                  value={settings.appSecret}
                  onChange={(value) => setField("appSecret", value)}
                  placeholder={settings.appSecretConfigured ? "已配置，留空则保持不变" : "认证后填写 AppSecret"}
                />
              </SettingsField>
              <SettingsField label="一次性订阅模板 ID">
                <input value={settings.templateId} onChange={(event) => setField("templateId", event.target.value)} placeholder="认证后从接口权限中获取" />
              </SettingsField>
              <SettingsField label="授权回调地址" tooltip="需将 www.nextwood.net 配置为公众号业务域名。">
                <input value={settings.callbackUrl} readOnly />
              </SettingsField>
            </div>
          </SettingsSection>
          <p className={styles.accountNote}>{settings.accountRequirement}。个人未认证号可先保存 AppID 等非敏感配置，但无法启用或测试真实推送。</p>
          {message ? <div className={message.includes("成功") || message.includes("已保存") ? styles.emptyState : styles.inlineError}>{message}</div> : null}
          <div className={styles.accountActions}>
            <button className={styles.primaryButtonCompact} type="button" onClick={() => void save()} disabled={saving || testing || !dirty}>
              {saving ? "保存中..." : "保存微信设置"}
            </button>
            <button className={styles.secondaryButton} type="button" onClick={() => void testConnection()} disabled={saving || testing || dirty || !settings.credentialsReady}>
              {testing ? "测试中..." : "测试微信连接"}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => { setSettings(savedSettings); setMessage(""); }}
              disabled={saving || testing || !dirty}
            >
              恢复微信设置
            </button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
