/** @type {import('next').NextConfig} */
import { staticSecurityHeaders } from "./lib/security-headers.mjs";

const securityHeaders = staticSecurityHeaders();

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  serverExternalPackages: ["@napi-rs/canvas", "geoip-lite", "pdf2json", "pdfjs-dist"],
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
