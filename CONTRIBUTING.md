# Contributing to OphirPay

Thank you for your interest in contributing! OphirPay is an open-source payment orchestration layer for Stellar.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/OphirPay.git`
3. Install dependencies: `npm install`
4. Set up the database: `npx prisma db push && npx prisma generate`
5. Start the dev server: `npm run dev`

> 💡 **New to Stellar or Soroban?** Check out the
> [Stellar & Soroban glossary](GLOSSARY.md) — it defines the terms used
> throughout the codebase (XLM, testnet, friendbot, Horizon, Soroban, SAC,
> WASM, Freighter, memo, trustline, path payments, sponsored reserves, and
> more).

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

## Label Legend

We use a small set of labels to communicate issue type, difficulty, and program affiliation.

| Label | Meaning | Used on |
|---|---|---|
| `bug` | Something is broken or not behaving as documented. | Issues & PRs |
| `frontend` | Work primarily in the Next.js app (`src/`). | Issues & PRs |
| `contracts` | Work in the Soroban Rust contracts (`contracts/`). | Issues & PRs |
| `documentation` | Docs, README, runbooks, or inline comments. | Issues & PRs |
| `tests` | Unit, integration, E2E, or property tests. | Issues & PRs |
| `ci` | CI/CD, build, or deployment automation. | Issues & PRs |
| `security` | Security hardening, audit fixes, or vulnerability mitigations. | Issues & PRs |
| `good-first-issue` | Low-risk entry point for new contributors. | Issues |
| `difficulty: medium` | Self-contained task; usually 2-6 hours of focused work. | Issues |
| `Stellar Wave` | Part of the Stellar Wave bounty program on Drips. | Issues |

> **Tip:** If an issue has both `Stellar Wave` and a difficulty label, it is eligible for bounty points through the [Drips Wave program](https://www.drips.network/wave/stellar).

## Bounty Claim Flow

OphirPay participates in the Stellar Wave Program. To claim a bounty:

1. **Find an issue** on the [Drips Wave Stellar board](https://www.drips.network/wave/stellar/issues) or in our GitHub issues with the `Stellar Wave` label.
2. **Apply on Drips** before starting work. Drips Wave uses an application-first model; the first accepted applicant is the one eligible for the reward.
3. **Wait for acceptance**. You will receive a notification when a maintainer accepts your application and assigns a due date.
4. **Fork and branch** from `main`. Use a branch name like `feat/issue-123-short-description` or `docs/issue-456-what-changed`.
5. **Implement and test** locally. Run the full local CI pipeline:
   ```bash
   npm run ci
   cd contracts/ophirpay && cargo test
   ```
6. **Open a Pull Request** referencing the issue: `Closes #123`.
7. **Address review feedback** promptly. Maintainers aim to review within 48 hours during active Waves.
8. **Get merged**. Once merged and the issue is closed, Drips will automatically assess the contribution for payout.

> ⚠️ **Important:** Submitting a PR without first being accepted on Drips does not guarantee the bounty. Always apply through Drips first.

## Definition of Done

A PR is considered ready for review when all of the following are true:

- [ ] The PR description explains **what** changed and **why**, and references the issue it closes.
- [ ] The branch is up to date with `main` and has no unresolved merge conflicts.
- [ ] All required CI checks pass (see the 15-job pipeline table above).
- [ ] New behavior is covered by tests when applicable.
- [ ] Existing tests continue to pass.
- [ ] TypeScript types are correct (`npm run typecheck`).
- [ ] Code follows the existing style (`npm run lint`).
- [ ] Documentation is updated if the change affects user-facing behavior, APIs, or deployment steps.
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org).
- [ ] Review feedback has been resolved and the PR has at least one approving review.
