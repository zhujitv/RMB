/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV !== "production";
const appOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://www.nextwood.net";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
      "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
      "worker-src 'self' blob:",
      "frame-src 'self' blob:",
      "media-src 'self' blob: data:",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Access-Control-Allow-Origin", value: appOrigin },
  { key: "Vary", value: "Origin" },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate",
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
