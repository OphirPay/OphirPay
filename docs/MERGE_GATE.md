# 🚦 Pull Request Merge Gate & CI Workflow Guide

> Comprehensive reference for contributors, maintainers, and reviewers documenting the exact status checks gating merges into `integration/staging` and `main`, their local reproduction commands, path-scoped rules, and scheduled operational workflows.

---

## 1. Overview & Branch Protection Architecture

OphirPay enforces an automated quality gate across all pull requests to ensure stability, security, contract invariants, and zero regressions.

### Branch Protection & Target Branch Constraints
* **Batch Integration Mode (`integration/staging`):** While the `integration/staging` branch exists, **all pull requests must target `integration/staging`** (enforced automatically by `.github/workflows/enforce-integration-branch.yml`). PRs targeting `main` fail immediately.
* **Required Approvals:** At least **1 approving review** from a repository maintainer is required to merge.
* **Dismiss Stale Approvals:** New commits pushed to a pull request invalidate existing approvals and re-run all status checks.
* **Strict Status Checks:** All required checks in the merge gate table below must complete with status `success` before the **Merge** button unlocks.

---

## 2. The Pull Request Merge Gate

The following table lists every check that runs on pull requests, indicating whether it is **blocking (required)**, its trigger scope, and how to run it locally.

| # | Check Name | GitHub Status Check Name | Workflow File | Trigger Scope | Merge Gating Status | Local Command |
|---|---|---|---|---|---|---|
| **1** | **Lint** | `1️⃣ Frontend — Lint (ESLint)` | `ci.yml` | Every PR | ⛔ **Required** | `npm run lint -- --max-warnings 0` |
| **2** | **Typecheck** | `2️⃣ Frontend — TypeCheck (tsc)` | `ci.yml` | Every PR | ⛔ **Required** | `npx prisma generate && npm run typecheck` |
| **3** | **Unit Tests** | `3️⃣ Frontend — Unit Tests (Vitest)` | `ci.yml` | Every PR | ⛔ **Required** | `npx prisma generate && npm test` |
| **4** | **Next.js Build & Bundle Budget** | `9️⃣ Frontend — Build (Next.js)` | `ci.yml` | Every PR | ⛔ **Required** | `npm run build && node scripts/check-bundle-budget.mjs` |
| **5** | **Contract WASM & Unit Tests** | `5️⃣ Backend — Contracts (WASM + Tests)` | `ci.yml` | Every PR | ⛔ **Required** | `cd contracts/ophirpay && cargo test && cd ../emitter && cargo test` |
| **6** | **Deploy Config Validation** | `1️⃣0️⃣ Deploy — Config Guards` | `ci.yml` | Every PR | ⛔ **Required** | `bash scripts/validate-deploy-config.sh` |
| **7** | **Secrets Detection** | `1️⃣2️⃣ Security — Secrets (Gitleaks)` | `ci.yml` | Every PR | ⛔ **Required** | `gitleaks detect --config .gitleaks.toml --verbose --redact` |
| **8** | **Helm Lint & Render** | `1️⃣9️⃣ Infra — Helm (Lint + Render)` | `ci.yml` | Every PR | ⛔ **Required** | `helm lint helm/ophirpay --strict && bash scripts/validate-helm-render.sh` |
| **9** | **Integration Branch Target** | `🚧 Enforce Integration Branch` | `enforce-integration-branch.yml` | Every PR | ⛔ **Required** | Ensure PR target branch is set to `integration/staging` |
| **10** | **Prisma Schema & Migrations** | `Validate schema, replay migrations, and test invariants` | `prisma-ci.yml` | Path-scoped (`prisma/**`, migration scripts, tests) | ⛔ **Required** *(when paths match)* | `npx prisma validate && bash scripts/validate-prisma-migrations.sh` |
| **11** | **Contract Regression & Size** | `contract-regression` | `contract-regression.yml` | Path-scoped (`contracts/**`, scripts) | ⛔ **Required** *(when paths match)* | `node scripts/check-contract-regressions.mjs` |
| **12** | **README Translations Sync** | `Check translated READMEs are in sync` | `readme-sync-check.yml` | Path-scoped (`README*.md`, scripts) | ⛔ **Required** *(when paths match)* | `node scripts/check-readme-sync.mjs` |
| **13** | **Docker Image Smoke Test** | `docker-smoke` | `docker-smoke.yml` | Path-scoped (`Dockerfile`, `helm/**`, `k8s/**`) | ℹ️ *Advisory / Smoke* | `bash scripts/docker-smoke.sh` |
| **14** | **PR Labeler** | `🏷️ Meta — PR Labeler` | `pr-labeler.yml` | Every PR (`pull_request_target`) | ℹ️ *Advisory / Non-blocking* | N/A (GitHub Actions metadata) |

---

## 3. The One-Command Local Gate: `npm run ci`

To mirror the required frontend, typecheck, lint, test, build, and deploy guards locally before pushing a branch, run:

