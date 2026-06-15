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

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
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
