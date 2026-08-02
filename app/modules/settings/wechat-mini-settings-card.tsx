import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import styles from "../../WorkspaceShell.module.css";
import { SecretField, SettingsCard, SettingsField, SettingsSection, SettingsSwitch } from "./settings-layout";

type MiniSettings = {
  enabled: boolean;
  appId: string;
  appSecret: string;
  appSecretConfigured: boolean;
  trackingTemplateId: string;
  orderField: string;
  statusField: string;
  eventTimeField: string;
  eventField: string;
  credentialsReady: boolean;
  ready: boolean;
  requestDomain: string;
};

const EMPTY: MiniSettings = {
  enabled: false,
  appId: "",
  appSecret: "",
  appSecretConfigured: false,
  trackingTemplateId: "",
  orderField: "thing1",
  statusField: "phrase2",
  eventTimeField: "time3",
  eventField: "thing4",
  credentialsReady: false,
  ready: false,
  requestDomain: "https://www.nextwood.net",
};

export function WechatMiniSettingsCard({
  onDirtyChange,
  onBusyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [settings, setSettings] = useState<MiniSettings>(EMPTY);
  const [saved, setSaved] = useState<MiniSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
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
    void apiJson<{ settings?: MiniSettings }>("/api/settings/wechat-mini")
      .then((result) => {
        if (!active) return;
        const next = { ...EMPTY, ...(result.settings || {}) };
        setSettings(next);
        setSaved(next);
      })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "读取微信小程序设置失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function setField<K extends keyof MiniSettings>(key: K, value: MiniSettings[K]) {
    setMessage("");
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: MiniSettings; message?: string }>(
        "/api/settings/wechat-mini",
        { method: "PATCH", body: JSON.stringify(settings) },
      );
      if (result.success !== true) throw new Error(result.message || "保存失败");
      const next = { ...EMPTY, ...(result.settings || {}) };
      setSettings(next);
      setSaved(next);
      setMessage(result.message || "微信小程序设置已保存");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "保存微信小程序设置失败");
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>("/api/settings/wechat-mini/test", { method: "POST" });
      if (result.success !== true) throw new Error(result.message || "连接测试失败");
      setMessage(result.message || "微信小程序连接成功");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "微信小程序连接测试失败");
    } finally { setTesting(false); }
  }

  return (
    <SettingsCard title="微信小程序物流应用" icon="小">
      {loading ? <div className={styles.emptyState}>正在读取微信小程序设置...</div> : (
        <>
          <SettingsSection title="独立小程序账号">
            <div className={styles.settingsFieldGrid}>
              <SettingsSwitch
                label="启用微信小程序"
                tooltip="启用后，员工可在小程序查看本人有权限的物流，并授权接收物流变化通知；不会关闭或替换公众号。"
                checked={settings.enabled}
                onChange={(value) => setField("enabled", value)}
              />
              <SettingsField label="小程序 AppID">
                <input value={settings.appId} onChange={(event) => setField("appId", event.target.value)} placeholder="wx 开头的小程序 AppID" />
              </SettingsField>
              <SettingsField label="小程序 AppSecret" tooltip="仅在服务端加密保存，不会返回浏览器或下发到小程序。">
                <SecretField
                  value={settings.appSecret}
                  onChange={(value) => setField("appSecret", value)}
                  placeholder={settings.appSecretConfigured ? "已配置，留空则保持不变" : "填写小程序 AppSecret"}
                />
              </SettingsField>
              <SettingsField label="物流订阅模板 ID">
                <input value={settings.trackingTemplateId} onChange={(event) => setField("trackingTemplateId", event.target.value)} placeholder="微信小程序后台选择的模板 ID" />
              </SettingsField>
              <SettingsField label="request 合法域名">
                <input value={settings.requestDomain} readOnly />
              </SettingsField>
            </div>
          </SettingsSection>
          <SettingsSection title="订阅模板字段">
            <div className={styles.settingsFieldGrid}>
              <SettingsField label="订单号字段"><input value={settings.orderField} onChange={(event) => setField("orderField", event.target.value)} placeholder="thing1" /></SettingsField>
              <SettingsField label="物流状态字段"><input value={settings.statusField} onChange={(event) => setField("statusField", event.target.value)} placeholder="phrase2" /></SettingsField>
              <SettingsField label="节点时间字段"><input value={settings.eventTimeField} onChange={(event) => setField("eventTimeField", event.target.value)} placeholder="time3" /></SettingsField>
              <SettingsField label="节点说明字段"><input value={settings.eventField} onChange={(event) => setField("eventField", event.target.value)} placeholder="thing4" /></SettingsField>
            </div>
          </SettingsSection>
          <p className={styles.accountNote}>公众号继续保留。小程序必须使用小程序自己的 AppID 与 AppSecret，模板字段应与微信后台显示的字段名完全一致。</p>
          {message ? <div className={message.includes("成功") || message.includes("已保存") ? styles.emptyState : styles.inlineError}>{message}</div> : null}
          <div className={styles.accountActions}>
            <button className={styles.primaryButtonCompact} type="button" onClick={() => void save()} disabled={saving || testing || !dirty}>{saving ? "保存中..." : "保存小程序设置"}</button>
            <button className={styles.secondaryButton} type="button" onClick={() => void test()} disabled={saving || testing || dirty || !settings.credentialsReady}>{testing ? "测试中..." : "测试小程序连接"}</button>
            <button className={styles.secondaryButton} type="button" onClick={() => { setSettings(saved); setMessage(""); }} disabled={saving || testing || !dirty}>恢复小程序设置</button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
