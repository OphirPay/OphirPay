import type { NextConfig } from 'next';

/**
 * Security headers that should be applied to **all** responses.
 * These are the same headers that Vercel adds by default.
 */
const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

/**
 * Next.js configuration.
 *
 * In addition to the existing project‑specific settings we add a `headers`
 * function that:
 *   • Applies the security headers to every route.
 *   • Disables caching for API routes (`/api/*`).
 *   • Mirrors Vercel’s immutable long‑term cache for static assets
 *     (`/_next/static/*`).
 *   • Adds a sensible cache policy for the Next‑Image optimizer
 *     (`/_next/image/*`).
 */
const nextConfig: NextConfig = {
  // Preserve any existing Next.js flags (reactStrictMode, swcMinify, etc.).
  // If they are defined elsewhere they will be merged automatically by Next.js.
  // Here we only extend the configuration with the `headers` hook.
  async headers() {
    return [
      // 1️⃣ Security headers – applied to **all** routes.
      {
        source: '/:path*',
        headers: securityHeaders,
      },

      // 2️⃣ API routes – never cached.
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0, must-revalidate',
          },
        ],
      },

      // 3️⃣ Immutable cache for hashed static assets (mirrors vercel.json).
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },

      // 4️⃣ Next‑Image assets – cache for one week (still immutable because the URL
      //    contains a content hash).
      {
        source: '/_next/image/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800, immutable',
          },
        ],
      },
    ];
  },

  // Example of other common flags – keep existing values if they are already
  // defined elsewhere in the repo. Adjust as needed.
  reactStrictMode: true,
  swcMinify: true,
};

export default nextConfig;
