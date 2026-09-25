# Contributing to OphirPay

Thank you for your interest in contributing! OphirPay is an open-source payment orchestration layer for Stellar.

## Getting Started

1. Ensure you have Node.js 20 installed (see `.nvmrc`)
2. Fork the repository
3. Clone your fork: `git clone https://github.com/YOUR_USERNAME/OphirPay.git`
4. Install dependencies: `npm install`
5. Set up the database: `npx prisma db push && npx prisma generate`
6. Start the dev server: `npm run dev`

> 🛠️ **Setup trouble?** See the
> [Troubleshooting Guide](docs/TROUBLESHOOTING.md) — it covers Freighter
> detection, the Rust `wasm32` target, Prisma migrations, WASM builds,
> Node version mismatches, and port conflicts.

> 💡 **New to Stellar or Soroban?** Check out the
> [Stellar & Soroban glossary](GLOSSARY.md) — it defines the terms used
> throughout the codebase (XLM, testnet, friendbot, Horizon, Soroban, SAC,
> WASM, Freighter, memo, trustline, path payments, sponsored reserves, and
> more).

## Development Workflow

- **Branch naming**: `feat/feature-name`, `fix/bug-description`, `docs/what-changed`, `ci/what-changed`, `test/what-changed`
- **Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org)
- **Before submitting**: Run `npm run ci` (typecheck → lint → test → build)

### Dependency Updates

[Dependabot](.github/dependabot.yml) checks the `npm` (root `package-lock.json`),
`cargo` (`contracts/ophirpay` and `contracts/emitter`) and `github-actions`
ecosystems once a week.

- Minor and patch bumps in an ecosystem are grouped into a **single** PR; major
  bumps arrive individually so they can be reviewed on their own.
- Update PRs are labelled `dependencies` and use a `chore(deps)` commit prefix.
- Review one like any other PR: wait for CI (the `contract-wasm` job matters for
  Cargo bumps) and run it locally for security-sensitive packages. If a bump has
  breaking changes or fails CI, coordinate with the team before merging instead
  of force-landing it.

#### GitHub Actions SHA Pinning

To mitigate supply-chain attacks and ensure deterministic CI builds:
- All GitHub Actions in `.github/workflows/*.yml` MUST be pinned to full 40-character commit SHAs, never mutable version tags (such as `@v4` or `@main`).
- Always append an inline comment with the upstream release tag for readability:
  ```yaml
  uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
  ```
- Dependabot automatically detects and bumps these pinned SHAs, updating both the commit hash and version comment in pull requests.

### Adding or changing an API endpoint

Before adding or modifying an API endpoint, read the [API Endpoint Guide](docs/API_GUIDE.md). It documents the mandatory conventions: file structure, Zod validation, the error-handling pattern, auth middleware usage, the response envelope, rate-limit integration, a copy-pasteable worked example, and a pre-merge checklist.

## CI/CD Pipeline

Every PR triggers the following independent CI/CD checks across quality,
testing, security, and DevOps. The jobs in `.github/workflows/ci.yml` are the
merge gate, and `npm run ci` runs the same frontend chain locally
(typecheck → lint → test → build → deploy-config guards) so the two cannot
drift apart again.

| # | Job (workflow) | Runs on PR | Blocks merge |
|---|---|---|---|
| 1 | `lint` — ESLint `--max-warnings 0` (`ci.yml`) | ✅ | ✅ Required |
| 2 | `typecheck` — tsc (`ci.yml`) | ✅ | ✅ Required |
| 3 | `unit-tests` — Vitest (`ci.yml`) | ✅ | ✅ Required |
| 4 | `build` — Next.js production build (`ci.yml`) | ✅ | ✅ Required |
| 5 | `contract-wasm` — Soroban WASM build + tests (`ci.yml`) | ✅ | ✅ Required |
| 6 | `deploy-config` — deploy-script config guards (`ci.yml`) | ✅ | ✅ Required |
| 7 | `secrets-scan` — Gitleaks (`ci.yml`) | ✅ | ✅ Required |
| 8 | `helm-lint` — Helm lint + render (`ci.yml`) | ✅ | ✅ Required |
| 9 | `prisma` — schema + migration replay (`prisma-ci.yml`) | ✅ (prisma paths) | ✅ Required |
| 10 | `contract-regression` — WASM size guardrails (`contract-regression.yml`) | ✅ (contract paths) | ✅ Required |
| 11 | `enforce-base` — integration-branch guard (`enforce-integration-branch.yml`) | ✅ | ✅ Required |

