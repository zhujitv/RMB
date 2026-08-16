import type { FormEvent } from "react";
import styles from "../../WorkspaceShell.module.css";
import { smsIntegrationFormFromSettings } from "./helpers";
import {
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsStatusTag,
  SettingsSwitch,
} from "./settings-layout";
import type { SmsIntegrationForm, SmsIntegrationSettings } from "./types";

export function SmsIntegrationSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: SmsIntegrationSettings | null;
  form: SmsIntegrationForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: SmsIntegrationForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载短信通知设置</div>;

  const currentForm = form || smsIntegrationFormFromSettings(settings);
  const credentialsReady = Boolean(
    (currentForm.secretIdConfigured || currentForm.secretId.trim())
    && (currentForm.secretKeyConfigured || currentForm.secretKey.trim()),
  );
  const businessConfigReady = Boolean(
    currentForm.tencentSdkAppId.trim()
    && currentForm.signName.trim()
    && currentForm.templateId.trim()
    && currentForm.region.trim(),
  );
  const ready = credentialsReady && businessConfigReady;
  const statusTone = currentForm.enabled ? (ready ? "success" : "warning") : "muted";
  const statusLabel = currentForm.enabled ? (ready ? "已就绪" : "待完善配置") : "已关闭";

  function setField<K extends keyof SmsIntegrationForm>(key: K, value: SmsIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <SettingsPage
      title="短信通知"
      description="订单下发给产品供应商时，可通过腾讯云短信发送采购通知。"
      status={<SettingsStatusTag tone={statusTone}>{statusLabel}</SettingsStatusTag>}
      onSubmit={onSubmit}
      actions={(
        <>
          <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
          <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>重置</button>
        </>
      )}
    >
      {message ? (
        <div className={message.includes("失败") || message.includes("错误") || message.includes("无权限") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <SettingsCard title="基础配置" icon="信">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用供应商采购短信"
            tooltip="关闭后，订单下发不会创建短信通知。"
            checked={currentForm.enabled}
            onChange={(value) => setField("enabled", value)}
          />
          <SettingsField label="服务商">
            <input value="腾讯云短信" readOnly aria-label="服务商" />
          </SettingsField>
          <SettingsField label="短信 SDK AppID">
            <input
              value={currentForm.tencentSdkAppId}
              onChange={(event) => setField("tencentSdkAppId", event.target.value)}
              placeholder="例如：1400xxxxxxxx"
              inputMode="numeric"
            />
          </SettingsField>
          <SettingsField label="地域">
            <input
              value={currentForm.region}
              onChange={(event) => setField("region", event.target.value)}
              placeholder="ap-guangzhou"
            />
          </SettingsField>
          <SettingsField label="短信签名">
            <input
              value={currentForm.signName}
              onChange={(event) => setField("signName", event.target.value)}
              placeholder="填写腾讯云已审核通过的签名内容"
            />
          </SettingsField>
          <SettingsField label="采购下发模板 ID">
            <input
              value={currentForm.templateId}
              onChange={(event) => setField("templateId", event.target.value)}
              placeholder="填写腾讯云已审核通过的模板 ID"
            />
          </SettingsField>
        </div>
        <div className={styles.emptyState}>
          腾讯云模板必须正好包含 1 个变量 {"{1}"}，用于采购单号。推荐模板正文：采购订单{"{1}"}已下发，请及时查看并确认交付时间。短信正文需在腾讯云审核，本系统仅填写审核通过后的 Template ID。
        </div>
      </SettingsCard>

      <SettingsCard title="访问密钥" icon="密">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="SecretId">
            <input
              type="password"
              value={currentForm.secretId}
              onChange={(event) => setField("secretId", event.target.value)}
              placeholder={currentForm.secretIdConfigured ? "已配置，留空则保持不变" : "请输入腾讯云 SecretId"}
              autoComplete="new-password"
            />
          </SettingsField>
          <SettingsField label="SecretKey">
            <input
              type="password"
              value={currentForm.secretKey}
              onChange={(event) => setField("secretKey", event.target.value)}
              placeholder={currentForm.secretKeyConfigured ? "已配置，留空则保持不变" : "请输入腾讯云 SecretKey"}
              autoComplete="new-password"
            />
          </SettingsField>
        </div>
        <div className={styles.emptyState}>
          SecretId 与 SecretKey 将加密保存，仅供服务端调用腾讯云短信；页面不会回显已保存的明文密钥。建议使用仅授予短信发送权限的子账号密钥。
        </div>
      </SettingsCard>

      <div className={styles.emptyState}>
        保存设置不会发送测试短信。短信发送失败不会阻止订单下发，发送结果将在订单通知状态中单独记录。
      </div>
    </SettingsPage>
  );
}
