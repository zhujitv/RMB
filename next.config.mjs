/** @type {import('next').NextConfig} */
import { staticSecurityHeaders } from "./lib/security-headers.mjs";

const securityHeaders = staticSecurityHeaders();

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
