const DEFAULT_APP_ORIGIN = "https://www.nextwood.net";

export function isDevelopmentEnv(env = process.env) {
  return env.NODE_ENV !== "production";
}

export function appOriginFromEnv(env = process.env) {
  return env.NEXT_PUBLIC_APP_URL || env.APP_URL || DEFAULT_APP_ORIGIN;
}

function cspSourceList(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((source) => source.trim())
    .filter(Boolean)
    .filter((source) => !/[;\r\n]/.test(source));
}

function uniqueSources(sources = []) {
  return [...new Set(sources.filter(Boolean))];
}

function developmentSources(isDevelopment, sources = []) {
  return isDevelopment ? sources : [];
}

export function buildContentSecurityPolicy({ isDevelopment, nonce = "", env = process.env } = {}) {
  const devMode = typeof isDevelopment === "boolean" ? isDevelopment : isDevelopmentEnv(env);
  const scriptSrc = devMode
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : nonce
      ? ["'self'", `'nonce-${nonce}'`]
      : ["'self'"];
  const styleSrc = devMode
    ? ["'self'", "'unsafe-inline'"]
    : nonce
      ? ["'self'", `'nonce-${nonce}'`]
      : ["'self'"];
  const connectSrc = uniqueSources([
    "'self'",
    ...cspSourceList(env.CSP_CONNECT_SRC),
    ...developmentSources(devMode, ["https:", "http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*"]),
  ]);
  const imgSrc = uniqueSources([
    "'self'",
    "data:",
    "blob:",
    ...cspSourceList(env.CSP_IMG_SRC),
    ...developmentSources(devMode, ["https:"]),
  ]);
  const frameSrc = uniqueSources([
    "'self'",
    "blob:",
    "https://embed.shipsgo.com",
    ...cspSourceList(env.CSP_FRAME_SRC),
  ]);
  const mediaSrc = uniqueSources([
    "'self'",
    "blob:",
    "data:",
    ...cspSourceList(env.CSP_MEDIA_SRC),
  ]);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self' data:",
    `style-src ${styleSrc.join(" ")}`,
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    `frame-src ${frameSrc.join(" ")}`,
    `media-src ${mediaSrc.join(" ")}`,
  ].join("; ");
}

export function staticSecurityHeaders(env = process.env) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Access-Control-Allow-Origin", value: appOriginFromEnv(env) },
    { key: "Vary", value: "Origin" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate" },
  ];
  if (!isDevelopmentEnv(env)) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains; preload",
    });
  }
  return headers;
}
