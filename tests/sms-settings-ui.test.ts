import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsTypes = [
  readFileSync("app/modules/settings/types-forms.ts", "utf8"),
  readFileSync("app/modules/settings/types-integrations.ts", "utf8"),
  readFileSync("app/modules/settings/types-records.ts", "utf8"),
].join("\n");
const settingsFlow = [
  readFileSync("app/modules/settings/settings-tab-options.ts", "utf8"),
  readFileSync("app/modules/settings/settings-view-constants.ts", "utf8"),
  readFileSync("app/modules/settings/settings-config-helpers.ts", "utf8"),
  readFileSync("app/modules/settings/use-settings-state.ts", "utf8"),
  readFileSync("app/modules/settings/use-settings-load-actions.ts", "utf8"),
  readFileSync("app/modules/settings/use-settings-system-save-actions.ts", "utf8"),
  readFileSync("app/modules/settings/use-settings-controller.ts", "utf8"),
  readFileSync("app/modules/settings/module-tab-content.tsx", "utf8"),
].join("\n");
const smsCard = readFileSync("app/modules/settings/sms-integration-settings-card.tsx", "utf8");
const supplierTypes = readFileSync("app/modules/settings/types-forms.ts", "utf8")
  + readFileSync("app/modules/settings/types-records.ts", "utf8");
const supplierHelpers = readFileSync("app/modules/settings/settings-form-helpers.ts", "utf8");
const supplierFields = readFileSync("app/modules/settings/supplier-purchase-settings-fields.tsx", "utf8");
const supplierPanel = readFileSync("app/modules/settings/supplier-edit-panel.tsx", "utf8");
const supplierSave = readFileSync("app/modules/settings/use-settings-entity-save-actions.ts", "utf8");
const deliveryLogSerializer = readFileSync("lib/platform/notification-settings.ts", "utf8");
const deliveryLogTable = readFileSync("app/modules/settings/notification-delivery-log-table.tsx", "utf8");

test("settings center exposes a complete Tencent SMS settings flow", () => {
  assert.match(settingsTypes, /type SmsIntegrationForm/);
  assert.match(settingsTypes, /provider: "TENCENT_CLOUD"/);
  assert.match(settingsTypes, /secretIdConfigured: boolean/);
  assert.match(settingsTypes, /secretKeyConfigured: boolean/);
  assert.match(settingsFlow, /key: "smsIntegration", label: "短信通知"/);
  assert.match(settingsFlow, /"\/api\/settings\/sms"/);
  assert.match(settingsFlow, /method: "PATCH"/);
  assert.match(settingsFlow, /smsIntegrationFormFromSettings/);
  assert.match(settingsFlow, /secretId: ""/);
  assert.match(settingsFlow, /secretKey: ""/);
  assert.match(settingsFlow, /<SmsIntegrationSettingsCard/);
});

test("SMS card keeps stored secrets masked and does not expose a test-send action", () => {
  assert.match(smsCard, /title="短信通知"/);
  assert.match(smsCard, /type="password"[\s\S]*currentForm\.secretId/);
  assert.match(smsCard, /type="password"[\s\S]*currentForm\.secretKey/);
  assert.match(smsCard, /已配置，留空则保持不变/);
  assert.match(smsCard, /加密保存，仅供服务端调用腾讯云短信/);
  assert.match(smsCard, /必须正好包含 1 个变量/);
  assert.match(smsCard, /采购订单\{"\{1\}"\}已下发/);
  assert.match(smsCard, /本系统仅填写审核通过后的 Template ID/);
  assert.doesNotMatch(smsCard, /\/api\/settings\/sms\/test/);
  assert.doesNotMatch(smsCard, />测试(?:连接|发送|短信)</);
});

test("product supplier form carries opt-in SMS fields and validates the notification phone", () => {
  assert.match(supplierTypes, /dispatchSmsEnabled: boolean/);
  assert.match(supplierTypes, /dispatchSmsPhone: string/);
  assert.match(supplierHelpers, /dispatchSmsEnabled: false/);
  assert.match(supplierHelpers, /dispatchSmsPhone: ""/);
  assert.match(supplierHelpers, /dispatchSmsEnabled: Boolean\(supplier\.dispatchSmsEnabled\)/);
  assert.match(supplierHelpers, /dispatchSmsPhone: supplier\.dispatchSmsPhone \|\| ""/);
  assert.match(supplierPanel, /factoryDocumentCapable \? \([\s\S]*<SupplierPurchaseSettingsFields/);
  assert.match(supplierPanel, /remainsProductSupplier[\s\S]*dispatchSmsEnabled: false[\s\S]*dispatchSmsPhone: ""/);
  assert.match(supplierFields, /label="订单下发时发送短信"/);
  assert.match(supplierFields, /采购通知手机号/);
  assert.match(supplierFields, /required=\{form\.dispatchSmsEnabled\}/);
  assert.match(supplierSave, /启用采购短信通知后，请填写采购通知手机号/);
  assert.match(supplierSave, /dispatchSmsEnabled: supplierForm\.dispatchSmsEnabled/);
  assert.match(supplierSave, /dispatchSmsPhone: supplierForm\.dispatchSmsPhone/);
});

test("SMS delivery logs expose masked phones and distinguish accepted from delivered", () => {
  assert.match(settingsTypes, /channel: string/);
  assert.match(settingsTypes, /recipientPhones: string\[\]/);
  assert.match(deliveryLogSerializer, /log\.recipientPhones\.map\(maskPhone\)/);
  assert.match(deliveryLogTable, /采购订单短信通知/);
  assert.match(deliveryLogTable, /SUBMITTED: "腾讯云已受理"/);
  assert.match(deliveryLogTable, /UNKNOWN: "发送结果未知"/);
  assert.doesNotMatch(deliveryLogTable, /SUBMITTED: "已送达"/);
});
