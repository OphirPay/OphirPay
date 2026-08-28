# Contributing to OphirPay

Thank you for your interest in contributing! OphirPay is an open-source payment orchestration layer for Stellar.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/OphirPay.git`
3. Install dependencies: `npm install`
4. Set up the database: `npx prisma db push && npx prisma generate`
5. Start the dev server: `npm run dev`

## Development Workflow

- **Branch naming**: `feat/feature-name`, `fix/bug-description`, `docs/what-changed`, `ci/what-changed`, `test/what-changed`
- **Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org)
- **Before submitting**: Run `npm run ci` (typecheck → lint → test → build)

## 15-Job CI/CD Pipeline

Every PR triggers 15 independent CI/CD checks across quality, testing, security, and DevOps:

| # | Job | Runs on PR | Blocks merge |
|---|---|---|---|
| 1 | Lint — ESLint | ✅ | ✅ Required |
| 2 | TypeCheck — tsc | ✅ | ✅ Required |
| 3 | Unit Tests — Vitest | ✅ | ✅ Required |
| 4 | Coverage — Vitest | ✅ | ⚠️ Informational |
| 5 | Contract WASM Build | ✅ | ✅ Required |
| 6 | Next.js Build | ✅ | ✅ Required |
| 7 | E2E — Chromium | ✅ | ✅ Required |
| 8 | E2E — Firefox | ✅ | ✅ Required |
| 9 | Prisma Validate | ✅ | ✅ Required |
| 10 | Docker Build | ✅ | ⚠️ Informational |
| 11 | K8s Validate | ✅ | ✅ Required |
| 12 | Helm Lint | ✅ | ✅ Required |
| 13 | Secret Scan — Gitleaks | ✅ | ✅ Required |
| 14 | npm Audit | ✅ | ⚠️ Advisory |
| 15 | PR Auto-Label | ✅ | ℹ️ No block |

### Branch Protection Rules (recommended)

Configure these in **Settings → Branches → Branch protection rules** for `main`:

- **Require a pull request before merging**: ✅
- **Require approvals**: 1 minimum
- **Dismiss stale pull request approvals when new commits are pushed**: ✅
- **Require status checks to pass before merging**: ✅
  - Required checks: `lint`, `typecheck`, `unit-tests`, `contract-wasm`, `next-build`, `e2e-chromium`, `e2e-firefox`, `prisma-validate`, `k8s-validate`, `helm-lint`, `secret-scan`
- **Require conversation resolution before merging**: ✅
- **Require signed commits**: Recommended
- **Require linear history**: Recommended
- **Do not allow bypassing the above settings**: ✅

### Merge Requirements Summary

> A PR must pass **11 of 15** checks (excludes coverage, npm audit, Docker build, PR labeler) and have at least **1 approving review** before it can be merged to `main`.

## Testing

```bash
npm test              # Run all tests (800 frontend)
npm run test:watch    # Watch mode
npm run coverage      # Coverage report
npm run typecheck     # TypeScript check
npm run lint          # ESLint
```

## Smart Contracts

Contracts are in `contracts/`. Build with:

```bash
cd contracts/ophirpay && cargo test   # 58 contract tests
cd contracts/emitter && cargo test    # 6 emitter tests
```

Contract WASM size is enforced in CI (hard limit: 128 KB per contract, the
Soroban protocol limit) and a per-function gas report is uploaded as a build
artifact — see the `contract-gas-report` job in `.github/workflows/ci.yml`.

## Repository Label Taxonomy & Meaning

We use a structured labeling system to triage work, communicate difficulty, and signal bounty eligibility:

| Label | Color | Purpose & Meaning |
|---|---|---|
| `bounty` | `#5319e7` | Funded task eligible for payout upon completed review & merge. |
| `Stellar Wave` | `#5555ff` | Issues funded directly under the Stellar Drips Wave program. |
| `difficulty: easy` | `#0e8a16` | Small scope, self-contained tweaks, documentation fixes (~15-30m). |
| `difficulty: medium` | `#0e8a16` | Standard feature or test additions, multi-component refactors (~30-60m). |
| `difficulty: high` | `#B60205` | Architectural changes, cross-contract protocols, complex integrations. |
| `security` | `#1afe81` | Rate-limiting, cryptographic verification, XSS/sanitization, auth hardening. |
| `documentation` | `#0075ca` | Runbooks, guides, API cookbook, schema references. |
| `ci` | `#9104df` | GitHub Actions workflow optimizations, test matrix sharding, automation. |
| `tests` | `#1560de` | Unit test fixtures, regression test suites, property testing, E2E coverage. |
| `frontend` | `#1a2fbd` | React 19 UI, Tailwind CSS components, responsive layouts, accessibility. |
| `contracts` | `#f118b4` | Soroban Rust contracts, WASM optimization, gas reporting. |

---

## 💎 Bounty Process & Claim Workflow

OphirPay participates in open-source developer bounty programs (including the Stellar Wave Program). Follow this step-by-step workflow to claim and resolve bounties:

1. **Find an Open Issue**: Browse issues with the `bounty` and `Stellar Wave` labels that have no open pull requests.
2. **Review Acceptance Criteria**: Read the issue specification and acceptance criteria thoroughly.
3. **Branch & Implement**:
   - Create a clean git branch: `feat/<issue-num>-<description>` or `test/<issue-num>-<description>`.
   - Keep your changes surgical, minimal, and strictly scoped to the issue.
4. **Local Verification**:
   - Run `npm run typecheck` (0 errors).
   - Run `npm run lint -- --max-warnings 0` (0 warnings/errors).
   - Run `npx vitest run` or targeted test suite with 100% pass rate.
5. **Open Pull Request & Claim**:
   - Title your PR following Conventional Commits: `feat(scope): brief description (#issue)`
   - Include `Fixes #<issue-number>` and `/claim #<issue-number>` in the PR description.
   - Provide clear summary of changes, testing steps, and acceptance checklist.

---

## ✅ Definition of Done (DoD) for Pull Requests

Before a PR is ready for maintainer review and merge, it must satisfy:

- [ ] **Acceptance Criteria Met**: Every item in the issue acceptance criteria is fully implemented.
- [ ] **Zero Regressions**: All existing unit and E2E tests continue to pass cleanly.
- [ ] **New Test Fixtures**: Every bugfix or new feature includes automated unit/integration tests covering both happy paths and edge cases.
- [ ] **Type & Lint Safety**: Strict TypeScript compilation passes with zero type assertions (`as any`), and ESLint passes with zero warnings.
- [ ] **Documentation**: Any new config options, API routes, or environment variables are documented in the respective guide or README.
- [ ] **Minimal Diff**: Diff does not include unintended whitespace changes, unformatted files, or extraneous dependencies.

---

## Pull Request Process

1. Create a branch from `main`: `feat/my-feature` or `fix/my-bug`
2. Make your changes, following existing code conventions
3. Run `npm run ci` locally to verify everything passes
4. Push and open a PR — the 15-job CI pipeline runs automatically
5. Ensure all 11 required checks pass (✅ green)
6. Request review from a maintainer (CODEOWNERS auto-assigns reviewers)
7. Once approved and all checks pass, squash-merge to `main`

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

