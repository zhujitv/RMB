import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSettingsModuleSource } from "./source-helpers.ts";

const constants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const service = readFileSync("lib/platform/ocr-integration.ts", "utf8");
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const customsParser = readFileSync("lib/customs-declaration-parser.ts", "utf8");
const settingsRoute = readFileSync("app/api/settings/ocr/route.ts", "utf8");
const customsRecognition = readFileSync("lib/platform/customs-recognition.ts", "utf8");
const orderDocuments = readFileSync("lib/platform/order-documents.ts", "utf8");
const settingsModule = readSettingsModuleSource();

test("OCR integration settings are modular and stored in system settings", () => {
  assert.match(constants, /OCR_INTEGRATION_SETTING_KEY = "ocr_integration"/);
  assert.match(constants, /DEFAULT_OCR_INTEGRATION_SETTINGS/);
  assert.match(constants, /supplierDocumentReturnEnabled: false/);
  assert.match(service, /prisma\.systemSetting\.findUnique\(\{ where: \{ key: OCR_INTEGRATION_SETTING_KEY \} \}\)/);
  assert.match(service, /prisma\.systemSetting\.upsert/);
  assert.match(service, /assertRead\(actor, "settings"\)/);
  assert.match(service, /assertWrite\(actor, "settings"\)/);
  assert.match(service, /supplierDocumentReturnEnabled: input\.supplierDocumentReturnEnabled === true/);
  assert.match(service, /accessKeyIdConfigured: Boolean\(normalized\.accessKeyId\)/);
  assert.match(service, /accessKeySecretConfigured: Boolean\(normalized\.accessKeySecret\)/);
  assert.match(service, /appCodeConfigured: Boolean\(normalized\.appCode\)/);
  assert.match(service, /accessKeyId: ""/);
  assert.match(service, /accessKeySecret: ""/);
  assert.match(service, /appCode: ""/);
  assert.match(shared, /export \* from "\.\/ocr-integration"/);
});

test("OCR settings API supports authenticated read and admin write", () => {
  assert.match(settingsRoute, /export async function GET/);
  assert.match(settingsRoute, /readOcrIntegrationSettings\(actor\)/);
  assert.match(settingsRoute, /export async function PATCH/);
  assert.match(settingsRoute, /saveOcrIntegrationSettings\(request, actor, body\)/);
  assert.match(settingsRoute, /OCR设置已保存/);
});

test("settings module exposes OCR configuration without leaking secrets", () => {
  assert.match(settingsModule, /\/api\/settings\/ocr/);
  assert.match(settingsModule, /OcrIntegrationSettingsCard/);
  assert.match(settingsModule, /保存OCR设置/);
  assert.match(settingsModule, /OCR_FEATURE_OPTIONS/);
  assert.match(settingsModule, /产品供应商资料回传 OCR/);
  assert.match(settingsModule, /placeholder=\{currentForm\.appCodeConfigured \? "已配置，留空则保持不变"/);
  assert.match(settingsModule, /setOcrIntegrationSettings/);
  assert.match(settingsModule, /setOcrIntegrationForm\(ocrIntegrationFormFromSettings\(ocrSettings\)\)/);
});

test("customs recognition is controlled by OCR settings", () => {
  assert.match(customsRecognition, /recognizePdfTextWithOcr\(buffer, "customsDeclaration"/);
  assert.match(customsRecognition, /customsDeclarationParser\.parseCustomsDeclarationText\(recognized\.text\)/);
  assert.match(customsParser, /export async function extractPdfTextFromPdfBuffer/);
  assert.match(orderDocuments, /isOcrFeatureEnabled\("customsDeclaration"\)/);
  assert.match(orderDocuments, /shouldAutoRecognizeCustoms/);
  assert.match(service, /ensureOcrFeatureEnabled/);
  assert.match(service, /OCR_FEATURE_DISABLED/);
});
