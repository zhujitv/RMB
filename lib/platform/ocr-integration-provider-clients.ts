import { Readable } from "node:stream";
import DocMindClient from "@alicloud/docmind-api20220711";
import AliyunOcrClient, { RecognizeInvoiceRequest } from "@alicloud/ocr-api20210707";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { extractPdfTextFromPdfBuffer } from "../customs-declaration-parser";
import { codedError, isPlainRecord } from "./shared-base-utils";
import { extractAliyunInvoiceRecognitionData } from "./aliyun-invoice-ocr-parser";
import { aliyunEndpointFromUrl } from "./ocr-integration-reliability";
import { normalizeAliyunDocMindEndpoint } from "./outbound-request-security";
import {
  type OcrFeatureKey,
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  customsTextFallbackParsedJson,
  normalizeOcrIntegrationSettings,
  toPlainJson,
} from "./ocr-integration-shared";

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
  return normalizeAliyunDocMindEndpoint(
    process.env.ALIYUN_DOCMIND_ENDPOINT
      || process.env.DOCMIND_API_ENDPOINT
      || "docmind-api.cn-hangzhou.aliyuncs.com",
  );
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
  options: { signal?: AbortSignal } = {},
): Promise<OcrRecognitionResult> {
  if (options.signal?.aborted) throw options.signal.reason;
  const client = createAliyunOcrClient(settings);
  const body = Readable.from(buffer);
  const abortBody = () => body.destroy(
    options.signal?.reason instanceof Error ? options.signal.reason : new Error("OCR request aborted"),
  );
  options.signal?.addEventListener("abort", abortBody, { once: true });
  let response;
  try {
    response = await client.recognizeInvoice(new RecognizeInvoiceRequest({
      body,
      pageNo: 1,
    }));
  } finally {
    options.signal?.removeEventListener("abort", abortBody);
    body.destroy();
  }
  if (options.signal?.aborted) throw options.signal.reason;
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
