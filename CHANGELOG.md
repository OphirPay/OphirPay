# Changelog

All notable changes to OphirPay will be documented in this file.

## [Unreleased] — 2026-08-26

### Added
- **Request-id + duration structured request logging**: every API request now emits a single structured log line with the request id, HTTP method, path, response status, and duration in ms. `withRequestLogging()` wraps every route handler (the proxy cannot observe a handler's final status/duration), the proxy threads the `X-Request-Id` it mints into the downstream request headers so handlers and error logs correlate with the response header, and `logger.request()`/`handleApiError()` now include the request id in their structured context. Rate-limited (429) rejections are logged from the proxy with the same request id.

## [Unreleased] — 2026-08-12 (submission hardening pass)

### Fixed
- **Governance list renders real proposals**: `GET /api/governance/proposals` now enumerates proposals on-chain (count + by-id, capped at 100, each read cached 30s) and returns an array; the page previously received a bare count number and always showed the empty state
- **Governance create flow works end-to-end**: the modal now accepts a deposit amount (XLM → stroops) and optional asset; empty asset resolves to native XLM's SAC address instead of the proposer address (which was never a token contract)
- **Empty-caller tx bugs**: `processRefund` and `executeGovernanceProposal` signed with an empty source account, which can never simulate or submit; both now require the caller's public key
- **On-chain ids captured from tx meta**: `submitContractInvocation` parses the Soroban return value from the transaction result meta, so proposal/request ids flow back to the UI (multisig now Approve/Execute real requests instead of `Date.now()` placeholders)
- **Stale governance cache**: vote/execute/create routes invalidate the affected proposal cache entries, so post-mutation refetches show fresh on-chain state
- **`apiFetch` 403 body double-read**: non-CSRF 403s lost the real server error detail; the body is now read once and shared
- **Audit-log SSE leak**: EventSource now closes on page unmount, not just on toggle-off
- **Timelock `?id=` validation**: non-numeric ids return a clean 400 instead of a 500 from `nativeToScVal`
- **Stale contract-error tests**: `contract-utils.test.ts` asserted the pre-expansion error mapping; expectations now match the 300-code catalog (full suite: 800/800 green)

### Changed
- **Scoped query invalidation**: governance mutations invalidate only `['governance']` instead of every query (avoids refetching expensive on-chain enumeration queries)
- **`isOnChainId` guard**: refunds/hooks on-chain actions are gated behind a positive-u64 check with clear messaging; dead action buttons are hidden for off-chain DB records
- **Multisig empty state**: action button wired; offers Configure when multisig is not yet enabled
- **Refunds/hooks id reconciliation**: approve/process/deactivate no longer call the contract with `NaN` ids

## [Unreleased] — 2026-08-11

### Changed
- **React Query rollout complete**: All 16 remaining data-driven pages converted from raw `fetch` + `useState` to `useApiQuery`/`useApiMutation` (batches, policy-versions, recurring, RBAC, timelock, hooks, fee-config, refunds, multisig, webhooks, requests, audit-log, dashboard, payments, events, send). Contract-signed mutations keep in-browser Freighter signing but now refresh the cache via `queryClient.invalidateQueries()` instead of manual state patching; webhooks/requests/send use `useApiMutation` with scoped invalidation
- **CSRF client plumbing**: added `GET /api/csrf` (sets `__Host-csrf` cookie + returns token) and `apiFetch` now auto-attaches `x-csrf-token` to non-GET requests — fixes 403s that previously blocked ALL mutation API routes (including the already-converted governance page)
- **`useApiMutation` upgrades**: `method` option (POST/DELETE/PUT/PATCH), URL-as-function for resource-identified routes, `invalidateKeys` for scoped cache invalidation
- **`useApiQuery` upgrades**: optional `queryFn` override for non-REST sources (on-chain Soroban reads on dashboard/payments/events) with `refetchOnWindowFocus: false` to avoid N+1 RPC refetches on tab focus

### Security Fixes
- **Voting weight**: `vote_on_proposal` no longer accepts self-reported `weight` parameter. Each address gets exactly 1 vote per proposal with double-vote prevention via persistent storage tracking. Added `AlreadyVoted` error (51).
- **Reentrancy guard**: Added `REENTRANCY_LOCK` with `acquire_reentrancy_lock()`/`release_reentrancy_lock()` helpers and `ReentrantCall` error (52). Applied to `emergency_withdraw`, `emergency_pause_all`, `emergency_unpause_all`.
- **Min proposal deposit**: `create_proposal` now requires `deposit_asset` + `deposit_amount` params, validated against `config.min_proposal_deposit`. Deposit transferred to contract and tracked in `LOCKED_BALANCE`. `execute_proposal` refunds deposit regardless of outcome.

### Changed
- **Error code expansion**: OphirPay PaymentError from 52 → 94 variants (grouped, 100-255 reserved). Emitter EmitterError from 7 → 14 variants. TypeScript `CONTRACT_ERROR_MAP` updated with human-readable messages for all 94 codes.
- **CI/CD pipeline**: 12 → 20 jobs. Added Rust Clippy, Rust Format, Secrets Scan (Gitleaks), Docker Build, Bundle Size, Accessibility Audit (axe-core), OpenAPI Validation (Redocly), Spell Check (typos-cli).
- **React Query**: Added `@tanstack/react-query` with `QueryProvider`, `useApiQuery` (typed GET), `useApiMutation` (typed POST with auto-invalidation). Wired into `AppShell`.
- **Zod validation**: Added shared `validation-schemas.ts` with 15 schemas and `validateBody()` helper. Wired into governance vote route.

## [Unreleased] — 2026-08-10

### Changed
- **Next.js 16 upgrade**: bumped `next` + `eslint-config-next` to 16.3 — removed the removed `instrumentationHook` config option (enabled by default in 16), migrated `eslint.config.mjs` to the native flat configs exported by `eslint-config-next` 16, and documented the suppressed react-hooks v6 opinionated rules
- **Test suite**: 154 → 184 app tests (13 suites) and 62 contract tests (56 OphirPay + 6 Emitter); corrected stale test/CI counts across README, docs, and PR templates

### Fixed
- **Startup bootstrap**: `bootstrap()` now called via Next.js instrumentation hook; env validation with Zod
- **Environment**: Added `.env.example` with all 20+ documented variables
- **CI**: Removed `|| true` that masked ESLint failures; added Playwright E2E job
- **Database**: Converted 4 monetary `Float` columns to `Decimal(18,7)`; added `@relation` annotations to Batch, Recurrence, PaymentRequest
- **Rate limiting**: Unified duplicate implementations — middleware now uses shared `InMemoryRateLimitStore`
- **Docs**: Corrected SDK version to 27.0.5 in architecture + integration guide
- **Contract tests**: Expanded from 21 → 56 tests (refund lifecycle, multisig threshold, spending limit expiry, atomic spend)
- **Lint**: Removed all 8 unused variables; added `argsIgnorePattern` for underscore-prefixed params
- **API routes**: Wired 14 stubbed routes to actual Soroban contract calls (multisig, governance, fee-config, RBAC, timelock, policy-versions, audit-log)
- **Wallet network**: 5 connectors now use `NEXT_PUBLIC_STELLAR_NETWORK` env var instead of hardcoded "PUBLIC"
- **Refunds page**: Fixed `parseInt` → `parseFloat` for Decimal amount fields
- **API endpoints**: Added missing escrow, stream, stats, contracts, and fee-collector API routes
- **Infra**: Added `.gitattributes` for WASM binaries, `robots.txt`, Dependabot config (npm + cargo + GHA)
- **simulateContractCall**: Added optional `args` parameter for arg-based contract queries
- **Error codes**: Centralized `ERROR_CODES` constants with HTTP status code mapping

## [Unreleased] — 2026-08-07

### Changed
- **Auth refactor**: merged duplicate `auth-middleware.ts` into `api-auth.ts`, indexed hash+prefix DB lookup (O(1) vs O(n))
- **Rate-limit consolidation**: merged `rate-limit-store.ts`, added Redis auto-init with REDIS_URL env var, periodic in-memory cleanup
- **Error handling**: added `handleApiError()` mapping Prisma/Zod errors to correct HTTP codes (400/404/409/503), fixed 11 route handlers
- **Prometheus metrics**: extracted shared counter module, wired `incMetric()` into middleware, payments, batches, webhook delivery
- **Test suite**: 68 → 154 backend tests (+86 real tests across 3 new test files: api-response, validation, auth)
- **RPC failover**: added 60s URL cache, circuit breaker with 30s cooldown, per-endpoint health probes
- **CI hardening**: replaced soft-fail migration validation with real PostgreSQL service container + strict `db push`
- **Redis integration**: health-checked, K8s-ready, Helm values, startup bootstrap
- **Security headers**: CSP with Stellar-specific directives, HSTS 2-year, COOP, CORP, Permissions-Policy
- **E2E contract tests**: 16 API contract tests covering auth, pagination, health, metrics, SSE, security headers
- **Contract fixes**: removed duplicate `pause`/`unpause` re-declarations, fixed orphan expression, fixed Emitter two-step ownership test
- **Hardcoded values removed**: contract IDs and RPC source now env-driven with launch-time validation (no testnet fallback)
- **Stub routes replaced**: governance execute, audit-log with pagination/filtering, all routes use `withApiAuth` wrapper
- **OpenAPI 3.1 spec**: 26 endpoints across 14 tag groups, exact Zod validation schema parity
- **Rate-limit bypass**: `/api/health` and `/api/metrics` excluded from rate limiting for monitoring
- **Cargo.toml**: caret ranges (`^22.0.0`) for Soroban SDK patch updates

## [0.1.0-alpha] — 2026-08-06
- **Structured refund system**: `RefundReasonCode` enum (6 variant codes), `RefundStatus` lifecycle (Requested→Approved→Rejected→Processed), `request_refund`/`approve_refund`/`process_refund` with SAC token transfers, `get_reason_code_analytics()` for on-chain analytics
- **Cross-contract orchestration**: Emitter contract `pause`/`unpause`/`is_paused`, OphirPay `set_emitter`/`get_emitter`, `emergency_pause_all()` and `emergency_unpause_all()` atomically pause both contracts via `env.invoke_contract()`
- **On-chain notification hooks**: `NotificationHook` struct, `register_hook`/`unregister_hook`, `get_hooks_by_event` (off-chain relayer queryable), `get_subscriber_hooks`, per-subscriber indexing
- **Policy versioning**: `FeeConfigVersion` and `MultisigVersion` immutable snapshots, `get_fee_config_history`/`get_multisig_config_history`, `get_fee_config_at_version` for rollback support
- **Two-step admin rotation**: 24h timelock on ownership transfer, `accept_ownership` by new owner, `cancel_ownership_transfer` by current owner, applied to both OphirPay and Emitter
- **Atomic check-and-spend**: `SpendingLimit.expires_at` field, `atomic_spend()` validates limit+expiry then records payment in one Soroban call, error code 46: `SpendingLimitExpired`
- **Multisig approvals**: N-of-M signer configuration, payment proposal → approve → execute workflow, threshold validation
- **Spending limits + escalation**: Per-user daily/monthly caps, auto-reset, escalation tiers (small/medium/large), `SpendCheckResult` enum
- **Role-based access control**: Admin/Operator/Auditor roles, `grant_role`/`revoke_role`, `require_role` guard on all writes
- **On-chain audit log**: `AuditEntry` struct, `get_audit_log_range` with pagination, immutable trail for every state change
- **Recurring payment scheduler**: `RecurringPayment` with Daily/Weekly/Monthly schedules, auto-execution after `next_execution`, cancel with remaining payments tracking
- **Fee configuration**: `FeeConfig` per-operation basis points, `calculate_fee`, owner-configurable caps (max 10%)
- **Timelocked admin actions**: 24h delay on sensitive ops, `propose_timelocked_action` → `execute_timelocked_action` → `cancel_timelocked_action`
- **DAO governance**: `GovernanceConfig`, proposal creation with min deposit, yes/no voting, quorum enforcement, `execute_proposal`
- **Emergency withdraw**: Owner can rescue accidentally sent tokens without affecting active escrows/streams
- **50 error codes**: Granular typed errors from `NotInitialized=1` to `RefundWindowExpired=50`

### Added — Frontend
- **15-page UI**: Dashboard, Send, Payments, Batches, Requests, Webhooks, Analytics, Events, Contracts, Recurring, Multisig, Governance, Audit Log, Refunds, Notification Hooks
- **Refunds page**: Request→Approve→Process lifecycle, reason code analytics bar chart, status badges, Freighter signing
- **Notification hooks page**: Register/deactivate on-chain hooks, 9 event type selector, active/inactive badges
- **Demo mode**: `NEXT_PUBLIC_DEMO_MODE=true` enables simulated TXs, demo wallet with 10K XLM, pre-generated data — no real funds needed
- **Fee estimator**: Live network fee display + congestion badge (low/medium/high) on send page
- **Polished SSE feed**: Auto-scroll, scroll-aware pause, Explorer link badges, connection pulse indicator
- **Mobile UX**: 48px touch targets, `inputMode=decimal`, safe-area insets, swipe-to-dismiss, pull-to-refresh, bottom-sheet modals

### Added — Backend & API
- **API key authentication**: DB-backed key validation with SHA-256 hashing, `withApiAuth` wrapper, protected `/api/keys` and `/api/webhooks`
- **Prisma models**: `Refund`, `NotificationHook` with indexes on userId/status/eventType, reverse relations on `User`
- **Webhook relayer**: `scripts/relayer.ts` — dual-source polling (Prisma + Soroban audit log), event matching, HMAC-SHA256 delivery
- **Prometheus `/api/metrics`**: 8 counters (HTTP requests, payments created/failed, batches, webhooks, DB latency)
- **SSE audit log streaming**: `/api/audit-log/sse` with Soroban contract polling every 15s, new entry diff and push

### Added — DevOps & CI
- **15-job CI/CD pipeline**: Lint, TypeCheck, Unit Tests, Coverage, Contract WASM, Next.js Build, E2E Chromium, E2E Firefox, Prisma Validate, Docker Build, K8s Validate, Helm Lint, Secret Scan (Gitleaks), npm Audit, PR Auto-Label
- **Kubernetes manifests**: Namespace, Deployment (2 replicas, RollingUpdate, resource limits, probes), Service, Ingress (TLS), HPA, PDB, NetworkPolicy, ConfigMap, Secret
- **Helm chart**: `Chart.yaml`, `values.yaml` (100+ values), 7 templates, Prometheus scrape annotations
- **Disaster recovery**: Nightly DB backup to S3 (30d retention), restore drill script with row-count assertions
- **Grafana dashboard**: 6-panel JSON (Platform Health, HTTP Rate, Payment Volume, Webhook Health, DB Latency, Batches)
- **Mainnet deployment guide**: 10-section doc covering config, contract deployment, DB setup, Helm, monitoring, DNS, rollback
- **One-click demo seed**: `scripts/demo-seed.sh` provisions DB, creates `.env.local` with demo mode, starts dev server in <60s

### Added — Testing
- **46 Rust contract tests**: Refund lifecycle (5), emergency_pause_all (2), notification hooks (2), policy versioning (2), two-step ownership (3), plus existing tests for payments, escrows, streams, batches, multisig, spending limits, RBAC, audit log, recurring, fees, timelock, governance
- **15 Playwright E2E tests**: Dashboard smoke, all 13 pages navigation, multisig modal interactions, governance proposal forms
- **Demo mode tests**: Simulated TXs, demo wallet, pre-generated data validation

### Added — Community Infrastructure
- **Contributor Covenant Code of Conduct v2.1**
- **Issue templates**: Bug report (environment fields, component checklist), Feature request (affected area checklist)
- **SUPPORT.md**: Where to get help, security disclosures, community links
- **FUNDING.yml**: GitHub Sponsors + custom donation link
- **Pull request template**: 8-type checklist, verification steps
- **CODEOWNERS**: 50+ path rules across 6 teams (core-contracts, frontend, backend, devops, docs, security)
- **PR auto-labeler**: 13 label rules + branch-name auto-detection
- **Dependabot**: npm (weekly), cargo (weekly for both contracts), GitHub Actions (monthly)
- **Gitleaks secret scanning**: Full-history scan on every PR

### Changed
- Contract error codes expanded from 21 → 50
- Contract test count: 33 → 46
- Frontend test count: 154 across 10 suites
- Total test count: 200 (154 + 46)
- `transfer_ownership` now two-step with 24h timelock (breaking change)
- `set_fee_config` and `set_multisig_config` now archive immutable version history
- Sidebar expanded to 13 nav items with keyboard shortcuts (Ctrl+1..13)

## [0.1.0] — 2026-08-05

### Added
- Wallet connect/disconnect with Freighter browser extension
- Send XLM payments on Stellar Testnet
- Batch payments (multi-recipient in single transaction)
- Soroban smart contract deployment (OphirPay + Emitter)
- Cross-contract communication between contracts
- SSE event streaming from on-chain events
- Mobile-responsive UI with dark mode toggle
- CI/CD pipeline with GitHub Actions
- Shared UI component library (Button, Card, Modal, Toast, Badge, etc.)
- Environment variable validation with Zod
- API rate limiting and CORS middleware
- CSV import/export for batch payments
- Webhook delivery with HMAC signing
- Analytics aggregation API
- Payment requests API
- Recurring payment schedules
- API key management
- Address book utility
- Browser notification support
- Feature flag system
- Audit trail logging
- Comprehensive input validation and sanitization

### Changed
- Contracts use Result types instead of panics
- Payment struct includes timestamp and metadata
- API responses use structured success/error format
- Sidebar uses shared Icon components

### Security
- Security headers on all responses (CSP, HSTS, COOP, CORP, Permissions-Policy)
- Input sanitization against XSS
- SQL injection pattern detection
- API key hashing with SHA-256
- Timing-safe comparison for secrets
- No private keys stored server-side
- Rate-limit bypass protection for monitoring endpoints
