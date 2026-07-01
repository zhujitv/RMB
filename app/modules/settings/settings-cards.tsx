import type { FormEvent } from "react";
import { PermissionSelectItem, UiSwitch } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { CompanyProfileSettings } from "../../types";
import { BooleanSelect } from "./common-controls";
import {
  COMMISSION_FORMULA_DEDUCTIONS,
  COMMISSION_FORMULA_PRESETS,
  COMMISSION_FORMULA_SOURCES,
  EXCHANGE_RATE_SOURCES,
  EXCHANGE_RATE_TYPES,
  NOTIFICATION_RECIPIENT_EMAIL_OPTIONS,
  SHIPSGO_FEATURE_OPTIONS,
} from "./constants";
import {
  businessEntityFormFromRow,
  commissionFormulaFormFromSettings,
  commissionFormulaPreview,
  companyProfileFormFromSettings,
  exchangeFormFromSettings,
  notificationDeliveryLogs,
  notificationTemplateFormFromSettings,
  notificationTemplatePreview,
  notificationTemplateRows,
  shipsgoIntegrationFormFromSettings,
} from "./helpers";
import type {
  BusinessEntityForm,
  BusinessEntityRow,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
  ExchangeRateForm,
  ExchangeRateSettings,
  NotificationTemplateForm,
  NotificationTemplateSettings,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
} from "./types";

