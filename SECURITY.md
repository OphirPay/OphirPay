# Security Policy

OphirPay takes the security of its users, funds, and infrastructure seriously.
This policy explains how to report a vulnerability, what to expect after you
report, what is in scope, and the safe-harbor protections for researchers who
follow it.

## Reporting a Vulnerability

If you discover a security vulnerability in OphirPay, **do not** open a public
issue, public pull request, discussion, or social post with sensitive details.

Please report it through one of the private channels below.

### How to report

1. **Private email (fastest)**
   Send your report to **security@ophirpay.com**. Include the details listed
   in [What to include](#what-to-include-in-your-report).

2. **PGP-encrypted email (preferred for sensitive reports)**
   Encrypt the full report with the security team's public key before sending
   it to **security@ophirpay.com**. If you need the current key fingerprint,
   request it over an out-of-band channel (for example the project's
   [SUPPORT.md](.github/SUPPORT.md) or the GitHub organization profile), and
   verify the fingerprint before use.

3. **GitHub private vulnerability reporting (preferred when enabled)**
   If the repository has private vulnerability reporting enabled, use the
   **"Report a vulnerability"** button on the
   [Security tab](https://github.com/OphirPay/OphirPay/security/advisories)
   to open a private advisory form. Reports submitted this way are visible
   only to repository maintainers. (The
   [Security Vulnerability template](.github/ISSUE_TEMPLATE/security_vulnerability.yml)
   exists only as a last-resort public fallback for researchers who cannot
   use any private channel — it deliberately contains no exploit-detail
   fields.)

> Never send secrets, private keys, or real user data in a report. Redact
> sensitive material and describe it in placeholders instead.

### What to include in your report

The more complete the report, the faster we can triage it:

- A concise summary of the vulnerability
- Affected component and file paths (e.g. `contracts/ophirpay/src/lib.rs`,
  `src/app/api/**/route.ts`)
- Version, release tag, or commit hash where the issue reproduces
- Environment details: network (TESTNET / PUBLIC), chain/network ID, browser
  and version, OS
- Step-by-step reproduction instructions
- Expected behavior vs. observed behavior
- Security impact: what an attacker can do, and the likely blast radius
- Any logs, screenshots, transaction hashes, addresses, or calldata needed to
  reproduce
- For smart contract issues: contract name, on-chain address, and the
  function(s) involved
- A suggested mitigation, if you have one

### Response expectations

| Stage | Timeframe |
|---|---|
| Acknowledgement of your report | Within **48 hours** |
| Initial triage and severity assessment | Within **5 business days** |
| Fix target — Critical / High | As soon as possible, coordinated with you |
| Fix target — Medium / Low | Next planned release, coordinated with you |
| Advisory publication | After the fix ships, credited to you (if you consent) |

If you do not hear back within the acknowledgement window, please follow up on
the same thread or escalate via [SUPPORT.md](.github/SUPPORT.md).

## Supported Versions

Security fixes are backported to supported release lines:

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅ Active (current — incl. `v1.0.0-rc1` release candidates) |
| 0.1.x   | ⚠️ Security patches only |

Only the latest release of each supported line receives security fixes.
Older versions are not patched; please upgrade. When reporting, state which
version you found the issue in and whether it reproduces on the latest
release.

## Scope

### In scope

- **Smart contracts**: `contracts/ophirpay/src/lib.rs`,
  `contracts/emitter/src/lib.rs` (and the `contracts/` tree generally)
- **API routes**: `src/app/api/**/route.ts`
- **Authentication**: wallet session auth, API key auth, CSRF handling
- **Webhook system**: URL validation, HMAC signing, SSRF prevention
- **Frontend**: client-side signing flows, wallet integration (Freighter,
  xBull, Rabet, Albedo, Lobstr, Ledger), demo mode
- **Infrastructure**: Dockerfile, Kubernetes manifests, Helm chart, GitHub
  Actions workflows, deployment scripts

### Out of scope

- Third-party services we do not control (Vercel, Neon/PostgreSQL, the Stellar
  network, Horizon/Soroban RPC endpoints)
- Vulnerabilities in upstream dependencies — report them to the dependency's
  maintainers (Dependabot / `npm audit` also surface these)
- Issues that require physical access to a device or social engineering of a
  user
- Known issues already documented in [docs/AUDIT.md](docs/AUDIT.md)
- Best-practice suggestions with no demonstrated vulnerability — please open a
  regular [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) instead

If you are unsure whether something is in scope, report it anyway — we prefer
an out-of-scope report to a missed one.

## Safe Harbor

We will not pursue civil or criminal legal action, and will not report you to
law enforcement or your employer, for security research conducted in good
faith that complies with this policy, including:

- Research performed on your own OphirPay deployment, the testnet contracts,
  or the public instance **without** exceeding the limits below
- Testing that does not access, modify, or delete other users' data
- Testing that does not disrupt the availability of the service
- Reporting the vulnerability privately and giving us a reasonable
  opportunity to fix it before any public disclosure
- Not exploiting a vulnerability beyond what is necessary to demonstrate it

If legal action is initiated by a third party against you for research that
followed this policy, we will consider making a public statement in your
support.

## Responsible Disclosure Process

### Step 1: Report the Vulnerability

Email **security@ophirpay.com** with the following information:

- **Subject**: `[SECURITY] Brief description of the vulnerability`
- **Body**:
  - Description of the vulnerability
  - Steps to reproduce (include URLs, endpoints, and request/response examples if applicable)
  - Affected versions (check `package.json` or `Cargo.toml`)
  - Potential impact (what an attacker could achieve)
  - Any suggested mitigations (if you have them)
  - Your preferred contact method for follow-up questions

### Step 2: Acknowledgment

We will acknowledge receipt of your report within **48 hours** via email.

### Step 3: Validation

Our security team will validate the vulnerability within **5 business days**. We may contact you for additional details or clarification.

### Step 4: Resolution

Once validated, we will:
- Develop and test a fix
- Deploy the fix to production
- Publish a security advisory on GitHub
- Credit you in the advisory (unless you prefer anonymity)

### Step 5: Reward

If eligible, you will receive a reward based on the severity of the vulnerability (see Bug Bounty Program below).

## Security.txt

OphirPay publishes a `security.txt` file at `/.well-known/security.txt` following the [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) standard. This file provides security researchers with contact information and disclosure policies.

The file is accessible at:
- **Production**: https://ophirpay.vercel.app/.well-known/security.txt
- **Repository**: https://github.com/OphirPay/OphirPay/blob/main/.well-known/security.txt

## CSRF Protection Policy

### For Users

- OphirPay never stores private keys — all signing happens client-side via
  Freighter
- Always verify the destination address before signing
- Check transaction details in Freighter before approving
- Use a hardware wallet for production/mainnet operations
- Never share your wallet seed phrase or private keys

### For Developers

- Run `npm audit` regularly to check for dependency vulnerabilities
- Keep all dependencies up to date
- Review PRs for security implications
- Never commit secrets or API keys
- Use environment variables for all sensitive configuration
- Follow the contract security guidance below for any contract change

1. **Token Generation**: Clients request a CSRF token from `GET /api/csrf`.
   The server generates a cryptographically secure random token (256 bits),
   sets it as an `HttpOnly` cookie, and returns the token in the response body.

2. **Token Storage**: The client stores the token in memory (not localStorage
   or sessionStorage) and sends it as the `x-csrf-token` header on all
   mutating requests.

3. **Token Validation**: On mutating requests, the server compares the
   `x-csrf-token` header against the CSRF cookie value using constant-time
   comparison to prevent timing attacks.

### Rules

1. **Do not** exploit the vulnerability beyond what is necessary to demonstrate it
2. **Do not** access, modify, or delete other users' data
3. **Do not** disrupt the live service (ophirpay.vercel.app)
4. **Do not** disclose the vulnerability publicly before it is resolved
5. Provide a clear proof-of-concept with steps to reproduce
6. Report vulnerabilities in good faith

- **Production (HTTPS)**: Cookie named `__Host-csrf` with `Secure` attribute
- **Development (HTTP)**: Cookie named `csrf` without `Secure` attribute
  (browsers reject `__Host-` cookies without Secure on non-localhost HTTP)

1. Report via one of the [private channels](#how-to-report) above
2. We acknowledge within 48 hours
3. We validate and determine severity within 5 business days
4. We ship a fix and publish an advisory
5. You receive credit in the advisory + reward (with your consent)

> Payouts are in XLM or USDC on Stellar. We follow
> [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) scoring.

```typescript
// Method 1: Manual enforcement
import { verifyCsrf } from "@/lib/csrf";

// Method 2: Higher-order function wrapper
import { withCsrf } from "@/lib/csrf";
```

## Security Headers

OphirPay implements the following security headers via `src/proxy.ts` and `next.config.ts`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 0`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

## Content Security Policy (CSP) & Inline Scripts

OphirPay enforces a Content Security Policy via `src/proxy.ts` on all rendered HTML pages:

| Directive | Policy | Purpose |
|---|---|---|
| `default-src` | `'self'` | Default fallback for unlisted resource types |
| `script-src` | `'self' 'unsafe-inline' 'wasm-unsafe-eval'` (prod)<br>`'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'` (dev) | Executable scripts; WASM for Soroban cryptography; eval in dev for HMR |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind CSS and styled UI styling |
| `connect-src` | `'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so` | Whitelisted Horizon and Soroban RPC endpoints |
| `img-src` | `'self' data: https://stellar.expert https://raw.githubusercontent.com` | Verified token icons and Stellar asset visuals |
| `font-src` | `'self'` | Local Geist and Geist Mono font bundles |
| `frame-src` | `'self' https://*.freighter.app chrome-extension: moz-extension:` | Web3 wallet extension iframes and Freighter authorization popups |
| `object-src` | `'none'` | Disables browser plugins (Flash, Java, Silverlight) |
| `base-uri` | `'self'` | Prevents unauthorized `<base>` tag injection |
| `form-action` | `'self'` | Restricts `<form>` submission destinations |

### Known Limitation: 'unsafe-inline' in script-src

> [!WARNING]
> In production, `script-src` includes `'unsafe-inline'`. Consequently, the Content Security Policy does **not** protect against inline Cross-Site Scripting (XSS) injection attacks.

**Architectural Cause:**
Next.js 16 (App Router) generates and streams dynamic inline hydration scripts (e.g. `self.__next_f.push(...)`) alongside initial HTML chunks. In standalone and statically optimized deployments, Next.js does not reliably propagate per-request cryptographic nonces to these streaming chunks without triggering complete client-side hydration failures.

**Defense-in-Depth & Mitigations:**
Because the CSP header cannot act as the primary defense against inline script injection, OphirPay relies on the following primary controls to prevent XSS:
1. **React Automatic JSX Escaping:** All dynamic content rendered in React components is contextually HTML-escaped by default.
2. **Input Validation:** All client inputs and API request payloads are strictly validated against strongly typed Zod schemas (`src/lib/validation-schemas.ts`).
3. **No Dynamic HTML Injection:** The application prohibits user-controlled data in `dangerouslySetInnerHTML`.
4. **Origin Isolation:** `connect-src`, `frame-src`, and `object-src` remain strictly locked down, preventing an attacker from exfiltrating secrets to unapproved hosts or embedding rogue frames.

## Contract Security

- All contract functions use proper access control
- Cross-contract calls are validated and propagate failures atomically (see
  `docs/architecture.md` for the system overview)
- Contracts use Result types for error handling
- Timestamps and metadata are recorded for audit trails
- State-changing operations — governance proposal execution, the
  escrow/stream lifecycle (create, release, claim, cancel), refund
  processing, emergency withdraw, and cross-contract pause orchestration —
  are guarded by reentrancy locks
- Sensitive admin actions are protected by two-step ownership transfer (24h
  timelock) and timelocked upgrades
