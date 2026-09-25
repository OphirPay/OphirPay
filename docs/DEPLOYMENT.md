# Deployment Guide

...

## Security Headers

The application’s security headers are defined in the following places:

- `next.config.ts` – Runtime headers for all environments.
- `vercel.json` – Edge configuration for static assets.
- `src/proxy.ts` – Dynamic `Content‑Security‑Policy` header per request.

For a comprehensive table of headers, values, and rationale, see
[docs/SECURITY_HEADERS.md](SECURITY_HEADERS.md).

...