> **Batch mode**: while the `integration/staging` branch exists, every PR must
> target it instead of `main` (enforced by `enforce-integration-branch.yml`),
> and `ci.yml` runs on PRs against that branch as well as `main`.

### Branch Protection Rules (recommended)

Configure these in **Settings → Branches → Branch protection rules** for `main`
(and `integration/staging` while batch mode is active):

- **Require a pull request before merging**: ✅
- **Require approvals**: 1 minimum
- **Dismiss stale pull request approvals when new commits are pushed**: ✅
- **Require status checks to pass before merging**: ✅
  - Required checks: `lint`, `typecheck`, `unit-tests`, `build`, `contract-wasm`, `deploy-config`, `secrets-scan`, `helm-lint`
- **Require conversation resolution before merging**: ✅
- **Require signed commits**: Recommended
- **Require linear history**: Recommended
- **Do not allow bypassing the above settings**: ✅

### Merge Requirements Summary

> A PR must pass every required check above (and the path-scoped `prisma`,
> `contract-regression` and `enforce-base` checks) and have at least
> **1 approving review** before it can be merged.

## Testing

```bash
npm test              # Run all tests (800 frontend)
npm run test:watch    # Watch mode
npm run coverage      # Coverage report
npm run typecheck     # TypeScript check
npm run lint          # ESLint
npm run test:openapi  # OpenAPI spec ↔ implementation conformance (drift)
npm run test:e2e      # E2E tests (requires a running server at E2E_BASE_URL)
npm run test:visual   # Visual regression tests
npm run test:visual:update # Update visual baselines
```

### Coverage ratchet

Coverage is enforced by **per-directory budgets**, not one global number
(`vitest.config.ts`). A single 80% global threshold was simultaneously too
strict for thin, presentational surface area and too lenient for the
money-handling API and security modules: a well-covered component could
subsidise a thinly-covered auth or webhook module and keep the aggregate green.

The measured surface is `src/lib/**`, `src/components/**`, `src/hooks/**` and
`src/app/**`. `src/app/api/**` is included exactly once, as part of
`src/app/**` — do not add a second, overlapping include entry.

| Band | Glob(s) | Baseline (st / br / fn / ln) | Budget |
|---|---|---|---|
| 1 · API route handlers | `src/app/api/**` | 71.3 / 68.9 / 70.4 / 74.4 | 71 / 68 / 70 / 74 |
| 1 · Security modules | `src/lib/{auth-rate-limit,auth-session,challenge,csrf,csrf-route-registry,crypto,lookup-rate-limit,sanitize,session,validation-schemas,webhook-url-guard}.ts` | 90.4 / 90.1 / 94.1 / 92.5 | 90 / 89 / 93 / 92 |
| 2 · Shared lib logic | `src/lib/**` | 87.8 / 84.7 / 91.2 / 89.2 | 87 / 84 / 90 / 89 |
| 3 · UI components | `src/components/**` | 70.4 / 75.0 / 69.1 / 71.5 | 70 / 74 / 69 / 71 |
| 3 · Hooks | `src/hooks/**` | 95.3 / 82.5 / 95.7 / 97.1 | 95 / 82 / 95 / 97 |
| 3 · App pages | `src/app/**` | 55.2 / 52.5 / 43.6 / 56.9 | 55 / 52 / 43 / 56 |

A file must clear **every band whose glob it matches**, so the strictest band
wins. That is what makes a security module's budget bite even though it also
sits inside the broader `src/lib/**` band.

**The ratchet only turns one way: budgets may rise, never fall.** When a change
raises a band's measured coverage, bump that band's numbers in
`vitest.config.ts` in the same PR. Lowering a budget to make a red build green is
a review-blocking change — fix the coverage or document the exception
explicitly in the PR description instead. Baselines in the table above are
refreshed whenever a band's budget moves.

```bash
# Run the gate locally exactly as CI does
npm run coverage
```

### Dark-mode colour guard

`src/__tests__/dark-mode-color-guard.test.ts` fails CI if the colour-critical
components (status badges, toasts, the payment timeline, the analytics charts)
introduce a raw colour literal such as `text-[#ff0000]` or
`style={{ color: "#3b82f6" }}`. Use theme tokens (CSS variables) or a Tailwind
pair (`text-red-500 dark:text-red-400`) so the colour adapts to dark mode.

