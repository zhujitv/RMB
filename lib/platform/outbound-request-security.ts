import { promises as dns } from "node:dns";
import { isIP } from "node:net";

const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const DNS_LOOKUP_TIMEOUT_MS = 5000;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const DOCMIND_OUTPUT_MAX_BYTES = 1024 * 1024;
const dnsCache = new Map<string, { expiresAt: number; addresses: string[] }>();

export function createOutboundTimeoutSignal(
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  signal?: AbortSignal | null,
) {
  const requestedTimeoutMs = Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : DEFAULT_FETCH_TIMEOUT_MS;
  const boundedTimeoutMs = Math.min(30000, Math.max(1, requestedTimeoutMs));
  const timeoutSignal = AbortSignal.timeout(boundedTimeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function outboundError(message: string, code: string, status = 400) {
  const error = new Error(message) as Error & { status: number; code: string; expose: boolean };
  error.status = status;
  error.code = code;
  error.expose = status < 500;
  return error;
}

function envAllowedHosts(name: string) {
  return new Set(
    (process.env[name] || "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter((host) => /^[a-z0-9.-]+$/.test(host)),
  );
}

function normalizeHostname(value: string) {
  return value.toLowerCase().replace(/\.$/, "");
}

function isAllowedAliyunOcrHost(hostname: string) {
  return /^ocr-api(?:\.[a-z0-9-]+)?\.aliyuncs\.com$/i.test(hostname)
    || envAllowedHosts("ALIYUN_OCR_ALLOWED_HOSTS").has(hostname);
}

function isAllowedDocMindEndpointHost(hostname: string) {
  return /^docmind-api(?:\.[a-z0-9-]+)?\.aliyuncs\.com$/i.test(hostname)
    || envAllowedHosts("ALIYUN_DOCMIND_ENDPOINT_ALLOWED_HOSTS").has(hostname);
}

function isAllowedDocMindOutputHost(hostname: string) {
  return /^(?:[a-z0-9][a-z0-9.-]*\.)?oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(hostname)
    || isAllowedDocMindEndpointHost(hostname)
    || envAllowedHosts("ALIYUN_DOCMIND_OUTPUT_ALLOWED_HOSTS").has(hostname);
}

function ipv4Octets(address: string) {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isBlockedIpv4(address: string) {
  const parts = ipv4Octets(address);
  if (!parts) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

export function isBlockedOutboundAddress(address: string) {
  const normalized = address.trim().toLowerCase().split("%")[0];
  const version = isIP(normalized);
  if (version === 4) return isBlockedIpv4(normalized);
  if (version !== 6) return true;
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4);
  return normalized === "::"
    || normalized === "::1"
    || /^f[cd]/i.test(normalized)
    || /^fe[89ab]/i.test(normalized)
    || /^ff/i.test(normalized)
    || /^2001:db8:/i.test(normalized);
}

function parseProviderUrl(value: unknown, fallback: string, label: string) {
  const text = String(value || fallback).trim();
  try {
    const parsed = new URL(text);
    const hostname = normalizeHostname(parsed.hostname);
    if (!hostname || parsed.username || parsed.password || parsed.port) {
      throw outboundError(`${label}必须使用官方域名。`, "OUTBOUND_URL_NOT_ALLOWED");
    }
    if (parsed.protocol === "http:") parsed.protocol = "https:";
    if (parsed.protocol !== "https:") {
      throw outboundError(`${label}只支持 HTTPS。`, "OUTBOUND_HTTPS_REQUIRED");
    }
    parsed.hostname = hostname;
    return parsed;
  } catch (error) {
    if ((error as { status?: number } | null)?.status) throw error;
    throw outboundError(`${label}格式错误。`, "OUTBOUND_URL_INVALID");
  }
}

export function normalizeAliyunOcrApiUrl(value: unknown, fallback: string) {
  const url = parseProviderUrl(value, fallback, "OCR API 地址");
  if (!isAllowedAliyunOcrHost(url.hostname)) {
    throw outboundError("OCR API 地址必须使用阿里云官方域名或服务器明确允许的域名。", "OUTBOUND_HOST_NOT_ALLOWED");
  }
  if ((url.pathname.replace(/\/+$/, "") || "/") !== "/" || url.search || url.hash) {
    throw outboundError("OCR API 地址不能包含额外路径、查询参数或片段。", "OUTBOUND_URL_NOT_ALLOWED");
  }
  url.pathname = "/";
  return url.toString().replace(/\/+$/, "");
}

export function normalizeAliyunDocMindEndpoint(value: unknown) {
  const raw = String(value || "docmind-api.cn-hangzhou.aliyuncs.com").trim();
  const url = parseProviderUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`, "", "文档智能 API 地址");
  if (!isAllowedDocMindEndpointHost(url.hostname) || (url.pathname.replace(/\/+$/, "") || "/") !== "/" || url.search || url.hash) {
    throw outboundError("文档智能 API 地址必须使用阿里云官方域名或服务器明确允许的域名。", "OUTBOUND_HOST_NOT_ALLOWED");
  }
  return url.hostname;
}

async function lookupPublicAddresses(hostname: string) {
  if (isIP(hostname)) {
    if (isBlockedOutboundAddress(hostname)) {
      throw outboundError("出站请求不能访问内网、回环、链路本地或保留地址。", "OUTBOUND_PRIVATE_ADDRESS_BLOCKED");
    }
    return [hostname];
  }
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(outboundError("出站域名解析超时。", "OUTBOUND_DNS_TIMEOUT", 502)), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
    const addresses = [...new Set(records.map((record) => record.address))];
    if (!addresses.length || addresses.some(isBlockedOutboundAddress)) {
      throw outboundError("出站域名解析到了内网、回环、链路本地或保留地址。", "OUTBOUND_PRIVATE_ADDRESS_BLOCKED");
    }
    dnsCache.set(hostname, { expiresAt: Date.now() + DNS_CACHE_TTL_MS, addresses });
    return addresses;
  } catch (error) {
    if ((error as { code?: string } | null)?.code?.startsWith("OUTBOUND_")) throw error;
    throw outboundError("出站域名解析失败。", "OUTBOUND_DNS_LOOKUP_FAILED", 502);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeFetch(url: URL, init: RequestInit, timeoutMs: number) {
  await lookupPublicAddresses(url.hostname);
  const controller = new AbortController();
  const onAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) controller.abort(init.signal.reason);
  else init.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("outbound_request_timeout")), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchAliyunOcrApi(urlValue: string, init: RequestInit = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const normalized = normalizeAliyunOcrApiUrl(urlValue, urlValue);
  return safeFetch(new URL(normalized), init, Math.min(30000, Math.max(1000, timeoutMs)));
}

export async function assertAliyunOcrApiUrlSafe(urlValue: string) {
  const normalized = normalizeAliyunOcrApiUrl(urlValue, urlValue);
  await lookupPublicAddresses(new URL(normalized).hostname);
}

export async function assertAliyunDocMindEndpointSafe(endpoint: string) {
  await lookupPublicAddresses(normalizeAliyunDocMindEndpoint(endpoint));
}

function parseAliyunDocMindOutputUrl(urlValue: string) {
  const url = parseProviderUrl(urlValue, "", "文档智能结果地址");
  if (!isAllowedDocMindOutputHost(url.hostname)) {
    throw outboundError("文档智能结果地址不属于允许的阿里云域名。", "OUTBOUND_HOST_NOT_ALLOWED");
  }
  return url;
}

export async function readResponseTextLimited(response: Response, maxBytes = DOCMIND_OUTPUT_MAX_BYTES) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw outboundError("第三方响应内容超过安全上限。", "OUTBOUND_RESPONSE_TOO_LARGE", 502);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw outboundError("第三方响应内容超过安全上限。", "OUTBOUND_RESPONSE_TOO_LARGE", 502);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function readAliyunDocMindOutputSafely(
  urlValue: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  maxBytes = DOCMIND_OUTPUT_MAX_BYTES,
) {
  const url = parseAliyunDocMindOutputUrl(urlValue);
  await lookupPublicAddresses(url.hostname);
  const controller = new AbortController();
  const onAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) controller.abort(init.signal.reason);
  else init.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error("outbound_request_timeout")),
    Math.min(30000, Math.max(1000, timeoutMs)),
  );
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { response, text: "" };
    }
    return { response, text: await readResponseTextLimited(response, maxBytes) };
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}
