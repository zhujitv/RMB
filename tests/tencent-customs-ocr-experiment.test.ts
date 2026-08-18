import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";

const route = readFileSync("app/api/settings/ocr/tencent-customs-experiment/route.ts", "utf8");
const service = readFileSync("lib/platform/tencent-customs-ocr-experiment.ts", "utf8");
const settings = readFileSync("lib/platform/ocr-integration-settings.ts", "utf8");
const config = readFileSync("lib/platform/ocr-integration-config.ts", "utf8");
const card = readFileSync("app/modules/settings/tencent-customs-ocr-test-card.tsx", "utf8");

test("Tencent customs OCR experiment is settings-admin only and memory-only", () => {
  assert.match(route, /requireApiWrite\(request, "settings"\)/);
  assert.match(route, /assertMultipartRequestWithinLimit/);
  assert.match(route, /formData\.get\("file"\)/);
  assert.match(service, /assertWrite\(actor, "settings"\)/);
  assert.match(service, /readValidatedPdfUploadFile/);
  assert.match(service, /savedToBusinessData: false/);
  assert.doesNotMatch(service, /putR2Object|prisma\..*create|prisma\..*update|orderDocument/);
});

test("Tencent credentials are encrypted and never serialized back to the browser", () => {
  assert.match(settings, /"tencentSecretId", "tencentSecretKey"/);
  assert.match(settings, /encryptSystemSettingSecrets\(value, OCR_INTEGRATION_SETTING_KEY, OCR_SECRET_FIELDS\)/);
  assert.match(config, /tencentSecretId: ""/);
  assert.match(config, /tencentSecretKey: ""/);
  assert.match(config, /tencentSecretIdConfigured/);
  assert.match(config, /tencentSecretKeyConfigured/);
});

test("experiment runs dedicated customs recognition and table V3 without enabling business OCR", () => {
  assert.match(service, /RecognizeGeneralInvoice/);
  assert.match(service, /Types: \[22\]/);
  assert.match(service, /EnableMultiplePage: true/);
  assert.match(service, /RecognizeTableAccurateOCR/);
  assert.match(service, /UseNewModel: true/);
  assert.match(service, /Promise\.allSettled/);
  assert.match(card, /报关单专用识别和表格识别 V3/);
  assert.match(card, /不写入订单、不保存附件、不修改报关或退税数据/);
});

test("table candidates retain commodity name, code, quantity/unit and source coordinates", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 2,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号", "商品编号", "商品名称及规格型号", "数量及单位", "单价/总价/币制"],
      ["1", "3918909000", "木塑复合地板 140×25", "1200 千克\n80 平方米", "12.50/15000/USD"],
    ],
    cells: [],
  }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].page, 2);
  assert.equal(items[0].commodityCode, "3918909000");
  assert.equal(items[0].nameAndSpecification, "木塑复合地板 140×25");
  assert.deepEqual(items[0].quantityUnits, [
    { quantity: "1200", unit: "千克" },
    { quantity: "80", unit: "平方米" },
  ]);
});

test("transition product name excludes customs declaration elements", async () => {
  const { customsProductName } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  assert.equal(customsProductName("塑料制柱子 0|2|杆|58%木粉 37%PE塑料 5%化学助剂|无品牌|无型号"), "塑料制柱子");
  assert.equal(customsProductName("木塑复合地板\n0|0|室外用|无品牌"), "木塑复合地板");
  assert.equal(customsProductName("1 3916909000 塑料制柱子"), "塑料制柱子");
  assert.equal(customsProductName("3916909000 木塑复合地板"), "木塑复合地板");
});