export function BusinessEntitySettingsCard({
  entities,
  form,
  loading,
  saving,
  message,
  onChange,
  onCreate,
  onEdit,
  onCancel,
  onSubmit,
}: {
  entities: BusinessEntityRow[];
  form: BusinessEntityForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: BusinessEntityForm) => void;
  onCreate: () => void;
  onEdit: (entity: BusinessEntityRow) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const currentForm = form || null;

  function setField<K extends keyof BusinessEntityForm>(key: K, value: BusinessEntityForm[K]) {
    if (!currentForm) return;
    onChange({ ...currentForm, [key]: value });
  }

  function restoreCurrentForm() {
    if (!currentForm) return;
    const row = entities.find((entity) => entity.id === currentForm.id);
    onChange(row ? businessEntityFormFromRow(row) : {
      id: "",
      name: "",
      shortName: "",
      isDefault: false,
      status: "启用",
      sortOrder: "0",
      remark: "",
    });
  }

  return (
    <div className={styles.quickCreatePanel}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>业务主体配置</strong>
        </div>
        <button className={styles.primaryButtonCompact} type="button" onClick={onCreate} disabled={saving}>
          新增业务主体
        </button>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>公司全称</th>
              <th>公司简称</th>
              <th>默认</th>
              <th>状态</th>
              <th>排序</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : entities.length ? entities.map((entity) => (
              <tr key={entity.id}>
                <td title={entity.name || ""}>{entity.name || "-"}</td>
                <td>{entity.shortName || "-"}</td>
                <td>{entity.isDefault ? "默认" : "-"}</td>
                <td>{entity.status || "启用"}</td>
                <td>{entity.sortOrder ?? 0}</td>
                <td title={entity.remark || ""}>{entity.remark || "-"}</td>
                <td>
                  <button
                    className={styles.rowDetailButton}
                    type="button"
                    onClick={() => onEdit(entity)}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>暂无业务主体</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {currentForm ? (
        <form className={styles.documentGroupCard} onSubmit={onSubmit}>
          <strong>{currentForm.id ? "编辑业务主体" : "新增业务主体"}</strong>
          <div className={styles.reportFilterGrid}>
            <label>
              公司全称
              <input
                value={currentForm.name}
                onChange={(event) => setField("name", event.target.value)}
                required
              />
            </label>
            <label>
              公司简称
              <input value={currentForm.shortName} onChange={(event) => setField("shortName", event.target.value)} />
            </label>
            <label>
              状态
              <select
                value={currentForm.status}
                onChange={(event) => setField("status", event.target.value)}
                disabled={currentForm.isDefault}
              >
                <option value="启用">启用</option>
                <option value="停用">停用</option>
              </select>
            </label>
            <label>
              排序
              <input
                type="number"
                value={currentForm.sortOrder}
                onChange={(event) => setField("sortOrder", event.target.value)}
              />
            </label>
            <UiSwitch
              label="设为默认业务主体"
              description="新建订单默认使用该业务主体；已有订单不会自动变更。"
              checked={currentForm.isDefault}
              onChange={(value) => onChange({
                ...currentForm,
                isDefault: value,
                status: value ? "启用" : currentForm.status,
              })}
            />
            <label>
              备注
              <textarea value={currentForm.remark} onChange={(event) => setField("remark", event.target.value)} rows={3} />
            </label>
          </div>
          <div className={styles.emptyState}>
            业务主体用于订单标记、筛选、报表和导出抬头，不改变权限隔离和业务流程。
          </div>
          <div className={styles.detailActions}>
            <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存业务主体"}</button>
            <button className={styles.secondaryButton} type="button" onClick={restoreCurrentForm} disabled={saving}>恢复当前值</button>
            <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function CompanyProfileSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: CompanyProfileSettings | null;
  form: CompanyProfileForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: CompanyProfileForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载公司资料</div>;
  const currentForm = form || companyProfileFormFromSettings(settings);

  function setField<K extends keyof CompanyProfileForm>(key: K, value: CompanyProfileForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>公司资料 / 系统品牌配置</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          品牌名称
          <input value={currentForm.brandName} onChange={(event) => setField("brandName", event.target.value)} required />
        </label>
        <label>
          系统名称
          <input value={currentForm.systemName} onChange={(event) => setField("systemName", event.target.value)} required />
        </label>
        <label>
          公司中文名称
          <input value={currentForm.companyNameZh} onChange={(event) => setField("companyNameZh", event.target.value)} required />
        </label>
        <label>
          公司英文名称
          <input value={currentForm.companyNameEn} onChange={(event) => setField("companyNameEn", event.target.value)} />
        </label>
        <label>
          公司简称
          <input value={currentForm.shortName} onChange={(event) => setField("shortName", event.target.value)} />
        </label>
        <label>
          官网地址
          <input value={currentForm.website} onChange={(event) => setField("website", event.target.value)} placeholder="https://www.example.com" />
        </label>
        <label>
          联系邮箱
          <input value={currentForm.contactEmail} onChange={(event) => setField("contactEmail", event.target.value)} type="email" />
        </label>
        <label>
          联系电话
          <input value={currentForm.contactPhone} onChange={(event) => setField("contactPhone", event.target.value)} />
        </label>
        <label>
          Logo 地址
          <input value={currentForm.logoUrl} onChange={(event) => setField("logoUrl", event.target.value)} placeholder="可为空，支持 http/https 图片地址" />
        </label>
        <label>
          页脚版权文案
          <input value={currentForm.footerText} onChange={(event) => setField("footerText", event.target.value)} />
        </label>
        <label>
          公司地址
          <textarea value={currentForm.address} onChange={(event) => setField("address", event.target.value)} rows={3} />
        </label>
      </div>

      <div className={styles.emptyState}>
        当前品牌预览：{currentForm.brandName || "-"} · {currentForm.systemName || "-"} · {currentForm.companyNameZh || "-"}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存公司资料"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}

export function ExchangeSettingsCard({
  settings,
  form,
  loading,
  saving,
  refreshing,
  message,
  onChange,
  onReset,
  onRefresh,
  onSubmit,
}: {
  settings: ExchangeRateSettings | null;
  form: ExchangeRateForm | null;
  loading: boolean;
  saving: boolean;
  refreshing: boolean;
  message: string;
  onChange: (form: ExchangeRateForm) => void;
  onReset: () => void;
  onRefresh: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载汇率设置</div>;
  const currentForm = form || exchangeFormFromSettings(settings);
  function setField<K extends keyof ExchangeRateForm>(key: K, value: ExchangeRateForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>汇率设置</strong>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={onRefresh} disabled={refreshing || saving}>
          {refreshing ? "刷新中..." : "手动刷新今日汇率"}
        </button>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          汇率来源
          <select value={currentForm.source} onChange={(event) => setField("source", event.target.value)}>
            {EXCHANGE_RATE_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <label>
          汇率类型
          <select value={currentForm.rateType} onChange={(event) => setField("rateType", event.target.value)}>
            {EXCHANGE_RATE_TYPES.map((rateType) => <option key={rateType} value={rateType}>{rateType}</option>)}
          </select>
        </label>
        <BooleanSelect
          label="自动更新汇率"
          value={currentForm.autoUpdate}
          onChange={(value) => setField("autoUpdate", value)}
        />
        <BooleanSelect
          label="允许手动汇率"
          value={currentForm.allowManualEdit}
          onChange={(value) => setField("allowManualEdit", value)}
        />
        <BooleanSelect
          label="允许订单选择多个物流供应商"
          value={currentForm.allowMultipleOrderLogisticsSuppliers}
          onChange={(value) => setField("allowMultipleOrderLogisticsSuppliers", value)}
        />
        <BooleanSelect
          label="管理员可忽略退税完整度"
          value={currentForm.allowAdminIncompleteTaxSubmit}
          onChange={(value) => setField("allowAdminIncompleteTaxSubmit", value)}
        />
        <label>
          付款凭证提醒启用日期
          <input
            type="date"
            value={currentForm.paymentVoucherReminderStartDate}
            onChange={(event) => setField("paymentVoucherReminderStartDate", event.target.value)}
          />
        </label>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存汇率设置"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}

export function CommissionFormulaSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: CommissionFormulaSettings | null;
  form: CommissionFormulaForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: CommissionFormulaForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载提成公式设置</div>;
  const currentForm = form || commissionFormulaFormFromSettings(settings);
  const formulaText = commissionFormulaPreview(currentForm);

  function setField<K extends keyof CommissionFormulaForm>(key: K, value: CommissionFormulaForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function applyPreset(mode: string) {
    const preset = COMMISSION_FORMULA_PRESETS.find((item) => item.value === mode) || COMMISSION_FORMULA_PRESETS[0];
    onChange({
      ...currentForm,
      mode: preset.value,
      label: preset.label,
      source: preset.source,
      deductions: [...preset.deductions],
    });
  }

  function toggleDeduction(value: string) {
    const exists = currentForm.deductions.includes(value);
    const deductions = exists
      ? currentForm.deductions.filter((item) => item !== value)
      : [...currentForm.deductions, value];
    onChange({ ...currentForm, mode: "CUSTOM", label: currentForm.label || "自定义公式", deductions });
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>提成公式</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <label>
          公式模板
          <select value={currentForm.mode} onChange={(event) => applyPreset(event.target.value)}>
            {COMMISSION_FORMULA_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </select>
        </label>
        <label>
          公式名称
          <input value={currentForm.label} onChange={(event) => setField("label", event.target.value)} />
        </label>
        <label>
          收入来源
          <select
            value={currentForm.source}
            onChange={(event) => onChange({ ...currentForm, mode: "CUSTOM", source: event.target.value })}
          >
            {COMMISSION_FORMULA_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
          </select>
        </label>
        <UiSwitch
          label="提成基数负数归零"
          description="开启后，扣减后的负数基数按 0 处理。"
          checked={currentForm.floorAtZero}
          onChange={(value) => setField("floorAtZero", value)}
        />
      </div>

      <div className={styles.documentGroupCard}>
        <strong>扣减项</strong>
        <div className={styles.commissionDeductionGrid}>
          {COMMISSION_FORMULA_DEDUCTIONS.map((item) => (
            <PermissionSelectItem
              key={item.value}
              label={item.label}
              description={item.description}
              checked={currentForm.deductions.includes(item.value)}
              onChange={() => toggleDeduction(item.value)}
            />
          ))}
        </div>
      </div>

      <div className={styles.emptyState}>当前公式：提成基数 = {formulaText}</div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存提成公式"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}

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
  onTestSend,
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
  onTestSend: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载邮件通知中心</div>;
  const templates = notificationTemplateRows(settings);
  const logs = notificationDeliveryLogs(settings);
  const currentForm = form || notificationTemplateFormFromSettings(settings, selectedType);
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
            <span>统一管理系统邮件模板、变量、发送测试和最近发送记录。</span>
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

      <section className={styles.documentGroupCard}>
        <strong>抄送设置</strong>
        <UiSwitch
          label="默认抄送管理员"
          description="发送该类型通知时，自动抄送系统中已启用的管理员邮箱。"
          checked={currentForm.ccAdminEmails}
          disabled={currentForm.securitySensitive}
          onChange={(value) => setField("ccAdminEmails", value)}
        />
        <label className={styles.notificationTemplateField}>
          额外抄送邮箱
          <textarea
            value={currentForm.ccEmails}
            onChange={(event) => setField("ccEmails", event.target.value)}
            placeholder="多个邮箱可用逗号、分号或换行分隔"
            disabled={currentForm.securitySensitive}
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
        <button className={styles.secondaryButton} type="button" onClick={onTestSend} disabled={saving}>发送测试邮件</button>
      </div>

      <section className={styles.documentGroupCard}>
        <strong>最近发送记录</strong>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>状态</th>
                <th>收件人</th>
                <th>标题</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {logs.length ? logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</td>
                  <td>{log.templateName || log.type}</td>
                  <td>{log.status === "sent" ? "已发送" : log.status === "failed" ? "失败" : log.status}</td>
                  <td>{(log.recipientEmails || []).join("，") || "-"}</td>
                  <td>{log.subject || "-"}</td>
                  <td>{log.errorMessage || "-"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>暂无发送记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </form>
  );
}

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
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载第三方接口设置</div>;
  const currentForm = form || shipsgoIntegrationFormFromSettings(settings);

  function setField<K extends keyof ShipsgoIntegrationForm>(key: K, value: ShipsgoIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof SHIPSGO_FEATURE_OPTIONS[number]["key"]) {
    setField(key, !currentForm[key]);
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>大掌櫃接口配置</strong>
        </div>
      </div>

      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <div className={styles.reportFilterGrid}>
        <UiSwitch
          label="启用大掌櫃"
          description="关闭后，物流信息页面不显示大掌櫃相关入口。"
          checked={currentForm.enabled}
          onChange={(value) => setField("enabled", value)}
        />
        <label>
          API Base URL
          <input
            value={currentForm.apiBaseUrl}
            onChange={(event) => setField("apiBaseUrl", event.target.value)}
            placeholder="https://api.shipsgo.com"
          />
        </label>
        <label>
          API Key
          <input
            value={currentForm.apiKey}
            onChange={(event) => setField("apiKey", event.target.value)}
            placeholder={currentForm.apiKeyConfigured ? "已配置，留空则保持不变" : "请输入大掌櫃 API Key"}
            autoComplete="off"
          />
        </label>
        <label>
          剩余 Credit 预警阈值
          <input
            value={currentForm.creditWarningThreshold}
            onChange={(event) => setField("creditWarningThreshold", event.target.value)}
            inputMode="numeric"
            min={0}
            type="number"
          />
        </label>
        <label>
          每日同步时间
          <input
            value={currentForm.dailySyncTime}
            onChange={(event) => setField("dailySyncTime", event.target.value)}
            type="time"
          />
        </label>
        <label>
          Webhook Secret
          <input
            value={currentForm.webhookSecret}
            onChange={(event) => setField("webhookSecret", event.target.value)}
            placeholder={currentForm.webhookSecretConfigured ? "已配置，留空则保持不变" : "用于校验大掌櫃 Webhook"}
            autoComplete="off"
          />
        </label>
      </div>

      <section className={styles.documentGroupCard}>
        <strong>前台功能显示</strong>
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
      </section>

      <div className={styles.emptyState}>
        当前状态：{currentForm.enabled ? (currentForm.apiKeyConfigured || currentForm.apiKey ? "已启用" : "待填写 API Key") : "已关闭"}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存大掌櫃设置"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复当前值</button>
      </div>
    </form>
  );
}
