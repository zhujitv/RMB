const DEFAULT_APP_ORIGIN = "https://www.nextwood.net";

export function isDevelopmentEnv(env = process.env) {
  return env.NODE_ENV !== "production";
}

export function appOriginFromEnv(env = process.env) {
  return env.NEXT_PUBLIC_APP_URL || env.APP_URL || DEFAULT_APP_ORIGIN;
}

export function buildContentSecurityPolicy({ isDevelopment = isDevelopmentEnv(), nonce = "" } = {}) {
  const scriptSrc = isDevelopment
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : nonce
      ? ["'self'", `'nonce-${nonce}'`]
      : ["'self'"];
  const styleSrc = isDevelopment
    ? ["'self'", "'unsafe-inline'"]
    : nonce
      ? ["'self'", `'nonce-${nonce}'`]
      : ["'self'"];
  const connectSrc = [
    "'self'",
    "https:",
    ...(isDevelopment ? ["http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*"] : []),
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `style-src ${styleSrc.join(" ")}`,
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "media-src 'self' blob: data:",
  ].join("; ");
}

export function staticSecurityHeaders(env = process.env) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Access-Control-Allow-Origin", value: appOriginFromEnv(env) },
    { key: "Vary", value: "Origin" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate" },
  ];
}
