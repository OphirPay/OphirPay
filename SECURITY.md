# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in OphirPay, please **do not** open a public issue.

Instead, email **security@ophirpay.com** with:
- A description of the vulnerability
- Steps to reproduce
- Affected versions
- Any potential mitigations

We will respond within 48 hours and work with you on a fix.

## Security Best Practices

### For Users
- OphirPay never stores private keys — all signing happens client-side via Freighter
- Always verify the destination address before signing
- Check transaction details in Freighter before approving
- Use a hardware wallet for production/mainnet operations

### For Developers
- Run `npm audit` regularly to check for dependency vulnerabilities
- Keep all dependencies up to date
- Review PRs for security implications
- Never commit secrets or API keys
- Use environment variables for all sensitive configuration

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | ✅ Active (current)|
| 0.1.x   | ⚠️ Security patches only |

## Bug Bounty Program

OphirPay offers rewards for responsibly disclosed vulnerabilities:

| Severity | Reward | Examples |
|---|---|---|
| **Critical** (9.0-10.0) | Up to $5,000 | Fund drainage, unauthorized admin takeover, key extraction |
| **High** (7.0-8.9) | Up to $2,000 | Reentrancy, signature bypass, privilege escalation |
| **Medium** (4.0-6.9) | Up to $500 | CSRF on sensitive endpoints, information disclosure, DoS |
| **Low** (0.1-3.9) | Swag + recognition | Minor issues, defense-in-depth improvements |

### Scope

- Smart contracts: `contracts/ophirpay/src/lib.rs`, `contracts/emitter/src/lib.rs`
- API routes: `src/app/api/**/route.ts`
- Authentication: Wallet session auth, API key auth
- Webhook system: URL validation, HMAC signing, SSRF prevention
- Infrastructure: Dockerfile, Kubernetes manifests, Helm chart

### Rules

1. **Do not** exploit the vulnerability beyond what is necessary to demonstrate it
2. **Do not** access, modify, or delete other users' data
3. **Do not** disrupt the live service (ophirpay.vercel.app)
4. **Do not** disclose the vulnerability publicly before it is resolved
5. Provide a clear proof-of-concept with steps to reproduce

### Process

1. Email **security@ophirpay.com** with your report
2. We acknowledge within 48 hours
3. We validate and determine severity within 5 business days
4. We ship a fix and publish an advisory
5. You receive credit in the advisory + reward

> Payouts are in XLM or USDC on Stellar. We follow [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) scoring.

## Security Headers

OphirPay implements the following security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 0`

## Smart Contract Security

- All contract functions use proper access control
- Cross-contract calls are validated
- Contracts use Result types for error handling
- Timestamps and metadata are recorded for audit trails
