import styles from "../../WorkspaceShell.module.css";
import { FREIGHTOWER_EXPORT_OPTIONS, FREIGHTOWER_LANG_OPTIONS } from "./constants";
import { SecretField, SettingsCard, SettingsField, SettingsSection, SettingsSwitch } from "./settings-layout";
import type { ShipsgoIntegrationForm } from "./types";

type FreightowerSettingsCardProps = {
  form: ShipsgoIntegrationForm;
  onChange: <K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) => void;
};

function secretPlaceholder(configured: boolean, emptyText: string) {
  return configured ? "已配置，留空则保持不变" : emptyText;
}

export function FreightowerSettingsCard({ form, onChange }: FreightowerSettingsCardProps) {
  return (
    <SettingsCard title="飞驼可视接口" icon="航">
      <SettingsSection title="1. API Key 直连认证">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="API Key" tooltip="直接用于 Authorization: Bearer API_KEY，不再获取 Token。">
            <SecretField
              value={form.freightowerApiKey}
              onChange={(value) => onChange("freightowerApiKey", value)}
              placeholder={secretPlaceholder(form.freightowerApiKeyConfigured, "请输入飞驼 API Key")}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="2. 中国海关 Token 认证（可选）">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="Client ID" tooltip="用于按飞驼官方文档获取中国海关接口 Token，同时可用于生成网页地图地址。">
            <SecretField
              value={form.freightowerClientId}
              onChange={(value) => onChange("freightowerClientId", value)}
              placeholder={secretPlaceholder(form.freightowerClientIdConfigured, "请输入飞驼 Client ID")}
            />
          </SettingsField>
          <SettingsField label="API Secret" tooltip="与 Client ID 配套，仅在服务端换取短期 Token；不是 API Key，也不会返回给浏览器。">
            <SecretField
              value={form.freightowerApiSecret}
              onChange={(value) => onChange("freightowerApiSecret", value)}
              placeholder={secretPlaceholder(form.freightowerApiSecretConfigured, "请输入飞驼 API Secret")}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="3. 网页地图（可选）">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="Iframe Key" tooltip="仅用于海运可视化 iframe，不是查询接口的 API Key。">
            <SecretField
              value={form.freightowerIframeKey}
              onChange={(value) => onChange("freightowerIframeKey", value)}
              placeholder={secretPlaceholder(form.freightowerIframeKeyConfigured, "请输入飞驼 iframe Key")}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="4. 跟踪更新与预警推送（Webhook）">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用跟踪更新与甩柜预警"
            tooltip="同时支持“更新通知推送”和“增量+预警推送”。收到通知后系统会用 API Key 回查完整物流并自动去重。"
            checked={form.webhookEnabled}
            onChange={(value) => onChange("webhookEnabled", value)}
          />
          <SettingsField label="推送回调地址" tooltip="将此完整 HTTPS 地址提交给飞驼配置，不能填写站内相对路径。">
            <input value="https://www.nextwood.net/api/freightower/webhook" readOnly />
          </SettingsField>
          <SettingsField label="Webhook Access Secret（可选）" tooltip="如飞驼提供了签名密钥，请填写以校验 HmacSHA1 并合并即时增量预警；未填写时，推送只会触发 API Key 安全回查。">
            <SecretField
              value={form.freightowerWebhookAccessSecret}
              onChange={(value) => onChange("freightowerWebhookAccessSecret", value)}
              placeholder={secretPlaceholder(form.freightowerWebhookAccessSecretConfigured, "可留空；填写后启用签名校验")}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="默认订阅参数">
        <div className={styles.settingsFieldGrid}>
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
      </SettingsSection>
    </SettingsCard>
  );
}
