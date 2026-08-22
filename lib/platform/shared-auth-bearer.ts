type HeaderRequest = {
  headers?: { get(name: string): string | null };
} | null | undefined;

export function requestBearerToken(request: HeaderRequest) {
  const authorization = String(request?.headers?.get("authorization") || "").trim();
  if (!authorization.startsWith("Bearer ")) return "";
  const token = authorization.slice(7).trim();
  return /^[A-Za-z0-9_-]{32,512}$/.test(token) ? token : "";
}
