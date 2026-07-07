import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isSuspiciousInvoiceParty, parseVatInvoiceFields } from "../lib/platform/supplier-vat-invoice-parser.ts";
import {
  readSupplierDocumentOcrSource,
  readSupplierDocumentRequestListSource,
  readSupplierDocumentRequestsSource,
  readSupplierDocumentsModuleSource,
} from "./source-helpers.ts";
import {
  contractOrderNoMatches,
  normalizeContractOrderNoSet,
  selectBestContractOrderNo,
} from "../lib/platform/supplier-contract-order-match.ts";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const service = readSupplierDocumentOcrSource();
const vatParser = readFileSync("lib/platform/supplier-vat-invoice-parser.ts", "utf8");
const supplierRequests = readSupplierDocumentRequestsSource();
const supplierRequestList = readSupplierDocumentRequestListSource();
const supplierModule = readSupplierDocumentsModuleSource();
const supplierUploadActions = readFileSync("app/modules/supplier-documents/use-supplier-document-request-actions.ts", "utf8");
const ocrRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/[documentId]/ocr/route.ts", "utf8");
const confirmRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/[documentId]/ocr/confirm/route.ts", "utf8");
const rejectRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/[documentId]/ocr/reject/route.ts", "utf8");
const supplierOcrCronRoute = readFileSync("app/api/cron/supplier-document-ocr/route.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");

test("supplier return OCR stores tasks and fields in independent OCR tables", () => {
  assert.match(schema, /model OcrTask/);
  assert.match(schema, /@@map\("ocr_tasks"\)/);
  assert.match(schema, /model OcrResult/);
  assert.match(schema, /@@map\("ocr_results"\)/);
  assert.match(schema, /document\s+OrderDocument\s+@relation/);
  assert.match(schema, /request\s+SupplierDocumentRequest\?/);
});

