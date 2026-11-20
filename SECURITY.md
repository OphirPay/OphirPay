# Security Policy

OphirPay takes the security of its users, funds, and infrastructure seriously.
This policy explains how to report a vulnerability, what to expect after you
report, what is in scope, and the safe-harbor protections for researchers who
follow it.

- [Researcher checklist](#researcher-checklist)
- [Reporting a Vulnerability](#reporting-a-vulnerability)
- [Response expectations](#response-expectations)
- [Supported Versions](#supported-versions)
- [Scope](#scope)
- [Safe Harbor](#safe-harbor)
- [Responsible Disclosure Process](#responsible-disclosure-process)
- [Emergency Response Protocol](#emergency-response-protocol)
- [Security.txt](#securitytxt)
- [CSRF Protection Policy](#csrf-protection-policy)
- [Security Headers](#security-headers)
- [Contract Security Guidance](#contract-security-guidance)

---

## Researcher checklist

A quick pre-flight list before you submit a report. The sections below expand
each item.

**Before you submit**

- [ ] The finding is a **security vulnerability** in something we control — see
      [Scope](#scope). Upstream dependencies, Vercel/Neon, and the Stellar
      network itself are out of scope; report those to their maintainers.
- [ ] You can describe **impact**: who can do what, to whom, and under which
      preconditions.
- [ ] You have **reproduction steps** (URLs, contract calls, request/response
      bodies, transaction hashes) and can state expected vs. observed behavior.
- [ ] You have the **affected component and version** (commit, release tag, or
      `package.json` / `Cargo.toml` value).
- [ ] You have **not** accessed, modified, or deleted other users' data, and
      have not degraded the live service while testing.
- [ ] You are ready to report **privately first** — no public issue, PR,
      discussion, or social post with exploit details.

**How to submit (one of these, in order of preference)**

- [ ] **GitHub private vulnerability reporting** — preferred. Open the
      [Security tab](https://github.com/OphirPay/OphirPay/security/advisories)
      and choose **"Report a vulnerability"**.
- [ ] **No-details issue** — only if the button is unavailable: open a public
      issue with the
      [Security Vulnerability template](.github/ISSUE_TEMPLATE/security_vulnerability.yml)
      containing no exploit details, and ask a maintainer to open a private
      advisory with you.
- [ ] **PGP-encrypted email** — not available today. No mailbox or key is
      published; see [Reporting a Vulnerability](#reporting-a-vulnerability).

**What happens next**

- [ ] We acknowledge the report within **48 hours** (Critical issues are
      triaged within **24 hours** when possible).
- [ ] We validate and assess severity within **5 business days**.
- [ ] We coordinate the fix and advisory with you, and credit you unless you
      ask us not to ([Response expectations](#response-expectations)).

> Never include secrets, private keys, seed phrases, or real user data in a
> report. Redact them and describe the shape instead.

---

## Reporting a Vulnerability

If you discover a security vulnerability in OphirPay, **do not** open a public
issue, public pull request, discussion, or social post with sensitive details.

Please report it through one of the channels below.

### How to report

1. **GitHub private vulnerability reporting (preferred)**
   On the [Security tab](https://github.com/OphirPay/OphirPay/security/advisories),
   choose **"Report a vulnerability"**. This opens a private advisory that is
   visible only to the repository maintainers.

   > The button only appears while **Private vulnerability reporting** is
   > enabled under _Settings → Code security_. Maintainers: keeping it enabled
   > is what makes this policy work — see the
   > [maintainer checklist](#maintainer-checklist).
   > If the button is missing, use option 2: a maintainer can open the private
   > advisory for you (and should re-enable the setting).

2. **No-details issue, then a private advisory (always available)**
   Open a public issue with the
   [Security Vulnerability template](.github/ISSUE_TEMPLATE/security_vulnerability.yml)
   that contains **no** exploit details — just the affected component and rough
   severity. Ask a maintainer to open a private advisory with you, then send
   the sensitive details there. This is the fallback that cannot dead-end, and
   it is how issue #1280 was resolved.

> **Email is not a supported channel right now.** The previously documented
> `security@ophirpay.com` address has no MX record, so mail to it bounces
> (issue #1280); `security@ophirpay.dev` does not resolve yet either. Please do
> not send reports to either address. Once a monitored mailbox exists this
> section — and `.well-known/security.txt` — will be updated to list it.

3. **PGP-encrypted email (available once a mailbox is provisioned)**
   When a mailbox is published, encrypt the full report with the security
   team's public key before sending it, and verify the fingerprint over an
   out-of-band channel (for example the project's
   [SUPPORT.md](.github/SUPPORT.md) or the GitHub organization profile) before
   use. No key or mailbox is published today, so reports must use options 1–2.
   Until then, GitHub private advisories are the confidential channel: they are
   access-controlled and do not depend on mail deliverability.

> Never send secrets, private keys, or real user data in a report. Redact
> sensitive material and describe it in placeholders instead.

### Maintainer checklist

A disclosure policy that points at a dead channel is worse than no policy, so
maintainers must keep these true:

- [ ] **Settings → Code security → Private vulnerability reporting** is enabled,
      so the "Report a vulnerability" button is visible to researchers.
- [ ] The [Security tab](https://github.com/OphirPay/OphirPay/security/advisories)
      is monitored and new advisories are acknowledged within 48 hours.
- [ ] When a mailbox is provisioned, add it to this file, to
      `.well-known/security.txt` and to `src/lib/security-txt.ts` in the same PR
      (the tests in `src/__tests__/security-txt.test.ts` enforce that the served
      document and the repository file agree).
- [ ] Never advertise an address on a domain without MX records; verify
      deliverability before documenting it.

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

---

## Response expectations

| Stage                                  | Timeframe                                                   |
| -------------------------------------- | ----------------------------------------------------------- |
| Acknowledgement of your report         | Within **48 hours** (Critical: **24 hours** where possible) |
| Initial triage and severity assessment | Within **5 business days**                                  |
| Fix target — Critical / High           | As soon as possible, coordinated with you                   |
| Fix target — Medium / Low              | Next planned release, coordinated with you                  |
| Advisory publication                   | After the fix ships, credited to you (if you consent)       |

If you do not hear back within the acknowledgement window, follow up on the
same advisory thread. If a channel itself is broken, say so in a public issue
**without sensitive details** and a maintainer will open a private advisory
with you (this is how issue #1280 was resolved).

We follow [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document)
scoring when assigning severity. OphirPay does not currently advertise a paid
security-bounty program; we credit researchers in the published advisory unless
you prefer to remain anonymous.

---

## Supported Versions

Security fixes are backported to supported release lines:

| Version | Supported                                                   |
| ------- | ----------------------------------------------------------- |
| 1.0.x   | ✅ Active (current — incl. `v1.0.0-rc1` release candidates) |
| 0.1.x   | ⚠️ Security patches only                                    |

Only the latest release of each supported line receives security fixes.
Older versions are not patched; please upgrade. When reporting, state which
version you found the issue in and whether it reproduces on the latest
release.

---

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

---

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

### Rules

1. **Do not** exploit the vulnerability beyond what is necessary to demonstrate it
2. **Do not** access, modify, or delete other users' data
3. **Do not** disrupt the live service (ophirpay.vercel.app)
4. **Do not** disclose the vulnerability publicly before it is resolved
5. Provide a clear proof-of-concept with steps to reproduce
6. Report vulnerabilities in good faith

---

## Responsible Disclosure Process

### Step 1: Report the Vulnerability

Open a private GitHub advisory (preferred) — or a no-details public issue that
asks a maintainer to open one — with the following information:

- **Subject**: `[SECURITY] Brief description of the vulnerability`
- **Body**:
  - Description of the vulnerability
  - Steps to reproduce (include URLs, endpoints, contract calls, and
    request/response examples if applicable)
  - Affected versions (check `package.json` or `Cargo.toml`)
  - Potential impact (what an attacker could achieve)
  - Any suggested mitigations (if you have them)
  - Your preferred contact method for follow-up questions

### Step 2: Acknowledgment

We will acknowledge receipt of your report within **48 hours** in the advisory
thread (or the issue thread, for the no-details fallback).

### Step 3: Validation

Our security team will validate the vulnerability within **5 business days**.
We may contact you for additional details or clarification.

### Step 4: Resolution

Once validated, we will:

- Develop and test a fix
- Deploy the fix to production
- Publish a security advisory on GitHub
- Credit you in the advisory (unless you prefer anonymity)

### Step 5: Coordinated disclosure

Advisories are published after the fix ships. If you plan to publish research
of your own, coordinate the date with us in the advisory thread so users have
time to upgrade.

---

## Emergency Response Protocol

An **active** exploit is handled differently from a report: containment comes
first, disclosure second.

- **If you believe a vulnerability is being exploited right now**, file the
  GitHub private advisory and mark it **URGENT / active exploitation** in the
  title. Maintainers will acknowledge within 24 hours where possible. Do not
  attempt to stop the exploit yourself (that is out of scope under
  [Safe Harbor](#safe-harbor)); report it and, if you can, include the
  transaction hashes or addresses involved.
- **Maintainers on call** follow
  [docs/EMERGENCY.md](docs/EMERGENCY.md): pause the contracts with
  `emergency_pause_all` / scoped pauses, inspect pending timelock actions,
  rotate keys if compromise is suspected, and only then publish the advisory.
  The runbook contains the exact `stellar contract invoke` commands, the 24-hour
  timelock procedure, and the post-incident checklist.
- **Owner-key compromise** escalates to ownership rotation on both contracts —
  see [docs/EMERGENCY.md §6](docs/EMERGENCY.md#6-ownership-rotation) — followed
  by the maintainer checklist above (re-enable private reporting, verify
  `security.txt`).

For day-to-day reports (no active exploitation), use the normal
[reporting channels](#how-to-report) and the SLAs in
[Response expectations](#response-expectations).

---

## Security.txt

OphirPay publishes a `security.txt` file at `/.well-known/security.txt` following the [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) standard. This file provides security researchers with contact information and disclosure policies.

The file is accessible at:

- **Production**: https://ophirpay.vercel.app/.well-known/security.txt — served by
  `src/app/.well-known/security.txt/route.ts` from `src/lib/security-txt.ts`; a
  test asserts this document and the repository file below stay in sync
- **Repository**: https://github.com/OphirPay/OphirPay/blob/main/.well-known/security.txt

---

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
- Follow the [contract security guidance](#contract-security-guidance) for any
  contract change
- Mutating routes must use the CSRF flow below — do not exempt endpoints
  without a security review

1. **Token Generation**: Clients request a CSRF token from `GET /api/csrf`.
   The server generates a cryptographically secure random token (256 bits),
   sets it as an `HttpOnly` cookie, and returns the token in the response body.
2. **Token Storage**: The client stores the token in memory (not localStorage
   or sessionStorage) and sends it as the `x-csrf-token` header on all
   mutating requests.
3. **Token Validation**: On mutating requests, the server compares the
   `x-csrf-token` header against the CSRF cookie value using constant-time
   comparison to prevent timing attacks.
4. **Cookie naming**: production (HTTPS) uses `__Host-csrf` with the `Secure`
   attribute; development (HTTP) uses `csrf` without `Secure` (browsers reject
   `__Host-` cookies without Secure on non-localhost HTTP).

---

## Security Headers

OphirPay implements the following security headers
([`next.config.ts`](next.config.ts) is the single source of truth for static headers;
`src/proxy.ts` sets the per-request `Content-Security-Policy` and violation-reporting headers):

- For the CSP directives, nonce flow and maintenance procedure, see
  [Security Headers & Content Security Policy](docs/SECURITY.md).
- For the layer-by-layer effective policy, including Vercel behavior and API
  overrides, see [Security Header Policy](docs/SECURITY_HEADERS.md).
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 0` (the legacy `1; mode=block` filter is deprecated and
  must not be re-enabled)
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Content-Security-Policy` — strict `default-src 'self'`, `connect-src`
  limited to Stellar/Soroban endpoints, `frame-src` limited to wallet
  extensions, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.

  `script-src` is nonce-based: `'self' 'nonce-<per-request>' 'strict-dynamic'
'wasm-unsafe-eval'` in production (plus `'unsafe-eval'` in development for
  HMR). `'unsafe-inline'` is **not** present, so injected inline scripts are
  blocked. The proxy sets the CSP on the _request_ headers so the App Router
  renderer stamps the nonce on its framework scripts, and forwards it as
  `x-nonce` for the inline scripts in `src/app/layout.tsx`.

  **History (issues #697 → #1257):** earlier builds kept `'unsafe-inline'`
  because the nonce appeared not to reach the renderer. Re-tested on
  next@16.3.4 (2026-09-30): the cause was the proxy setting the CSP only on
  the response. With the request header set, framework scripts carry
  `nonce="…"` and pages hydrate with no CSP violations. See `src/proxy.ts`.

- `Report-To` / `Reporting-Endpoints` — browsers POST CSP violation reports
  to `POST /api/csp-report`, which validates, size-limits, and logs them via
  the structured logger (with PII redaction) and counts them in the
  `csp_violation_reports_total` metric (issue #698).

---

## Contract Security Guidance

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
  timelock), timelocked upgrades, and the 24-hour timelock on sensitive config
  setters — see [docs/EMERGENCY.md](docs/EMERGENCY.md)
- Emergency procedures (pause, scope pause, timelocks, upgrades, ownership
  rotation) are documented with copy-pasteable CLI commands in
  [docs/EMERGENCY.md](docs/EMERGENCY.md)
