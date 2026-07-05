import { Readable } from "stream";
import { AyncTradeDocumentPackageExtractSmartAppRequest } from "@alicloud/docmind-api20220711";
import { RecognizeDocumentStructureRequest } from "@alicloud/ocr-api20210707";
import { type CustomsDeclarationItemFields } from "../customs-declaration-parser";
import { codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { extractCustomsItemsFromAliyunTableData } from "./aliyun-customs-table-parser";
import {
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  customsOcrSettings,
  normalizeFieldValue,
  normalizeOcrIntegrationSettings,
  parseJsonMaybe,
  responseField,
  toPlainJson,
} from "./ocr-integration-shared";
import {
  CUSTOMS_FIELD_ALIASES,
  CUSTOMS_TRADE_DOCUMENT_EXTRACTION_RANGE,
  collectCustomsItemCandidates,
  collectFieldsFromObject,
  collectText,
  mergeCustomsParsedData,
  normalizeCurrencyCode,
} from "./ocr-integration-parsing";
import {
  createAliyunDocMindClient,
  createAliyunOcrClient,
  rasterizeFirstPdfPageForOcr,
} from "./ocr-integration-clients";
import {
  buildDocMindCustomsRawJson,
  collectDocMindText,
  docMindResponseError,
  findDocMindTaskId,
  getAliyunDocMindParserResult,
  jsonPreview,
  safeObjectKeys,
  throwDocMindCustomsEmptyError,
} from "./ocr-integration-docmind";

export function buildAliyunCustomsStructureRawJson(rawJson: unknown, data: unknown) {
  return {
    primary: rawJson,
    data,
  };
}

export function throwAliyunCustomsStructureEmptyError(params: {
  rawJson: unknown;
  data: unknown;
  text: string;
  structuredFields: Record<string, unknown>;
  items: CustomsDeclarationItemFields[];
  parsedJson: unknown;
}) {
  const error = codedError("阿里云 OCR 文档结构化接口未返回可用的报关单商品明细。", 422, "ALIYUN_DOCUMENT_STRUCTURE_CUSTOMS_EMPTY");
  error.details = {
    source: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE_CUSTOMS",
    provider: "ALIYUN",
    apiName: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE",
    parser: "CUSTOMS_DECLARATION_DOCUMENT_STRUCTURE",
    textLength: params.text.length,
    textPreview: params.text.slice(0, 4000),
    dataType: Array.isArray(params.data) ? "array" : typeof params.data,
    dataKeys: safeObjectKeys(params.data),
    extractedFields: params.structuredFields,
    itemsCount: params.items.length,
    parsedJson: params.parsedJson,
    rawJsonPreview: jsonPreview(buildAliyunCustomsStructureRawJson(params.rawJson, params.data)),
  };
  throw error;
}

export function hasUsefulCustomsParsedData(parsed: unknown) {
  if (!isPlainRecord(parsed)) return false;
  return Boolean(
    parsed.customsDeclarationNo
    || parsed.customsDeclarationDate
    || parsed.exportDate
    || parsed.totalAmount
    || (Array.isArray(parsed.items) && parsed.items.length > 0),
  );
}

export function hasStructuredCustomsItems(parsed: unknown) {
  return isPlainRecord(parsed) && Array.isArray(parsed.items) && parsed.items.length > 0;
}

export async function recognizeAliyunCustomsDeclarationWithDocumentStructure(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(customsOcrSettings(settings));
  const rasterized = await rasterizeFirstPdfPageForOcr(buffer);
  const request = new RecognizeDocumentStructureRequest({
    body: rasterized ? Readable.from(rasterized.buffer) : Readable.from(buffer),
  });
  const response = await client.recognizeDocumentStructure(request);
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const text = collectText(data).join("\n");
  const structuredFields = collectFieldsFromObject(data, CUSTOMS_FIELD_ALIASES);
  let items = extractCustomsItemsFromAliyunTableData(data, {
    tradeTerm: normalizeFieldValue(structuredFields.tradeTerm),
    currency: normalizeCurrencyCode(structuredFields.currency),
  });
  if (!items.length) items = collectCustomsItemCandidates(data);
  const parsedJson = mergeCustomsParsedData(text, structuredFields, items);
  if (!hasStructuredCustomsItems(parsedJson)) {
    throwAliyunCustomsStructureEmptyError({
      rawJson,
      data,
      text,
      structuredFields,
      items,
      parsedJson,
    });
  }
  return {
    text,
    source: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE_CUSTOMS",
    provider: settings.provider,
    apiName: "ALIYUN_RECOGNIZE_DOCUMENT_STRUCTURE",
    rawJson: buildAliyunCustomsStructureRawJson(rawJson, data),
    extractedFields: structuredFields,
    parsedJson,
    confidence: null,
    parser: "CUSTOMS_DECLARATION_DOCUMENT_STRUCTURE",
    diagnostics: {
      docMindAttempted: true,
      docMindSucceeded: true,
      pdfRasterized: Boolean(rasterized),
      rasterizedPageWidth: rasterized?.width || null,
      rasterizedPageHeight: rasterized?.height || null,
      rasterizedPageCount: rasterized?.pageCount || null,
      docMindErrorCode: "",
      docMindErrorMessage: "",
      fallbackUsed: false,
    },
  };
}

export async function recognizeAliyunCustomsDeclarationWithDocMind(
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const fileUrl = nonEmpty(options.sourceUrl);
  if (!fileUrl) {
    throw codedError("文档智能报关单识别需要可下载的文件 URL。", 400, "ALIYUN_DOCMIND_FILE_URL_REQUIRED");
  }
  const client = createAliyunDocMindClient(customsOcrSettings(settings));
  const response = await client.ayncTradeDocumentPackageExtractSmartApp(new AyncTradeDocumentPackageExtractSmartAppRequest({
    fileUrl,
    fileName: nonEmpty(options.fileName) || "customs-declaration.pdf",
    customExtractionRange: CUSTOMS_TRADE_DOCUMENT_EXTRACTION_RANGE,
  }));
  const submitRawJson = toPlainJson(response);
  const responseBody = isPlainRecord(submitRawJson) ? submitRawJson.body : response.body;
  const submitError = docMindResponseError(responseBody);
  if (submitError) {
    throw codedError(`阿里云文档智能整票识别提交失败：${submitError}`, 502, "ALIYUN_DOCMIND_SUBMIT_FAILED");
  }
  const submitData = parseJsonMaybe(responseField(responseBody, "data"));
  const taskId = findDocMindTaskId(submitData) || findDocMindTaskId(responseBody);
  const result = taskId
    ? await getAliyunDocMindParserResult(client, taskId)
    : { data: submitData, resultRawJson: null, statusRawJson: [] };
  const data = parseJsonMaybe(result.data);
  const docMindText = collectDocMindText(data).join("\n");
  const text = [docMindText, collectText(data).join("\n")].filter(Boolean).join("\n");
  const structuredFields = collectFieldsFromObject(data, CUSTOMS_FIELD_ALIASES);
  let items = extractCustomsItemsFromAliyunTableData(data, {
    tradeTerm: normalizeFieldValue(structuredFields.tradeTerm),
    currency: normalizeCurrencyCode(structuredFields.currency),
  });
  if (!items.length) items = collectCustomsItemCandidates(data);
  const parsedJson = mergeCustomsParsedData(text, structuredFields, items);
  if (!hasUsefulCustomsParsedData(parsedJson)) {
    throwDocMindCustomsEmptyError({
      submitRawJson,
      statusRawJson: result.statusRawJson,
      resultRawJson: result.resultRawJson,
      taskId,
      data,
      text,
      structuredFields,
      items,
      parsedJson,
    });
  }
  return {
    text,
    source: "ALIYUN_DOCMIND_TRADE_DOCUMENT_CUSTOMS",
    provider: settings.provider,
    apiName: "ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT",
    rawJson: buildDocMindCustomsRawJson(submitRawJson, result.statusRawJson, result.resultRawJson, taskId, data),
    extractedFields: structuredFields,
    parsedJson,
    confidence: null,
    parser: "CUSTOMS_DECLARATION_DOCMIND",
    diagnostics: {
      docMindAttempted: true,
      docMindSucceeded: true,
      docMindErrorCode: "",
      docMindErrorMessage: "",
      fallbackUsed: false,
    },
  };
}
