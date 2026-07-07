import { Readable } from "node:stream";
import DocMindClient from "@alicloud/docmind-api20220711";
import AliyunOcrClient, {
  RecognizeInvoiceRequest,
} from "@alicloud/ocr-api20210707";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import {
  extractPdfTextFromPdfBuffer,
} from "../customs-declaration-parser";
import { codedError, isPlainRecord, nonEmpty } from "./shared-base-utils";
import { logServerError, type AppError } from "./shared-base-errors";
import { extractAliyunInvoiceRecognitionData } from "./aliyun-invoice-ocr-parser";
import {
  type OcrFeatureKey,
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  type RasterizedPdfPage,
  customsTextFallbackParsedJson,
  normalizeOcrIntegrationSettings,
  normalizeFieldValue,
  ocrErrorText,
  parseJsonMaybe,
  responseField,
  toPlainJson,
  sleep,
} from "./ocr-integration-shared";

export const ALIYUN_OCR_RETRY_DELAYS_MS = [1000, 2000, 5000] as const;
const ALIYUN_OCR_HEALTH_STATE_KEY = "__rmbAliyunOcrHealthCheckScheduled";

type AliyunOcrSettings = ReturnType<typeof normalizeOcrIntegrationSettings>;
type AliyunOcrDiagnostics = {
  requestId: string;
  httpStatus: string;
  responseBody: string;
  errorCode: string;
  errorMessage: string;
};
type AliyunOcrRetryOptions = {
  maxAttempts?: number;
  url?: string;
};

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

export function aliyunRegionFromUrl(value: string) {
  const endpoint = aliyunEndpointFromUrl(value);
  return endpoint.match(/^ocr-api\.([a-z0-9-]+)\.aliyuncs\.com$/i)?.[1] || process.env.ALIYUN_OCR_REGION || "";
}

function jsonSnippet(value: unknown, limit = 2000) {
  if (value == null) return "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(toPlainJson(value));
    return text.slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}

function headerValue(headers: unknown, key: string) {
  if (!headers) return "";
  const lowerKey = key.toLowerCase();
  if (typeof (headers as { get?: unknown }).get === "function") {
    return String((headers as { get: (name: string) => unknown }).get(key) || "");
  }
  if (!isPlainRecord(headers)) return "";
  for (const [entryKey, entryValue] of Object.entries(headers)) {
    if (entryKey.toLowerCase() === lowerKey) return String(entryValue || "");
  }
  return "";
}

export function aliyunOcrErrorDiagnostics(error: unknown): AliyunOcrDiagnostics {
  const record = isPlainRecord(error) ? error : {};
  const data = isPlainRecord(record.data) ? record.data : {};
  const response = isPlainRecord(record.response) ? record.response : {};
  const responseData = isPlainRecord(response.data) ? response.data : {};
  const responseBody = isPlainRecord(response.body) ? response.body : response.body;
  const headers = response.headers || record.headers || data.headers;
  const requestId = nonEmpty(
    record.requestId
      || data.requestId
      || data.RequestId
      || responseData.requestId
      || responseData.RequestId
      || (isPlainRecord(responseBody) ? responseBody.requestId || responseBody.RequestId : "")
      || headerValue(headers, "x-acs-request-id")
      || headerValue(headers, "x-acs-requestid"),
  );
  const statusValue = record.statusCode || record.status || data.statusCode || response.status || response.statusCode;
  const code = nonEmpty(record.code || data.code || data.Code || responseData.code || responseData.Code);
  const message = nonEmpty(record.message || data.message || data.Message || responseData.message || responseData.Message);
  const fallbackBody = {
    requestId,
    code,
    message,
    name: nonEmpty(record.name),
  };
  const body = response.body || response.data || data.body || data.response || fallbackBody;
  return {
    requestId,
    httpStatus: statusValue == null ? "" : String(statusValue),
    responseBody: jsonSnippet(body),
    errorCode: code,
    errorMessage: message,
  };
}

function isRetryableAliyunOcrError(error: unknown) {
  const diagnostics = aliyunOcrErrorDiagnostics(error);
  const text = [
    (error as { name?: unknown } | null)?.name,
    (error as { code?: unknown } | null)?.code,
    (error as { message?: unknown } | null)?.message,
    diagnostics.errorCode,
    diagnostics.errorMessage,
    diagnostics.httpStatus,
  ].join(" ");
  if (/\b(400|401|403|404)\b/.test(diagnostics.httpStatus)) return false;
  return /(ConnectTimeout|ReadTimeout|Timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|Connect HTTPS|InternalError|ServiceUnavailable|Throttling|TooManyRequests|5\d\d|429)/i.test(text);
}

