import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * The Content‑Security‑Policy header is generated per request.
 * The policy is documented in docs/SECURITY_HEADERS.md.
 * In production the `unsafe-inline` keyword is retained to allow
 * inline scripts/styles required by the dashboard’s widgets.
 * In development the CSP is relaxed further to support local tooling.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const isProd = process.env.NODE_ENV === 'production';
  const csp = isProd
    ? `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.stellar.org;`
    : `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:*;`;

  res.setHeader('Content-Security-Policy', csp);
  // ... proxy logic ...
}
