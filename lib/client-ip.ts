import { isIP } from "node:net";

export type ClientIpRequest = {
  ip?: string | null;
  headers?: {
    get(name: string): string | null;
  };
} | null | undefined;

export type ClientIpResolutionOptions = {
  platform?: "direct" | "vercel" | "cloudflare" | "trusted-proxy";
  allowDevelopmentHeaders?: boolean;
};

function normalizeIp(value: unknown) {
  let text = String(value || "").trim().replace(/^"|"$/g, "");
  if (!text) return "";
  if (text.startsWith("[")) {
    const closingBracket = text.indexOf("]");
    if (closingBracket > 0) text = text.slice(1, closingBracket);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) {
    text = text.replace(/:\d+$/, "");
  }
  text = text.split("%")[0];
  return isIP(text) ? text : "";
}

function headerCandidates(request: ClientIpRequest, name: string) {
  return String(request?.headers?.get(name) || "")
    .split(",")
    .map(normalizeIp)
    .filter(Boolean);
}

function firstHeaderIp(request: ClientIpRequest, name: string) {
  return headerCandidates(request, name)[0] || "";
}

function lastHeaderIp(request: ClientIpRequest, name: string) {
  return headerCandidates(request, name).at(-1) || "";
}

function optionsFromEnvironment(): Required<ClientIpResolutionOptions> {
  const isVercelRuntime = process.env.VERCEL === "1" && Boolean(
    process.env.VERCEL_URL || process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_REGION,
  );
  if (isVercelRuntime) {
    return { platform: "vercel", allowDevelopmentHeaders: false };
  }
  const provider = String(process.env.TRUSTED_PROXY_PROVIDER || "").toLowerCase();
  if (provider === "cloudflare") return { platform: "cloudflare", allowDevelopmentHeaders: false };
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    return { platform: "trusted-proxy", allowDevelopmentHeaders: false };
  }
  return {
    platform: "direct",
    allowDevelopmentHeaders: process.env.NODE_ENV !== "production",
  };
}

export function resolveTrustedClientIp(
  request: ClientIpRequest,
  options: ClientIpResolutionOptions = optionsFromEnvironment(),
) {
  const platform = options.platform || "direct";
  if (platform === "vercel") {
    return firstHeaderIp(request, "x-vercel-forwarded-for")
      || firstHeaderIp(request, "x-forwarded-for")
      || firstHeaderIp(request, "x-real-ip")
      || normalizeIp(request?.ip)
      || null;
  }
  if (platform === "cloudflare") {
    return firstHeaderIp(request, "cf-connecting-ip") || normalizeIp(request?.ip) || null;
  }
  if (platform === "trusted-proxy") {
    return lastHeaderIp(request, "x-forwarded-for")
      || firstHeaderIp(request, "x-real-ip")
      || normalizeIp(request?.ip)
      || null;
  }
  const directIp = normalizeIp(request?.ip);
  if (directIp) return directIp;
  if (options.allowDevelopmentHeaders) {
    return firstHeaderIp(request, "x-real-ip")
      || firstHeaderIp(request, "x-forwarded-for")
      || null;
  }
  return null;
}
