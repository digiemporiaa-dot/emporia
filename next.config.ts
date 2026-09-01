import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Traced standalone output keeps the Docker runner minimal (see docs/ARCHITECTURE.md 17.1).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    // Server Actions are the primary write path; keep the payload cap tight.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
