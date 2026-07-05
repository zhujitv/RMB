import { Readable } from "node:stream";
import {
  RecognizeAllTextRequest,
  RecognizeAllTextRequestAdvancedConfig,
  RecognizeAllTextRequestTableConfig,
  RecognizeGeneralStructureRequest,
} from "@alicloud/ocr-api20210707";
import {
  extractPdfTextFromPdfBuffer,
  type CustomsDeclarationItemFields,
} from "../customs-declaration-parser";
import { codedError } from "./shared-base-utils";
import { extractCustomsItemsFromAliyunTableData } from "./aliyun-customs-table-parser";
import {
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  customsOcrSettings,
  normalizeFieldValue,
  normalizeOcrIntegrationSettings,
  ocrErrorDetails,
  ocrErrorText,
  parseJsonMaybe,
  responseField,
  toPlainJson,
} from "./ocr-integration-shared";
import {
  CUSTOMS_FIELD_ALIASES,
  collectCustomsItemCandidates,
  collectFieldsFromObject,
  collectText,
  mergeCustomsParsedData,
  normalizeCurrencyCode,
} from "./ocr-integration-parsing";
import {
  createAliyunOcrClient,
  recognizeWithPdfTextFallback,
} from "./ocr-integration-clients";
import {
  recognizeAliyunCustomsDeclarationWithDocMind,
  recognizeAliyunCustomsDeclarationWithDocumentStructure,
} from "./ocr-integration-customs-structure";

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

  return recognizeAliyunCustomsDeclarationWithGeneralStructure(buffer, settings, effectiveSettings, docMindDiagnostics);
}

async function recognizeAliyunCustomsDeclarationWithGeneralStructure(
  buffer: Buffer,
  originalSettings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  effectiveSettings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  docMindDiagnostics: Record<string, unknown>,
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(effectiveSettings);
  let primaryRawJson: unknown = null;
  let primaryText = "";
  let primaryError = "";
  let primaryFields: Record<string, unknown> = {};
  let primaryItems: CustomsDeclarationItemFields[] = [];
  try {
    const response = await client.recognizeGeneralStructure(new RecognizeGeneralStructureRequest({ body: Readable.from(buffer) }));
    primaryRawJson = toPlainJson(response);
    const primaryBody = responseField(primaryRawJson, "body") || response.body;
    const primaryData = parseJsonMaybe(responseField(primaryBody, "data"));
    primaryText = collectText(primaryData).join("\n");
    primaryFields = collectFieldsFromObject(primaryData, CUSTOMS_FIELD_ALIASES);
    primaryItems = extractCustomsItemsFromAliyunTableData(primaryData, {
      tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
      currency: normalizeCurrencyCode(primaryFields.currency),
    });
    if (!primaryItems.length) primaryItems = collectCustomsItemCandidates(primaryData);
  } catch (error) {
    primaryError = ocrErrorText(error);
  }

  const pdfText = primaryText || await extractPdfTextFromPdfBuffer(buffer).catch(() => "");
  const table = await recognizeCustomsTables(buffer, primaryFields, primaryItems, effectiveSettings);
  if (primaryError && !table.rawJson && !table.tableOnlyRawJson) {
    throw codedError(`阿里云报关单结构化识别超时或失败：${primaryError}`, 504, "ALIYUN_CUSTOMS_OCR_TIMEOUT");
  }
  const text = [pdfText, table.text].filter(Boolean).join("\n");
  const parsedJson = mergeCustomsParsedData(text, primaryFields, table.items);
  return {
    text,
    source: table.items.length ? "ALIYUN_RECOGNIZE_TRADE_DOCUMENT_WITH_TABLE" : "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE_TABLE_EMPTY",
    provider: originalSettings.provider,
    apiName: table.items.length ? "ALIYUN_RECOGNIZE_ALL_TEXT_TABLE_FALLBACK" : "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE_TABLE_EMPTY",
    rawJson: {
      docMind: docMindDiagnostics,
      primary: primaryRawJson,
      table: table.tableOnlyRawJson || table.rawJson,
      advancedTable: table.rawJson,
      tableOnly: table.tableOnlyRawJson,
      primaryError,
      tableErrors: table.errors,
    },
    extractedFields: primaryFields,
    parsedJson,
    confidence: null,
    parser: "CUSTOMS_DECLARATION",
    diagnostics: docMindDiagnostics,
  };
}

async function recognizeCustomsTables(
  buffer: Buffer,
  primaryFields: Record<string, unknown>,
  initialItems: CustomsDeclarationItemFields[],
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
) {
  const itemsOptions = {
    tradeTerm: normalizeFieldValue(primaryFields.tradeTerm),
    currency: normalizeCurrencyCode(primaryFields.currency),
  };
  const client = createAliyunOcrClient(settings);
  let rawJson: unknown = null;
  let tableOnlyRawJson: unknown = null;
  let text = "";
  let items: CustomsDeclarationItemFields[] = initialItems;
  const errors: string[] = [];

  if (items.length) return { rawJson, tableOnlyRawJson, text, items, errors };

  try {
    const response = await client.recognizeAllText(new RecognizeAllTextRequest({
      body: Readable.from(buffer),
      type: "Advanced",
      advancedConfig: new RecognizeAllTextRequestAdvancedConfig({
        outputTable: true,
        outputRow: true,
        isLineLessTable: true,
      }),
    }));
    rawJson = toPlainJson(response);
    const body = responseField(rawJson, "body") || response.body;
    const data = parseJsonMaybe(responseField(body, "data"));
    text = collectText(data).join("\n");
    items = extractCustomsItemsFromAliyunTableData(data, itemsOptions);
    if (!items.length) items = collectCustomsItemCandidates(data);
  } catch (error) {
    errors.push(`Advanced: ${ocrErrorText(error)}`);
  }

  if (!items.length) {
    try {
      const response = await client.recognizeAllText(new RecognizeAllTextRequest({
        body: Readable.from(buffer),
        type: "Table",
        tableConfig: new RecognizeAllTextRequestTableConfig({ isLineLessTable: true }),
      }));
      tableOnlyRawJson = toPlainJson(response);
      const body = responseField(tableOnlyRawJson, "body") || response.body;
      const data = parseJsonMaybe(responseField(body, "data"));
      text = [text, collectText(data).join("\n")].filter(Boolean).join("\n");
      items = extractCustomsItemsFromAliyunTableData(data, itemsOptions);
      if (!items.length) items = collectCustomsItemCandidates(data);
    } catch (error) {
      errors.push(`Table: ${ocrErrorText(error)}`);
    }
  }

  return { rawJson, tableOnlyRawJson, text, items, errors };
}
