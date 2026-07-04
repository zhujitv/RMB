import { Readable } from "node:stream";
import DocMindClient from "@alicloud/docmind-api20220711";
import AliyunOcrClient, {
  RecognizeGeneralStructureRequest,
  RecognizeInvoiceRequest,
} from "@alicloud/ocr-api20210707";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import {
  extractPdfTextFromPdfBuffer,
} from "../customs-declaration-parser";
import { codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { extractAliyunInvoiceRecognitionData } from "./aliyun-invoice-ocr-parser";
import {
  type OcrFeatureKey,
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  type RasterizedPdfPage,
  SUPPLIER_CONTRACT_KEYS,
  customsTextFallbackParsedJson,
  normalizeOcrIntegrationSettings,
  normalizeFieldValue,
  ocrErrorText,
  parseJsonMaybe,
  responseField,
  toPlainJson,
} from "./ocr-integration-shared";
import {
  CONTRACT_FIELD_ALIASES,
  collectFieldsFromObject,
  collectText,
} from "./ocr-integration-parsing";

export async function rasterizeFirstPdfPageForOcr(buffer: Buffer): Promise<RasterizedPdfPage | null> {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return null;
  try {
    const canvasModule = await import("@napi-rs/canvas");
    const { createCanvas, DOMMatrix, ImageData, Path2D } = canvasModule;
    const globalScope = globalThis as Record<string, unknown>;
    globalScope.DOMMatrix ||= DOMMatrix;
    globalScope.ImageData ||= ImageData;
    globalScope.Path2D ||= Path2D;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
      getDocument: (params: Record<string, unknown>) => { promise: Promise<Record<string, unknown>>; destroy?: () => Promise<void> };
    };
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise as Record<string, unknown> & {
      numPages?: number;
      getPage: (pageNumber: number) => Promise<Record<string, unknown> & {
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: Record<string, unknown>) => { promise: Promise<void> };
      }>;
      destroy?: () => Promise<void>;
    };
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const longestSide = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(3, Math.max(1.5, 2200 / Math.max(longestSide, 1)));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: null, canvasContext: context, viewport }).promise;
    const pngBuffer = canvas.toBuffer("image/png");
    const pageCount = Number(pdf.numPages || 1);
    await pdf.destroy?.().catch(() => undefined);
    await loadingTask.destroy?.().catch(() => undefined);
    return {
      buffer: Buffer.from(pngBuffer),
      width: canvas.width,
      height: canvas.height,
      pageCount,
    };
  } catch (error) {
    console.error("customs-pdf-rasterize-for-ocr-failed", { message: ocrErrorText(error) });
    return null;
  }
}

export function aliyunEndpointFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

export function createAliyunOcrClient(settings: ReturnType<typeof normalizeOcrIntegrationSettings>) {
  if (!settings.accessKeyId || !settings.accessKeySecret) {
    throw codedError("阿里云结构化 OCR 需要配置 AccessKey ID 和 AccessKey Secret。", 400, "OCR_ACCESS_KEY_REQUIRED");
  }
  return new AliyunOcrClient(new $OpenApiUtil.Config({
    accessKeyId: settings.accessKeyId,
    accessKeySecret: settings.accessKeySecret,
    endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
    readTimeout: settings.timeoutMs,
    connectTimeout: Math.min(settings.timeoutMs, 10000),
  }));
}

export function aliyunDocMindEndpoint() {
  return (process.env.ALIYUN_DOCMIND_ENDPOINT || process.env.DOCMIND_API_ENDPOINT || "docmind-api.cn-hangzhou.aliyuncs.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export function createAliyunDocMindClient(settings: ReturnType<typeof normalizeOcrIntegrationSettings>) {
  if (!settings.accessKeyId || !settings.accessKeySecret) {
    throw codedError("阿里云文档智能需要配置 AccessKey ID 和 AccessKey Secret。", 400, "OCR_ACCESS_KEY_REQUIRED");
  }
  return new DocMindClient(new $OpenApiUtil.Config({
    accessKeyId: settings.accessKeyId,
    accessKeySecret: settings.accessKeySecret,
    endpoint: aliyunDocMindEndpoint(),
    readTimeout: settings.timeoutMs,
    connectTimeout: Math.min(settings.timeoutMs, 10000),
  }));
}

export async function recognizeWithPdfTextFallback(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
  feature: OcrFeatureKey,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
  options: OcrRecognitionOptions & { source?: string; error?: unknown } = {},
): Promise<OcrRecognitionResult> {
  if (!settings.fallbackToPdfText) {
    if (options.error) throw options.error;
    throw codedError("OCR服务未配置可用结构化识别，且本地 PDF 文本兜底已关闭。", 501, "OCR_PROVIDER_ADAPTER_NOT_CONFIGURED");
  }
  const text = await extractPdfTextFromPdfBuffer(buffer, options);
  const parsedJson = feature === "customsDeclaration" ? customsTextFallbackParsedJson(text) : undefined;
  return {
    text,
    source: options.source || "OCR_PDF_TEXT_FALLBACK",
    provider: settings.provider,
    apiName: options.source || "OCR_PDF_TEXT_FALLBACK",
    rawJson: {
      source: options.source || "OCR_PDF_TEXT_FALLBACK",
      provider: settings.provider,
      textLength: text.length,
      fallbackReason: options.error instanceof Error ? options.error.message : "",
    },
    parsedJson,
  };
}

export async function recognizeAliyunVatInvoice(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(settings);
  const response = await client.recognizeInvoice(new RecognizeInvoiceRequest({
    body: Readable.from(buffer),
    pageNo: 1,
  }));
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const { extractedFields, text } = extractAliyunInvoiceRecognitionData(responseBody);
  return {
    text,
    source: "ALIYUN_RECOGNIZE_INVOICE",
    provider: settings.provider,
    apiName: "ALIYUN_RECOGNIZE_INVOICE",
    rawJson,
    extractedFields,
    parsedJson: extractedFields,
    parser: "VAT_INVOICE",
  };
}

export async function recognizeAliyunSupplierContract(
  buffer: Buffer,
  settings: ReturnType<typeof normalizeOcrIntegrationSettings>,
): Promise<OcrRecognitionResult> {
  const client = createAliyunOcrClient(settings);
  const response = await client.recognizeGeneralStructure(new RecognizeGeneralStructureRequest({
    body: Readable.from(buffer),
    keys: SUPPLIER_CONTRACT_KEYS,
  }));
  const rawJson = toPlainJson(response);
  const responseBody = isPlainRecord(rawJson) ? rawJson.body : response.body;
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const extractedFields = collectFieldsFromObject(data, CONTRACT_FIELD_ALIASES);
  const text = collectText(data).join("\n");
  return {
    text,
    source: "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE",
    provider: settings.provider,
    apiName: "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE",
    rawJson,
    extractedFields,
    parsedJson: extractedFields,
    parser: "PURCHASE_CONTRACT",
  };
}
