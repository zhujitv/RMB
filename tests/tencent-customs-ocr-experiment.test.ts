import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://user:password@localhost:5432/rmb_test";

const route = readFileSync("app/api/settings/ocr/tencent-customs-experiment/route.ts", "utf8");
const service = readFileSync("lib/platform/tencent-customs-ocr-experiment.ts", "utf8");
const settings = readFileSync("lib/platform/ocr-integration-settings.ts", "utf8");
const config = readFileSync("lib/platform/ocr-integration-config.ts", "utf8");
const card = readFileSync("app/modules/settings/tencent-customs-ocr-test-card.tsx", "utf8");
const whitelistCard = readFileSync("app/modules/settings/customs-product-whitelist-card.tsx", "utf8");
const jiti = createJiti(import.meta.url);

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
  assert.match(service, /extractPdfTextFromPdfBuffer/);
  assert.match(service, /candidateItemsFromCustomsText/);
  assert.match(service, /applyCustomsProductWhitelist/);
  assert.match(service, /CUSTOMS_GOODS_WHITELIST_NOT_MATCHED/);
  assert.match(service, /表格识别漏读的\$\{additions\.length\}行商品已从PDF文本补充/);
  assert.match(card, /报关单专用识别和表格识别 V3/);
  assert.match(card, /不写入订单、不保存附件、不修改报关或退税数据/);
});

test("customs product whitelist controls are exposed in OCR settings", () => {
  assert.match(whitelistCard, /报关品名白名单/);
  assert.match(whitelistCard, /启用白名单模式/);
  assert.match(whitelistCard, /标准报关品名/);
  assert.match(whitelistCard, /OCR 别名/);
  assert.match(whitelistCard, /HS Code/);
  assert.match(config, /customsProductWhitelistEnabled/);
  assert.match(config, /normalizeCustomsProductWhitelist/);
});

test("customs product whitelist standardizes matched names and excludes unknown names", async () => {
  const { applyCustomsProductWhitelist } = await jiti.import<
    typeof import("../lib/platform/customs-product-whitelist.ts")
  >("../lib/platform/customs-product-whitelist.ts");
  const warnings: string[] = [];
  const items = applyCustomsProductWhitelist([
    { productName: "塑料墙板", commodityCode: "3918909000", quantityUnits: [{ quantity: "10", unit: "千克" }] },
    { productName: "木制托盘", commodityCode: "4415209090", quantityUnits: [{ quantity: "2", unit: "件" }] },
  ], {
    customsProductWhitelistEnabled: true,
    customsProductWhitelist: [{
      id: "wall-panel",
      standardName: "塑料制墙板",
      aliases: ["塑料墙板"],
      hsCodes: ["3918909000"],
      enabled: true,
    }],
  }, warnings);
  assert.equal(items.length, 1);
  assert.equal(items[0].productName, "塑料制墙板");
  assert.equal(items[0].customsWhitelistMatched, true);
  assert.match(warnings.join("；"), /白名单标准化为“塑料制墙板”/);
  assert.match(warnings.join("；"), /未命中报关品名白名单/);
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

test("table candidates never use HS code as quantity or product name as unit", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号", "商品编号", "商品名称及规格型号", "数量及单位", "备用识别列", "总价"],
      ["1", "3918909000", "塑料制地板", "3918909000 塑料制地板", "16250 千克", "16250.00"],
    ],
    cells: [],
  }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].commodityCode, "3918909000");
  assert.equal(items[0].productName, "塑料制地板");
  assert.deepEqual(items[0].quantityUnits, [{ quantity: "16250", unit: "千克" }]);
});

test("table candidates split customs rows collapsed into one OCR column", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号 商品编号 商品名称及规格型号 数量及单位 总价 币制"],
      ["1 3918909000 塑料制地板 16250 千克 16250.00 USD"],
      ["2 3916909000 塑料制柱子 23301 千克 110898.92 USD"],
    ],
    cells: [],
  }]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => ({
    itemNo: item.itemNo,
    commodityCode: item.commodityCode,
    productName: item.productName,
    quantityUnits: item.quantityUnits,
  })), [
    { itemNo: "1", commodityCode: "3918909000", productName: "塑料制地板", quantityUnits: [{ quantity: "16250", unit: "千克" }] },
    { itemNo: "2", commodityCode: "3916909000", productName: "塑料制柱子", quantityUnits: [{ quantity: "23301", unit: "千克" }] },
  ]);
});

test("table candidates split multiple customs products merged into one OCR row", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号 商品编号 商品名称及规格型号 数量及单位 总价 币制"],
      ["1 3918909000 塑料制地板 16250 千克 16250.00 USD 2 7326909000 不锈钢连接件 240 件 1800.00 USD"],
    ],
    cells: [],
  }]);
  assert.deepEqual(items.map((item) => ({
    itemNo: item.itemNo,
    commodityCode: item.commodityCode,
    productName: item.productName,
    quantityUnits: item.quantityUnits,
  })), [
    { itemNo: "1", commodityCode: "3918909000", productName: "塑料制地板", quantityUnits: [{ quantity: "16250", unit: "千克" }] },
    { itemNo: "2", commodityCode: "7326909000", productName: "不锈钢连接件", quantityUnits: [{ quantity: "240", unit: "件" }] },
  ]);
});

