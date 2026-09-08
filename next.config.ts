import type { NextConfig } from "next";

/**
 * Content-Security-Policy origins for the tracking providers in
 * lib/services/tracking.service.ts.
 *
 * A provider a marketer enables in Marketing → Tracking & Pixels is loaded by
 * components/website/tracking/loaders.ts, and the browser will refuse it
 * silently unless its origins are listed here. Listing an origin only permits
 * it — nothing loads until the setting is saved and enabled — so the whole set
 * ships together rather than the policy being edited per launch.
 *
 * Grouped by provider so a removal is as obvious as an addition.
 */
const TRACKING_CSP = {
  script: [
    // GTM, GA4 and Google Ads all serve their tag from this one origin.
    "https://www.googletagmanager.com",
    // Google Ads conversion linker.
    "https://www.googleadservices.com",
    // Meta Pixel (fbevents.js).
    "https://connect.facebook.net",
    // Microsoft Clarity.
    "https://www.clarity.ms",
    "https://*.clarity.ms",
    // Hotjar splits the bootstrap and the recorder across two hosts.
    "https://static.hotjar.com",
    "https://script.hotjar.com",
    // Pinterest Tag.
    "https://s.pinimg.com",
    // TikTok Pixel.
    "https://analytics.tiktok.com",
    // Snap Pixel.
    "https://sc-static.net",
  ],
  connect: [
    // GA4 / GTM measurement beacons.
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://stats.g.doubleclick.net",
    // Google Ads conversions.
    "https://www.google.com",
    "https://googleads.g.doubleclick.net",
    // Meta Pixel browser events (the CAPI copy is sent server-side).
    "https://www.facebook.com",
    // Clarity session upload.
    "https://*.clarity.ms",
    // Hotjar, including the websocket its recorder opens.
    "https://*.hotjar.com",
    "https://*.hotjar.io",
    "wss://*.hotjar.com",
    // Pinterest.
    "https://ct.pinterest.com",
    // TikTok.
    "https://analytics.tiktok.com",
    // Snap.
    "https://tr.snapchat.com",
  ],
  frame: [
    // Google Ads and Hotjar both drop a hidden iframe for cross-domain state.
    "https://td.doubleclick.net",
    "https://vars.hotjar.com",
  ],
} as const;

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
   * the gateway takes a card, and the tracking origins above; nothing else is
   * granted. `unsafe-inline` on styles is required by Next's own inlined
   * critical CSS, and `unsafe-eval` is deliberately absent in production.
   */
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const list = (origins: readonly string[]) => origins.join(" ");

    const csp = [
      "default-src 'self'",
      // Razorpay checkout is loaded from their CDN; 'unsafe-inline' covers
      // Next's bootstrap script tags, which carry no user input, and the tag
      // bootstrap snippets the tracking loaders inject.
      //
      // 'unsafe-eval' is added in development ONLY. `next dev` compiles and
      // evaluates modules through eval for fast refresh, so without it React
      // never hydrates: every client component is inert, and forms fall back to
      // a native POST that `form-action 'self'` then blocks. The dev server is
      // unusable for anything interactive without this, and a production build
      // never evaluates a string as script — which is why the directive is
      // conditional rather than simply present.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com ${list(TRACKING_CSP.script)}`,
      "style-src 'self' 'unsafe-inline'",
      // Tracking pixels are <img> requests to a long tail of hosts; https: was
      // already the policy for CMS media and covers them without enumeration.
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Uploads go straight to R2, and checkout talks to Razorpay. In
      // development, fast refresh also needs its own websocket.
      `connect-src 'self'${isDev ? " ws: wss:" : ""} https://*.r2.cloudflarestorage.com https://api.razorpay.com https://lumberjack.razorpay.com ${list(TRACKING_CSP.connect)}`,
      `frame-src https://api.razorpay.com https://checkout.razorpay.com ${list(TRACKING_CSP.frame)}`,
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
