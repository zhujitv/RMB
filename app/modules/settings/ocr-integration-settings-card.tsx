import { type FormEvent, useRef, useState } from "react";
import { PermissionSelectItem, UiSwitch } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { CompanyProfileSettings } from "../../types";
import { uploadFormDataWithProgress, validatePdfUploadFile } from "../../utils";
import { BooleanSelect } from "./common-controls";
import {
  COMMISSION_FORMULA_DEDUCTIONS,
  COMMISSION_FORMULA_PRESETS,
  COMMISSION_FORMULA_SOURCES,
  EXCHANGE_RATE_SOURCES,
  EXCHANGE_RATE_TYPES,
  NOTIFICATION_RECIPIENT_EMAIL_OPTIONS,
  CUSTOMS_DECLARATION_MODE_OPTIONS,
  OCR_FEATURE_OPTIONS,
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
  ocrIntegrationFormFromSettings,
  shipsgoIntegrationFormFromSettings,
} from "./helpers";
import {
  SecretField,
  SettingsCard,
  SettingsField,
  SettingsPage,
  SettingsSection,
  SettingsStatusTag,
  SettingsSwitch,
} from "./settings-layout";
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
  OcrIntegrationForm,
  OcrIntegrationSettings,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
} from "./types";

export function OcrIntegrationSettingsCard({
  settings,
  form,
  loading,
  saving,
  message,
  onChange,
  onReset,
  onSubmit,
}: {
  settings: OcrIntegrationSettings | null;
  form: OcrIntegrationForm | null;
  loading: boolean;
  saving: boolean;
  message: string;
  onChange: (form: OcrIntegrationForm) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  type CustomsOcrTestResult = {
    fileName?: string;
    source?: string;
    provider?: string;
    apiName?: string;
    parser?: string;
    confidence?: number | null;
    textLength?: number;
    docMindAttempted?: boolean;
    docMindSucceeded?: boolean;
    docMindErrorCode?: string;
    docMindErrorMessage?: string;
    fallbackUsed?: boolean;
    fields?: Record<string, unknown>;
    itemsCount?: number;
    itemsPreview?: unknown[];
    rawJsonPreview?: string;
  };

  type CustomsOcrTestResponse = {
    success?: boolean;
    result?: CustomsOcrTestResult;
    message?: string;
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [customsTestBusy, setCustomsTestBusy] = useState(false);
  const [customsTestProgress, setCustomsTestProgress] = useState(0);
  const [customsTestMessage, setCustomsTestMessage] = useState("");
  const [customsTestError, setCustomsTestError] = useState("");
  const [customsTestResult, setCustomsTestResult] = useState<CustomsOcrTestResult | null>(null);

  if (loading) return <div className={styles.emptyState}>数据加载中...</div>;
  if (!settings) return <div className={styles.emptyState}>点击刷新当前页加载 OCR 设置</div>;
  const currentForm = form || ocrIntegrationFormFromSettings(settings);
  const hasCredential = Boolean(
    currentForm.appCodeConfigured ||
    currentForm.appCode ||
    currentForm.accessKeyIdConfigured ||
    currentForm.accessKeyId,
  );
  const statusTone = currentForm.enabled ? (hasCredential ? "success" : "warning") : "muted";
  const statusLabel = currentForm.enabled ? (hasCredential ? "已启用" : "待填写密钥") : "已关闭";

  function setField<K extends keyof OcrIntegrationForm>(key: K, value: OcrIntegrationForm[K]) {
    onChange({ ...currentForm, [key]: value });
  }

  function toggleFeature(key: typeof OCR_FEATURE_OPTIONS[number]["key"]) {
    if (key === "fallbackToPdfText" && currentForm.customsDeclarationMode === "STRICT") {
      setField("fallbackToPdfText", false);
      return;
    }
    setField(key, !currentForm[key]);
  }

  function resetCustomsTestInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function displayValue(value: unknown) {
    if (value == null || value === "") return "-";
    return String(value);
  }

  async function runCustomsOcrTest(file: File | null) {
    setCustomsTestMessage("");
    setCustomsTestError("");
    setCustomsTestResult(null);
    const validationError = validatePdfUploadFile(file);
    if (validationError || !file) {
      setCustomsTestError(validationError || "请选择 PDF 文件");
      resetCustomsTestInput();
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setCustomsTestBusy(true);
    setCustomsTestProgress(1);
    try {
      const response = await uploadFormDataWithProgress<CustomsOcrTestResponse>(
        "/api/settings/ocr/test-customs",
        formData,
        setCustomsTestProgress,
      );
      setCustomsTestResult(response.result || null);
      setCustomsTestMessage(response.message || "报关单识别测试完成");
    } catch (error) {
      setCustomsTestError(error instanceof Error ? error.message : "测试报关单识别失败");
    } finally {
      setCustomsTestBusy(false);
      resetCustomsTestInput();
    }
  }

  return (
    <SettingsPage
      title="OCR识别"
      description="统一管理 OCR 服务配置、密钥和识别能力。"
      status={<SettingsStatusTag tone={statusTone}>{statusLabel}</SettingsStatusTag>}
      onSubmit={onSubmit}
      actions={(
        <>
          <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={saving}>恢复</button>
        </>
      )}
    >
      {message ? (
        <div className={message.includes("失败") || message.includes("无权限") || message.includes("错误") ? styles.inlineError : styles.emptyState}>
          {message}
        </div>
      ) : null}

      <SettingsCard title="基础配置" icon="OCR">
        <div className={styles.settingsFieldGrid}>
          <SettingsSwitch
            label="启用 OCR 服务"
            tooltip="关闭后 OCR 能力不会执行。"
            checked={currentForm.enabled}
            onChange={(value) => setField("enabled", value)}
          />
          <SettingsField label="服务商">
            <select value={currentForm.provider} onChange={(event) => setField("provider", event.target.value)}>
              <option value="ALIYUN">阿里云 OCR</option>
            </select>
          </SettingsField>
          <SettingsField label="API Base URL">
            <input
              value={currentForm.apiBaseUrl}
              onChange={(event) => setField("apiBaseUrl", event.target.value)}
              placeholder="https://ocr-api.cn-hangzhou.aliyuncs.com"
            />
          </SettingsField>
          <SettingsField label="请求超时">
            <input
              value={currentForm.timeoutMs}
              onChange={(event) => setField("timeoutMs", event.target.value)}
              inputMode="numeric"
              min={3000}
              type="number"
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard title="API 密钥" icon="AK">
        <div className={styles.settingsFieldGrid}>
          <SettingsField label="AppCode">
            <SecretField
              value={currentForm.appCode}
              onChange={(value) => setField("appCode", value)}
              placeholder={currentForm.appCodeConfigured ? "已配置，留空则保持不变" : "可选：旧版 AppCode"}
            />
          </SettingsField>
          <SettingsField label="AccessKey ID">
            <SecretField
              value={currentForm.accessKeyId}
              onChange={(value) => setField("accessKeyId", value)}
              placeholder={currentForm.accessKeyIdConfigured ? "已配置，留空则保持不变" : "可选：AccessKey ID"}
            />
          </SettingsField>
          <SettingsField label="AccessKey Secret">
            <SecretField
              value={currentForm.accessKeySecret}
              onChange={(value) => setField("accessKeySecret", value)}
              placeholder={currentForm.accessKeySecretConfigured ? "已配置，留空则保持不变" : "可选：AccessKey Secret"}
            />
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard title="识别能力" icon="能">
        <SettingsSection title="报关单识别模式">
          <div className={styles.settingsFieldGrid}>
            <SettingsField label="报关单识别模式">
              <select
                value={currentForm.customsDeclarationMode}
                onChange={(event) => {
                  const mode = event.target.value as OcrIntegrationForm["customsDeclarationMode"];
                  onChange({
                    ...currentForm,
                    customsDeclarationMode: mode,
                    customsDeclarationEnabled: mode !== "MANUAL",
                    fallbackToPdfText: mode === "STRICT" ? false : currentForm.fallbackToPdfText,
                  });
                }}
              >
                {CUSTOMS_DECLARATION_MODE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </SettingsField>
          </div>
          <div className={styles.emptyState}>
            {CUSTOMS_DECLARATION_MODE_OPTIONS.find((item) => item.value === currentForm.customsDeclarationMode)?.description}
          </div>
        </SettingsSection>
        <SettingsSection title="启用范围">
          <div className={styles.commissionDeductionGrid}>
            {OCR_FEATURE_OPTIONS.map((item) => (
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

      <SettingsCard title="报关单识别测试" icon="测">
        <SettingsSection title="上传 PDF 测试">
          <div className={styles.settingsFieldGrid}>
            <SettingsField label="测试文件">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={(event) => void runCustomsOcrTest(event.target.files?.[0] || null)}
                />
                <button
                  className={styles.primaryButtonCompact}
                  type="button"
                  disabled={customsTestBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {customsTestBusy ? "识别中..." : "选择报关单 PDF 测试识别"}
                </button>
                <span className={styles.emptyState} style={{ margin: 0, padding: 0 }}>
                  仅测试识别，不保存订单数据，不影响资料回传 OCR。
                </span>
              </div>
            </SettingsField>
          </div>
          {customsTestBusy ? (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              <div style={{ height: 8, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(1, Math.min(100, customsTestProgress))}%`,
                    height: "100%",
                    background: "#2563eb",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
              <span className={styles.emptyState} style={{ margin: 0, padding: 0 }}>识别中 {customsTestProgress}%</span>
            </div>
          ) : null}
          {customsTestError ? <div className={styles.inlineError}>{customsTestError}</div> : null}
          {customsTestMessage && !customsTestError ? <div className={styles.emptyState}>{customsTestMessage}</div> : null}
          {customsTestResult ? (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <div className={styles.settingsFieldGrid}>
                <SettingsField label="识别接口">{displayValue(customsTestResult.apiName)}</SettingsField>
                <SettingsField label="数据来源">{displayValue(customsTestResult.source)}</SettingsField>
                <SettingsField label="解析器">{displayValue(customsTestResult.parser)}</SettingsField>
                <SettingsField label="商品明细数">{displayValue(customsTestResult.itemsCount)}</SettingsField>
                <SettingsField label="结构化接口">{customsTestResult.docMindAttempted ? (customsTestResult.docMindSucceeded ? "已调用成功" : "已尝试但失败") : "未调用"}</SettingsField>
                <SettingsField label="是否回退">{customsTestResult.fallbackUsed ? "已回退到通用 OCR" : "未回退"}</SettingsField>
                <SettingsField label="报关单号">{displayValue(customsTestResult.fields?.customsDeclarationNo)}</SettingsField>
                <SettingsField label="申报日期">{displayValue(customsTestResult.fields?.customsDeclarationDate)}</SettingsField>
              </div>
              {customsTestResult.docMindAttempted && !customsTestResult.docMindSucceeded ? (
                <div className={styles.inlineError}>
                  阿里云报关单结构化接口未成功：{displayValue(customsTestResult.docMindErrorCode)}
                  {customsTestResult.docMindErrorMessage ? `，${customsTestResult.docMindErrorMessage}` : ""}
                </div>
              ) : null}
              {customsTestResult.itemsPreview?.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>商品名称</th>
                        <th>数量</th>
                        <th>单位</th>
                        <th>币种</th>
                        <th>总金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customsTestResult.itemsPreview.map((item, index) => {
                        const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
                        return (
                          <tr key={`customs-test-item-${index}`}>
                            <td>{displayValue(row.productName)}</td>
                            <td>{displayValue(row.quantity)}</td>
                            <td>{displayValue(row.unit)}</td>
                            <td>{displayValue(row.currency)}</td>
                            <td>{displayValue(row.totalAmount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.inlineError}>未解析到商品明细；请检查识别接口是否返回结构化商品表。</div>
              )}
              <SettingsField label="原始返回摘要">
                <pre
                  style={{
                    maxHeight: 280,
                    overflow: "auto",
                    padding: 12,
                    borderRadius: 8,
                    background: "#0f172a",
                    color: "#e5e7eb",
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {customsTestResult.rawJsonPreview || "-"}
                </pre>
              </SettingsField>
            </div>
          ) : null}
        </SettingsSection>
      </SettingsCard>

      <div className={styles.emptyState}>增值税发票和采购合同结构化识别需要 AccessKey ID / Secret；仅配置 AppCode 时会走 PDF 文本兜底。</div>
    </SettingsPage>
  );
}