## Changelog

Every user-facing change must be recorded in [`CHANGELOG.md`](CHANGELOG.md).
The file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with
[Semantic Versioning](https://semver.org/).

- Read the [Changelog Maintenance Guide](docs/CHANGELOG_GUIDE.md) before adding
  or updating an entry — it documents the category conventions (Added / Changed /
  Fixed / Removed / Security) with examples and the release flow.
- Add entries under the existing `## [Unreleased]` section in the same PR as the
  change. Do not create a new `[Unreleased]` heading per PR.
- Internal changes (refactors with no observable behavior change, test-only
  changes, CI plumbing) do not need an entry.
- Reviewers will ask for an entry on any user-facing change; treat a missing
  entry as a review-blocking item.

See the [release flow](docs/CHANGELOG_GUIDE.md#6-release-flow) in the guide for
how versions are chosen and releases are cut.

## Smart Contracts

Contracts are in `contracts/`. Build with:

```bash
cd contracts/ophirpay && cargo test   # 58 contract tests
cd contracts/emitter && cargo test    # 6 emitter tests
```

Contract WASM size is enforced in CI (hard limit: 128 KB per contract, the
Soroban protocol limit) by the `contract-regression` job in
`.github/workflows/contract-regression.yml`.

## Pull Request Process

1. Create a branch from the branch the issue targets (`main`, or
   `integration/staging` while batch mode is active): `feat/my-feature` or
   `fix/my-bug`
2. Make your changes, following existing code conventions
3. Run `npm run ci` locally to verify everything passes
4. Push and open a PR against that branch — CI runs automatically
5. Ensure all required checks pass (✅ green)
6. Request review from a maintainer (CODEOWNERS auto-assigns reviewers)
7. Once approved and all checks pass, squash-merge to the target branch

## Issue Labels & Their Meanings

OphirPay uses a two-tier label scheme: **plain labels** (semantic) and
**emoji labels** (stack-area). Bounty-eligible work is tagged with a
**`bounty`** label plus a **`Stellar Wave`** program label and a
**`difficulty:`** estimate.

### Semantic labels

| Label | Meaning | What to do with it |
|---|---|---|
| `bug` | Something isn't working | Reproduce, add a failing test, fix, reference `Fixes #…` |
| `enhancement` | New feature or improvement request | Discuss scope in the issue, then implement |
| `feature` | Larger feature-tracked work | See the linked epic/Roadmap item |
| `documentation` | Docs-only change (guides, README, comments) | Edit docs; keep commands copy-pasteable and verified |
| `good first issue` | Small, well-scoped task for newcomers | Grab it — it's the intended on-ramp |
| `help wanted` | Extra attention needed | Comment to coordinate before starting |
| `question` | Needs clarification, not code | Answer with detail; close once resolved |
| `duplicate` | Already tracked elsewhere | Link the original issue |
| `invalid` | Not a valid issue/PR for this repo | Explain why when closing |
| `wontfix` | Accepted, will not be worked on | Leave a note on the decision |

### Stack-area labels

| Label | Area | Example use |
|---|---|---|
| `frontend` / `🎨 frontend` | UI components, pages, styling | Payment form, dashboard |
| `backend` / `🔧 backend` | API routes, server logic | `/api/payments`, rate limiting |
| `contracts` / `📦 contracts` | Soroban Rust contracts | `contracts/ophirpay`, `contracts/emitter` |
| `security` / `🔒 security` | Auth, RBAC, secrets, audit | `AUTH_SECRET`, governance, multisig |
| `tests` / `🧪 tests` | Vitest/Playwright coverage | New unit or e2e tests |
| `ci` | CI/CD pipeline changes | `.github/workflows/ci.yml` |
| `performance` | Gas, latency, bundle size | `docs/GAS.md` related work |
| `devops` / `⚙️ devops` | Docker, Helm, K8s, monitoring | `helm/`, `k8s/`, `monitoring/` |
| `database` / `🗄️ database` | Prisma schema & migrations | `prisma/schema.prisma` |
| `dependencies` / `📦 dependencies` | npm/cargo dependency bumps | Renovate/Dependabot PRs |
| `hooks` / `🪝 hooks` | React hooks | `src/lib/`, custom hooks |
| `types` / `📐 types` | TypeScript types & ABI | `src/types/contract-abi.ts` |
| `lib` / `📚 lib` | Shared libraries | `src/lib/` utilities |
| `docs` / `📝 docs` | Documentation | Guides in `docs/` |

> 💡 **PR auto-labeling**: the `pr-labeler` CI job applies stack-area labels to
> PRs automatically from the changed paths — you don't need to label your PR
> by hand.

## Bounty Process (Stellar Wave)

OphirPay participates in the **Stellar Wave** bounty program. Bounty-eligible
issues carry the **`bounty`** + **`Stellar Wave`** labels and a difficulty
estimate (e.g. `difficulty: medium`). Each bounty issue's acceptance criteria
are the contract for payout — the PR must satisfy them exactly.

### Claiming a bounty

1. **Find a bounty issue** — filter for the `bounty` label (with `Stellar Wave`)
   and read its acceptance criteria + implementation hints.
2. **Comment to claim it**: reply on the issue saying you'd like to take it on
   (e.g. "I'd like to work on this one").
3. **Wait for assignment** — a maintainer will assign you. Do not open a PR
   for a bounty issue before you are assigned.
4. **Create your branch** from `main` using the issue's suggested branch name
   (e.g. `feat(wasm)/compute-WASM-hash-early-and-display-before-simulat`).
5. **Implement** following the issue's key-files hints and this guide's
   conventions (Conventional Commits, `npm run ci` green, tests added).
6. **Open the PR** referencing the issue with **`Closes #<number>`** in the
   description so the issue auto-closes on merge.
7. **Make sure CI is green** — all required checks must pass.
8. **Request review** from a maintainer and respond to feedback.
9. **Merge** — once approved and merged, the bounty issue closes and payout is
   processed per the program's terms.

### Bounty etiquette

- Claim **one issue at a time**; finish it before claiming the next.
- If you can't finish, **unassign yourself** (or comment) early so someone
  else can pick it up.
- **Don't** claim an issue and submit a PR that only partially satisfies the
  acceptance criteria — partial work delays the bounty and the review.
- A PR that references `Closes #…` for a bounty issue is the record of the
  work; keep the description detailed so reviewers can verify every
  acceptance criterion.

## Definition of Done (DoD) for PRs

A PR is **done** — ready for review and merge — when **all** of the following
hold. This mirrors the [pull request template](.github/pull_request_template.md)
and the required CI checks listed above.

### Functional & code requirements

- [ ] Addresses the issue's acceptance criteria **completely** (docs issues:
  every requested section exists and is accurate)
- [ ] Follows existing code conventions and the repo's style (Prettier + ESLint)
- [ ] No new lint warnings (`npm run lint` clean)
- [ ] No new type errors (`npx tsc --noEmit` clean)
- [ ] Tests added/updated for the change, and the full suite passes
  (`npm test` — 1,000+ tests; contract changes also need `cargo test`)
- [ ] No new security findings (secret-scan, npm audit advisory level)

### Contract changes (additional)

- [ ] `cargo build --target wasm32v1-none --release` succeeds for the changed
  contract
- [ ] Contract WASM stays under the 128 KB Soroban protocol limit (CI
  enforces it)
- [ ] Rust tests added/updated in the contract's `src/lib.rs` and passing
- [ ] If the contract ABI changed: TypeScript types updated in
  `src/types/contract-abi.ts`

### Documentation changes (additional)

- [ ] Commands are copy-pasteable and were verified (or clearly marked as
  expectations)
- [ ] New docs are linked from the README or the appropriate index page
- [ ] No typos (`typos` spell-check CI job passes)
- [ ] Cross-links use relative paths so they work on GitHub and in the docs

### Checklist before opening the PR

- [ ] Branch is based on current `main` and named `feat/…`, `fix/…`,
      `docs/…`, `ci/…`, or `test/…`
- [ ] `npm run ci` passes locally (typecheck → lint → test → build)
- [ ] PR description explains **what** changed and **why**, references the
      issue with `Closes #…`, and includes a test plan
- [ ] All required CI checks are green on the PR
- [ ] At least 1 maintainer approval obtained before merge

> If any box can't be ticked, say so explicitly in the PR description with the
> reason — a documented exception beats a silent one.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
