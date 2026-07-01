export class ApiRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

type ApiJsonInit = RequestInit & {
  timeoutMs?: number;
};

let apiRequestTimingSeq = 0;
const API_PERFORMANCE_REPORT_PATH = "/api/settings/api-performance";

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function startApiRequestTimer(path: string, init?: RequestInit) {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return "";
  const method = String(init?.method || "GET").toUpperCase();
  const label = `[api] ${++apiRequestTimingSeq} ${method} ${path}`;
  console.time(label);
  return label;
}

function endApiRequestTimer(label: string) {
  if (!label) return;
  console.timeEnd(label);
}

function normalizedApiPath(path: string) {
  if (typeof window === "undefined") return "";
  try {
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    return url.pathname;
  } catch {
    return path.split("?")[0] || path;
  }
}

function shouldReportApiRequestTiming(path: string) {
  const pathname = normalizedApiPath(path);
  return pathname.startsWith("/api/") && pathname !== API_PERFORMANCE_REPORT_PATH;
}

function reportApiRequestTiming(input: {
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
  errorCode?: string;
}) {
  if (typeof window === "undefined" || !shouldReportApiRequestTiming(input.path)) return;
  const payload = JSON.stringify({
    source: "client",
    path: normalizedApiPath(input.path),
    method: input.method,
    statusCode: input.statusCode,
    durationMs: input.durationMs,
    errorCode: input.errorCode || "",
  });
  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(API_PERFORMANCE_REPORT_PATH, blob);
    return;
  }
  void fetch(API_PERFORMANCE_REPORT_PATH, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: payload,
  }).catch(() => undefined);
}

export async function apiJson<T>(path: string, init?: ApiJsonInit): Promise<T> {
  const timingLabel = startApiRequestTimer(path, init);
  const { timeoutMs, signal, ...fetchInit } = init || {};
  const requestStartedAt = Date.now();
  const method = String(fetchInit.method || "GET").toUpperCase();
  let statusCode = 0;
  let errorCode = "";
  const controller = typeof AbortController !== "undefined" && timeoutMs ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  try {
    if (controller && signal) {
      abortListener = () => controller.abort();
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", abortListener, { once: true });
      }
    }

    if (controller && timeoutMs) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(path, {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(fetchInit.headers || {}),
        },
        ...fetchInit,
        signal: controller?.signal || signal,
      });
      statusCode = response.status;
    } catch (error) {
      if (isAbortError(error)) {
        statusCode = 408;
        errorCode = "REQUEST_TIMEOUT";
        throw new ApiRequestError("请求超时，请检查本地数据库、网络或权限初始化接口。", 408, "REQUEST_TIMEOUT");
      }
      throw error;
    }

    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && typeof data === "object"
        ? ("message" in data && typeof data.message === "string"
          ? data.message
          : "error" in data && typeof data.error === "string"
            ? data.error
            : "请求失败，请稍后重试。")
        : "请求失败，请稍后重试。";
      const code = data && typeof data === "object" && "code" in data && typeof data.code === "string"
        ? data.code
        : undefined;
      errorCode = code || "";
      throw new ApiRequestError(message, response.status, code);
    }
    return data as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    reportApiRequestTiming({
      path,
      method,
      statusCode,
      durationMs: Date.now() - requestStartedAt,
      errorCode,
    });
    endApiRequestTimer(timingLabel);
  }
}