```bash
# Clean install matching package-lock.json and run the local gate
npm ci
npm run ci
```

### What `npm run ci` Executes (in sequential order):
1. **`npm run typecheck` (`tsc --noEmit`)**: Verifies strict TypeScript type adherence across all source files and components.
2. **`npm run lint -- --max-warnings 0` (`eslint .`)**: Validates code conventions, import formatting, and suppression hygiene with zero allowed warnings.
3. **`npm test` (`vitest run`)**: Executes all Vitest frontend unit tests and enforces per-directory coverage ratchet thresholds.
4. **`npm run build` (`next build`)**: Builds the Next.js production bundle, generates static artifacts, and validates client page dependencies.
5. **`node scripts/check-bundle-budget.mjs`**: Asserts that client JS bundle chunks do not exceed committed route budgets.
6. **`bash scripts/validate-deploy-config.sh`**: Ensures deploy scripts target Stellar Mainnet securely with disabled friendbot and strict dry-run guards.

---

## 4. Path-Scoped Checks Explained

Certain checks only run when relevant files are modified. When triggered, they become **hard merge blockers**:

### 1. Database Schema & Migration Invariants (`prisma-ci.yml`)
* **Trigger Paths:** `prisma/**`, `scripts/validate-prisma-migrations.sh`, `src/__tests__/prisma-schema-ci.test.ts`, `.github/workflows/prisma-ci.yml`.
* **What it validates:**
  - `npx prisma validate`: Verifies `schema.prisma` syntax.
  - `scripts/validate-prisma-migrations.sh`: Verifies migration names, timestamps, and structure.
  - `npx prisma migrate diff`: Proves zero drift between `schema.prisma` and committed migrations.
  - `npx prisma migrate deploy`: Applies all migrations cleanly against a clean PostgreSQL 16 container.
  - Vitest schema invariance test suite.
* **Local Reproduction:**
  ```bash
  npm run db:validate
  bash scripts/validate-prisma-migrations.sh
  ```

### 2. Contract WASM Regression & Size Guard (`contract-regression.yml`)
* **Trigger Paths:** `contracts/**`, `scripts/check-contract-regressions.mjs`, `.github/workflows/contract-regression.yml`.
* **What it validates:** Compiles optimized Soroban WASM artifacts and ensures bytecode size does not grow by more than 3% over `contracts/wasm-baseline.json`. Also verifies on-chain gas fee models.
* **Local Reproduction:**
  ```bash
  cd contracts/ophirpay && cargo test --test fee_report -- --nocapture
  cd ../..
  node scripts/check-contract-regressions.mjs
  ```

### 3. Translated README Synchronization (`readme-sync-check.yml`)
* **Trigger Paths:** `README.md`, `README.*.md`, `scripts/check-readme-sync.mjs`.
* **What it validates:** Verifies that structural headings, links, and code blocks in translated README files (`README.zh-CN.md`, `README.es.md`, etc.) remain in lockstep with the canonical English `README.md`.
* **Local Reproduction:**
  ```bash
  node scripts/check-readme-sync.mjs
  ```

---

## 5. Scheduled & Operational Workflows (Non-Gating)

The following workflows run on schedules or administrative triggers. **They do NOT run on pull requests and do NOT gate pull request merges**:

| Workflow File | Name | Trigger Schedule | Purpose | Gates PR Merges? |
|---|---|---|---|---|
| `db-backup.yml` | Database Backup | Nightly (`0 2 * * *`) | Dumps PostgreSQL database and syncs encrypted archive to AWS S3. | ❌ **No** |
| `dependency-scan.yml` | Dependency Security Scan | Weekly (`0 3 * * 1`) | Audits npm and cargo dependencies for known CVEs. | ❌ **No** |
| `e2e-nightly.yml` | Nightly E2E Test Suite | Nightly (`0 4 * * *`) | Runs full Playwright end-to-end matrix against deployed Testnet instance. | ❌ **No** |
| `scheduled-payments-cron.yml` | Scheduled Payments Processor | Hourly (`0 * * * *`) | Triggers automated payment recurrence execution job. | ❌ **No** |
| `scorecard.yml` | OpenSSF Scorecard | Weekly (`0 4 * * 1`) | Analyzes repository supply-chain posture and reports to OpenSSF. | ❌ **No** |
| `stale.yml` | Stale Issue & PR Cleanup | Daily (`0 0 * * *`) | Flags and closes inactive issues and abandoned pull requests. | ❌ **No** |

---

## 6. Reviewer & Maintainer Checklist

Before approving or merging any pull request:

- [ ] All required checks in the **Pull Request Merge Gate** table show green checkmarks (✅).
- [ ] PR targets `integration/staging` (or `main` if batch integration mode is retired).
- [ ] No unhandled merge conflicts or out-of-date branch warnings.
- [ ] No disabled ESLint rules or unhandled TypeScript `any` casts without justification.
- [ ] All discussions and review comments are resolved.

