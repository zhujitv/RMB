import styles from "../../WorkspaceShell.module.css";
import { FREIGHTOWER_EXPORT_OPTIONS, FREIGHTOWER_LANG_OPTIONS } from "./constants";
import { SecretField, SettingsCard, SettingsField, SettingsSwitch } from "./settings-layout";
import type { ShipsgoIntegrationForm } from "./types";

type FreightowerSettingsCardProps = {
  form: ShipsgoIntegrationForm;
  onChange: <K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) => void;
};

export function FreightowerSettingsCard({ form, onChange }: FreightowerSettingsCardProps) {
  return (
    <SettingsCard title="飞驼可视接口" icon="航">
      <div className={styles.settingsFieldGrid}>
        <SettingsSwitch
          label="启用飞驼可视"
          tooltip="关闭后不会使用飞驼创建新跟踪，推送入口也会拒绝处理。"
          checked={form.freightowerEnabled}
          onChange={(value) => onChange("freightowerEnabled", value)}
        />
        <SettingsField label="API Base URL">
          <input value={form.freightowerApiBaseUrl} onChange={(event) => onChange("freightowerApiBaseUrl", event.target.value)} placeholder="http://openapi.freightower.com" />
        </SettingsField>
        <SettingsField label="Client ID">
          <SecretField
            value={form.freightowerClientId}
            onChange={(value) => onChange("freightowerClientId", value)}
            placeholder={form.freightowerClientIdConfigured ? "已配置，留空则保持不变" : "请输入飞驼 Client ID"}
          />
        </SettingsField>
        <SettingsField label="Secret">
          <SecretField
            value={form.freightowerSecret}
            onChange={(value) => onChange("freightowerSecret", value)}
            placeholder={form.freightowerSecretConfigured ? "已配置，留空则保持不变" : "请输入飞驼 Secret"}
          />
        </SettingsField>
        <SettingsField label="地图 Key">
          <SecretField
            value={form.freightowerMapKey}
            onChange={(value) => onChange("freightowerMapKey", value)}
            placeholder={form.freightowerMapKeyConfigured ? "已配置，留空则保持不变" : "可视化地图密钥"}
          />
        </SettingsField>
        <SettingsField label="推送 Access Secret">
          <SecretField
            value={form.freightowerWebhookSecret}
            onChange={(value) => onChange("freightowerWebhookSecret", value)}
            placeholder={form.freightowerWebhookSecretConfigured ? "已配置，留空则保持不变" : "用于飞驼 HmacSHA1 签名校验"}
          />
        </SettingsField>
        <SettingsField label="默认船公司代码">
          <input value={form.freightowerDefaultCarrierCode} onChange={(event) => onChange("freightowerDefaultCarrierCode", event.target.value)} placeholder="AUTO" />
        </SettingsField>
        <SettingsField label="默认港区代码">
          <input value={form.freightowerDefaultPortCode} onChange={(event) => onChange("freightowerDefaultPortCode", event.target.value)} placeholder="例如 CNSHA" />
        </SettingsField>
        <SettingsField label="进出口标识">
          <select value={form.freightowerDefaultIsExport} onChange={(event) => onChange("freightowerDefaultIsExport", event.target.value)}>
            {FREIGHTOWER_EXPORT_OPTIONS.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}
          </select>
        </SettingsField>
        <SettingsField label="地图语言">
          <select value={form.freightowerDefaultLang} onChange={(event) => onChange("freightowerDefaultLang", event.target.value)}>
            {FREIGHTOWER_LANG_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </SettingsField>
        <SettingsSwitch
          label="地图隐藏单号 / 箱号"
          tooltip="开启后飞驼可视地图使用 hiddenReference=1。"
          checked={form.freightowerHiddenReference}
          onChange={(value) => onChange("freightowerHiddenReference", value)}
        />
      </div>
    </SettingsCard>
  );
}
