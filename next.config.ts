// Security headers are documented in docs/SECURITY_HEADERS.md
// The values below are the authoritative source for all environments.
export default {
  async headers() {
    return [
      {
        // X‑Content‑Type‑Options
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // X‑Frame‑Options
          { key: 'X-Frame-Options', value: 'DENY' },
          // X‑XSS‑Protection
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // Referrer‑Policy
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Permissions‑Policy
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
          // Strict‑Transport‑Security
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          // Cross‑Origin‑Opener‑Policy
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Cross‑Origin‑Resource‑Policy
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};
