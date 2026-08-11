import type { FormEvent } from "react";
import { PermissionSelectItem, UiSwitch } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { NOTIFICATION_RECIPIENT_EMAIL_OPTIONS } from "./constants";
import {
  notificationDeliveryLogs,
  notificationTemplateFormFromSettings,
  notificationTemplatePreview,
  notificationTemplateRows,
} from "./helpers";
import { NotificationDeliveryLogTable } from "./notification-delivery-log-table";
import type { NotificationTemplateForm, NotificationTemplateSettings } from "./types";

export function NotificationTemplateSettingsCard({
  settings,
  form,
  selectedType,
  loading,
  saving,
  message,
  onChange,
  onSelectType,
  onReset,
  onSubmit,
}: {
  settings: NotificationTemplateSettings | null;
  form: NotificationTemplateForm | null;
  selectedType: string;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: NotificationTemplateForm) => void;
  onSelectType: (type: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载邮件通知中心</div>;
  const templates = notificationTemplateRows(settings);
  const logs = notificationDeliveryLogs(settings);
  const currentForm = form || notificationTemplateFormFromSettings(settings, selectedType);
  const isPortAlertTemplate = currentForm.type === "FREIGHTOWER_PORT_ROLLOVER_ALERT";
  const isPortOperationTemplate = currentForm.type === "FREIGHTOWER_PORT_OPERATION_ALERT";
  const isCustomsAlertTemplate = currentForm.type === "FREIGHTOWER_CUSTOMS_ALERT";
  const isInternalTrackingTemplate = currentForm.type === "FREIGHTOWER_TRACKING_UPDATE"
    || isPortAlertTemplate
    || isPortOperationTemplate
    || isCustomsAlertTemplate;
  const preview = notificationTemplatePreview(currentForm);
  const editable = currentForm.editable && !currentForm.securitySensitive;
  const extraConfig = currentForm.extraConfig || {};
  const recipientConfig = currentForm.recipientConfig || {};
  const recipientEmailFields = Array.isArray(recipientConfig.recipientEmailFields)
    ? recipientConfig.recipientEmailFields as string[]
    : [];

  function setField<K extends keyof NotificationTemplateForm>(key: K, value: NotificationTemplateForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function setExtraField(key: string, value: unknown) {
    setField("extraConfig", { ...(currentForm.extraConfig || {}), [key]: value });
  }

  function setRecipientConfigField(key: string, value: unknown) {
    setField("recipientConfig", { ...(currentForm.recipientConfig || {}), [key]: value });
  }

  function toggleRecipientEmailField(value: string) {
    const current = recipientEmailFields;
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    if (!next.length) return;
    setRecipientConfigField("recipientEmailFields", next);
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>邮件通知中心</strong>
          <div className={styles.quickCreateMeta}>
            <span>统一管理系统邮件模板、变量和最近发送记录。</span>
          </div>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          邮件类型
          <select value={currentForm.type} onChange={(event) => onSelectType(event.target.value)}>
            {templates.map((template) => (
              <option key={template.type} value={template.type}>{template.module} / {template.name}</option>
            ))}
          </select>
        </label>
        <label>
          来源模块
          <input value={currentForm.module} readOnly />
        </label>
        <label>
          是否支持附件
          <input value={currentForm.supportsAttachments ? "支持附件" : "无附件"} readOnly />
        </label>
        <UiSwitch
          label="启用通知"
          description={currentForm.securitySensitive ? "安全类邮件必须保持启用，只允许查看模板。" : "关闭后该类型邮件不会自动发送。"}
          checked={currentForm.enabled}
          disabled={currentForm.securitySensitive}
          onChange={(value) => setField("enabled", value)}
        />
      </div>

      <section className={styles.documentGroupCard}>
        <strong>模板说明</strong>
        <div className={styles.quickCreateMeta}>
          <span>{currentForm.description || "该通知由业务模块自动触发。"}</span>
          {currentForm.securitySensitive ? <span>安全敏感模板：标题和正文不可编辑。</span> : null}
        </div>
      </section>

      {currentForm.type === "LOGISTICS_INVOICE_NOTICE" ? (
        <section className={styles.documentGroupCard}>
          <strong>物流开票触发与收件人</strong>
          <UiSwitch
            label="审核通过后自动发送"
            description="关闭后，审核仍会通过，但不会自动发开票通知，可在账单中手工重发。"
            checked={extraConfig.autoSendOnApproval !== false}
            onChange={(value) => setExtraField("autoSendOnApproval", value)}
          />
          <div className={styles.commissionDeductionGrid}>
            {NOTIFICATION_RECIPIENT_EMAIL_OPTIONS.map((item) => (
              <PermissionSelectItem
                key={item.value}
                label={item.label}
                description={item.description}
                checked={recipientEmailFields.includes(item.value)}
                onChange={() => toggleRecipientEmailField(item.value)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {isInternalTrackingTemplate ? (
        <section className={styles.documentGroupCard}>
          <strong>{isPortAlertTemplate ? "港区甩箱中文通知" : isCustomsAlertTemplate ? "中国海关中文通知" : "内部中文物流通知"}</strong>
          <div className={styles.quickCreateMeta}>
            <span>{isPortAlertTemplate
              ? "港区出现甩箱状态时自动发送，不向客户发送。"
              : isCustomsAlertTemplate
                ? "中国海关节点发生变化时自动发送，不向客户发送。"
                : "普通运输节点或状态发生变化时自动发送。"}</span>
            <span>默认收件人：所有已启用且已审批的管理员，以及该订单的业务员。</span>
            <span>管理员与业务员邮箱重复时自动合并，只发送一次。</span>
            <span>邮件正文使用中文卡片式模板；相同运输节点使用独立幂等键去重。</span>
          </div>
        </section>
      ) : null}

      {currentForm.type === "FREIGHTOWER_TRACKING_CUSTOMER_UPDATE" ? (
        <section className={styles.documentGroupCard}>
          <strong>客户英文物流通知</strong>
          <div className={styles.quickCreateMeta}>
            <span>发送给订单客户资料中绑定的主联系邮箱。</span>
            <span>客户邮箱与内部邮箱重复时，优先按内部人员发送中文，不重复发送英文。</span>
            <span>邮件正文使用独立英文卡片式模板，不包含内部中文说明。</span>
            <span>可关闭此模板，关闭后不向客户自动发送，但内部通知不受影响。</span>
          </div>
        </section>
      ) : null}

      <section className={styles.documentGroupCard}>
        <strong>抄送设置</strong>
        {currentForm.type === "FREIGHTOWER_TRACKING_CUSTOMER_UPDATE" ? (
          <div className={styles.quickCreateMeta}>
            <span>客户英文物流通知仅发送到该客户绑定的主联系邮箱，不使用管理员或额外抄送，避免客户信息误发。</span>
          </div>
        ) : null}
        <UiSwitch
          label="默认抄送管理员"
          description="发送该类型通知时，自动抄送系统中已启用的管理员邮箱。"
          checked={currentForm.ccAdminEmails}
          disabled={currentForm.securitySensitive || currentForm.type === "FREIGHTOWER_TRACKING_CUSTOMER_UPDATE"}
          onChange={(value) => setField("ccAdminEmails", value)}
        />
        <label className={styles.notificationTemplateField}>
          额外抄送邮箱
          <textarea
            value={currentForm.ccEmails}
            onChange={(event) => setField("ccEmails", event.target.value)}
            placeholder="多个邮箱可用逗号、分号或换行分隔"
            disabled={currentForm.securitySensitive || currentForm.type === "FREIGHTOWER_TRACKING_CUSTOMER_UPDATE"}
            rows={3}
          />
        </label>
      </section>

      <div className={styles.reportFilterGrid}>
        <label>
          邮件标题
          <input
            value={currentForm.subjectTemplate}
            onChange={(event) => setField("subjectTemplate", event.target.value)}
            readOnly={!editable}
          />
        </label>
        <label>
          邮件正文模板
          <textarea
            value={currentForm.bodyTemplate}
            onChange={(event) => setField("bodyTemplate", event.target.value)}
            readOnly={!editable}
            rows={11}
          />
        </label>
      </div>

      {currentForm.type === "LOGISTICS_INVOICE_NOTICE" ? (
        <div className={styles.reportFilterGrid}>
          <label>
            批量邮件标题
            <input
              value={String(extraConfig.batchSubjectTemplate || "")}
              onChange={(event) => setExtraField("batchSubjectTemplate", event.target.value)}
            />
          </label>
          <label>
            发票上传入口
            <input
              value={String(extraConfig.uploadUrl || "")}
              onChange={(event) => setExtraField("uploadUrl", event.target.value)}
              placeholder="为空时使用系统访问地址"
            />
          </label>
          <label>
            邮件落款
            <input value={String(extraConfig.signature || "")} onChange={(event) => setExtraField("signature", event.target.value)} />
          </label>
          <label>
            开票要求
            <textarea
              value={String(extraConfig.invoiceRequirements || "")}
              onChange={(event) => setExtraField("invoiceRequirements", event.target.value)}
              rows={6}
            />
          </label>
        </div>
      ) : null}

      <section className={styles.documentGroupCard}>
        <strong>可用变量</strong>
        <div className={styles.quickCreateMeta}>
          {(currentForm.variables || []).map((item) => (
            <span key={item.key}>{`{${item.key}}`}：{item.label}</span>
          ))}
        </div>
      </section>

      <section className={styles.documentGroupCard}>
        <strong>模板预览</strong>
        <textarea readOnly value={preview} rows={12} />
      </section>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存通知模板"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>

      <NotificationDeliveryLogTable logs={logs} />
    </form>
  );
}
