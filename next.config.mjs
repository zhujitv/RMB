/** @type {import('next').NextConfig} */
import { staticSecurityHeaders } from "./lib/security-headers.mjs";

const securityHeaders = staticSecurityHeaders();

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  serverExternalPackages: ["@napi-rs/canvas", "geoip-lite", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
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
