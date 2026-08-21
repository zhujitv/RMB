import type { FormEvent } from "react";
import styles from "../../WorkspaceShell.module.css";
import { crmEmailIntegrationFormFromSettings } from "./helpers";
import {
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsStatusTag,
  SettingsSwitch,
} from "./settings-layout";
import type { CrmEmailIntegrationForm, CrmEmailIntegrationSettings } from "./types";

export function CrmEmailIntegrationSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: CrmEmailIntegrationSettings | null;
  form: CrmEmailIntegrationForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: CrmEmailIntegrationForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载 CRM 邮件设置</div>;

  const currentForm = form || crmEmailIntegrationFormFromSettings(settings);
  const statusTone = currentForm.enabled ? (currentForm.outboundEnabled || currentForm.inboundEnabled ? "success" : "warning") : "muted";
  const statusLabel = currentForm.enabled
    ? (currentForm.outboundEnabled || currentForm.inboundEnabled ? "已启用" : "模块已开，通道未开")
    : "已关闭";

  function setField<K extends keyof CrmEmailIntegrationForm>(key: K, value: CrmEmailIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <SettingsPage
      title="CRM邮件"
      description="为客户 CRM 建立系统内个人邮箱账户、邮件往来归档和附件留痕。"
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

      <SettingsCard title="模块开关" icon="邮">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用 CRM 邮件模块"
            tooltip="关闭后，客户详情页不允许新建邮件，但历史往来仍保留。"
            checked={currentForm.enabled}
            onChange={(value) => setField("enabled", value)}
          />
          <SettingsField label="系统邮箱域名">
            <input
              value={currentForm.mailDomain}
              onChange={(event) => setField("mailDomain", event.target.value.trim().toLowerCase())}
              placeholder="例如：crm.nextwood.net"
            />
          </SettingsField>
          <SettingsField label="外发服务">
            <input value="Resend / 系统邮件适配器" readOnly aria-label="外发服务" />
          </SettingsField>
        </div>
        <div className={styles.emptyState}>
          操作人员创建英文名后，系统会生成类似 name@{currentForm.mailDomain || "crm.nextwood.net"} 的个人账户。
        </div>
      </SettingsCard>

      <SettingsCard title="收发通道" icon="通">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="允许外发邮件"
            tooltip="开启后，CRM 邮件会调用服务端邮件适配器真实发送。关闭时仅归档保存。"
            checked={currentForm.outboundEnabled}
            disabled={!currentForm.enabled}
            onChange={(value) => setField("outboundEnabled", value)}
          />
          <SettingsSwitch
            label="允许接收入站邮件"
            tooltip="开启后可接入二级域名邮件回传 Webhook/IMAP 适配器。"
            checked={currentForm.inboundEnabled}
            disabled={!currentForm.enabled}
            onChange={(value) => setField("inboundEnabled", value)}
          />
        </div>
        <div className={styles.emptyState}>
          文件附件使用当前对象存储配置；线上已配置腾讯云 COS 时走 COS 私有桶，下载必须经过系统权限校验。
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
