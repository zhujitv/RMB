import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, isDevelopmentEnv, staticSecurityHeaders } from "./lib/security-headers.mjs";

const BLOCKED_BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /baiduspider/i,
  /yandex(bot|images|mobilebot)/i,
  /duckduckbot/i,
  /slurp/i,
  /sogou/i,
  /exabot/i,
  /applebot(?!-extended)/i,
  /petalbot/i,
  /ahrefsbot/i,
  /semrushbot/i,
  /mj12bot/i,
  /dotbot/i,
  /bytespider/i,
  /gptbot/i,
  /chatgpt-user/i,
  /oai-searchbot/i,
  /google-extended/i,
  /claudebot/i,
  /claude-web/i,
  /anthropic-ai/i,
  /perplexitybot/i,
  /ccbot/i,
  /facebookbot/i,
  /meta-externalagent/i,
  /amazonbot/i,
  /youbot/i,
  /cohere-ai/i,
  /applebot-extended/i,
  /diffbot/i,
];

const IS_DEVELOPMENT = isDevelopmentEnv();
const SECURITY_HEADERS = Object.fromEntries(staticSecurityHeaders().map(({ key, value }) => [key, value]));

function isBlockedBot(userAgent = "") {
  return BLOCKED_BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

function appendHeaderValue(current: string | null, value: string) {
  const values = String(current || "").split(",").map((item) => item.trim()).filter(Boolean);
  return values.includes(value) ? values.join(", ") : [...values, value].join(", ");
}

function applySecurityHeaders(response: NextResponse, contentSecurityPolicy: string) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    if (key === "Vary") {
      response.headers.set(key, appendHeaderValue(response.headers.get(key), value));
    } else {
      response.headers.set(key, value);
    }
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    isDevelopment: IS_DEVELOPMENT,
    nonce,
  });
  const userAgent = request.headers.get("user-agent") || "";
  if (isBlockedBot(userAgent)) {
    return applySecurityHeaders(new NextResponse("Forbidden", { status: 403 }), contentSecurityPolicy);
  }

  if (request.nextUrl.pathname === "/workspace" || request.nextUrl.pathname === "/index.html") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return applySecurityHeaders(NextResponse.redirect(url), contentSecurityPolicy);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  return applySecurityHeaders(NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  }), contentSecurityPolicy);
}

export const config = {
  matcher: "/:path*",
};
