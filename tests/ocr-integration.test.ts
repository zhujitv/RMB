import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSettingsModuleSource } from "./source-helpers.ts";

const constants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const service = readFileSync("lib/platform/ocr-integration.ts", "utf8");
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const customsParser = readFileSync("lib/customs-declaration-parser.ts", "utf8");
const settingsRoute = readFileSync("app/api/settings/ocr/route.ts", "utf8");
const customsTestRoute = readFileSync("app/api/settings/ocr/test-customs/route.ts", "utf8");
const customsRecognition = readFileSync("lib/platform/customs-recognition.ts", "utf8");
const orderDocuments = readFileSync("lib/platform/order-documents.ts", "utf8");
const r2 = readFileSync("lib/r2.ts", "utf8");
const settingsModule = readSettingsModuleSource();

test("OCR integration settings are modular and stored in system settings", () => {
  assert.match(constants, /OCR_INTEGRATION_SETTING_KEY = "ocr_integration"/);
  assert.match(constants, /DEFAULT_OCR_INTEGRATION_SETTINGS/);
  assert.match(constants, /customsDeclarationMode: "AUTO"/);
  assert.match(constants, /supplierDocumentReturnEnabled: false/);
  assert.match(service, /export type CustomsDeclarationRecognitionMode = "AUTO" \| "STRICT" \| "MANUAL"/);
  assert.match(service, /function cleanCustomsDeclarationMode/);
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

test("OCR settings can run isolated customs declaration recognition diagnostics", () => {
  assert.match(customsTestRoute, /export const runtime = "nodejs"/);
  assert.match(customsTestRoute, /export const maxDuration = 60/);
  assert.match(customsTestRoute, /readValidatedPdfUploadFile\(formData\.get\("file"\), "customs-declaration-test\.pdf"\)/);
  assert.match(customsTestRoute, /testCustomsDeclarationOcr\(actor, file\)/);
  assert.match(service, /export async function testCustomsDeclarationOcr/);
  assert.match(service, /assertWrite\(actor, "settings"\)/);
  assert.match(service, /uploadToR2/);
  assert.match(service, /signedObjectReadUrl\(tempKey, 900\)/);
  assert.match(service, /recognizePdfTextWithOcr\(fileBuffer, "customsDeclaration"/);
  assert.match(service, /deleteR2Object\(tempKey\)/);
  assert.match(service, /itemsCount: items\.length/);
  assert.match(service, /docMindAttempted/);
  assert.match(service, /docMindSucceeded/);
  assert.match(service, /docMindErrorMessage/);
  assert.match(service, /fallbackUsed/);
  assert.match(settingsModule, /\/api\/settings\/ocr\/test-customs/);
  assert.match(settingsModule, /报关单识别测试/);
  assert.match(settingsModule, /选择报关单 PDF 测试识别/);
  assert.match(settingsModule, /仅测试识别，不保存订单数据，不影响资料回传 OCR。/);
  assert.match(settingsModule, /文档智能/);
  assert.match(settingsModule, /是否回退/);
  assert.match(settingsModule, /文档智能贸易单证结构化接口未成功/);
});

test("settings module exposes OCR configuration without leaking secrets", () => {
  assert.match(settingsModule, /"ocrIntegration"/);
  assert.match(settingsModule, /label: "OCR识别"/);
  assert.match(settingsModule, /\/api\/settings\/ocr/);
  assert.match(settingsModule, /OcrIntegrationSettingsCard/);
  assert.match(settingsModule, /title="OCR识别"/);
  assert.match(settingsModule, /SecretField/);
  assert.match(settingsModule, /CUSTOMS_DECLARATION_MODE_OPTIONS/);
  assert.match(settingsModule, /报关单识别模式/);
  assert.match(settingsModule, /严格结构化模式/);
  assert.match(settingsModule, /手工模式/);
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

test("customs table parser reads Aliyun table cells by row and column", async () => {
  process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";
  const { extractCustomsItemsFromAliyunTableData } = await import("../lib/platform/aliyun-customs-table-parser.ts");
  const payload = {
    SubImages: [
      {
        TableInfo: {
          TableDetails: [
            {
              CellDetails: [
                { CellContent: "项号", RowStart: 0, RowEnd: 0, ColumnStart: 0, ColumnEnd: 0 },
                { CellContent: "商品编号", RowStart: 0, RowEnd: 0, ColumnStart: 1, ColumnEnd: 1 },
                { CellContent: "商品名称及规格型号", RowStart: 0, RowEnd: 0, ColumnStart: 2, ColumnEnd: 2 },
                { CellContent: "数量及单位", RowStart: 0, RowEnd: 0, ColumnStart: 3, ColumnEnd: 3 },
                { CellContent: "总价", RowStart: 0, RowEnd: 0, ColumnStart: 4, ColumnEnd: 4 },
                { CellContent: "币制", RowStart: 0, RowEnd: 0, ColumnStart: 5, ColumnEnd: 5 },
                { CellContent: "1", RowStart: 1, RowEnd: 1, ColumnStart: 0, ColumnEnd: 0 },
                { CellContent: "9403200000", RowStart: 1, RowEnd: 1, ColumnStart: 1, ColumnEnd: 1 },
                { CellContent: "铝制工程结构件\n无品牌;无型号", RowStart: 1, RowEnd: 1, ColumnStart: 2, ColumnEnd: 2 },
                { CellContent: "2866.71 千克", RowStart: 1, RowEnd: 1, ColumnStart: 3, ColumnEnd: 3 },
                { CellContent: "86588.10", RowStart: 1, RowEnd: 1, ColumnStart: 4, ColumnEnd: 4 },
                { CellContent: "美元", RowStart: 1, RowEnd: 1, ColumnStart: 5, ColumnEnd: 5 },
                { CellContent: "2", RowStart: 2, RowEnd: 2, ColumnStart: 0, ColumnEnd: 0 },
                { CellContent: "7610900000", RowStart: 2, RowEnd: 2, ColumnStart: 1, ColumnEnd: 1 },
                { CellContent: "铝制栏杆配件", RowStart: 2, RowEnd: 2, ColumnStart: 2, ColumnEnd: 2 },
                { CellContent: "千克 3904.95", RowStart: 2, RowEnd: 2, ColumnStart: 3, ColumnEnd: 3 },
                { CellContent: "131554.34", RowStart: 2, RowEnd: 2, ColumnStart: 4, ColumnEnd: 4 },
                { CellContent: "USD", RowStart: 2, RowEnd: 2, ColumnStart: 5, ColumnEnd: 5 },
                { CellContent: "备注：代理报关委托协议随附", RowStart: 3, RowEnd: 3, ColumnStart: 0, ColumnEnd: 5 },
              ],
            },
          ],
        },
      },
    ],
  };
  const items = extractCustomsItemsFromAliyunTableData(payload, { tradeTerm: "FOB" });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => ({
    productName: item.productName,
    quantity: item.quantity,
    unit: item.unit,
    currency: item.currency,
    totalAmount: item.totalAmount,
  })), [
    { productName: "铝制工程结构件", quantity: 2866.71, unit: "千克", currency: "USD", totalAmount: 86588.1 },
    { productName: "铝制栏杆配件", quantity: 3904.95, unit: "千克", currency: "USD", totalAmount: 131554.34 },
  ]);
});

test("customs table parser handles delayed headers with split quantity and unit columns", async () => {
  process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";
  const { extractCustomsItemsFromAliyunTableData } = await import("../lib/platform/aliyun-customs-table-parser.ts");
  const CellDetails = [
    { CellContent: "报关单号 223120260000000001", RowStart: 0, RowEnd: 0, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "申报日期 2026-07-01", RowStart: 1, RowEnd: 1, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "境内发货人 浙江莱诺建材有限公司", RowStart: 2, RowEnd: 2, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "提运单号 NB26001", RowStart: 3, RowEnd: 3, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "集装箱号 TLLU1234567", RowStart: 4, RowEnd: 4, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "备注 代理报关委托协议随附", RowStart: 5, RowEnd: 5, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "随附单证 发票 装箱单", RowStart: 6, RowEnd: 6, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "境内货源地 浙江绍兴", RowStart: 7, RowEnd: 7, ColumnStart: 0, ColumnEnd: 5 },
    { CellContent: "商品名称及规格型号", RowStart: 8, RowEnd: 8, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "成交数量", RowStart: 8, RowEnd: 8, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "成交单位", RowStart: 8, RowEnd: 8, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "总价", RowStart: 8, RowEnd: 8, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "币制", RowStart: 8, RowEnd: 8, ColumnStart: 4, ColumnEnd: 4 },
    { CellContent: "出境关别(2248)洋山港区", RowStart: 9, RowEnd: 9, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "8.00", RowStart: 9, RowEnd: 9, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "平方米", RowStart: 9, RowEnd: 9, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "2026/6/17", RowStart: 9, RowEnd: 9, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "USD", RowStart: 9, RowEnd: 9, ColumnStart: 4, ColumnEnd: 4 },
    { CellContent: "生产销售单位(M A D X)(BML)", RowStart: 10, RowEnd: 10, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "8.00", RowStart: 10, RowEnd: 10, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "平方米", RowStart: 10, RowEnd: 10, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "99.00", RowStart: 10, RowEnd: 10, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "USD", RowStart: 10, RowEnd: 10, ColumnStart: 4, ColumnEnd: 4 },
    { CellContent: "铝制工程结构件\n无品牌;无型号", RowStart: 11, RowEnd: 11, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "2866.71", RowStart: 11, RowEnd: 11, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "千克", RowStart: 11, RowEnd: 11, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "86588.10", RowStart: 11, RowEnd: 11, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "美元", RowStart: 11, RowEnd: 11, ColumnStart: 4, ColumnEnd: 4 },
  ];
  const items = extractCustomsItemsFromAliyunTableData({ TableInfo: { TableDetails: [{ CellDetails }] } });
  assert.equal(items.length, 1);
  assert.deepEqual({
    productName: items[0]?.productName,
    quantity: items[0]?.quantity,
    unit: items[0]?.unit,
    currency: items[0]?.currency,
    totalAmount: items[0]?.totalAmount,
  }, {
    productName: "铝制工程结构件",
    quantity: 2866.71,
    unit: "千克",
    currency: "USD",
    totalAmount: 86588.1,
  });
});

test("customs item normalizer rejects declaration metadata as product rows", async () => {
  process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";
  const {
    cleanCustomsDeclarationProductNameForTaxRefund,
    normalizeCustomsDeclarationItemForTaxRefund,
  } = await import("../lib/customs-declaration-parser.ts");
  for (const productName of [
    "出境关别(2248)洋山港区",
    "生产销售单位(M A D X)(BML)",
    "生产销售单位(M A D X)(BML)浙江莱诺建材有限公司",
    "境内收发货人 浙江莱诺建材有限公司",
    "浙江莱诺建材有限公司 洋山 区",
    "Major Fence B.V.水路运输HAMBURG EXPRESS / W",
  ]) {
    assert.equal(normalizeCustomsDeclarationItemForTaxRefund({
      productName,
      quantity: 8,
      unit: "平方米",
      totalAmount: 99,
      currency: "USD",
    }), null);
  }
  assert.equal(normalizeCustomsDeclarationItemForTaxRefund({
    productName: "铝制工程结构件",
    quantity: 5771.43,
    unit: "千克",
    totalAmount: 86588.1,
    currency: "USD",
  })?.productName, "铝制工程结构件");
  assert.equal(cleanCustomsDeclarationProductNameForTaxRefund("塑料制栅栏 中国 荷兰（ ）宣城 照章征税"), "塑料制栅栏");
  assert.equal(cleanCustomsDeclarationProductNameForTaxRefund("铝制工程结构 中国荷兰( )宣城照章征税"), "铝制工程结构");
  assert.equal(normalizeCustomsDeclarationItemForTaxRefund({
    productName: "塑料制栅栏 中国 荷兰（ ）宣城 照章征税",
    quantity: 41636.05,
    unit: "千克",
    totalAmount: 10320,
    currency: "USD",
  })?.productName, "塑料制栅栏");
  assert.equal(normalizeCustomsDeclarationItemForTaxRefund({
    productName: "铝制工程结构 中国荷兰( )宣城照章征税",
    quantity: 3904.95,
    unit: "千克",
    totalAmount: 200,
    currency: "USD",
  })?.productName, "铝制工程结构");
});

test("customs table parser filters party and transport rows while trimming item metadata", async () => {
  process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";
  const { extractCustomsItemsFromAliyunTableData } = await import("../lib/platform/aliyun-customs-table-parser.ts");
  const CellDetails = [
    { CellContent: "商品名称", RowStart: 0, RowEnd: 0, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "数量", RowStart: 0, RowEnd: 0, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "单位", RowStart: 0, RowEnd: 0, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "币制", RowStart: 0, RowEnd: 0, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "总价", RowStart: 0, RowEnd: 0, ColumnStart: 4, ColumnEnd: 4 },
    { CellContent: "塑料制栅栏 中国 荷兰（ ）宣城 照章征税", RowStart: 1, RowEnd: 1, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "41636.05", RowStart: 1, RowEnd: 1, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "千克", RowStart: 1, RowEnd: 1, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "USD", RowStart: 1, RowEnd: 1, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "10320.00", RowStart: 1, RowEnd: 1, ColumnStart: 4, ColumnEnd: 4 },
    { CellContent: "浙江莱诺建材有限公司 洋山 区", RowStart: 2, RowEnd: 2, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "8.00", RowStart: 2, RowEnd: 2, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "平方米", RowStart: 2, RowEnd: 2, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "USD", RowStart: 2, RowEnd: 2, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "2248.00", RowStart: 2, RowEnd: 2, ColumnStart: 4, ColumnEnd: 4 },
    { CellContent: "Major Fence B.V.水路运输HAMBURG EXPRESS / W", RowStart: 3, RowEnd: 3, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "8.00", RowStart: 3, RowEnd: 3, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "平方米", RowStart: 3, RowEnd: 3, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "USD", RowStart: 3, RowEnd: 3, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "3.00", RowStart: 3, RowEnd: 3, ColumnStart: 4, ColumnEnd: 4 },
    { CellContent: "铝制工程结构 中国荷兰( )宣城照章征税", RowStart: 4, RowEnd: 4, ColumnStart: 0, ColumnEnd: 0 },
    { CellContent: "3904.95", RowStart: 4, RowEnd: 4, ColumnStart: 1, ColumnEnd: 1 },
    { CellContent: "千克", RowStart: 4, RowEnd: 4, ColumnStart: 2, ColumnEnd: 2 },
    { CellContent: "USD", RowStart: 4, RowEnd: 4, ColumnStart: 3, ColumnEnd: 3 },
    { CellContent: "200.00", RowStart: 4, RowEnd: 4, ColumnStart: 4, ColumnEnd: 4 },
  ];
  const items = extractCustomsItemsFromAliyunTableData({ TableInfo: { TableDetails: [{ CellDetails }] } });
  assert.deepEqual(items.map((item) => ({
    productName: item.productName,
    quantity: item.quantity,
    unit: item.unit,
    currency: item.currency,
    totalAmount: item.totalAmount,
  })), [
    { productName: "塑料制栅栏", quantity: 41636.05, unit: "千克", currency: "USD", totalAmount: 10320 },
    { productName: "铝制工程结构", quantity: 3904.95, unit: "千克", currency: "USD", totalAmount: 200 },
  ]);
});

test("customs recognition is controlled by OCR settings", () => {
  assert.match(customsRecognition, /recognizePdfTextWithOcr\(buffer, "customsDeclaration"/);
  assert.match(customsRecognition, /saveOcrRawResult/);
  assert.match(customsParser, /export async function extractPdfTextFromPdfBuffer/);
  assert.match(orderDocuments, /isOcrFeatureEnabled\("customsDeclaration"\)/);
  assert.match(orderDocuments, /shouldAutoRecognizeCustoms/);
  assert.match(service, /ensureOcrFeatureEnabled/);
  assert.match(service, /OCR_FEATURE_DISABLED/);
  assert.match(service, /settings\.customsDeclarationMode !== "MANUAL"/);
  assert.match(service, /settings\.customsDeclarationMode === "STRICT"/);
  assert.match(service, /报关单严格结构化模式需要配置 AccessKey ID 和 AccessKey Secret。/);
  assert.match(service, /@alicloud\/docmind-api20220711/);
  assert.match(service, /AyncTradeDocumentPackageExtractSmartAppRequest/);
  assert.match(service, /CUSTOMS_TRADE_DOCUMENT_EXTRACTION_RANGE = \["出口报关单", "进口报关单"\]/);
  assert.match(service, /CUSTOMS_DECLARATION_MIN_TIMEOUT_MS = 60000/);
  assert.match(service, /function customsOcrSettings/);
  assert.match(service, /Math\.max\(settings\.timeoutMs, CUSTOMS_DECLARATION_MIN_TIMEOUT_MS\)/);
  assert.match(service, /recognizeAliyunCustomsDeclarationWithDocMind/);
  assert.match(service, /ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT/);
  assert.match(service, /AyncTradeDocumentPackageExtractSmartApp/);
  assert.match(service, /queryDocParserStatus\(new QueryDocParserStatusRequest/);
  assert.match(service, /getDocParserResult\(new GetDocParserResultRequest/);
  assert.match(service, /findDocMindTaskId/);
  assert.match(service, /collectDocMindText/);
  assert.match(service, /readDocMindOutputFiles/);
  assert.match(service, /outputFileUrl/);
  assert.match(service, /throwDocMindCustomsEmptyError/);
  assert.match(service, /customsDiagnosticResultFromError/);
  assert.match(service, /rawJsonPreview/);
  assert.match(service, /ALIYUN_DOCMIND_CUSTOMS_EMPTY/);
  assert.match(service, /ALIYUN_DOCMIND_RESULT_TIMEOUT/);
  assert.match(service, /recognizeAliyunCustomsDeclaration/);
  assert.match(service, /报关单严格结构化模式需要可下载文件 URL，不能回退到通用 OCR。/);
  assert.match(service, /阿里云报关单严格结构化识别失败/);
  assert.match(service, /aliyun-customs-general-structure-failed/);
  assert.match(service, /ALIYUN_CUSTOMS_OCR_TIMEOUT/);
  assert.match(service, /RecognizeAllTextRequest/);
  assert.match(service, /RecognizeAllTextRequestTableConfig/);
  assert.match(service, /outputTable: true/);
  assert.match(service, /type: "Table"/);
  assert.match(service, /tableConfig: new RecognizeAllTextRequestTableConfig/);
  assert.match(service, /ALIYUN_RECOGNIZE_ALL_TEXT_TABLE_FALLBACK/);
  assert.match(service, /ALIYUN_CUSTOMS_FALLBACK_PDF_TEXT/);
  assert.match(r2, /export async function signedObjectReadUrl/);
  assert.match(customsRecognition, /signedObjectReadUrl\(document\.storageKey, 900\)/);
});
