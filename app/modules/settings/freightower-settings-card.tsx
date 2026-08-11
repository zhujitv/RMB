import styles from "../../WorkspaceShell.module.css";
import {
  CHINA_DEPARTURE_PORT_OPTIONS,
  CUSTOM_CHINA_DEPARTURE_PORT_VALUE,
  isCommonChinaDeparturePort,
} from "../domestic-logistics/shipsgo-port-options";
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
      <SettingsSection title="1. API Key 直连认证（综合物流与中国海关）">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="API Key" tooltip="综合物流、中国港区和中国海关查询统一使用 Authorization: Bearer API_KEY，不再获取 Token。">
            <SecretField
              value={form.freightowerApiKey}
              onChange={(value) => onChange("freightowerApiKey", value)}
              placeholder={secretPlaceholder(form.freightowerApiKeyConfigured, "请输入飞驼 API Key")}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="2. 网页地图（可选）">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="Client ID" tooltip="仅用于生成飞驼网页地图地址；中国海关查询不需要填写。">
            <SecretField
              value={form.freightowerClientId}
              onChange={(value) => onChange("freightowerClientId", value)}
              placeholder={secretPlaceholder(form.freightowerClientIdConfigured, "请输入飞驼 Client ID")}
            />
          </SettingsField>
          <SettingsField label="Iframe Key" tooltip="仅用于海运可视化 iframe，不是查询接口的 API Key。">
            <SecretField
              value={form.freightowerIframeKey}
              onChange={(value) => onChange("freightowerIframeKey", value)}
              placeholder={secretPlaceholder(form.freightowerIframeKeyConfigured, "请输入飞驼 iframe Key")}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="3. 跟踪更新与预警推送（Webhook）">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用跟踪更新与甩柜预警"
            tooltip="同时支持“更新通知推送”和“增量+预警推送”。收到通知后系统会用 API Key 回查完整物流并自动去重。"
            checked={form.webhookEnabled}
            onChange={(value) => onChange("webhookEnabled", value)}
          />
          <SettingsField label="推送回调地址" tooltip="保存当前完整 HTTPS 地址，再将同一地址提交给飞驼；域名必须已经指向本系统。">
            <input
              type="url"
              value={form.freightowerWebhookCallbackUrl}
              onChange={(event) => onChange("freightowerWebhookCallbackUrl", event.target.value)}
              placeholder="https://www.ruscny.com/api/freightower/webhook"
              required
            />
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
            <select
              value={isCommonChinaDeparturePort(form.freightowerDefaultPortCode)
                ? form.freightowerDefaultPortCode
                : CUSTOM_CHINA_DEPARTURE_PORT_VALUE}
              onChange={(event) => onChange(
                "freightowerDefaultPortCode",
                event.target.value === CUSTOM_CHINA_DEPARTURE_PORT_VALUE ? "" : event.target.value,
              )}
            >
              {CHINA_DEPARTURE_PORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value={CUSTOM_CHINA_DEPARTURE_PORT_VALUE}>其他港口（手动输入）</option>
            </select>
            {!isCommonChinaDeparturePort(form.freightowerDefaultPortCode) ? (
              <input
                value={form.freightowerDefaultPortCode}
                onChange={(event) => onChange(
                  "freightowerDefaultPortCode",
                  event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
                )}
                placeholder="输入其他中国港口代码，例如 CNXMN"
                maxLength={16}
              />
            ) : null}
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
