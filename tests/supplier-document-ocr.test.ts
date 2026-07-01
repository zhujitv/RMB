import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const service = readFileSync("lib/platform/supplier-document-ocr.ts", "utf8");
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
