# Pull request merge gate

While `integration/staging` exists, pull requests must target that branch. The
required checks below run on pull requests and are the merge gate. Run
`npm run ci` locally for the application checks; the repository-specific
commands are listed so failures can be reproduced individually.

| Required check | Workflow | Gate Job Name | Local command |
| --- | --- | --- | --- |
| Typecheck | `ci.yml` | `Typecheck` | `npm run typecheck` |
| ESLint (zero warnings) | `ci.yml` | `ESLint (zero warnings)` | `npm run lint -- --max-warnings 0` |
| Unit tests | `ci.yml` | `Unit tests` | `npm test` |
| Next.js build | `ci.yml` | `Next.js build` | `npm run build` |
| Deploy configuration guards | `ci.yml` | `Deploy configuration guards` | `bash scripts/validate-deploy-config.sh` |
| Contract WASM and Rust tests | `ci.yml` | `Contract WASM and Rust tests` | `cd contracts/ophirpay && cargo test`; repeat in `contracts/emitter` |
| Secrets scan | `ci.yml` | `Secrets scan` | `gitleaks detect --config .gitleaks.toml --redact` |
| Helm lint/render | `ci.yml` | `Helm lint/render` | `helm lint helm/ophirpay` |
| Prisma schema and migration replay | `prisma-ci.yml` | `Prisma Gate` | `npm run db:validate:migrations` |
| Contract regression guard | `contract-regression.yml` | `Contract Regression Gate` | `node scripts/check-contract-regressions.mjs` |
| Docker smoke test (when required) | `docker-smoke.yml` | `Docker Smoke Gate` | `docker build -t ophirpay:smoke .` |
| Integration-branch policy | `enforce-integration-branch.yml` | `Enforce integration branch` | Open the PR against `integration/staging` |

### Path-filtered gate jobs

`prisma-ci.yml`, `contract-regression.yml`, and `docker-smoke.yml` use a path
detection job (`dorny/paths-filter`) paired with an always-running `gate` job.
When configuring branch protection, mark **only the gate job** as required:
- `Prisma Gate`
- `Contract Regression Gate`
- `Docker Smoke Gate` (if enabled in branch protection)

Because the gate job runs unconditionally and succeeds when the heavy work is
either skipped (no matching file changes) or passes, unrelated pull requests
(such as documentation changes) will report the check as passed instead of
stalling on "Expected — waiting for status". The integration-branch policy is
required for every PR while the batch-integration branch exists.

## Scheduled or advisory workflows

The following workflows are operational or advisory and are not merge-gate
checks for an ordinary pull request:

- `dependency-scan.yml` — nightly dependency vulnerability scan.
- `e2e-nightly.yml` — scheduled/dispatch end-to-end coverage.
- `scheduled-payments-cron.yml` — scheduled payment sweep.
- `db-backup.yml` — scheduled database backup.
- `scorecard.yml` — scheduled OpenSSF scorecard analysis.
- `stale.yml` — scheduled issue and PR housekeeping.

`docker-smoke.yml` may run on pull requests, but it is an auxiliary deployment
smoke test unless branch protection explicitly marks its check required. Review
the repository’s branch-protection settings when changing the required list;
this document describes the intended gate, not a replacement for GitHub
settings.

## One-command local gate

```bash
npm ci
npm run ci
```

The command runs typecheck, lint, unit tests, production build, and deploy
configuration validation in the same order as the main application workflow.