function aliyunOcrLogContext(apiName: string, settings: AliyunOcrSettings, attempt: number, error?: unknown) {
  const diagnostics = error ? aliyunOcrErrorDiagnostics(error) : {
    requestId: "",
    httpStatus: "",
    responseBody: "",
    errorCode: "",
    errorMessage: "",
  };
  return {
    provider: settings.provider,
    apiName,
    endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
    region: aliyunRegionFromUrl(settings.apiBaseUrl),
    timeoutMs: settings.timeoutMs,
    attempt,
    requestId: diagnostics.requestId || "-",
    httpStatus: diagnostics.httpStatus || "-",
    responseBody: diagnostics.responseBody || "-",
    errorCode: diagnostics.errorCode || "-",
    errorMessage: diagnostics.errorMessage || "-",
  };
}

async function withAliyunOcrRetry<T>(
  apiName: string,
  settings: AliyunOcrSettings,
  operation: () => Promise<T>,
  options: AliyunOcrRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.min(
    ALIYUN_OCR_RETRY_DELAYS_MS.length + 1,
    Math.max(1, Math.trunc(Number(options.maxAttempts || ALIYUN_OCR_RETRY_DELAYS_MS.length + 1))),
  );
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation();
      if (attempt > 1) {
        console.info("aliyun-ocr-request-recovered", aliyunOcrLogContext(apiName, settings, attempt));
      }
      return result;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableAliyunOcrError(error);
      const context = aliyunOcrLogContext(apiName, settings, attempt, error);
      const nextRetryDelayMs = retryable && attempt < maxAttempts ? (ALIYUN_OCR_RETRY_DELAYS_MS[attempt - 1] ?? 0) : 0;
      console.warn("aliyun-ocr-request-failed", {
        ...context,
        retryable,
        maxAttempts,
        nextRetryDelayMs,
      });
      if (!retryable || attempt >= maxAttempts) break;
      await sleep(nextRetryDelayMs);
    }
  }
  const diagnostics = aliyunOcrErrorDiagnostics(lastError);
  const error = codedError("OCR 服务异常，请稍后重新识别；如仍失败，请联系管理员查看服务器日志。", 503, "ALIYUN_OCR_SERVICE_UNAVAILABLE") as AppError;
  error.details = {
    apiName,
    provider: settings.provider,
    endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
    region: aliyunRegionFromUrl(settings.apiBaseUrl),
    timeoutMs: settings.timeoutMs,
    requestId: diagnostics.requestId,
    httpStatus: diagnostics.httpStatus,
    responseBody: diagnostics.responseBody,
    errorCode: diagnostics.errorCode,
    errorMessage: diagnostics.errorMessage,
  };
  throw error;
}

async function readResponseBodySnippet(response: Response) {
  try {
    return (await response.text()).slice(0, 1000);
  } catch (error) {
    return `body_unreadable:${ocrErrorText(error)}`;
  }
}

export async function checkAliyunOcrConnectivity(settings: AliyunOcrSettings) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(settings.timeoutMs, 3000), 15000));
  try {
    const response = await fetch(settings.apiBaseUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await readResponseBodySnippet(response);
    console.info("aliyun-ocr-health-check", {
      provider: settings.provider,
      endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
      region: aliyunRegionFromUrl(settings.apiBaseUrl),
      timeoutMs: settings.timeoutMs,
      httpStatus: response.status,
      requestId: response.headers.get("x-acs-request-id") || response.headers.get("x-acs-requestid") || "-",
      responseBody: body || "-",
    });
    return { ok: response.status < 500, status: response.status, body };
  } catch (error) {
    logServerError("aliyun-ocr-health-check-failed", error, {
      provider: settings.provider,
      endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
      region: aliyunRegionFromUrl(settings.apiBaseUrl),
      timeoutMs: settings.timeoutMs,
    });
    return { ok: false, status: 0, body: ocrErrorText(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export function scheduleAliyunOcrStartupHealthCheck(settings: AliyunOcrSettings) {
  const state = globalThis as typeof globalThis & { __rmbAliyunOcrHealthCheckScheduled?: boolean };
  if (state[ALIYUN_OCR_HEALTH_STATE_KEY] || process.env.DISABLE_ALIYUN_OCR_HEALTH_CHECK === "true") return;
  state[ALIYUN_OCR_HEALTH_STATE_KEY] = true;
  setTimeout(() => {
    checkAliyunOcrConnectivity(settings).catch((error) => {
      logServerError("aliyun-ocr-startup-health-check-failed", error, {
        endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
        region: aliyunRegionFromUrl(settings.apiBaseUrl),
      });
    });
  }, 0);
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
