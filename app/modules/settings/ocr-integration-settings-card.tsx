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
  type CustomsPdfFullTextTestItem = {
    itemNo?: string | null;
    hsCode?: string | null;
    productName?: string | null;
    specification?: string | null;
    quantity?: number | null;
    unit?: string | null;
    unitPrice?: number | null;
    totalPrice?: number | null;
    currency?: string | null;
  };

  type CustomsPdfFullTextTestResult = {
    success?: boolean;
    method?: string;
    fileName?: string;
    textLength?: number;
    header?: {
      customsDeclarationNo?: string | null;
      declarationDate?: string | null;
      exportDate?: string | null;
      domesticShipper?: string | null;
      overseasConsignee?: string | null;
      tradeMode?: string | null;
      transactionMode?: string | null;
      currency?: string | null;
      totalAmount?: number | null;
    };
    items?: CustomsPdfFullTextTestItem[];
    rawTextPreview?: string;
  };

  type CustomsPdfFullTextTestResponse = CustomsPdfFullTextTestResult & {
    success?: boolean;
    message?: string;
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [customsTestBusy, setCustomsTestBusy] = useState(false);
  const [customsTestProgress, setCustomsTestProgress] = useState(0);
  const [customsTestMessage, setCustomsTestMessage] = useState("");
  const [customsTestError, setCustomsTestError] = useState("");
  const [customsTestResult, setCustomsTestResult] = useState<CustomsPdfFullTextTestResult | null>(null);

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
    if (value == null || value === "") return "未识别";
    return String(value);
  }

  async function runCustomsPdfFullTextTest(file: File | null) {
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
      const response = await uploadFormDataWithProgress<CustomsPdfFullTextTestResponse>(
        "/api/settings/ocr/customs-pdf-full-text-test",
        formData,
        setCustomsTestProgress,
      );
      setCustomsTestResult(response || null);
      setCustomsTestMessage(response.message || "PDF报关单整单文本解析测试完成");
    } catch (error) {
      setCustomsTestError(error instanceof Error ? error.message : "PDF报关单整单文本解析测试失败");
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

      <SettingsCard title="PDF报关单整单文本解析测试" icon="测">
        <SettingsSection title="上传 PDF 测试">
          <div className={styles.settingsFieldGrid}>
            <SettingsField label="测试文件">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={(event) => void runCustomsPdfFullTextTest(event.target.files?.[0] || null)}
                />
                <button
                  className={styles.primaryButtonCompact}
                  type="button"
                  disabled={customsTestBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {customsTestBusy ? "解析中..." : "选择报关单 PDF 测试整单解析"}
                </button>
                <span className={styles.emptyState} style={{ margin: 0, padding: 0 }}>
                  仅测试 PDF 文本解析，不调用 OCR，不保存业务数据。
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
              <span className={styles.emptyState} style={{ margin: 0, padding: 0 }}>解析中 {customsTestProgress}%</span>
            </div>
          ) : null}
          {customsTestError ? <div className={styles.inlineError}>{customsTestError}</div> : null}
          {customsTestMessage && !customsTestError ? <div className={styles.emptyState}>{customsTestMessage}</div> : null}
          {customsTestResult ? (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <div className={styles.settingsFieldGrid}>
                <SettingsField label="解析方式">{customsTestResult.method === "PDF_TEXT_FULL_PARSE" ? "PDF文本解析" : displayValue(customsTestResult.method)}</SettingsField>
                <SettingsField label="是否调用OCR">否</SettingsField>
                <SettingsField label="是否保存业务数据">否</SettingsField>
                <SettingsField label="文本长度">{displayValue(customsTestResult.textLength)}</SettingsField>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>识别结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["报关单号", customsTestResult.header?.customsDeclarationNo],
                      ["申报日期", customsTestResult.header?.declarationDate],
                      ["出口日期", customsTestResult.header?.exportDate],
                      ["境内发货人", customsTestResult.header?.domesticShipper],
                      ["境外收货人", customsTestResult.header?.overseasConsignee],
                      ["贸易方式", customsTestResult.header?.tradeMode],
                      ["成交方式", customsTestResult.header?.transactionMode],
                      ["币制", customsTestResult.header?.currency],
                      ["总金额", customsTestResult.header?.totalAmount],
                    ].map(([label, value]) => (
                      <tr key={`customs-header-${label}`}>
                        <td>{label}</td>
                        <td>{displayValue(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {customsTestResult.items?.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>项号</th>
                        <th>商品编号 / HS编码</th>
                        <th>商品名称</th>
                        <th>规格型号</th>
                        <th>数量</th>
                        <th>单位</th>
                        <th>单价</th>
                        <th>总价</th>
                        <th>币种</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customsTestResult.items.map((row, index) => {
                        return (
                          <tr key={`customs-test-item-${index}`}>
                            <td>{displayValue(row.itemNo)}</td>
                            <td>{displayValue(row.hsCode)}</td>
                            <td>{displayValue(row.productName)}</td>
                            <td>{displayValue(row.specification)}</td>
                            <td>{displayValue(row.quantity)}</td>
                            <td>{displayValue(row.unit)}</td>
                            <td>{displayValue(row.unitPrice)}</td>
                            <td>{displayValue(row.totalPrice)}</td>
                            <td>{displayValue(row.currency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={styles.inlineError}>未解析到商品明细，请检查PDF文本结构。</div>
              )}
              <details>
                <summary>原始文本预览</summary>
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
                  {customsTestResult.rawTextPreview || "未识别"}
                </pre>
              </details>
            </div>
          ) : null}
        </SettingsSection>
      </SettingsCard>

      <div className={styles.emptyState}>增值税发票和采购合同结构化识别需要 AccessKey ID / Secret；仅配置 AppCode 时会走 PDF 文本兜底。</div>
    </SettingsPage>
  );
}
