import { codedError, isPlainRecord, nonEmpty, redactSensitiveText } from "./shared-base-utils";
import { logServerError, type AppError } from "./shared-base-errors";
import { fetchAliyunOcrApi } from "./outbound-request-security";
import {
  normalizeOcrIntegrationSettings,
  ocrErrorText,
  sleep,
} from "./ocr-integration-shared";

export const ALIYUN_OCR_RETRY_DELAYS_MS = [1000, 2000, 5000] as const;
const ALIYUN_OCR_HEALTH_STATE_KEY = "__rmbAliyunOcrHealthCheckScheduled";

type AliyunOcrSettings = ReturnType<typeof normalizeOcrIntegrationSettings>;
type AliyunOcrFailureDetails = {
  requestId: string;
  httpStatus: string;
  errorCode: string;
  errorMessage: string;
};
type AliyunOcrRetryOptions = {
  maxAttempts?: number;
  url?: string;
};

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

export function aliyunOcrErrorDiagnostics(error: unknown): AliyunOcrFailureDetails {
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
  return {
    requestId,
    httpStatus: statusValue == null ? "" : String(statusValue),
    errorCode: code,
    errorMessage: redactSensitiveText(message || fallbackBody.message, 500),
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
    errorCode: diagnostics.errorCode,
    errorMessage: diagnostics.errorMessage,
  };
  throw error;
}

export async function checkAliyunOcrConnectivity(settings: AliyunOcrSettings) {
  try {
    const response = await fetchAliyunOcrApi(settings.apiBaseUrl, {
      method: "GET",
    }, Math.min(Math.max(settings.timeoutMs, 3000), 15000));
    await response.body?.cancel();
    console.info("aliyun-ocr-health-check", {
      provider: settings.provider,
      endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
      region: aliyunRegionFromUrl(settings.apiBaseUrl),
      timeoutMs: settings.timeoutMs,
      httpStatus: response.status,
      requestId: response.headers.get("x-acs-request-id") || response.headers.get("x-acs-requestid") || "-",
    });
    return { ok: response.status < 500, status: response.status };
  } catch (error) {
    logServerError("aliyun-ocr-health-check-failed", error, {
      provider: settings.provider,
      endpoint: aliyunEndpointFromUrl(settings.apiBaseUrl),
      region: aliyunRegionFromUrl(settings.apiBaseUrl),
      timeoutMs: settings.timeoutMs,
    });
    return { ok: false, status: 0 };
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
