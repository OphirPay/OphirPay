# Contributing to OphirPay

Thank you for your interest in contributing! OphirPay is an open-source payment orchestration layer for Stellar.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/OphirPay.git`
3. Install dependencies: `npm install`
4. Set up the database: `npx prisma db push && npx prisma generate`
5. Start the dev server: `npm run dev`

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

### Adding or changing an API endpoint

Before adding or modifying an API endpoint, read the [API Endpoint Guide](docs/API_GUIDE.md). It documents the mandatory conventions: file structure, Zod validation, the error-handling pattern, auth middleware usage, the response envelope, rate-limit integration, a copy-pasteable worked example, and a pre-merge checklist.

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
