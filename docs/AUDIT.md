# Security Audit

## WEB-1 CSP nonce propagation

Status: Resolved 2025-09-01
Next version tested: 16.3.0
Result: Nonce propagates from proxy middleware to App Router via x-csp-nonce header. Production script-src uses nonce and removes unsafe-inline.