import { Readable } from "node:stream";
import {
  AyncTradeDocumentPackageExtractSmartAppRequest,
} from "@alicloud/docmind-api20220711";
import {
  RecognizeAllTextRequest,
  RecognizeAllTextRequestAdvancedConfig,
  RecognizeAllTextRequestTableConfig,
  RecognizeDocumentStructureRequest,
  RecognizeGeneralStructureRequest,
} from "@alicloud/ocr-api20210707";
import {
  extractPdfTextFromPdfBuffer,
  type CustomsDeclarationItemFields,
} from "../customs-declaration-parser";
import { codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { extractCustomsItemsFromAliyunTableData } from "./aliyun-customs-table-parser";
import {
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  customsOcrSettings,
  normalizeOcrIntegrationSettings,
  normalizeFieldValue,
  ocrErrorDetails,
  ocrErrorText,
  parseJsonMaybe,
  responseField,
  toPlainJson,
} from "./ocr-integration-shared";
import {
  CUSTOMS_DECLARATION_KEYS,
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
  recognizeWithPdfTextFallback,
} from "./ocr-integration-clients";
import {
  buildDocMindCustomsRawJson,
  docMindResponseError,
  findDocMindTaskId,
  getAliyunDocMindParserResult,
  collectDocMindText,
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
    body: rasterized ? Readable.from(rasterized.buffer) : (options.sourceUrl ? undefined : Readable.from(buffer)),
    url: rasterized ? undefined : (nonEmpty(options.sourceUrl) || undefined),
    outputTable: true,
    row: true,
    paragraph: true,
    page: true,
    needRotate: true,
    needSortPage: true,
    useNewStyleOutput: true,
  });
  const response = await client.recognizeDocumentStructure(request);
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const responseError = docMindResponseError(responseBody);
  if (responseError) {
    throw codedError(`阿里云 OCR 文档结构化识别失败：${responseError}`, 502, "ALIYUN_DOCUMENT_STRUCTURE_FAILED");
  }
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
  const rawJson = buildDocMindCustomsRawJson(submitRawJson, result.statusRawJson, result.resultRawJson, taskId, data);
  return {
    text,
    source: "ALIYUN_DOCMIND_TRADE_DOCUMENT_CUSTOMS",
    provider: settings.provider,
    apiName: "ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT",
    rawJson,
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

export async function recognizeAliyunCustomsDeclaration(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions = {},
): Promise<OcrRecognitionResult> {
  const effectiveSettings = customsOcrSettings(settings);
  let structuredError: unknown = null;
  let structuredErrorCode = "";
  let structuredErrorMessage = "";
  try {
    return await recognizeAliyunCustomsDeclarationWithDocumentStructure(buffer, effectiveSettings, options);
  } catch (error) {
    structuredError = error;
    structuredErrorCode = (error as { code?: string } | null)?.code || "ALIYUN_DOCUMENT_STRUCTURE_CUSTOMS_FAILED";
    structuredErrorMessage = ocrErrorText(error);
    console.error("aliyun-document-structure-customs-ocr-failed", {
      code: structuredErrorCode,
      message: structuredErrorMessage,
      mode: effectiveSettings.customsDeclarationMode,
    });
  }
  let docMindError: unknown = null;
  let docMindErrorCode = "";
  let docMindErrorMessage = "";
  if (options.sourceUrl) {
    try {
      return await recognizeAliyunCustomsDeclarationWithDocMind(effectiveSettings, options);
    } catch (error) {
      docMindError = error;
      docMindErrorCode = (error as { code?: string } | null)?.code || "ALIYUN_DOCMIND_CUSTOMS_FAILED";
      docMindErrorMessage = ocrErrorText(error);
      console.error("aliyun-docmind-customs-ocr-failed", {
        code: docMindErrorCode,
        message: docMindErrorMessage,
        mode: effectiveSettings.customsDeclarationMode,
      });
    }
  }
  const structuredFailure = [
    structuredErrorMessage && `文档结构化：${structuredErrorMessage}`,
    docMindErrorMessage && `贸易单证结构化：${docMindErrorMessage}`,
  ].filter(Boolean).join("；");
  const finalStructuredError = docMindError || structuredError;
  if (effectiveSettings.customsDeclarationMode === "STRICT") {
    const strictError = codedError(
      `阿里云报关单严格结构化识别失败：${structuredFailure || "结构化接口未返回可用报关单数据。"}`,
      (finalStructuredError as { status?: number } | null)?.status || 502,
      docMindErrorCode || structuredErrorCode || "ALIYUN_CUSTOMS_STRUCTURED_OCR_FAILED",
    );
    strictError.details = {
      documentStructure: {
        code: structuredErrorCode,
        message: structuredErrorMessage,
        details: ocrErrorDetails(structuredError),
      },
      tradeDocument: {
        attempted: Boolean(options.sourceUrl),
        code: docMindErrorCode,
        message: docMindErrorMessage,
        details: ocrErrorDetails(docMindError),
      },
    };
    throw strictError;
  }
  const docMindDiagnostics: Record<string, unknown> = {
    docMindAttempted: Boolean(options.sourceUrl),
    docMindSucceeded: false,
    docMindErrorCode: docMindErrorCode || structuredErrorCode,
    docMindErrorMessage: structuredFailure || structuredErrorMessage || docMindErrorMessage,
    fallbackUsed: true,
  };
  if (finalStructuredError) {
    return recognizeWithPdfTextFallback(buffer, "customsDeclaration", effectiveSettings, {
      ...options,
      source: "ALIYUN_CUSTOMS_STRUCTURE_FAILED_PDF_TEXT",
      error: finalStructuredError,
    });
  }
  const client = createAliyunOcrClient(effectiveSettings);
  let primaryRawJson: unknown = null;
  let primaryData: unknown = null;
  let primaryText = "";
  let primaryError = "";
  try {
    const response = await client.recognizeGeneralStructure(new RecognizeGeneralStructureRequest({
      body: Readable.from(buffer),
      keys: CUSTOMS_DECLARATION_KEYS,
    }));
    primaryRawJson = toPlainJson(response);
    const responseBody = responseField(primaryRawJson, "body") || response.body;
    primaryData = parseJsonMaybe(responseField(responseBody, "data"));
    primaryText = collectText(primaryData).join("\n");
  } catch (error) {
    primaryError = ocrErrorText(error);
    primaryRawJson = {
      error: primaryError,
      apiName: "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE",
      timeoutMs: effectiveSettings.timeoutMs,
    };
    console.error("aliyun-customs-general-structure-failed", {
      message: primaryError,
      timeoutMs: effectiveSettings.timeoutMs,
    });
  }
  const pdfText = primaryText || await extractPdfTextFromPdfBuffer(buffer, { requireText: options.requireText === true }).catch(() => "");
  const primaryFields = collectFieldsFromObject(primaryData, CUSTOMS_FIELD_ALIASES);
  let items = extractCustomsItemsFromAliyunTableData(primaryData, {
    tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
    currency: normalizeCurrencyCode(primaryFields.currency),
  });
  if (!items.length) items = collectCustomsItemCandidates(primaryData);
  let tableRawJson: unknown = null;
  let tableOnlyRawJson: unknown = null;
  let tableText = "";
  const tableErrors: string[] = [];
  if (!items.length) {
    try {
      const tableResponse = await client.recognizeAllText(new RecognizeAllTextRequest({
        body: Readable.from(buffer),
        type: "Advanced",
        advancedConfig: new RecognizeAllTextRequestAdvancedConfig({
          outputTable: true,
          outputRow: true,
          isLineLessTable: true,
        }),
      }));
      tableRawJson = toPlainJson(tableResponse);
      const tableBody = responseField(tableRawJson, "body") || tableResponse.body;
      const tableData = parseJsonMaybe(responseField(tableBody, "data"));
      tableText = collectText(tableData).join("\n");
      items = extractCustomsItemsFromAliyunTableData(tableData, {
        tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
        currency: normalizeCurrencyCode(primaryFields.currency),
      });
      if (!items.length) items = collectCustomsItemCandidates(tableData);
    } catch (error) {
      tableErrors.push(`Advanced: ${ocrErrorText(error)}`);
    }
  }
  if (!items.length) {
    try {
      const tableOnlyResponse = await client.recognizeAllText(new RecognizeAllTextRequest({
        body: Readable.from(buffer),
        type: "Table",
        tableConfig: new RecognizeAllTextRequestTableConfig({
          isLineLessTable: true,
        }),
      }));
      tableOnlyRawJson = toPlainJson(tableOnlyResponse);
      const tableOnlyBody = responseField(tableOnlyRawJson, "body") || tableOnlyResponse.body;
      const tableOnlyData = parseJsonMaybe(responseField(tableOnlyBody, "data"));
      tableText = [tableText, collectText(tableOnlyData).join("\n")].filter(Boolean).join("\n");
      items = extractCustomsItemsFromAliyunTableData(tableOnlyData, {
        tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
        currency: normalizeCurrencyCode(primaryFields.currency),
      });
      if (!items.length) items = collectCustomsItemCandidates(tableOnlyData);
    } catch (error) {
      tableErrors.push(`Table: ${ocrErrorText(error)}`);
    }
  }
  if (primaryError && !tableRawJson && !tableOnlyRawJson) {
    throw codedError(
      `阿里云报关单结构化识别超时或失败：${primaryError}`,
      504,
      "ALIYUN_CUSTOMS_OCR_TIMEOUT",
    );
  }
  if (tableRawJson || tableOnlyRawJson) {
    const mergedTableText = [pdfText, tableText].filter(Boolean).join("\n");
    const parsedWithTable = mergeCustomsParsedData(mergedTableText, primaryFields, items);
    return {
      text: mergedTableText,
      source: items.length ? "ALIYUN_RECOGNIZE_TRADE_DOCUMENT_WITH_TABLE" : "ALIYUN_RECOGNIZE_TRADE_DOCUMENT_TABLE_EMPTY",
      provider: settings.provider,
      apiName: items.length ? "ALIYUN_RECOGNIZE_ALL_TEXT_TABLE_FALLBACK" : "ALIYUN_RECOGNIZE_ALL_TEXT_TABLE_EMPTY",
      rawJson: {
        docMind: docMindDiagnostics,
        primary: primaryRawJson,
        table: tableOnlyRawJson || tableRawJson,
        advancedTable: tableRawJson,
        tableOnly: tableOnlyRawJson,
        primaryError,
        tableErrors,
      },
      extractedFields: primaryFields,
      parsedJson: parsedWithTable,
      confidence: null,
      parser: "CUSTOMS_DECLARATION",
      diagnostics: docMindDiagnostics,
    };
  }
  const parsedJson = mergeCustomsParsedData(pdfText, primaryFields, items);
  return {
    text: pdfText,
    source: "ALIYUN_RECOGNIZE_TRADE_DOCUMENT",
    provider: settings.provider,
    apiName: items.length ? "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE" : "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE_TABLE_EMPTY",
    rawJson: {
      docMind: docMindDiagnostics,
      primary: primaryRawJson,
      table: tableRawJson,
      tableOnly: tableOnlyRawJson,
      primaryError,
      tableErrors,
    },
    extractedFields: primaryFields,
    parsedJson,
    confidence: null,
    parser: "CUSTOMS_DECLARATION",
    diagnostics: docMindDiagnostics,
  };
}