test("supplier document upload saves files without automatic OCR", () => {
  assert.match(supplierUploadActions, /setNotice\(data\.message \|\| "上传成功"\)/);
  assert.doesNotMatch(supplierUploadActions, /async function recognizeUploadedDocument/);
  assert.doesNotMatch(supplierUploadActions, /setOcrBusyKey/);
  assert.doesNotMatch(supplierUploadActions, /正在识别，请勿关闭页面/);
  assert.doesNotMatch(supplierUploadActions, /documents\/\$\{encodeURIComponent\(document\.id\)\}\/ocr/);
  assert.doesNotMatch(supplierUploadActions, /timeoutMs: 65_000/);
  assert.match(supplierRequests, /message: "上传成功"/);
  assert.match(supplierRequests, /attachSupplierDocumentOcrTasks/);
  assert.match(supplierRequests, /prisma\.ocrTask\.findMany/);
  assert.match(supplierRequests, /已跳过OCR附加信息/);
  assert.doesNotMatch(supplierRequestList, /documents:\s*\{[\s\S]*include:\s*\{[\s\S]*ocrTasks:\s*\{/);
  assert.match(supplierRequests, /serializeSupplierDocumentOcrTask/);
  assert.doesNotMatch(supplierRequests, /产品供应商回传资料OCR后台识别/);
});

test("supplier document page silently polls only while OCR is processing", () => {
  assert.match(supplierModule, /function hasProcessingOcrTask/);
  assert.match(supplierModule, /document\.ocrTask\?\.status === "OCR识别中"/);
  assert.match(supplierModule, /window\.setInterval/);
  assert.match(supplierModule, /loadTaskDetail\(expandedTaskId, \{ force: true, silent: true \}\)/);
  assert.match(supplierModule, /window\.clearInterval/);
});

test("supplier document foreground OCR disables repeated actions while waiting", () => {
  assert.match(supplierModule, /const documentOcrBusy = document \? ocrBusyKey\.startsWith/);
  assert.match(supplierModule, /disabled=\{uploading \|\| documentOcrBusy\}/);
  assert.match(supplierModule, /const documentBusy = busyKey\.startsWith/);
  assert.match(supplierModule, /<OcrWaitingInline \/>/);
  assert.match(supplierModule, /<ButtonSpinnerText text="识别中\.\.\." \/>/);
  assert.match(supplierModule, /disabled=\{documentBusy\}/);
  assert.match(supplierModule, /supplierDocumentOcrSpinner/);
});

test("supplier OCR has a cron worker fallback for processing tasks", () => {
  assert.match(service, /export async function runPendingSupplierDocumentOcrTasks/);
  assert.match(service, /updatedAt: \{ lt: readyBefore \}/);
  assert.match(service, /await runSupplierDocumentOcrTaskWithTimeout\(task\.id\)/);
  assert.match(service, /export async function runSupplierDocumentOcrTaskWithTimeout/);
  assert.match(service, /SUPPLIER_DOCUMENT_OCR_TASK_TIMEOUT/);
  assert.match(service, /supplier-document-ocr-pending-worker/);
  assert.match(supplierOcrCronRoute, /assertCronSecret\(request\)/);
  assert.match(supplierOcrCronRoute, /runPendingSupplierDocumentOcrTasks\(limit \|\| 5, minAgeMs \|\| 60_000\)/);
  assert.match(supplierOcrCronRoute, /runPendingLogisticsInvoiceOcrTasks\(limit \|\| 5, minAgeMs \|\| 60_000\)/);
  assert.match(supplierOcrCronRoute, /return ok\(\{ supplier, logistics \}\)/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/supplier-document-ocr"/);
  assert.match(vercelConfig, /"\*\/5 \* \* \* \*"/);
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

test("supplier contract OCR compares purchase order numbers with normalization and OCR tolerance", () => {
  assert.deepEqual(normalizeContractOrderNoSet("PO24-2 / PO24-12"), ["P024-12", "P024-2"]);
  assert.equal(contractOrderNoMatches("PO24-2/P024-12", "PO24-2/PO24-12"), true);
  assert.equal(contractOrderNoMatches("PO24-12 / PO24-2", "PO24-2/PO24-12"), true);
  assert.equal(contractOrderNoMatches("PO24-2/PO24-13", "PO24-2/PO24-12"), false);
  assert.equal(
    selectBestContractOrderNo("合同编号：PO24-2/PO24-12\n其它编号：P024-12", "PO24-2/P024-12"),
    "PO24-2/PO24-12",
  );
  assert.match(service, /supplier-contract-order-compare/);
  assert.match(service, /normalizedSystemOrderNo/);
  assert.match(service, /normalizedOcrOrderNo/);
});

test("supplier VAT invoice OCR uses structured parser and preserves raw text", () => {
  assert.match(service, /recognizeSupplierDocumentWithOcr/);
  assert.match(service, /export function parseVatInvoiceFields\(text: string, structuredFields: Record<string, unknown> = \{\}\)/);
  assert.match(service, /parseVatInvoiceFieldsCore\(text, structuredFields\)/);
  assert.match(service, /enrichVatInvoiceFields\(parseVatInvoiceFields\(text, structuredFields\), context, text\)/);
  assert.match(service, /supplierTaxNo/);
  assert.match(service, /normalizeTaxIdentifier/);
  assert.match(vatParser, /structuredPartyFallback\(structuredFields, "seller"\)/);
  assert.match(vatParser, /extractInvoiceNameSequence\(text\)/);
  assert.match(vatParser, /companyNameCandidates/);
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
  assert.match(service, /supplierDocumentOcrFailureMessage/);
  assert.match(service, /supplierDocumentOcrFailureKind/);
  assert.match(service, /supplierDocumentOcrFailureMessageForKind/);
  assert.match(service, /supplierOcrFailureTechnicalDetails/);
  assert.match(service, /OCR 连接超时，请稍后点击“重新识别”/);
  assert.match(service, /OCR 配置缺失，请联系管理员到系统设置检查 OCR 配置。/);
  assert.match(service, /OCR 额度不足或调用频率受限，请检查阿里云账户额度。/);
  assert.match(service, /OCR_PERMISSION_FAILURE_MESSAGE/);
  assert.match(service, /ocrServiceNotOpen/);
  assert.match(service, /sanitizeSupplierOcrMessage\(task\.errorMessage, ""\)/);
  assert.match(service, /const rawMessage = String\(record\.message \|\| ""\)/);
  assert.match(service, /sanitizeSupplierOcrMessage\(rawMessage, ""\)/);
  assert.match(service, /OCR正在识别，请稍候。/);
  assert.match(service, /errorMessage\s*\?\s*\[\{ level: "manual", message: errorMessage, field: "" \}\]/);
  assert.match(service, /technicalError: originalMessage\.slice\(0, 1000\)/);
  assert.match(service, /rawText: task\.rawText \|\| ""/);
  assert.match(supplierModule, /查看 OCR 原始文本/);
  assert.match(supplierModule, /ocrTask\.rawText/);
  assert.match(supplierModule, /styles\.supplierDocumentOcrRawText/);
});

test("supplier OCR failure messages are actionable by root cause", () => {
  assert.match(service, /return "TIMEOUT"/);
  assert.match(service, /return "CONFIG_MISSING"/);
  assert.match(service, /return "AUTH_FAILED"/);
  assert.match(service, /return "QUOTA_LIMITED"/);
  assert.match(service, /return "FILE_READ_FAILED"/);
  assert.match(service, /return "PDF_PROCESS_FAILED"/);
  assert.match(service, /return "STRUCTURE_INVALID"/);
  assert.match(service, /OCR 连接超时，请稍后点击“重新识别”/);
  assert.match(service, /OCR 配置缺失，请联系管理员到系统设置检查 OCR 配置。/);
  assert.match(service, /OCR AccessKey\/Secret 配置错误或接口权限不足，请联系管理员。/);
  assert.match(service, /OCR 额度不足或调用频率受限，请检查阿里云账户额度。/);
  assert.match(service, /文件无法读取，请重新上传 PDF 后再识别。/);
  assert.match(service, /PDF 处理失败，请重新上传清晰、未加密的 PDF。/);
  assert.match(service, /OCR 返回结构异常，请点击重新识别或人工确认。/);
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

test("VAT invoice parser accepts group company seller names from Aliyun structured fields", () => {
  const fields = parseVatInvoiceFields("", {
    invoiceNo: "2634200002105865616",
    invoiceDate: "2026年07月03日",
    buyer: "浙江莱诺建材有限公司",
    buyerTaxNo: "91330681MA2D86XM28",
    seller: "安徽森泰木塑集团股份有限公司",
    sellerTaxNo: "91341822796423104J",
    amountWithTax: "137401.92",
    amountWithoutTax: "121594.62",
    taxAmount: "15807.30",
    taxRate: "13%",
    productName: "塑料制栅栏",
  });
  assert.equal(isSuspiciousInvoiceParty("安徽森泰木塑集团股份有限公司"), false);
  assert.equal(fields.seller, "安徽森泰木塑集团股份有限公司");
  assert.equal(fields.sellerTaxNo, "91341822796423104J");
  assert.equal(fields.buyer, "浙江莱诺建材有限公司");
});

test("VAT invoice parser infers seller from plain company sequence in Aliyun text", () => {
  const fields = parseVatInvoiceFields(`
电子发票（增值税专用发票）
发票号码 2634200002105865616
开票日期 2026年07月03日
浙江莱诺建材有限公司
91330681MA2D86XM28
安徽森泰木塑集团股份有限公司
91341822796423104J
项目名称 规格型号 单位 数量 单价 金额 税率 税额
塑料制栅栏 千克 18792.65 6.47 121594.62 13% 15807.30
价税合计 ¥137401.92
`, {});
  assert.equal(fields.buyer, "浙江莱诺建材有限公司");
  assert.equal(fields.seller, "安徽森泰木塑集团股份有限公司");
  assert.equal(fields.sellerTaxNo, "91341822796423104J");
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

test("supplier document UI only shows manual OCR confirmation for abnormal results", () => {
  assert.match(supplierModule, /function supplierOcrCleanlyPassed/);
  assert.match(supplierModule, /OCR_STATUS_PASSED/);
  assert.match(supplierModule, /VALIDATION_PASSED/);
  assert.match(supplierModule, /VALIDATION_CONFIRMED/);
  assert.match(supplierModule, /function supplierOcrRequiresManualReview/);
  assert.match(supplierModule, /const requiresManualReview = supplierOcrRequiresManualReview\(ocrTask\)/);
  assert.match(supplierModule, /requiresManualReview \? \(/);
  assert.match(supplierModule, /void loadTaskDetail\(task\.id, \{ force: true, silent: true \}\)/);
  assert.match(supplierModule, /void loadStats\(undefined, \{ silent: true \}\)/);
});

test("supplier OCR routes expose re-recognize, confirm, and reject operations", () => {
  assert.match(ocrRoute, /rerunSupplierDocumentOcr/);
  assert.match(ocrRoute, /supplierDocumentOcrApiResult/);
  assert.match(ocrRoute, /\.\.\.ocrResult/);
  assert.match(confirmRoute, /confirmSupplierDocumentOcr/);
  assert.match(rejectRoute, /rejectSupplierDocumentOcr/);
  assert.match(rejectRoute, /parseJsonBody\(request, \{ allowEmpty: true \}\)/);
});

test("supplier OCR rerun loads supplier return document and exposes actionable failures", () => {
  assert.match(service, /loadSupplierReturnDocument\(documentId, requestId, actor\)/);
  assert.match(service, /缺少 supplierReturnDocumentId/);
  assert.match(service, /SUPPLIER_DOCUMENT_REQUEST_MISMATCH/);
  assert.match(service, /SUPPLIER_DOCUMENT_FILE_MISSING/);
  assert.match(service, /SUPPLIER_DOCUMENT_UPLOAD_INCOMPLETE/);
  assert.match(service, /createSupplierDocumentOcrTask\(document\)/);
  assert.match(service, /cancelProcessingSupplierDocumentOcrTasks\(documentId, requestId\)/);
  assert.match(service, /const result = await runSupplierDocumentOcrTaskWithTimeout\(task\.id\)/);
  assert.match(service, /return serializeSupplierDocumentOcrTask\(result\)/);
  assert.match(service, /status: "TIMEOUT"/);
  assert.match(service, /OCR识别超时，请重新识别或人工确认。/);
  assert.doesNotMatch(service, /void runNonCriticalTask\("资料回传OCR重新识别后台执行"/);
  assert.doesNotMatch(ocrRoute, /已开始重新识别，OCR识别中/);
  assert.match(service, /normalizeSupplierReturnDocumentType/);
  assert.match(service, /VAT_INVOICE/);
  assert.match(supplierModule, /apiErrorMessage\(ocrError, "重新识别失败"\)/);
  assert.match(supplierModule, /OCR识别失败，请人工核对或重新上传/);
});

test("supplier OCR missing table errors are converted into migration guidance", () => {
  assert.match(service, /isSupplierOcrTableMissingError/);
  assert.match(service, /typedError\.code === "P2021"/);
  assert.match(service, /OCR 数据表未初始化，请联系管理员执行数据库迁移/);
  assert.match(service, /OCR_TABLE_NOT_INITIALIZED/);
  assert.match(service, /throwIfSupplierOcrTableMissing\(error\)/);
  assert.match(service, /throwIfSupplierOcrTableMissing\(updateError\)/);
});

test("supplier OCR reconciles stale processing tasks instead of leaving them stuck", () => {
  assert.match(service, /OCR_STALE_PROCESSING_MESSAGE/);
  assert.match(service, /export async function reconcileStaleSupplierDocumentOcrTasks/);
  assert.match(service, /status: OCR_STATUS_PROCESSING/);
  assert.match(service, /validationStatus: "PROCESSING"/);
  assert.match(service, /createdAt: \{ lt: staleBefore \}/);
  assert.match(service, /status: OCR_STATUS_FAILED/);
  assert.match(service, /validationStatus: VALIDATION_FAILED/);
  assert.match(service, /Date\.now\(\) - new Date\(task\.createdAt\)\.getTime\(\) > supplierOcrProcessingStaleMs\(\)/);
  assert.match(supplierRequests, /reconcileStaleSupplierDocumentOcrTasks\(documentIds\)/);
});
