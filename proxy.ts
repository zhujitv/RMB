import { NextResponse, type NextRequest } from "next/server";

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

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://www.nextwood.net";

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${IS_DEVELOPMENT ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "media-src 'self' blob: data:",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Vary": "Origin",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate",
};

function isBlockedBot(userAgent = "") {
  return BLOCKED_BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function applySecurityHeaders(response: NextResponse) {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export function proxy(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  if (isBlockedBot(userAgent)) {
    return applySecurityHeaders(new NextResponse("Forbidden", { status: 403 }));
  }

  if (request.nextUrl.pathname === "/workspace" || request.nextUrl.pathname === "/index.html") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: "/:path*",
};