test("customs PDF text fallback supplements products missed by table OCR", async () => {
  const { candidateItemsFromCustomsText } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const text = [
    "商品项号 商品编号 商品名称、规格型号 成交数量及单位 总价 币制",
    "1 3918909000 塑料制地板 0|2|PVC|无品牌 22430千克 2880片 8.9550 25790.40 美元",
    "2 7326199000 不锈钢连接件 0|2|非工业用|不锈钢|冲压 190千克 25000套 0.1200 3000.00 美元",
  ].join("\n");
  const items = candidateItemsFromCustomsText(text);
  assert.deepEqual(items.map((item) => ({
    itemNo: item.itemNo,
    commodityCode: item.commodityCode,
    productName: item.productName,
    quantityUnits: item.quantityUnits,
  })), [
    {
      itemNo: "1",
      commodityCode: "3918909000",
      productName: "塑料制地板",
      quantityUnits: [
        { quantity: "22430", unit: "千克" },
        { quantity: "2880", unit: "片" },
      ],
    },
    {
      itemNo: "2",
      commodityCode: "7326199000",
      productName: "不锈钢连接件",
      quantityUnits: [
        { quantity: "190", unit: "千克" },
        { quantity: "25000", unit: "套" },
      ],
    },
  ]);
});

test("table candidates zip customs products split across multiline cells", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号", "商品编号", "品名", "成交数量", "成交单位", "总价"],
      ["1\n2", "3918909000\n7326909000", "塑料制地板\n不锈钢连接件", "16250\n240", "千克\n件", "16250.00\n1800.00"],
    ],
    cells: [],
  }]);
  assert.equal(items.length, 2);
  assert.equal(items[0].productName, "塑料制地板");
  assert.deepEqual(items[0].quantityUnits, [{ quantity: "16250", unit: "千克" }]);
  assert.equal(items[1].productName, "不锈钢连接件");
  assert.deepEqual(items[1].quantityUnits, [{ quantity: "240", unit: "件" }]);
});

test("table candidates split product lines when each product has multiple quantity units", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号", "商品编号", "品名", "成交数量及单位", "总价"],
      [
        "1\n2\n3",
        "3918909000\n3916909000\n7326909000",
        "塑料制地板\n塑料制柱子\n不锈钢连接件",
        "16250 千克\n80 平方米\n23301 千克\n186 米\n240 千克\n25000 套",
        "16250.00\n110898.92\n1800.00",
      ],
    ],
    cells: [],
  }]);
  assert.deepEqual(items.map((item) => ({
    itemNo: item.itemNo,
    commodityCode: item.commodityCode,
    productName: item.productName,
    quantityUnits: item.quantityUnits,
  })), [
    {
      itemNo: "1",
      commodityCode: "3918909000",
      productName: "塑料制地板",
      quantityUnits: [
        { quantity: "16250", unit: "千克" },
        { quantity: "80", unit: "平方米" },
      ],
    },
    {
      itemNo: "2",
      commodityCode: "3916909000",
      productName: "塑料制柱子",
      quantityUnits: [
        { quantity: "23301", unit: "千克" },
        { quantity: "186", unit: "米" },
      ],
    },
    {
      itemNo: "3",
      commodityCode: "7326909000",
      productName: "不锈钢连接件",
      quantityUnits: [
        { quantity: "240", unit: "千克" },
        { quantity: "25000", unit: "套" },
      ],
    },
  ]);
});

test("table candidates match product lines by inline quantity-unit groups", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号", "商品编号", "品名", "成交数量及单位", "总价"],
      [
        "1\n2\n3",
        "3918909000\n3916909000\n7326909000",
        "塑料制地板\n塑料制柱子\n不锈钢连接件",
        "16250 千克 80 平方米 23301 千克 186 米 240 千克 25000 套",
        "16250.00\n110898.92\n1800.00",
      ],
    ],
    cells: [],
  }]);
  assert.deepEqual(items.map((item) => ({
    productName: item.productName,
    quantityUnits: item.quantityUnits,
  })), [
    {
      productName: "塑料制地板",
      quantityUnits: [
        { quantity: "16250", unit: "千克" },
        { quantity: "80", unit: "平方米" },
      ],
    },
    {
      productName: "塑料制柱子",
      quantityUnits: [
        { quantity: "23301", unit: "千克" },
        { quantity: "186", unit: "米" },
      ],
    },
    {
      productName: "不锈钢连接件",
      quantityUnits: [
        { quantity: "240", unit: "千克" },
        { quantity: "25000", unit: "套" },
      ],
    },
  ]);
});

test("table candidates handle split quantity and unit columns", async () => {
  const { candidateItemsFromTencentTables } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  const items = candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 0,
    type: 2,
    rows: [
      ["项号", "商品编号", "品名", "成交数量", "成交单位", "总价"],
      ["1", "3918909000", "塑料制地板", "16250", "千克", "16250.00"],
      ["2", "3916909000", "塑料制柱子", "23301", "千克", "110898.92"],
    ],
    cells: [],
  }]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.quantityUnits), [
    [{ quantity: "16250", unit: "千克" }],
    [{ quantity: "23301", unit: "千克" }],
  ]);
});

test("transition product name excludes customs declaration elements", async () => {
  const { customsProductName } = await import("../lib/platform/tencent-customs-ocr-table-parser.ts");
  assert.equal(customsProductName("塑料制柱子 0|2|杆|58%木粉 37%PE塑料 5%化学助剂|无品牌|无型号"), "塑料制柱子");
  assert.equal(customsProductName("木塑复合地板\n0|0|室外用|无品牌"), "木塑复合地板");
  assert.equal(customsProductName("1 3916909000 塑料制柱子"), "塑料制柱子");
  assert.equal(customsProductName("3916909000 木塑复合地板"), "木塑复合地板");
});
