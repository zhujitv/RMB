import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVatInvoiceFields } from "../lib/platform/supplier-vat-invoice-parser.ts";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const service = readFileSync("lib/platform/supplier-document-ocr.ts", "utf8");
const vatParser = readFileSync("lib/platform/supplier-vat-invoice-parser.ts", "utf8");
const supplierRequests = readFileSync("lib/platform/supplier-document-requests.ts", "utf8");
const supplierModule = readFileSync("app/modules/SupplierDocumentsModule.tsx", "utf8");
const ocrRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/[documentId]/ocr/route.ts", "utf8");
const confirmRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/[documentId]/ocr/confirm/route.ts", "utf8");
const rejectRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/[documentId]/ocr/reject/route.ts", "utf8");

test("supplier return OCR stores tasks and fields in independent OCR tables", () => {
  assert.match(schema, /model OcrTask/);
  assert.match(schema, /@@map\("ocr_tasks"\)/);
  assert.match(schema, /model OcrResult/);
  assert.match(schema, /@@map\("ocr_results"\)/);
  assert.match(schema, /document\s+OrderDocument\s+@relation/);
  assert.match(schema, /request\s+SupplierDocumentRequest\?/);
});

test("supplier document upload creates OCR task without changing tax refund module", () => {
  assert.match(supplierRequests, /createSupplierDocumentOcrTaskForUpload\(document\.id\)/);
  assert.match(supplierRequests, /runSupplierDocumentOcrTask\(ocrTask\.id\)/);
  assert.match(supplierRequests, /attachSupplierDocumentOcrTasks/);
  assert.match(supplierRequests, /prisma\.ocrTask\.findMany/);
  assert.match(supplierRequests, /已跳过OCR附加信息/);
  assert.doesNotMatch(supplierRequests, /documents:\s*\{[\s\S]*include:\s*\{[\s\S]*ocrTasks:\s*\{/);
  assert.match(supplierRequests, /serializeSupplierDocumentOcrTask/);
});

test("supplier OCR validates invoice and contract against supplier, business entity, amount, and duplicates", () => {
  assert.match(service, /发票销售方与供应商不一致/);
  assert.match(service, /发票购买方与业务主体不一致/);
  assert.match(service, /发票金额与采购订单金额不一致/);
  assert.match(service, /发票税率不是 13%/);
  assert.match(service, /发票号码已存在，请核查/);
  assert.match(service, /合同供应商与当前供应商不一致/);
  assert.match(service, /合同订单号与采购订单号不一致/);
  assert.match(service, /产品名称、规格或数量无法准确判断，需人工确认/);
  assert.match(service, /amountMatches/);
});

test("supplier VAT invoice OCR uses structured parser and preserves raw text", () => {
  assert.match(service, /recognizeSupplierDocumentWithOcr/);
  assert.match(service, /export function parseVatInvoiceFields\(text: string, structuredFields: Record<string, unknown> = \{\}\)/);
  assert.match(service, /parseVatInvoiceFieldsCore\(text, structuredFields\)/);
  assert.match(vatParser, /structuredPartyFallback\(structuredFields, "seller"\)/);
  assert.match(vatParser, /extractInvoiceNameSequence\(text\)/);
  assert.match(vatParser, /extractInvoiceTaxNoSequence\(text\)/);
  assert.match(vatParser, /structuredAmount\(structuredFields, "amountWithTax"\)/);
  assert.match(vatParser, /function extractPartyName\(section: string, partyLabel: string\)/);
  assert.match(vatParser, /function extractInvoiceAmountWithTax\(text: string\)/);
  assert.match(vatParser, /function extractInvoiceProductName\(text: string\)/);
  assert.match(vatParser, /extractPartyTaxNo\(sellerSection\)/);
  assert.match(vatParser, /extractPartyTaxNo\(buyerSection\)/);
  assert.match(service, /invoiceParserIssues/);
  assert.match(service, /发票购买方解析异常，请人工确认/);
  assert.match(service, /structuredFields: structuredFields as Prisma\.InputJsonValue/);
  assert.match(service, /parser: recognized\.parser \|\| \(document\.documentType === "SUPPLIER_INVOICE" \? "VAT_INVOICE" : "PURCHASE_CONTRACT"\)/);
  assert.match(service, /rawJson: \(recognized\.rawJson \|\| \{ source: recognized\.source, provider: recognized\.provider, textLength: text\.length \}\)/);
  assert.match(service, /extractedFields: fields as Prisma\.InputJsonValue/);
  assert.match(service, /OCR原文未识别，请人工核对。/);
  assert.match(service, /OCR原文已识别但解析失败，请人工核对。/);
  assert.match(service, /parserStatus: latestRawText \? "OCR原文已识别但解析失败" : "OCR原文未识别"/);
  assert.match(service, /rawText: task\.rawText \|\| ""/);
  assert.match(supplierModule, /查看 OCR 原始文本/);
  assert.match(supplierModule, /ocrTask\.rawText/);
  assert.match(supplierModule, /styles\.supplierDocumentOcrRawText/);
});

test("VAT invoice parser extracts buyer seller totals and item from Aliyun raw text", () => {
  const rawText = `
电子发票（增值税专用发票）
发票号码: 26342000002030743666
开票日期: 2026年06月29日
购买方信息
名称: 浙江莱诺建材有限公司 名称: 安徽科蓝特铝业股份有限公司
纳税人识别号: 91330681MA2D86XM28 纳税人识别号: 91341822070917615C
地址、电话: 浙江省诸暨市
开户行及账号: 中国银行
项目名称 规格型号 单位 数量 单价 金额 税率 税额
*有色金属压延材*铝制工
程结构件 套 1 101480.27 101480.27 13% 13192.44
合计 ¥101480.27 ¥13192.44
价税合计（大写）壹拾壹万肆仟陆佰柒拾贰圆柒角壹分 ¥ 114672.71
销售方信息
备注
`;
  const fields = parseVatInvoiceFields(rawText, {
    buyer: "浙江省诸暨市",
    seller: "浙江莱诺建材有限公司 名称: 安徽科蓝特铝业股份有限公司",
    productName: "浙江莱诺建材有限公司 91330681MA2D86XM28 安徽科蓝特铝业股份有限公司 91341822070917615C",
  });
  assert.deepEqual(fields, {
    invoiceNo: "26342000002030743666",
    invoiceDate: "2026-06-29",
    amountWithTax: 114672.71,
    amountWithoutTax: 101480.27,
    taxAmount: 13192.44,
    taxRate: "13%",
    seller: "安徽科蓝特铝业股份有限公司",
    sellerTaxNo: "91341822070917615C",
    buyer: "浙江莱诺建材有限公司",
    buyerTaxNo: "91330681MA2D86XM28",
    productName: "*有色金属压延材*铝制工程结构件",
    specModel: "",
    unit: "",
    quantity: "",
    unitPrice: "",
  });
});

test("VAT invoice parser prefers trusted structured fields over noisy raw party text", () => {
  const rawText = `
名称: 浙江莱诺建材有限公司 名称: 安徽科蓝特铝业股份有限公司
地址、电话: 浙江省诸暨市 暂无
项目名称 规格型号 单位 数量 单价 金额 税率 税额
*有色金属压延材*铝制工
程结构件 套 1 101480.27 101480.27 13% 13192.44
价税合计（小写）¥ 114672.71
`;
  const fields = parseVatInvoiceFields(rawText, {
    buyer: "浙江莱诺建材有限公司",
    seller: "安徽科蓝特铝业股份有限公司",
    buyerTaxNo: "91330681MA2D86XM28",
    sellerTaxNo: "91341822070917615C",
    amountWithTax: "114672.71",
    amountWithoutTax: "101480.27",
    taxAmount: "13192.44",
    taxRate: "13%",
    productName: "*有色金属压延材*铝制工程结构件",
  });
  assert.equal(fields.buyer, "浙江莱诺建材有限公司");
  assert.equal(fields.seller, "安徽科蓝特铝业股份有限公司");
  assert.equal(fields.buyerTaxNo, "91330681MA2D86XM28");
  assert.equal(fields.sellerTaxNo, "91341822070917615C");
  assert.equal(fields.amountWithTax, 114672.71);
  assert.equal(fields.amountWithoutTax, 101480.27);
  assert.equal(fields.taxAmount, 13192.44);
  assert.equal(fields.taxRate, "13%");
  assert.equal(fields.productName, "*有色金属压延材*铝制工程结构件");
});

test("VAT invoice parser handles reversed PDF fallback text from supplier invoice", () => {
  const rawText = `
刘明涵
开票人: 刘明涵
PO24-3
销方开户银行:中国工商银行股份有限公司广德开发区支行; 银行账号:1317087309100003323;
销售方地址:广德县经济开发区; 电话:-;
购方开户银行:中国银行诸暨支行; 银行账号:384477815827;
购买方地址:浙江省诸暨市东和乡王家宅村东一自然村; 电话:0575 87996781;
价税合计(大写) (小写)
壹拾壹万肆仟陆佰柒拾贰圆柒角壹分 ¥ 114672.71
合 计
101480.27 13192.44
¥ ¥
程结构件
千克 4374.35 23.1989379762212 101480.27 13% 13192.44
*有色金属压延材*铝制工
项目名称 规格型号 单 位 数 量 单 价 金 额 税率/征收率 税 额
息 息
统一社会信用代码/纳税人识别号: 统一社会信用代码/纳税人识别号:
91330681MA2D86XM28 91341822070917615C
信 信
方 方
买 售
名称: 浙江莱诺建材有限公司 名称: 安徽科蓝特铝业股份有限公司
购 销
开票日期: 2026年06月29日
发票号码: 26342000002030743666
`;
  const fields = parseVatInvoiceFields(rawText, {});
  assert.equal(fields.invoiceNo, "26342000002030743666");
  assert.equal(fields.invoiceDate, "2026-06-29");
  assert.equal(fields.buyer, "浙江莱诺建材有限公司");
  assert.equal(fields.seller, "安徽科蓝特铝业股份有限公司");
  assert.equal(fields.buyerTaxNo, "91330681MA2D86XM28");
  assert.equal(fields.sellerTaxNo, "91341822070917615C");
  assert.equal(fields.amountWithTax, 114672.71);
  assert.equal(fields.amountWithoutTax, 101480.27);
  assert.equal(fields.taxAmount, 13192.44);
  assert.equal(fields.taxRate, "13%");
  assert.equal(fields.productName, "*有色金属压延材*铝制工程结构件");
});

test("supplier document UI shows OCR result and protects internal actions", () => {
  assert.match(supplierModule, /SupplierDocumentOcrPanel/);
  assert.match(supplierModule, /OCR 校验结果/);
  assert.match(supplierModule, /重新识别/);
  assert.match(supplierModule, /人工确认通过/);
  assert.match(supplierModule, /驳回重传/);
  assert.match(supplierModule, /canManageSupplierDocumentOcr/);
});

test("supplier OCR routes expose re-recognize, confirm, and reject operations", () => {
  assert.match(ocrRoute, /rerunSupplierDocumentOcr/);
  assert.match(confirmRoute, /confirmSupplierDocumentOcr/);
  assert.match(rejectRoute, /rejectSupplierDocumentOcr/);
  assert.match(rejectRoute, /parseJsonBody\(request, \{ allowEmpty: true \}\)/);
});

test("supplier OCR rerun loads supplier return document and exposes actionable failures", () => {
  assert.match(service, /loadSupplierReturnDocument\(documentId, requestId\)/);
  assert.match(service, /缺少 supplierReturnDocumentId/);
  assert.match(service, /SUPPLIER_DOCUMENT_REQUEST_MISMATCH/);
  assert.match(service, /SUPPLIER_DOCUMENT_FILE_MISSING/);
  assert.match(service, /SUPPLIER_DOCUMENT_UPLOAD_INCOMPLETE/);
  assert.match(service, /createSupplierDocumentOcrTask\(document\)/);
  assert.match(service, /normalizeSupplierReturnDocumentType/);
  assert.match(service, /VAT_INVOICE/);
  assert.match(supplierModule, /apiErrorMessage\(ocrError, "重新识别失败"\)/);
  assert.match(supplierModule, /OCR识别失败，需人工核对/);
});

test("supplier OCR missing table errors are converted into migration guidance", () => {
  assert.match(service, /isSupplierOcrTableMissingError/);
  assert.match(service, /typedError\.code === "P2021"/);
  assert.match(service, /OCR 数据表未初始化，请联系管理员执行数据库迁移/);
  assert.match(service, /OCR_TABLE_NOT_INITIALIZED/);
  assert.match(service, /throwIfSupplierOcrTableMissing\(error\)/);
  assert.match(service, /throwIfSupplierOcrTableMissing\(updateError\)/);
});
