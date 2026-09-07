import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Traced standalone output gives the runner a self-contained server.js
  // (see docs/ARCHITECTURE.md 17.1).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    // Server Actions are the primary write path; keep the payload cap tight.
    serverActions: { bodySizeLimit: "2mb" },
  },

  /**
   * Security headers.
   *
   * Applied at the framework rather than left to the reverse proxy: Coolify
   * fronts the container, and a header the app depends on should not be a
   * setting someone can forget in a different system (CLAUDE.md 11).
   *
   * The CSP allows Razorpay's checkout script and frame, because that is how
   * the gateway takes a card; nothing else is granted. `unsafe-inline` on
   * styles is required by Next's own inlined critical CSS, and `unsafe-eval`
   * is deliberately absent.
   */
  async headers() {
    const isDev = process.env.NODE_ENV === "development";

    const csp = [
      "default-src 'self'",
      // Razorpay checkout is loaded from their CDN; 'unsafe-inline' covers
      // Next's bootstrap script tags, which carry no user input.
      //
      // 'unsafe-eval' is added in development ONLY. `next dev` compiles and
      // evaluates modules through eval for fast refresh, so without it React
      // never hydrates: every client component is inert, and forms fall back to
      // a native POST that `form-action 'self'` then blocks. The dev server is
      // unusable for anything interactive without this, and a production build
      // never evaluates a string as script — which is why the directive is
      // conditional rather than simply present.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Uploads go straight to R2, and checkout talks to Razorpay. In
      // development, fast refresh also needs its own websocket.
      `connect-src 'self'${isDev ? " ws: wss:" : ""} https://*.r2.cloudflarestorage.com https://api.razorpay.com https://lumberjack.razorpay.com`,
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Belt and braces with frame-ancestors, for older browsers.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
