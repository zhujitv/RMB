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

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function apiJson<T>(path: string, init?: ApiJsonInit): Promise<T> {
  const { timeoutMs, signal, ...fetchInit } = init || {};
  const controller = typeof AbortController !== "undefined" && timeoutMs ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

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
  } catch (error) {
    if (isAbortError(error)) {
      throw new ApiRequestError("请求超时，请检查本地数据库、网络或权限初始化接口。", 408, "REQUEST_TIMEOUT");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
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
    throw new ApiRequestError(message, response.status, code);
  }
  return data as T;
}
