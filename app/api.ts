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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function timeoutMessageForPath(path: string) {
  const pathname = normalizedApiPath(path);
  if (pathname === "/api/auth/me") return "无法读取当前用户信息";
  if (pathname === "/api/auth/permissions" || pathname === "/api/settings/permissions") return "权限初始化失败";
  if (pathname === "/api/workbench/todos") return "待办数据加载失败";
  if (pathname === "/api/overview" || pathname === "/api/ledger") return "统计数据加载失败";
  return "请求超时";
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

function bodyManagesContentType(body: BodyInit | null | undefined) {
  return Boolean(
    (typeof FormData !== "undefined" && body instanceof FormData)
    || (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams)
    || (typeof Blob !== "undefined" && body instanceof Blob)
  );
}

function apiRequestHeaders(headersInit: HeadersInit | undefined, body: BodyInit | null | undefined) {
  const headers = new Headers(headersInit || {});
  if (!headers.has("Content-Type") && !bodyManagesContentType(body)) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

export async function apiJson<T>(path: string, init?: ApiJsonInit): Promise<T> {
  const timingLabel = startApiRequestTimer(path, init);
  const { timeoutMs, signal, ...fetchInit } = init || {};
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
        headers: apiRequestHeaders(fetchInit.headers, fetchInit.body),
        ...fetchInit,
        signal: controller?.signal || signal,
      });
      statusCode = response.status;
    } catch (error) {
      if (isAbortError(error)) {
        statusCode = 408;
        errorCode = "REQUEST_TIMEOUT";
        throw new ApiRequestError(timeoutMessageForPath(path), 408, "REQUEST_TIMEOUT");
      }
      throw error;
    }

    let responseText = "";
    const responseForText = response.clone();
    const data: unknown = await response.json().catch(async () => {
      responseText = await responseForText.text().catch(() => "");
      return {};
    });
    if (!response.ok) {
      const message = data && typeof data === "object"
        ? ("message" in data && typeof data.message === "string"
          ? data.message
          : "error" in data && typeof data.error === "string"
            ? data.error
            : `请求失败（${response.status}）：${normalizedApiPath(path) || path}`)
        : `请求失败（${response.status}）：${normalizedApiPath(path) || path}`;
      const code = data && typeof data === "object" && "code" in data && typeof data.code === "string"
        ? data.code
        : undefined;
      const fallbackMessage = responseText
        ? `${message}。服务器返回非JSON响应，请查看服务端日志。`
        : message;
      errorCode = code || `HTTP_${response.status}`;
      throw new ApiRequestError(fallbackMessage, response.status, errorCode);
    }
    return data as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    endApiRequestTimer(timingLabel);
  }
}
