import { NextResponse } from "next/server";

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

function isBlockedBot(userAgent = "") {
  return BLOCKED_BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

export function middleware(request) {
  const userAgent = request.headers.get("user-agent") || "";
  if (isBlockedBot(userAgent)) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate",
      },
    });
  }

  if (request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate");
  return response;
}

export const config = {
  matcher: "/:path*",
};
