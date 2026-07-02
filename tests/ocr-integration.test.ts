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
  assert.match(settingsModule, /"ocrIntegration"/);
  assert.match(settingsModule, /label: "OCR识别"/);
  assert.match(settingsModule, /\/api\/settings\/ocr/);
  assert.match(settingsModule, /OcrIntegrationSettingsCard/);
  assert.match(settingsModule, /title="OCR识别"/);
  assert.match(settingsModule, /SecretField/);
  assert.match(settingsModule, /OCR_FEATURE_OPTIONS/);
  assert.match(settingsModule, /发票结构化识别/);
  assert.match(settingsModule, /产品供应商资料回传 OCR/);
  assert.match(settingsModule, /可选：旧版 AppCode/);
  assert.match(settingsModule, /结构化识别需要 AccessKey ID \/ Secret/);
  assert.match(settingsModule, /setOcrIntegrationSettings/);
  assert.match(settingsModule, /setOcrIntegrationForm\(ocrIntegrationFormFromSettings\(ocrSettings\)\)/);
  assert.match(settingsModule, /markLoaded\("ocrIntegration"\)/);
});

test("OCR integration uses Aliyun structured APIs for supplier documents with PDF fallback", () => {
  assert.match(service, /@alicloud\/ocr-api20210707/);
  assert.match(service, /RecognizeInvoiceRequest/);
  assert.match(service, /RecognizeGeneralStructureRequest/);
  assert.match(service, /recognizeInvoice\(new RecognizeInvoiceRequest/);
  assert.match(service, /recognizeGeneralStructure\(new RecognizeGeneralStructureRequest/);
  assert.match(service, /ALIYUN_RECOGNIZE_INVOICE/);
  assert.match(service, /ALIYUN_RECOGNIZE_GENERAL_STRUCTURE/);
  assert.match(service, /recognizeSupplierDocumentWithOcr/);
  assert.match(service, /OCR_ACCESS_KEY_REQUIRED/);
  assert.match(service, /ALIYUN_INVOICE_FALLBACK_PDF_TEXT/);
  assert.match(service, /ALIYUN_CONTRACT_FALLBACK_PDF_TEXT/);
});

test("Aliyun invoice parser reads official Data payload and invoiceDetails", async () => {
  process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";
  const { extractAliyunInvoiceRecognitionData } = await import("../lib/platform/aliyun-invoice-ocr-parser.ts");
  const payload = {
    Data: JSON.stringify({
      data: {
        invoiceNumber: "26342000002030743666",
        invoiceDate: "2026-06-29",
        purchaserName: "浙江莱诺建材有限公司",
        purchaserTaxNumber: "91330681MA2D86XM28",
        sellerName: "安徽科蓝特铝业股份有限公司",
        sellerTaxNumber: "91341822070917615C",
        invoiceAmountPreTax: "101480.27",
        invoiceTax: "13192.44",
        totalAmount: "114672.71",
        invoiceDetails: [
          {
            itemName: "*有色金属压延材*铝制工程结构件",
            specification: "",
            unit: "套",
            quantity: "1",
            unitPrice: "101480.27",
            amount: "101480.27",
            taxRate: "13%",
            tax: "13192.44",
          },
        ],
      },
      prism_keyValueInfo: [
        { key: "invoiceDetails", value: "[{\"itemName\":\"*有色金属压延材*铝制工程结构件\"}]" },
      ],
    }),
  };
  const result = extractAliyunInvoiceRecognitionData(payload);
  assert.equal(result.extractedFields.invoiceNo, "26342000002030743666");
  assert.equal(result.extractedFields.invoiceDate, "2026-06-29");
  assert.equal(result.extractedFields.buyer, "浙江莱诺建材有限公司");
  assert.equal(result.extractedFields.buyerTaxNo, "91330681MA2D86XM28");
  assert.equal(result.extractedFields.seller, "安徽科蓝特铝业股份有限公司");
  assert.equal(result.extractedFields.sellerTaxNo, "91341822070917615C");
  assert.equal(result.extractedFields.amountWithoutTax, "101480.27");
  assert.equal(result.extractedFields.taxAmount, "13192.44");
  assert.equal(result.extractedFields.amountWithTax, "114672.71");
  assert.equal(result.extractedFields.productName, "*有色金属压延材*铝制工程结构件");
  assert.match(result.text, /安徽科蓝特铝业股份有限公司/);
});

test("Aliyun invoice parser falls back to prism key value pairs without merging parties", async () => {
  process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";
  const { extractAliyunInvoiceRecognitionData } = await import("../lib/platform/aliyun-invoice-ocr-parser.ts");
  const payload = {
    Data: JSON.stringify({
      prism_keyValueInfo: [
        { key: "发票号码", value: "26342000002030743666" },
        { key: "开票日期", value: "2026年06月29日" },
        { key: "购买方名称", value: "浙江莱诺建材有限公司" },
        { key: "销售方名称", value: "安徽科蓝特铝业股份有限公司" },
        { key: "购买方纳税人识别号", value: "91330681MA2D86XM28" },
        { key: "销售方纳税人识别号", value: "91341822070917615C" },
        { key: "金额合计", value: "101480.27" },
        { key: "税额合计", value: "13192.44" },
        { key: "价税合计", value: "114672.71" },
        { key: "税率", value: "13%" },
        { key: "invoiceDetails", value: "[{\"itemName\":\"*有色金属压延材*铝制工程结构件\",\"taxRate\":\"13%\"}]" },
      ],
    }),
  };
  const result = extractAliyunInvoiceRecognitionData(payload);
  assert.equal(result.extractedFields.buyer, "浙江莱诺建材有限公司");
  assert.equal(result.extractedFields.seller, "安徽科蓝特铝业股份有限公司");
  assert.equal(result.extractedFields.buyerTaxNo, "91330681MA2D86XM28");
  assert.equal(result.extractedFields.sellerTaxNo, "91341822070917615C");
  assert.equal(result.extractedFields.amountWithTax, "114672.71");
  assert.equal(result.extractedFields.amountWithoutTax, "101480.27");
  assert.equal(result.extractedFields.taxAmount, "13192.44");
  assert.equal(result.extractedFields.taxRate, "13%");
  assert.equal(result.extractedFields.productName, "*有色金属压延材*铝制工程结构件");
});

test("customs recognition is controlled by OCR settings", () => {
  assert.match(customsRecognition, /recognizePdfTextWithOcr\(buffer, "customsDeclaration"/);
  assert.match(customsRecognition, /saveOcrRawResult/);
  assert.match(customsParser, /export async function extractPdfTextFromPdfBuffer/);
  assert.match(orderDocuments, /isOcrFeatureEnabled\("customsDeclaration"\)/);
  assert.match(orderDocuments, /shouldAutoRecognizeCustoms/);
  assert.match(service, /ensureOcrFeatureEnabled/);
  assert.match(service, /OCR_FEATURE_DISABLED/);
  assert.match(service, /recognizeAliyunCustomsDeclaration/);
  assert.match(service, /CUSTOMS_TABLE_KEYS/);
  assert.match(service, /ALIYUN_CUSTOMS_FALLBACK_PDF_TEXT/);
});
