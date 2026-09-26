import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

// NOTE: the Content-Security-Policy is set per-request in src/proxy.ts
// Note that 'unsafe-inline' is retained because the per-request nonce never
// reaches the App Router renderer. A static CSP cannot express that nonce,
// so it must NOT live here.
//
// NOTE: this file is the single source of truth for static security headers
// (issue #681). vercel.json used to repeat the same headers over the
// `/(.*)` rule — with a contradictory `X-XSS-Protection: 1; mode=block` — so
// the deployed policy depended on which layer applied last. Any header added
// here must NOT be duplicated in vercel.json; src/__tests__/security-headers.test.ts
// fails the build if it is.
//
// X-XSS-Protection is deliberately "0": the legacy IE/old-Chrome filter is
// deprecated and has itself been abused for cross-site scripting.
//
// NOTE: this file is also the single source of truth for the *cache* policy of
// framework-generated assets (issue #740). vercel.json used to be the only
// place that knew about `/_next/static/(.*)` — the long-lived `immutable`
// directive — so self-hosted targets (Docker, Kubernetes, `next start` /
// standalone Node) served the same content-addressed chunks with no caching
// hint at all and every repeat visit re-validated them. Declaring the rules
// here means both Vercel and self-hosted deployments emit identical headers.

// Hashed, content-addressed build output. The filename changes whenever the
// bytes change, so a 1-year immutable TTL is safe.
const IMMUTABLE_STATIC_CACHE = "public, max-age=31536000, immutable";

// The optimised-image endpoint. The URL is stable but the underlying image can
// change, so this needs a far shorter TTL than the chunk directory; the
// stale-while-revalidate window keeps repeat views instant while the optimiser
// refreshes in the background.
const OPTIMIZED_IMAGE_CACHE = "public, max-age=3600, stale-while-revalidate=86400";

// NOTE: the JavaScript bundle budget (issue #739) is enforced separately by
// `scripts/check-bundle-budget.mjs` against `bundle-budget.json`. The
// interactive treemap below is opt-in via ANALYZE=true (`npm run analyze`) so
// it never affects a normal or CI build, and it is the *webpack* analyzer —
// `npm run analyze` builds with `--webpack` for that reason.
const nextConfig: NextConfig = {
  // Standalone output — required by the Docker image (copies .next/standalone).
  // Disabled on Vercel: Next 16.3's adapter-based Vercel builds crash with
  // ENOENT .next/next-server.js.nft.json when standalone is set (vercel/next.js
  // #96646 / #96657), and Vercel doesn't use the standalone folder anyway.
  output: process.env.VERCEL ? undefined : "standalone",

  // Note: instrumentation (src/instrumentation.ts) is always enabled in Next.js 16
  // — the legacy `instrumentationHook` option was removed from the config type.

  // Power web vitals with edge performance metrics
  poweredByHeader: false,

  // Compress responses for better performance
  compress: true,

  // Production source maps disabled for security
  productionBrowserSourceMaps: false,

  // Security headers applied to all responses
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-XSS-Protection", value: "0" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      ],
    },
    {
      source: "/_next/static/(.*)",
      headers: [{ key: "Cache-Control", value: IMMUTABLE_STATIC_CACHE }],
    },
    {
      source: "/_next/image",
      headers: [{ key: "Cache-Control", value: OPTIMIZED_IMAGE_CACHE }],
    },
    {
      source: "/api/(.*)",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      ],
    },
  ],

  // Image optimization for Stellar Explorer and other external sources
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "stellar.expert" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
    ],
  },
};

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  // Don't try to open a browser in CI; write the report to .next/analyze.
  openAnalyzer: process.env.CI !== "true",
  analyzerMode: "static",
});

export default withBundleAnalyzer(nextConfig);
